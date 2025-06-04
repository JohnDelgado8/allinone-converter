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
  // In a real app, you might throw an error here or handle it gracefully
  // For this example, we'll let it potentially fail later if used.
}
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function extractAudio(videoPath: string, outputDir: string): Promise<string> {
  // Create a unique name for the audio file to prevent collisions if multiple requests process same named video
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
    // Ensure file exists before creating a read stream
    await fsPromises.access(audioPath, fsSync.constants.R_OK);

    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file: fsSync.createReadStream(audioPath),
    });
    
    if (typeof transcription.text === 'string') {
      return transcription.text;
    } else {
      console.warn("Unexpected Whisper API response format. Full response:", transcription);
      const possibleText = (transcription as any).text || (transcription as any).data?.text;
        if (possibleText) return possibleText;
      throw new Error("Could not extract text from Whisper API response.");
    }

  } catch (error: any) {
    console.error("Whisper API Error:", error.response ? error.response.data : error.message, error);
    throw new Error(`Whisper API transcription failed: ${error.message}`);
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
  // No need to explicitly delete tempDownloadedVideoPath here, as the entire tempSessionDir will be removed.
  return { audioFilePath: audioFilePath, videoTitle };
}


export async function POST(req: NextRequest) {
  console.log("API /api/transcribe-video POST request received");
  // Create a unique temporary directory for this session's files
  const tempSessionDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'transcribe-session-'));
  let audioToTranscribePath: string | null = null;
  let videoTitleFromUrl: string | undefined = undefined;
  let originalFileNameForDisplay: string | undefined;

  try {
    const formData = await req.formData();
    const operationType = formData.get('operationType') as string | null; // Get as string or null

    // Log the received operationType for debugging
    console.log("Received operationType:", operationType);

    if (operationType === 'file') {
      const videoFile = formData.get('video') as File | null;
      if (!videoFile) {
        return NextResponse.json({ error: 'No video file provided for upload.' }, { status: 400 });
      }
      console.log(`File Upload: ${videoFile.name}, Size: ${videoFile.size}`);
      originalFileNameForDisplay = videoFile.name;
      const tempUploadedVideoPath = path.join(tempSessionDir, videoFile.name); // Save uploaded file in session dir
      
      const videoBuffer = Buffer.from(await videoFile.arrayBuffer());
      await fsPromises.writeFile(tempUploadedVideoPath, videoBuffer);
      
      audioToTranscribePath = await extractAudio(tempUploadedVideoPath, tempSessionDir); // Extract audio into session dir

    } else if (operationType === 'url') {
      const videoUrl = formData.get('videoUrl') as string | null;
      if (!videoUrl) {
        return NextResponse.json({ error: 'No video URL provided.' }, { status: 400 });
      }
      console.log(`URL Submission: ${videoUrl}`);
      const downloadResult = await downloadYouTubeVideoAndExtractAudio(videoUrl, tempSessionDir); // Download and extract into session dir
      audioToTranscribePath = downloadResult.audioFilePath;
      videoTitleFromUrl = downloadResult.videoTitle;
      originalFileNameForDisplay = videoTitleFromUrl;
    } else {
      // If operationType is null, undefined, or not 'file'/'url'
      console.error(`Invalid operationType received: ${operationType}`);
      return NextResponse.json({ error: 'Invalid operation type. Ensure "operationType" is sent correctly from the client.' }, { status: 400 });
    }
    
    if (!audioToTranscribePath) {
        throw new Error("No audio data could be prepared for transcription.");
    }
    console.log(`Audio data ready for transcription at: ${audioToTranscribePath}`);

    const transcriptionText = await transcribeWithWhisper(audioToTranscribePath);

    return NextResponse.json({ transcription: transcriptionText, videoTitle: videoTitleFromUrl });

  } catch (error) {
    console.error('API Route /api/transcribe-video Error:', error);
    let errorMessage = 'An unknown error occurred during transcription processing.';
    let errorDetails = null;
    if (error instanceof Error) {
      errorMessage = error.message;
      // You might want to avoid sending full stack in production for some errors
      // errorDetails = error.stack; 
    }
    return NextResponse.json({ error: errorMessage, details: errorDetails }, { status: 500 });
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