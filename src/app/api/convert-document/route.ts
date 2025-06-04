// app/api/convert-document/route.ts
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import CloudConvert from 'cloudconvert';

// --- CloudConvert Initialization ---
if (!process.env.CLOUDCONVERT_API_KEY) {
  console.error("FATAL ERROR: CLOUDCONVERT_API_KEY is not set.");
}
const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY!);

// --- Type Definitions using TypeScript utility types ---
type CloudConvertJob = Awaited<ReturnType<typeof cloudConvert.jobs.create>>;
// Assuming tasks is an array and its elements have a 'name' and 'id', and potentially 'message'
type CloudConvertTask = NonNullable<CloudConvertJob['tasks']>[number];


// --- MIMETYPE MAPPING (Still useful for setting response headers) ---
const EXT_TO_MIMETYPE: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
    html: 'text/html',
    odt: 'application/vnd.oasis.opendocument.text',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    jpg: 'image/jpeg',
    png: 'image/png',
};
const SUPPORTED_DOC_OUTPUT_FORMATS_API = ['pdf', 'docx', 'txt', 'html', 'odt', 'pptx', 'jpg', 'png'];


async function performCloudConversion(
    inputFile: File,
    targetFormat: string
): Promise<{ convertedFileBuffer: Buffer, convertedFileName: string }> {
    console.log(`[CloudConvert] Starting conversion for ${inputFile.name} to ${targetFormat}`);

    let job: CloudConvertJob | undefined;

    try {
        job = await cloudConvert.jobs.create({
            tasks: {
                'import-file': { operation: 'import/upload' },
                'convert-file': { operation: 'convert', input: 'import-file', output_format: targetFormat.toLowerCase() },
                'export-file': { operation: 'export/url', input: 'convert-file', inline: false },
            },
        });

        if (!job || !job.id) {
            throw new Error('CloudConvert job creation failed or job has no ID.');
        }

        const uploadTask: CloudConvertTask | undefined = job.tasks?.find(task => task.name === 'import-file');

        if (!uploadTask || !uploadTask.id) { // Ensure task and its ID exist
            throw new Error('CloudConvert upload task not found in job or task has no ID.');
        }

        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-upload-'));
        const tempFilePath = path.join(tempDir, inputFile.name);
        await fs.writeFile(tempFilePath, Buffer.from(await inputFile.arrayBuffer()));
        
        console.log(`[CloudConvert] Uploading ${tempFilePath} for job ${job.id}`);
        // Pass the correctly typed uploadTask (after ensuring it's defined)
        await cloudConvert.tasks.upload(uploadTask, fsSync.createReadStream(tempFilePath), inputFile.name);
        await fs.rm(tempDir, { recursive: true, force: true });

        console.log(`[CloudConvert] Waiting for job ${job.id} to complete...`);
        // completedJob will also be of type CloudConvertJob
        const completedJob: CloudConvertJob = await cloudConvert.jobs.wait(job.id); 

        if (completedJob.status === 'error') {
            const failedTask = completedJob.tasks?.find(t => t.status === 'error');
            console.error('[CloudConvert] Job failed:', failedTask || completedJob);

            let jobErrorMessage: string | undefined = undefined;
            // Check if completedJob has a message property (common for error objects)
            // The actual property name might differ, inspect the 'completedJob' object when it's an error
            if ('message' in completedJob && typeof (completedJob as { message?: unknown }).message === 'string') {
                jobErrorMessage = (completedJob as { message: string }).message;
            }
            
            const taskErrorMessage = failedTask?.message; // Assuming 'message' is a property on a failed task

            throw new Error(`CloudConvert job failed: ${taskErrorMessage || jobErrorMessage || 'Unknown error from CloudConvert'}`);
        }

        const exportTask = completedJob.tasks?.find(task => task.name === 'export-file');
        // Add stronger type checks for exportTask.result and exportTask.result.files
        if (!exportTask || exportTask.status !== 'finished' || 
            !exportTask.result || !Array.isArray(exportTask.result.files) || exportTask.result.files.length === 0) {
            console.error('[CloudConvert] Export task failed or no files found:', exportTask);
            throw new Error('CloudConvert export task failed or did not produce a file.');
        }

        const resultFile = exportTask.result.files[0];
        const convertedFileName = resultFile.filename || `${path.parse(inputFile.name).name}.${targetFormat}`;
        
        if (!resultFile.url) {
            throw new Error('CloudConvert export task result did not contain a URL.');
        }
        console.log(`[CloudConvert] Downloading converted file: ${convertedFileName} from ${resultFile.url}`);
        
        const downloadResponse = await fetch(resultFile.url); 
        if (!downloadResponse.ok || !downloadResponse.body) {
            throw new Error(`Failed to download converted file from CloudConvert: ${downloadResponse.statusText}`);
        }
        const convertedFileBuffer = Buffer.from(await downloadResponse.arrayBuffer());
        
        return { convertedFileBuffer, convertedFileName };

    } catch (error: unknown) {
        let errorMessage = "Unknown CloudConvert error";
        let errorDetails: unknown = null; 

        if (error instanceof Error) {
            errorMessage = error.message;
        }

        if (typeof error === 'object' && error !== null) {
            if ('response' in error) {
                const response = (error as { response?: unknown }).response;
                if (typeof response === 'object' && response !== null && 'data' in response) {
                    errorDetails = (response as { data: unknown }).data;
                } else {
                    errorDetails = response;
                }
            } else {
                errorDetails = error;
            }
        }
        
        console.error('[CloudConvert] Error during conversion process:', errorDetails || errorMessage);
        // The type of 'job' is CloudConvertJob | undefined, so job.id is safe
        if (job && job.id) console.error(`[CloudConvert] Failed Job ID: ${job.id}`);
        else console.error('[CloudConvert] Error occurred, Job ID might not be available.');
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

  } catch (error: unknown) { 
    console.error('API Route /api/convert-document Error:', error);
    let errorMessage = 'An unknown error occurred during document conversion.';
    if (error instanceof Error) {
      errorMessage = error.message;
    }

    let responseDetails: unknown = null;
    if (typeof error === 'object' && error !== null) {
        if ('details' in error) { 
            responseDetails = (error as { details: unknown }).details;
        } else if ('response' in error) { 
            const errResponse = (error as { response?: unknown }).response;
            if (typeof errResponse === 'object' && errResponse !== null && 'data' in errResponse) {
                responseDetails = (errResponse as { data: unknown }).data;
            } else {
                responseDetails = errResponse; 
            }
        } else if (error instanceof Error) {
             // No need to do anything here, errorMessage is already set
        } else {
            responseDetails = error; 
        }
    }
    
    return NextResponse.json({ error: errorMessage, details: responseDetails }, { status: 500 });
  }
}