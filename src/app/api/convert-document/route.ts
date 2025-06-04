// app/api/convert-document/route.ts
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises'; // Still needed for reading uploaded file to stream
import fsSync from 'fs'; // For createReadStream
import path from 'path';
import os from 'os';
import CloudConvert from 'cloudconvert'; // Import the SDK

// --- CloudConvert Initialization ---
if (!process.env.CLOUDCONVERT_API_KEY) {
  console.error("FATAL ERROR: CLOUDCONVERT_API_KEY is not set.");
  // For a real app, you'd want to prevent startup or return a clear error
}
const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY!);
// For sandbox testing with CloudConvert:
// const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_SANDBOX_API_KEY!, true);


// --- MIMETYPE MAPPING (Still useful for setting response headers) ---
const EXT_TO_MIMETYPE: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
    html: 'text/html',
    odt: 'application/vnd.oasis.opendocument.text',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Add more as supported by your chosen output formats and CloudConvert
    jpg: 'image/jpeg',
    png: 'image/png',
};

// This list should reflect what your UI offers and what CloudConvert supports well.
const SUPPORTED_DOC_OUTPUT_FORMATS_API = ['pdf', 'docx', 'txt', 'html', 'odt', 'pptx', 'jpg', 'png'];


async function performCloudConversion(
    inputFile: File, // Pass the File object directly
    targetFormat: string
): Promise<{ convertedFileBuffer: Buffer, convertedFileName: string }> {
    console.log(`[CloudConvert] Starting conversion for ${inputFile.name} to ${targetFormat}`);

    let job: CloudConvert.Job | undefined; // Define type for job
    try {
        job = await cloudConvert.jobs.create({
            tasks: {
                'import-file': {
                    operation: 'import/upload',
                },
                'convert-file': {
                    operation: 'convert',
                    input: 'import-file',
                    output_format: targetFormat.toLowerCase(),
                    // engine: 'office', // Optional: specify engine if needed (e.g., 'office' for docx/pptx)
                    // engine_version: 'latest', // Optional
                    // pdf_a: false, // Example option for PDF output
                    // some_other_option: 'value'
                },
                'export-file': {
                    operation: 'export/url',
                    input: 'convert-file',
                    inline: false, // true if you want to try and serve directly, false for a download URL
                },
            },
            // tag: 'my-conversion-job', // Optional tag for tracking
        });

        const uploadTask = job.tasks?.find(task => task.name === 'import-file');
        if (!uploadTask || !uploadTask.id) {
            throw new Error('CloudConvert upload task not found in job.');
        }

        // Upload the file. CloudConvert SDK can take a ReadStream or sometimes a Buffer.
        // Creating a temporary file to stream from is robust for serverless.
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-upload-'));
        const tempFilePath = path.join(tempDir, inputFile.name);
        await fs.writeFile(tempFilePath, Buffer.from(await inputFile.arrayBuffer()));
        
        console.log(`[CloudConvert] Uploading ${tempFilePath} for job ${job.id}`);
        await cloudConvert.tasks.upload(uploadTask, fsSync.createReadStream(tempFilePath), inputFile.name);
        await fs.rm(tempDir, { recursive: true, force: true }); // Clean up temp upload dir

        console.log(`[CloudConvert] Waiting for job ${job.id} to complete...`);
        const completedJob = await cloudConvert.jobs.wait(job.id); // This polls until the job is finished

        if (completedJob.status === 'error') {
            const failedTask = completedJob.tasks?.find(t => t.status === 'error');
            console.error('[CloudConvert] Job failed:', failedTask || completedJob);
            throw new Error(`CloudConvert job failed: ${failedTask?.message || completedJob.message || 'Unknown error'}`);
        }

        const exportTask = completedJob.tasks?.find(task => task.name === 'export-file');
        if (!exportTask || exportTask.status !== 'finished' || !exportTask.result || !exportTask.result.files || exportTask.result.files.length === 0) {
            console.error('[CloudConvert] Export task failed or no files found:', exportTask);
            throw new Error('CloudConvert export task failed or did not produce a file.');
        }

        const resultFile = exportTask.result.files[0];
        const convertedFileName = resultFile.filename || `${path.parse(inputFile.name).name}.${targetFormat}`;
        
        console.log(`[CloudConvert] Downloading converted file: ${convertedFileName} from ${resultFile.url}`);
        
        if (!resultFile.url) { // Add a check for url existence
            throw new Error('CloudConvert export task result did not contain a URL.');
        }
        const downloadResponse = await fetch(resultFile.url); 
        if (!downloadResponse.ok || !downloadResponse.body) {
            throw new Error(`Failed to download converted file from CloudConvert: ${downloadResponse.statusText}`);
        }
        const convertedFileBuffer = Buffer.from(await downloadResponse.arrayBuffer());
        
        return { convertedFileBuffer, convertedFileName };

    } catch (error: unknown) { // Changed from any to unknown
        let errorMessage = "Unknown CloudConvert error";
        let errorDetails: unknown = null; 

        if (error instanceof Error) {
            errorMessage = error.message;
        }

        // Attempt to get more specific details from CloudConvert error structure
        // CloudConvert errors often have a 'response.data' structure
        if (typeof error === 'object' && error !== null) {
            if ('response' in error) {
                const response = (error as { response?: unknown }).response;
                if (typeof response === 'object' && response !== null && 'data' in response) {
                    errorDetails = (response as { data: unknown }).data;
                } else {
                    errorDetails = response; // Fallback to the response object itself
                }
            } else {
                errorDetails = error; // Fallback to the whole error object
            }
        }
        
        console.error('[CloudConvert] Error during conversion process:', errorDetails || errorMessage);
        if (job && job.id) console.error(`[CloudConvert] Failed Job ID: ${job.id}`);
        throw new Error(`CloudConvert processing failed: ${errorMessage}`);
    }
}


