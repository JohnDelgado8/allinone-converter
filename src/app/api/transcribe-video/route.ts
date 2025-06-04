// app/api/transcribe-video/route.ts
import { NextRequest, NextResponse } from 'next/server';
import fsPromises from 'fs/promises'; // Use fsPromises for async file operations
import fsSync from 'fs'; // For createReadStream with OpenAI
import path from 'path';
import os from 'os';
import ytdl from 'ytdl-core';
import OpenAI from 'openai';
import ffmpeg from 'fluent-ffmpeg';

// Optional: If ffmpeg is not in PATH, you might need to set its path
// You might need to install these if you use this method:
// npm install @ffmpeg-installer/ffmpeg @ffprobe-installer/ffprobe
// import ffmpegPath from '@ffmpeg-installer/ffmpeg';
// import ffprobePath from '@ffprobe-installer/ffprobe';
// ffmpeg.setFfmpegPath(ffmpegPath.path);
// ffmpeg.setFfprobePath(ffprobePath.path);


// --- OpenAI Client Initialization ---
if (!process.env.OPENAI_API_KEY) {
  console.error("FATAL ERROR: OPENAI_API_KEY is not set in environment variables.");
}
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function extractAudio(videoPath: string, outputDir: string): Promise<string> {
  const uniqueSuffix = Date.now() + "_" + Math.random().toString(36).substring(2, 8);
  const audioFileName = `${path.parse(videoPath).name}_${uniqueSuffix}_audio.mp3`;
  const audioOutputPath = path.join(outputDir, audioFileName);

  console.log(`Extracting audio from ${videoPath} to ${audioOutputPath}`);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .outputOptions('-map_metadata', '-1')
      .on('error', (err) => {
        console.error('FFmpeg audio extraction error:', err.message, err);
        reject(new Error('Failed to extract audio: ' + err.message));
      })
      .on('end', () => {
        console.log('Audio extraction finished:', audioOutputPath);
        resolve(audioOutputPath);
      })
      .save(audioOutputPath);
  });
}

async function transcribeWithWhisper(audioPath: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OpenAI API key is not configured. Cannot transcribe.");
  }
  console.log(`Transcribing audio with Whisper: ${audioPath}`);
  try {
    await fsPromises.access(audioPath, fsSync.constants.R_OK);

    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file: fsSync.createReadStream(audioPath),
    });
    
    // OpenAI.Audio.Transcriptions.Transcription type has `text: string;`
    const text = transcription.text;

    if (typeof text === 'string') {
      return text;
    } else {
      // This block is a fallback for unexpected API behavior or type mismatches.
      console.warn("Whisper API response 'text' field is not a string as expected. Full response:", transcription);
      
      const unknownTranscription = transcription as unknown;
      let extractedText: string | undefined = undefined;

      if (typeof unknownTranscription === 'object' && unknownTranscription !== null) {
        if ('text' in unknownTranscription && typeof (unknownTranscription as { text?: unknown }).text === 'string') {
          extractedText = (unknownTranscription as { text: string }).text;
        }
        else if ('data' in unknownTranscription) {
          const dataProp = (unknownTranscription as { data?: unknown }).data;
          if (typeof dataProp === 'object' && dataProp !== null && 'text' in dataProp && typeof (dataProp as { text?: unknown }).text === 'string') {
            extractedText = (dataProp as { text: string }).text;
          }
        }
      }

      if (extractedText !== undefined) {
        return extractedText;
      }
      
      throw new Error("Could not extract text from Whisper API response: 'text' field missing, not a string, or structure unexpected.");
    }

  } catch (error: unknown) { // Changed from any to unknown
    let detailMessage = "Unknown Whisper API error";
    let errorResponseData: unknown = null;

    if (error instanceof Error) {
        detailMessage = error.message;
    }

    // OpenAI SDK errors often have `error.response.data` or `error.error`
    if (typeof error === 'object' && error !== null) {
        if ('response' in error) {
            const errResponse = (error as { response?: unknown }).response;
            if (typeof errResponse === 'object' && errResponse !== null && 'data' in errResponse) {
                errorResponseData = (errResponse as { data: unknown }).data;
            } else {
                errorResponseData = errResponse;
            }
        } else if ('error' in error) { // Some OpenAI errors might be structured with an 'error' property
            errorResponseData = (error as { error: unknown }).error;
        } else {
            errorResponseData = error; // Fallback to the error object itself
        }
    }
    console.error("Whisper API Error:", errorResponseData ? errorResponseData : detailMessage, error); // Log full error for server-side debugging
    throw new Error(`Whisper API transcription failed: ${detailMessage}`);
  }
}


