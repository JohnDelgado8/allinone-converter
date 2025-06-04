// app/page.tsx
"use client";

import { useState, useCallback, FormEvent, ChangeEvent, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, XCircle, Download, Loader2, Archive, Trash2 } from 'lucide-react';
import { cn } from '@/app/lib/utils'; // VERIFY THIS PATH
import JSZip from 'jszip';
import { saveAs } from 'file-saver';


const SUPPORTED_OUTPUT_FORMATS = ['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff'];
const MIN_FILES_FOR_ZIP = 3;

interface FileWithPreview extends File {
  preview: string;
  id: string;
  status: 'pending' | 'converting' | 'converted' | 'error';
  originalSize: number;
  convertedUrl?: string;
  convertedBlob?: Blob;
  convertedName?: string;
  errorMessage?: string;
  convertedSize?: number;
}

export default function ImageConverterPage() {
  const [selectedFiles, setSelectedFiles] = useState<FileWithPreview[]>([]);
  const [targetFormat, setTargetFormat] = useState<string>(SUPPORTED_OUTPUT_FORMATS[0]);
  const [isBatchConverting, setIsBatchConverting] = useState<boolean>(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isZipping, setIsZipping] = useState<boolean>(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setGlobalError(null);
    const newFilesWithPreview: FileWithPreview[] = acceptedFiles
      .filter(file => file.type.startsWith('image/'))
      .map(file => {
          const fileWithOurProps = file as FileWithPreview;
          fileWithOurProps.preview = URL.createObjectURL(file);
          fileWithOurProps.id = Math.random().toString(36).substring(2, 15);
          fileWithOurProps.status = 'pending' as const;
          fileWithOurProps.originalSize = file.size;
          fileWithOurProps.convertedSize = undefined;
          fileWithOurProps.convertedBlob = undefined;
          fileWithOurProps.convertedUrl = undefined;
          return fileWithOurProps;
        });

    if (newFilesWithPreview.length !== acceptedFiles.length) {
        setGlobalError('Some files were not valid images and were ignored.');
    }
    setSelectedFiles(prevFiles => [...prevFiles, ...newFilesWithPreview]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: true,
  });

  const handleFormatChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setTargetFormat(e.target.value);
    setSelectedFiles(prevFiles =>
      prevFiles.map(f => {
        if (f.status === 'converted') {
          if (f.convertedUrl) URL.revokeObjectURL(f.convertedUrl);
          return { ...f, status: 'pending', convertedUrl: undefined, convertedName: undefined, convertedSize: undefined, convertedBlob: undefined };
        }
        return f;
      })
    );
  };

  const updateFileStatus = (id: string, newStatus: FileWithPreview['status'], data?: Partial<FileWithPreview>) => {
    setSelectedFiles(prevFiles =>
      prevFiles.map(f => (f.id === id ? { ...f, status: newStatus, ...data } : f))
    );
  };

  const handleConvertAll = async (e: FormEvent) => {
    e.preventDefault();
    const filesToProcess = selectedFiles.filter(f => f.status === 'pending' || f.status === 'error');
    if (filesToProcess.length === 0) {
      setGlobalError('No new images to convert or all have errors.');
      return;
    }
    setIsBatchConverting(true);
    setGlobalError(null);

    for (const fileToConvert of filesToProcess) {
        updateFileStatus(fileToConvert.id, 'converting');
        const formData = new FormData();
        formData.append('image', fileToConvert as File); 
        formData.append('format', targetFormat);

        try {
          const response = await fetch('/api/convert', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status}` }));
            throw new Error(errorData.error || errorData.details || `Conversion failed: ${response.status}`);
          }

          const blob = await response.blob(); 
          const convertedFileSize = blob.size;
          const url = URL.createObjectURL(blob); 
          
          const originalName = fileToConvert.name;
          const lastDotIndex = originalName.lastIndexOf('.');
          const nameWithoutExtension = lastDotIndex > 0 ? originalName.substring(0, lastDotIndex) : originalName;
          const desiredDisplayFileName = `${nameWithoutExtension}.${targetFormat}`; 
          
          updateFileStatus(fileToConvert.id, 'converted', {
            convertedUrl: url, 
            convertedBlob: blob, 
            convertedName: desiredDisplayFileName,
            convertedSize: convertedFileSize,
          });
        } catch (err) {
          console.error(`Error converting ${fileToConvert.name}:`, err);
          updateFileStatus(fileToConvert.id, 'error', { errorMessage: err instanceof Error ? err.message : 'Unknown error' });
        }
    }
    setIsBatchConverting(false);
  };


  const handleDownloadAllAsZip = async () => {
    const convertedImages = selectedFiles.filter(f => f.status === 'converted' && f.convertedBlob && f.convertedName);
    if (convertedImages.length === 0) {
      setGlobalError("No converted images available to zip.");
      return;
    }
    setIsZipping(true);
    setGlobalError(null);
    const zip = new JSZip();
    for (const image of convertedImages) {
      zip.file(image.convertedName!, image.convertedBlob!);
    }
    try {
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: "DEFLATE", compressionOptions: { level: 6 } });
      saveAs(zipBlob, `converted_images_${targetFormat}.zip`);
    } catch (err) {
      console.error("Error generating ZIP:", err);
      setGlobalError("Failed to generate ZIP file.");
    } finally {
      setIsZipping(false);
    }
  };

  const handleRemoveImage = (idToRemove: string) => {
    setSelectedFiles(prevFiles =>
      prevFiles.filter(file => {
        if (file.id === idToRemove) {
          URL.revokeObjectURL(file.preview);
          if (file.convertedUrl) URL.revokeObjectURL(file.convertedUrl);
          return false;
        }
        return true;
      })
    );
  };

  const handleClearConverted = () => {
    const filesToKeep = selectedFiles.filter(file => {
      if (file.status === 'converted') {
        URL.revokeObjectURL(file.preview); 
        if (file.convertedUrl) {
          URL.revokeObjectURL(file.convertedUrl);
        }
        return false; 
      }
      return true; 
    });
    setSelectedFiles(filesToKeep);
    setGlobalError(null); 
  };

  useEffect(() => {
    return () => {
      selectedFiles.forEach(file => {
        URL.revokeObjectURL(file.preview);
        if (file.convertedUrl) {
          URL.revokeObjectURL(file.convertedUrl);
        }
      });
    };
  }, [selectedFiles]);

  const somePendingOrError = selectedFiles.some(f => f.status === 'pending' || f.status === 'error');
  const anyFileSelected = selectedFiles.length > 0;
  const successfullyConvertedFiles = selectedFiles.filter(f => f.status === 'converted');
  const showZipDownloadButton = successfullyConvertedFiles.length >= MIN_FILES_FOR_ZIP;

  return (
    <div className="w-full max-w-3xl bg-slate-800/50 backdrop-blur-md shadow-2xl rounded-xl p-6 md:p-10">
      <header className="text-center mb-8">
        <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500">
          Universal Image Converter
        </h1>
        <p className="text-slate-400 mt-2">Convert your images and download them individually or as a ZIP.</p>
      </header>

      {globalError && (
        <div className="bg-red-500/20 border border-red-700 text-red-300 px-4 py-3 rounded-lg relative mb-6" role="alert">
          <strong className="font-bold">Oops! </strong>
          <span className="block sm:inline">{globalError}</span>
        </div>
      )}

      <form onSubmit={handleConvertAll}>
        <div
          {...getRootProps()}
          className={cn( "border-2 border-dashed border-slate-600 rounded-lg p-12 text-center cursor-pointer hover:border-slate-500 transition-colors duration-200 mb-6", isDragActive && "border-blue-500 bg-slate-700/30" )}
        >
          <input {...getInputProps()} />
          <UploadCloud className="mx-auto h-16 w-16 text-slate-500 mb-4" />
          <p className="text-slate-300">{isDragActive ? "Drop images here ..." : "Drag & drop images here, or click to select"}</p>
          <p className="text-xs text-slate-500 mt-2">Supports JPG, PNG, GIF, WEBP, AVIF, TIFF, etc.</p>
        </div>

        {selectedFiles.length > 0 && (
          <div className="mb-6 space-y-4">
            <h3 className="text-xl font-semibold text-slate-200">Selected Images:</h3>
            {selectedFiles.map((file) => (
              <div key={file.id} className="p-4 bg-slate-700/50 rounded-lg flex items-center gap-4 relative">
                <button
                  type="button"
                  onClick={() => handleRemoveImage(file.id)}
                  className="absolute top-2 right-2 text-slate-400 hover:text-red-400 transition-colors z-10"
                  aria-label="Remove image"
                  disabled={isBatchConverting && file.status === 'converting'}
                >
                  <XCircle size={20} />
                </button>
                <div className="w-20 h-20 flex-shrink-0 bg-slate-800 rounded-md overflow-hidden flex items-center justify-center">
                  <img src={file.preview} alt={file.name} className="max-h-full max-w-full object-contain" />
                </div>
                <div className="flex-grow min-w-0">
                  <p className="font-semibold truncate text-slate-100" title={file.name}>{file.name}</p>
                  <p className="text-sm text-slate-400">
                    Original: {typeof file.originalSize === 'number' ? `${(file.originalSize / 1024 / 1024).toFixed(2)} MB` : 'Size unavailable'}
                  </p>
                  {file.status === 'pending' && <p className="text-sm text-yellow-400">Ready to convert</p>}
                  {file.status === 'converting' && <p className="text-sm text-blue-400 flex items-center"><Loader2 className="mr-1 h-4 w-4 animate-spin" />Converting...</p>}
                  
                  {/* MODIFIED: Always show individual download if converted */}
                  {file.status === 'converted' && file.convertedUrl && file.convertedName && (
                    <>
                      <a
                        href={file.convertedUrl}
                        download={file.convertedName}
                        className="text-sm text-green-400 hover:text-green-300 flex items-center underline"
                      >
                        <Download className="mr-1 h-4 w-4" /> Download {file.convertedName}
                      </a>
                      {typeof file.convertedSize === 'number' && (
                        <p className="text-xs text-slate-400 mt-1">
                          Converted: {(file.convertedSize / 1024 / 1024).toFixed(2)} MB
                        </p>
                      )}
                    </>
                  )}
                  {/* The block for "Ready for ZIP" when showZipDownloadButton is true is now removed,
                      as the above block will always show the download link. */}

                  {file.status === 'error' && <p className="text-sm text-red-400" title={file.errorMessage}>Error: {file.errorMessage?.substring(0,50) || 'Conversion failed'}</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {anyFileSelected && (
          <div className="mb-6">
            <label htmlFor="format" className="block text-sm font-medium text-slate-300 mb-2">Convert all to:</label>
            <select id="format" value={targetFormat} onChange={handleFormatChange} className="w-full bg-slate-700 border border-slate-600 text-slate-100 rounded-md p-3 focus:ring-blue-500 focus:border-blue-500 transition-colors">
                {SUPPORTED_OUTPUT_FORMATS.map((format) => (<option key={format} value={format}>{format.toUpperCase()}</option>))}
            </select>
          </div>
        )}

        {anyFileSelected && (
          <div className="mt-6 space-y-3">
            {somePendingOrError && ( 
                 <button
                    type="submit"
                    disabled={isBatchConverting || !somePendingOrError}
                    className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold py-3 px-4 rounded-md transition-all duration-200 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                    {isBatchConverting ? (
                    <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Converting...</>
                    ) : (
                    `Convert ${selectedFiles.filter(f=>f.status === 'pending' || f.status === 'error').length} Pending Image(s)`
                    )}
                </button>
            )}

            {showZipDownloadButton && (
              <button
                type="button" 
                onClick={handleDownloadAllAsZip}
                disabled={isZipping || successfullyConvertedFiles.length < MIN_FILES_FOR_ZIP}
                className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold py-3 px-4 rounded-md transition-all duration-200 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {isZipping ? (
                  <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Zipping...</>
                ) : (
                  <><Archive className="mr-2 h-5 w-5" /> Download All ({successfullyConvertedFiles.length}) as ZIP</>
                )}
              </button>
            )}

            {successfullyConvertedFiles.length > 0 && (
                 <button
                    type="button"
                    onClick={handleClearConverted}
                    disabled={isBatchConverting || isZipping}
                    className="w-full bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white font-semibold py-3 px-4 rounded-md transition-all duration-200 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                    <Trash2 className="mr-2 h-5 w-5" /> Clear All Converted ({successfullyConvertedFiles.length})
                </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}