export async function POST(req: NextRequest) {
  console.log("API /api/convert-document POST request received");

  if (!process.env.CLOUDCONVERT_API_KEY) {
    console.error("CloudConvert API Key not configured on server.");
    return NextResponse.json({ error: 'Server configuration error for conversion service.' }, { status: 500 });
  }

  try {
    const formData = await req.formData();
    const documentFile = formData.get('document') as File | null;
    const targetFormat = formData.get('targetFormat') as string | null;
    const inputFileName = formData.get('inputFileName') as string | null; 

    if (!documentFile || !inputFileName) {
      return NextResponse.json({ error: 'No document file provided.' }, { status: 400 });
    }
    if (!targetFormat || !SUPPORTED_DOC_OUTPUT_FORMATS_API.includes(targetFormat.toLowerCase())) {
        return NextResponse.json({ error: `Unsupported target format: ${targetFormat}` }, { status: 400 });
    }

    console.log(`Received document: ${inputFileName}, Size: ${documentFile.size}, Target Format: ${targetFormat}`);

    const { convertedFileBuffer, convertedFileName } = await performCloudConversion(
        documentFile,
        targetFormat
    );

    const headers = new Headers();
    const mimeType = EXT_TO_MIMETYPE[targetFormat.toLowerCase()] || 'application/octet-stream';
    headers.set('Content-Type', mimeType);
    headers.set('Content-Disposition', `attachment; filename="${convertedFileName}"`);

    return new NextResponse(convertedFileBuffer, { status: 200, headers });

  } catch (error: unknown) { // Changed from implicit any to unknown
    console.error('API Route /api/convert-document Error:', error);
    let errorMessage = 'An unknown error occurred during document conversion.';
    if (error instanceof Error) {
      errorMessage = error.message;
    }

    let responseDetails: unknown = null;
    if (typeof error === 'object' && error !== null) {
        if ('details' in error) { // Check for a 'details' property first
            responseDetails = (error as { details: unknown }).details;
        } else if ('response' in error) { // Then check for 'response.data'
            const errResponse = (error as { response?: unknown }).response;
            if (typeof errResponse === 'object' && errResponse !== null && 'data' in errResponse) {
                responseDetails = (errResponse as { data: unknown }).data;
            } else {
                responseDetails = errResponse; // Fallback: use the response object itself if 'data' is not present
            }
        } else if (error instanceof Error) {
             // If it's an error instance but no specific structure found, use the error object itself for details
             // (excluding stack for brevity in response, but good for server logs)
            // responseDetails = { name: error.name, message: error.message }; 
        } else {
            responseDetails = error; // Fallback to the error object itself
        }
    }
    
    return NextResponse.json({ error: errorMessage, details: responseDetails }, { status: 500 });
  }
}