async function downloadYouTubeVideoAndExtractAudio(videoUrl: string, outputDir: string): Promise<{ audioFilePath: string; videoTitle: string }> {
  if (!ytdl.validateURL(videoUrl)) {
    throw new Error('Invalid YouTube URL');
  }
  const info = await ytdl.getInfo(videoUrl);
  const videoTitle = info.videoDetails.title.replace(/[<>:"/\\|?*]+/g, '').substring(0, 100); // Sanitize and shorten
  
  let format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
  if (!format || !format.url) {
      console.warn("No suitable 'audioonly' format found for YouTube video, trying highest quality with audio.");
      format = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: (f) => f.hasAudio });
      if (!format || !format.url) {
          throw new Error('Could not find a suitable video/audio format to download from YouTube.');
      }
  }

  const uniqueSuffix = Date.now() + "_" + Math.random().toString(36).substring(2, 8);
  const tempDownloadedVideoName = `youtube_${videoTitle.replace(/\s/g, '_')}_${uniqueSuffix}.${format.container || 'mp4'}`;
  const tempDownloadedVideoPath = path.join(outputDir, tempDownloadedVideoName);
  
  console.log(`Downloading YouTube content: ${videoTitle} to ${tempDownloadedVideoPath} (format: ${format.mimeType})`);

  const videoStream = ytdl(videoUrl, { format: format });
  const fileWriteStream = fsSync.createWriteStream(tempDownloadedVideoPath);

  await new Promise<void>((resolve, reject) => {
    videoStream.pipe(fileWriteStream);
    videoStream.on('end', () => {
        console.log(`Finished downloading YouTube content: ${videoTitle}`);
        resolve();
    });
    videoStream.on('error', (err) => {
        console.error("YouTube download stream error:", err);
        fileWriteStream.close(() => reject(new Error(`Failed to download YouTube content: ${err.message}`)));
    });
    fileWriteStream.on('error', (err) => {
        console.error("File write stream error:", err);
        reject(new Error(`Failed to write YouTube content to disk: ${err.message}`));
    });
  });
  
  const audioFilePath = await extractAudio(tempDownloadedVideoPath, outputDir);
  return { audioFilePath: audioFilePath, videoTitle };
}


export async function POST(req: NextRequest) {
  console.log("API /api/transcribe-video POST request received");
  const tempSessionDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'transcribe-session-'));
  let audioToTranscribePath: string | null = null;
  let videoTitleFromUrl: string | undefined = undefined;
  let originalFileNameForDisplay: string | undefined;

  try {
    const formData = await req.formData();
    const operationType = formData.get('operationType') as string | null; 

    console.log("Received operationType:", operationType);

    if (operationType === 'file') {
      const videoFile = formData.get('video') as File | null;
      if (!videoFile) {
        return NextResponse.json({ error: 'No video file provided for upload.' }, { status: 400 });
      }
      console.log(`File Upload: ${videoFile.name}, Size: ${videoFile.size}`);
      originalFileNameForDisplay = videoFile.name;
      const tempUploadedVideoPath = path.join(tempSessionDir, videoFile.name); 
      
      const videoBuffer = Buffer.from(await videoFile.arrayBuffer());
      await fsPromises.writeFile(tempUploadedVideoPath, videoBuffer);
      
      audioToTranscribePath = await extractAudio(tempUploadedVideoPath, tempSessionDir); 

    } else if (operationType === 'url') {
      const videoUrl = formData.get('videoUrl') as string | null;
      if (!videoUrl) {
        return NextResponse.json({ error: 'No video URL provided.' }, { status: 400 });
      }
      console.log(`URL Submission: ${videoUrl}`);
      const downloadResult = await downloadYouTubeVideoAndExtractAudio(videoUrl, tempSessionDir); 
      audioToTranscribePath = downloadResult.audioFilePath;
      videoTitleFromUrl = downloadResult.videoTitle;
      originalFileNameForDisplay = videoTitleFromUrl; // For URLs, use the fetched video title
    } else {
      console.error(`Invalid operationType received: ${operationType}`);
      return NextResponse.json({ error: 'Invalid operation type. Ensure "operationType" is sent correctly from the client.' }, { status: 400 });
    }
    
    if (!audioToTranscribePath) {
        throw new Error("No audio data could be prepared for transcription.");
    }
    console.log(`Audio data ready for transcription at: ${audioToTranscribePath}`);

    const transcriptionText = await transcribeWithWhisper(audioToTranscribePath);

    return NextResponse.json({ 
        transcription: transcriptionText, 
        videoTitle: videoTitleFromUrl,
        originalFileName: originalFileNameForDisplay // Used variable
    });

  } catch (error: unknown) { // Changed from implicit any
    console.error('API Route /api/transcribe-video Error:', error);
    let errorMessage = 'An unknown error occurred during transcription processing.';
    
    // This 'detailsForResponse' replaces the previous 'errorDetails = null' logic.
    let detailsForResponse: unknown = null; 

    if (error instanceof Error) {
      errorMessage = error.message;
    }

    // Populate detailsForResponse for more informative error messages client-side
    if (typeof error === 'object' && error !== null) {
        if ('response' in error) {
            const errResponse = (error as { response?: unknown }).response;
            if (typeof errResponse === 'object' && errResponse !== null && 'data' in errResponse) {
                detailsForResponse = (errResponse as { data: unknown }).data;
            } else {
                detailsForResponse = errResponse; 
            }
        } else if ('error' in error) { // Common structure for OpenAI SDK errors
            detailsForResponse = (error as { error: unknown }).error;
        } else if (error instanceof Error) {
            // Fallback: provide some structured info from the Error object
            // detailsForResponse = { name: error.name, message: error.message };
        } else {
            detailsForResponse = error; // Send the raw error object if it's not an Error instance.
        }
    }
    // The prefer-const error on a previous `let errorDetails = null;` is resolved
    // because we now have a variable `detailsForResponse` that is conditionally assigned.
    
    return NextResponse.json({ error: errorMessage, details: detailsForResponse }, { status: 500 });
  } finally {
    if (tempSessionDir) {
      try {
        console.log(`Attempting to clean up temporary session directory: ${tempSessionDir}`);
        await fsPromises.rm(tempSessionDir, { recursive: true, force: true });
        console.log(`Cleaned up temporary session directory: ${tempSessionDir}`);
      } catch (cleanupError) {
        console.error(`Error cleaning up temporary directory ${tempSessionDir}:`, cleanupError);
      }
    }
  }
}