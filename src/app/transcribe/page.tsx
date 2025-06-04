// app/transcribe/page.tsx
"use client";

import { useState, useCallback, FormEvent } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, Loader2, FileText, AlertTriangle, XCircle  } from 'lucide-react';
import { cn } from '@/app/lib/utils'; // VERIFY THIS PATH


export default function VideoTranscribePage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [transcription, setTranscription] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setError(null);
    setTranscription(null);
    if (acceptedFiles && acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      // Basic video type check (can be expanded)
      if (!file.type.startsWith('video/')) {
        setError('Invalid file type. Please upload a video file (e.g., MP4, MOV, AVI, WEBM).');
        setSelectedFile(null);
        setFileName(null);
        return;
      }
      // You might want to add a file size check here
      // if (file.size > MAX_VIDEO_SIZE_BYTES) {
      //   setError(`File is too large. Maximum size is ${MAX_VIDEO_SIZE_MB}MB.`);
      //   return;
      // }
      setSelectedFile(file);
      setFileName(file.name);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { // More specific video types
        'video/mp4': ['.mp4', '.MP4'],
        'video/quicktime': ['.mov', '.MOV'],
        'video/webm': ['.webm', '.WEBM'],
        'video/x-msvideo': ['.avi', '.AVI'], // AVI
        'video/x-matroska': ['.mkv', '.MKV'], // MKV
        // Add other common video types if needed
    },
    multiple: false,
  });

  const handleTranscribe = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setError('Please select a video file first.');
      return;
    }
    setIsTranscribing(true);
    setError(null);
    setTranscription(null);

    const formData = new FormData();
    formData.append('video', selectedFile);

    try {
      const response = await fetch('/api/transcribe-video', { // New API route
        method: 'POST',
        body: formData,
        // Note: For large file uploads, you might need a more robust solution
        // than default fetch if timeouts or body size limits become an issue.
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status}` }));
        throw new Error(errorData.error || errorData.details || `Transcription failed: ${response.status}`);
      }

      const result = await response.json();
      setTranscription(result.transcription);

    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred during transcription.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleRemoveVideo = () => {
    setSelectedFile(null);
    setFileName(null);
    setError(null);
    setTranscription(null);
  };

  return (
    <div className="w-full max-w-3xl bg-slate-800/50 backdrop-blur-md shadow-2xl rounded-xl p-6 md:p-10">
      <header className="text-center mb-8">
        <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-500 to-cyan-500">
          Video Transcription Service
        </h1>
        <p className="text-slate-400 mt-2">Upload your video to get an automated transcription.</p>
      </header>

      {error && (
        <div className="bg-red-500/20 border border-red-700 text-red-300 px-4 py-3 rounded-lg relative mb-6 flex items-start" role="alert">
          <AlertTriangle className="h-5 w-5 mr-2 mt-1 text-red-400 flex-shrink-0" />
          <div>
            <strong className="font-bold">Error! </strong>
            <span className="block sm:inline">{error}</span>
          </div>
        </div>
      )}
      
     


      <form onSubmit={handleTranscribe}>
        {!selectedFile ? (
          <div
            {...getRootProps()}
            className={cn(
              "border-2 border-dashed border-slate-600 rounded-lg p-12 text-center cursor-pointer hover:border-slate-500 transition-colors duration-200",
              isDragActive && "border-emerald-500 bg-slate-700/30"
            )}
          >
            <input {...getInputProps()} />
            <UploadCloud className="mx-auto h-16 w-16 text-slate-500 mb-4" />
            {isDragActive ? (
              <p className="text-slate-300">Drop the video here ...</p>
            ) : (
              <p className="text-slate-300">Drag & drop a video file here, or click to select</p>
            )}
            <p className="text-xs text-slate-500 mt-2">Supports MP4, MOV, WEBM, AVI, MKV etc. (Max 50MB for this demo)</p>
          </div>
        ) : (
          <div className="mb-6 p-6 bg-slate-700/30 rounded-lg relative">
            <button
              type="button"
              onClick={handleRemoveVideo}
              className="absolute top-3 right-3 text-slate-400 hover:text-red-400 transition-colors"
              aria-label="Remove video"
            >
              <XCircle size={24} />
            </button>
            <div className="flex flex-col md:flex-row items-center gap-6">
              <FileText className="h-16 w-16 text-emerald-400 flex-shrink-0" />
              <div className="w-full text-slate-300 min-w-0">
                <p className="font-semibold truncate" title={fileName || "Video File"}>{fileName || "Video File"}</p>
                <p className="text-sm text-slate-400">
                  {selectedFile.size ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB` : ''}
                </p>
                <p className="text-sm text-slate-400">Type: {selectedFile.type}</p>
              </div>
            </div>
          </div>
        )}

        {selectedFile && (
          <button
            type="submit"
            disabled={isTranscribing || !selectedFile}
            className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold py-3 px-4 rounded-md transition-all duration-200 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {isTranscribing ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Transcribing... (This may take a while)
              </>
            ) : (
              'Start Transcription'
            )}
          </button>
        )}
      </form>

      {transcription && (
        <div className="mt-8 p-6 bg-slate-700/50 rounded-lg">
          <h3 className="text-xl font-semibold text-emerald-300 mb-4">Transcription Result:</h3>
          <pre className="bg-slate-800 p-4 rounded-md text-slate-200 whitespace-pre-wrap text-sm leading-relaxed">
            {transcription}
          </pre>
        </div>
      )}
    </div>
  );
}