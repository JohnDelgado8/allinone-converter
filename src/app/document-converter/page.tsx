// app/document-converter/page.tsx
"use client";

import { useState, useCallback, FormEvent, ChangeEvent } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, Loader2, FileText, AlertTriangle, XCircle, Download, Presentation } from 'lucide-react';
import { cn } from '@/app/lib/utils'; // ENSURE THIS PATH IS CORRECT (e.g., '@/lib/utils')

// Potentially expand these based on your chosen cloud service's capabilities
// This list is just an example to keep it focused.
const SUPPORTED_DOC_INPUT_FORMATS = {
    'application/pdf': ['.pdf'],
    'application/msword': ['.doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'application/vnd.ms-powerpoint': ['.ppt'],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
    'text/plain': ['.txt'],
    'text/rtf': ['.rtf'],
    'text/html': ['.html', '.htm'],
    // You could add image types if your cloud service converts images to documents:
    // 'image/jpeg': ['.jpg', '.jpeg'],
    // 'image/png': ['.png'],
};

// Potentially expand this based on your chosen cloud service.
// CloudConvert can output to many image formats from documents too.
const SUPPORTED_DOC_OUTPUT_FORMATS = [
    'pdf', 'docx', 'doc', 'rtf', 'txt', 'html', 'odt', 'pptx', 
    // Examples if converting documents to images:
    // 'jpg', 'png', 
];

export default function DocumentConverterPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [targetFormat, setTargetFormat] = useState<string>(SUPPORTED_DOC_OUTPUT_FORMATS[0]);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [convertedFileUrl, setConvertedFileUrl] = useState<string | null>(null);
  const [convertedFileName, setConvertedFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setError(null);
    setConvertedFileUrl(null);
    setConvertedFileName(null);
    setSelectedFile(null); // Reset selected file first
    setFileName(null);

    if (acceptedFiles && acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      const acceptedMimeTypes = Object.keys(SUPPORTED_DOC_INPUT_FORMATS);
      // Create a more robust extension check allowing for various casing and including all from the map
      const allAcceptedExtensions = Object.values(SUPPORTED_DOC_INPUT_FORMATS)
                                        .flat()
                                        .map(ext => ext.toLowerCase().substring(1));
      const fileExtension = file.name.split('.').pop()?.toLowerCase();

      let isValidType = acceptedMimeTypes.includes(file.type);
      if (!isValidType && fileExtension) {
        isValidType = allAcceptedExtensions.includes(fileExtension);
      }
      // Some browsers might not provide a reliable file.type for all office documents,
      // so relying on extension is a good fallback.
      // For a stricter check, you might want to validate server-side more thoroughly.

      if (!isValidType) {
        setError(`Invalid file type: ${file.name}. Please upload a supported document format.`);
        return;
      }
      setSelectedFile(file);
      setFileName(file.name);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: SUPPORTED_DOC_INPUT_FORMATS,
    multiple: false,
  });

  const handleFormatChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setTargetFormat(e.target.value);
    setConvertedFileUrl(null);
    setConvertedFileName(null);
  };

  const handleConvert = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setError('Please select a document file first.');
      return;
    }
    setIsConverting(true);
    setError(null);
    setConvertedFileUrl(null);
    setConvertedFileName(null);

    const formData = new FormData();
    formData.append('document', selectedFile);
    // inputFileType and inputFileName are useful for the backend, especially if it needs to
    // make decisions based on the original file type or name.
    formData.append('inputFileType', selectedFile.type || 'application/octet-stream');
    formData.append('inputFileName', selectedFile.name);
    formData.append('targetFormat', targetFormat);

    try {
      const response = await fetch('/api/convert-document', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `Server error: ${response.status}`, details: "Failed to parse error response." }));
        // Use details from API if available
        const message = errorData.details || errorData.error || `Conversion failed with status: ${response.status}`;
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setConvertedFileUrl(url);

      const contentDisposition = response.headers.get('Content-Disposition');
      let newFileName = `converted_document.${targetFormat}`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/i);
        if (match && match[1]) newFileName = match[1];
      }
      setConvertedFileName(newFileName);

    } catch (err) {
      console.error("Frontend conversion error details:", err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred during conversion.');
    } finally {
      setIsConverting(false);
    }
  };

  const handleRemoveDocument = () => {
    setSelectedFile(null);
    setFileName(null);
    setError(null);
    setConvertedFileUrl(null);
    setConvertedFileName(null);
    if (convertedFileUrl) {
        URL.revokeObjectURL(convertedFileUrl);
    }
  };

  let FileIcon = FileText;
  if (selectedFile) {
    const fileType = selectedFile.type;
    const fileNameExt = selectedFile.name.split('.').pop()?.toLowerCase();
    if (fileType.startsWith('image/')) FileIcon = FileText; // Or specific ImageIcon
    else if (fileType.includes('powerpoint') || fileType.includes('presentationml') || fileNameExt === 'ppt' || fileNameExt === 'pptx') FileIcon = Presentation;
    else if (fileType.includes('pdf') || fileNameExt === 'pdf') FileIcon = FileText; // Could be a specific PDF icon
    // Add more conditions for other document types if you have specific icons
    else FileIcon = FileText;
  }


  return (
    <div className="w-full max-w-3xl bg-slate-800/50 backdrop-blur-md shadow-2xl rounded-xl p-6 md:p-10">
      <header className="text-center mb-8">
        <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-indigo-500 to-purple-500">
          Document Converter
        </h1>
        <p className="text-slate-400 mt-2">Convert your documents to various formats using our cloud-powered service.</p>
      </header>

      {error && (
        <div className="bg-red-500/20 border border-red-700 text-red-300 px-4 py-3 rounded-lg relative mb-6 flex items-start" role="alert">
          <AlertTriangle className="h-5 w-5 mr-2 mt-1 text-red-400 flex-shrink-0" />
          <div><strong className="font-bold">Error! </strong><span className="block sm:inline">{error}</span></div>
        </div>
      )}
      
     


      <form onSubmit={handleConvert}>
        {!selectedFile ? (
          <div
            {...getRootProps()}
            className={cn(
              "border-2 border-dashed border-slate-600 rounded-lg p-12 text-center cursor-pointer hover:border-slate-500 transition-colors duration-200",
              isDragActive && "border-indigo-500 bg-slate-700/30"
            )}
          >
            <input {...getInputProps()} />
            <UploadCloud className="mx-auto h-16 w-16 text-slate-500 mb-4" />
            {isDragActive ? (
              <p className="text-slate-300">Drop your document here ...</p>
            ) : (
              <p className="text-slate-300">Drag & drop a document, or click to select</p>
            )}
            <p className="text-xs text-slate-500 mt-2">Supports PDF, DOC(X), PPT(X), TXT, HTML, RTF etc.</p>
          </div>
        ) : (
          <div className="mb-6 p-6 bg-slate-700/30 rounded-lg relative">
            <button type="button" onClick={handleRemoveDocument} className="absolute top-3 right-3 text-slate-400 hover:text-red-400" aria-label="Remove document">
              <XCircle size={24} />
            </button>
            <div className="flex flex-col md:flex-row items-center gap-6">
              <FileIcon className="h-16 w-16 text-indigo-400 flex-shrink-0" /> {/* Dynamic Icon */}
              <div className="w-full text-slate-300 min-w-0">
                <p className="font-semibold truncate" title={fileName || "Document File"}>{fileName || "Document File"}</p>
                <p className="text-sm text-slate-400">{selectedFile.size ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB` : ''}</p>
                <p className="text-sm text-slate-400">Type: {selectedFile.type || 'Unknown (check extension)'}</p>
              </div>
            </div>
          </div>
        )}

        {selectedFile && (
            <>
            <div className="mb-6">
                <label htmlFor="docFormat" className="block text-sm font-medium text-slate-300 mb-2">
                Convert to:
                </label>
                <select
                id="docFormat"
                value={targetFormat}
                onChange={handleFormatChange}
                className="w-full bg-slate-700 border border-slate-600 text-slate-100 rounded-md p-3 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                >
                {SUPPORTED_DOC_OUTPUT_FORMATS.map((format) => (
                    <option key={format} value={format}>
                    {format.toUpperCase()}
                    </option>
                ))}
                </select>
            </div>

            <button
                type="submit"
                disabled={isConverting || !selectedFile}
                className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-semibold py-3 px-4 rounded-md transition-all duration-200 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
                {isConverting ? (
                <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Converting Document...</>
                ) : (
                'Convert Document'
                )}
            </button>
          </>
        )}
      </form>

      {convertedFileUrl && convertedFileName && (
        <div className="mt-8 p-6 bg-green-500/10 border border-green-700 rounded-lg text-center">
            <h3 className="text-xl font-semibold text-green-300 mb-3">Conversion Successful!</h3>
            <p className="text-slate-300 mb-4">Your document <span className="font-mono bg-slate-700 px-1 rounded">{convertedFileName}</span> is ready.</p>
            <a
              href={convertedFileUrl}
              download={convertedFileName}
              className="inline-flex items-center justify-center bg-green-500 hover:bg-green-600 text-white font-semibold py-3 px-6 rounded-md transition-colors duration-200"
            >
              <Download className="mr-2 h-5 w-5" />
              Download Converted Document
            </a>
          </div>
      )}
    </div>
  );
}