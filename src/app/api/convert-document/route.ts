// app/api/convert-document/route.ts
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import CloudConvert from 'cloudconvert'; // Just the default import

// --- CloudConvert Initialization ---
if (!process.env.CLOUDCONVERT_API_KEY) {
  console.error("FATAL ERROR: CLOUDCONVERT_API_KEY is not set.");
}
const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY!);

// ... (MIMETYPE MAPPING and SUPPORTED_DOC_OUTPUT_FORMATS_API remain the same) ...

async function performCloudConversion(
    inputFile: File,
    targetFormat: string
): Promise<{ convertedFileBuffer: Buffer, convertedFileName: string }> {
    console.log(`[CloudConvert] Starting conversion for ${inputFile.name} to ${targetFormat}`);

    // Let TypeScript infer the type of 'job'
    // The variable 'job' will automatically get the type returned by cloudConvert.jobs.create()
    let job; // REMOVE the explicit type annotation

    try {
        job = await cloudConvert.jobs.create({ // TypeScript infers the type of 'job' here
            tasks: {
                'import-file': {
                    operation: 'import/upload',
                },
                'convert-file': {
                    operation: 'convert',
                    input: 'import-file',
                    output_format: targetFormat.toLowerCase(),
                },
                'export-file': {
                    operation: 'export/url',
                    input: 'convert-file',
                    inline: false,
                },
            },
        });

        // At this point, if you hover over 'job' in VS Code,
        // it should show you the actual complex type of the job object.
        // You can then proceed with using job.id, job.tasks, etc.
        // TypeScript will provide autocompletion and type checking based on this inferred type.

        if (!job || !job.id) { // This check is still good practice
            throw new Error('CloudConvert job creation failed or job has no ID.');
        }

        const uploadTask = job.tasks?.find(task => task.name === 'import-file');
        // The type of uploadTask will also be inferred.
        // Add specific checks if properties on uploadTask are optional
        if (!uploadTask || !uploadTask.id) {
            throw new Error('CloudConvert upload task not found in job or task has no ID.');
        }

        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-upload-'));
        const tempFilePath = path.join(tempDir, inputFile.name);
        await fs.writeFile(tempFilePath, Buffer.from(await inputFile.arrayBuffer()));
        
        console.log(`[CloudConvert] Uploading ${tempFilePath} for job ${job.id}`);
        // The 'uploadTask' passed to cloudConvert.tasks.upload might need a specific type.
        // If the SDK expects a more specific 'Task' type, you might need to cast or ensure 'uploadTask' conforms.
        // However, often the SDK methods are flexible enough.
        // Let's assume for now the inferred type of uploadTask is sufficient.
        await cloudConvert.tasks.upload(uploadTask as any, fsSync.createReadStream(tempFilePath), inputFile.name); // Using 'as any' for uploadTask temporarily if its inferred type causes issues here. Better to find the exact Task type later.
        await fs.rm(tempDir, { recursive: true, force: true });

        console.log(`[CloudConvert] Waiting for job ${job.id} to complete...`);
        const completedJob = await cloudConvert.jobs.wait(job.id); // Type of completedJob also inferred.

        if (completedJob.status === 'error') {
            const failedTask = completedJob.tasks?.find(t => t.status === 'error');
            console.error('[CloudConvert] Job failed:', failedTask || completedJob);
            throw new Error(`CloudConvert job failed: ${failedTask?.message || (completedJob as any).message || 'Unknown error'}`); // (completedJob as any).message for safety if message isn't on all statuses
        }

        const exportTask = completedJob.tasks?.find(task => task.name === 'export-file');
        if (!exportTask || exportTask.status !== 'finished' || !exportTask.result || !exportTask.result.files || exportTask.result.files.length === 0) {
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
        // Use optional chaining for job?.id in case job was never assigned due to an early error
        if (job && job.id) console.error(`[CloudConvert] Failed Job ID: ${job.id}`);
        else console.error('[CloudConvert] Error occurred, Job ID might not be available.');
        throw new Error(`CloudConvert processing failed: ${errorMessage}`);
    }
}

// ... (POST function remains the same) ...
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
        } else {
            responseDetails = error; 
        }
    }
    
    return NextResponse.json({ error: errorMessage, details: responseDetails }, { status: 500 });
  }
}