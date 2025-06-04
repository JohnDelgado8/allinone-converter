// app/api/convert/route.ts
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

const SUPPORTED_FORMATS: Record<string, { mime: string; sharpFormat: keyof sharp.FormatEnum }> = {
  jpeg: { mime: 'image/jpeg', sharpFormat: 'jpeg' },
  png: { mime: 'image/png', sharpFormat: 'png' },
  webp: { mime: 'image/webp', sharpFormat: 'webp' },
  gif: { mime: 'image/gif', sharpFormat: 'gif' },
  avif: { mime: 'image/avif', sharpFormat: 'avif' },
  tiff: { mime: 'image/tiff', sharpFormat: 'tiff' },
};

// Simpler approach for Content-Disposition filename encoding
// This relies more on the browser correctly interpreting filename*
// and provides a very generic fallback for filename=
function getSafeAsciiFilename(originalFilename: string, targetFormat: string): string {
    const namePart = originalFilename.substring(0, originalFilename.lastIndexOf('.')) || originalFilename;
    // Replace any non-ASCII or problematic characters with a single underscore for the fallback
    const safeNamePart = namePart.replace(/[^\x20-\x7E]/g, '_').replace(/[\\/:*?"<>|]/g, '_');
    return `${safeNamePart}.${targetFormat}`;
}


export async function POST(req: NextRequest) {
  console.log("API /api/convert POST request received");

  try {
    const formData = await req.formData();
    const file = formData.get('image') as File | null;
    const targetFormat = formData.get('format') as string | null;

    if (file) {
        console.log(`Received file: Name='${file.name}', Type='${file.type}', Size=${file.size}`);
    } else {
        console.log("No file received in FormData.");
    }
    console.log("Target format:", targetFormat);

    if (!file) {
      return NextResponse.json({ error: 'No image file provided.' }, { status: 400 });
    }
    if (!targetFormat || !SUPPORTED_FORMATS[targetFormat]) {
      return NextResponse.json({ error: 'Invalid target format.' }, { status: 400 });
    }

    const imageBuffer = Buffer.from(await file.arrayBuffer());
    const { sharpFormat, mime } = SUPPORTED_FORMATS[targetFormat];
    
    const sharpInstance = sharp(imageBuffer);
    // It's good practice to await metadata to catch issues early if the input isn't a valid image
    await sharpInstance.metadata().catch(metaError => {
        console.error("API Error: Failed to get image metadata with Sharp:", metaError);
        throw new Error(`Could not read image metadata. The file might not be a supported image or is corrupted. Sharp error: ${metaError instanceof Error ? metaError.message : String(metaError)}`);
    });
    
    // Re-check if animated is needed based on sharp's capabilities for the target format
    const metadata = await sharpInstance.metadata(); // get it again after initial check
    if (metadata.pages && metadata.pages > 1) {
        const canBeAnimatedOutput = sharpFormat === 'gif' || sharpFormat === 'webp' || sharpFormat === 'avif';
        if (canBeAnimatedOutput) {
            console.log(`Animated image (${metadata.format}) to animated ${sharpFormat}. Preserving animation.`);
            sharpInstance.animated(true);
        } else {
            console.log(`Animated image (${metadata.format}) to static ${sharpFormat}. Using first frame.`);
            // No need to explicitly set animated(false), sharp defaults to processing first frame for static output
        }
    }
    
    const convertedBuffer = await sharpInstance
      .toFormat(sharpFormat)
      .toBuffer();
    console.log(`Conversion successful. Converted buffer size: ${convertedBuffer.length} bytes`);

    const headers = new Headers();
    headers.set('Content-Type', mime);

    // Construct the output filename: original name (without extension) + new extension
    const namePart = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    const desiredOutputFilename = `${namePart}.${targetFormat}`;

    // For filename* (UTF-8 support)
    const utf8EncodedFilename = encodeURIComponent(desiredOutputFilename);

    // For filename= (basic ASCII fallback, less critical with modern browsers)
    const asciiFallback = getSafeAsciiFilename(file.name, targetFormat);

    // The key is `filename*=UTF-8''${utf8EncodedFilename}`
    // The simple `filename="${asciiFallback}"` is for very old clients.
    headers.set('Content-Disposition', `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8EncodedFilename}`);
    
    console.log(`Sending response. Original desired: "${desiredOutputFilename}", Fallback ASCII: "${asciiFallback}", UTF-8 Encoded: "${utf8EncodedFilename}"`);

    return new NextResponse(convertedBuffer, { status: 200, headers });

  } catch (error) {
    console.error('API Route Full Conversion Error:', error);
    let errorMessage = 'An unknown error occurred during image conversion.';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    return NextResponse.json({ error: 'Image conversion failed on server.', details: errorMessage }, { status: 500 });
  }
}