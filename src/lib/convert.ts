import { detectInputFormat, getDestinationMimeType, isSameMimeFamily, type OutputFormatKey } from './formats';

const DEFAULT_QUALITY = 0.92;

function normalizeHeicResult(result: Blob | Blob[]): Blob {
  return Array.isArray(result) ? result[0] : result;
}

async function convertHeicBlob(file: Blob, mimeType: string): Promise<Blob> {
  const { default: heic2any } = await import('heic2any');
  const result = await heic2any({
    blob: file,
    toType: mimeType,
    quality: DEFAULT_QUALITY,
  });

  return normalizeHeicResult(result);
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const imageUrl = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(imageUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      reject(new Error('The image could not be decoded in this browser.'));
    };

    image.src = imageUrl;
  });
}

async function rasterizeImage(file: Blob, mimeType: string): Promise<Blob> {
  const image = await loadImage(file);
  const canvas = document.createElement('canvas');
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('The browser could not create a drawing context for conversion.');
  }

  context.drawImage(image, 0, 0, width, height);

  const outputBlob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, mimeType, DEFAULT_QUALITY);
  });

  if (!outputBlob) {
    throw new Error(`The browser could not export ${mimeType}.`);
  }

  return outputBlob;
}

export async function createPreviewUrl(file: File): Promise<string> {
  const format = detectInputFormat(file);

  if (format === 'heic') {
    const previewBlob = await convertHeicBlob(file, 'image/png');
    return URL.createObjectURL(previewBlob);
  }

  return URL.createObjectURL(file);
}

export async function convertImageFile(file: File, destination: OutputFormatKey): Promise<Blob> {
  const format = detectInputFormat(file);

  if (!format) {
    throw new Error(`Unsupported input format: ${file.name}`);
  }

  const targetMimeType = getDestinationMimeType(destination);

  if (format === 'heic') {
    return convertHeicBlob(file, targetMimeType);
  }

  if (isSameMimeFamily(format, destination)) {
    return file.slice(0, file.size, targetMimeType);
  }

  return rasterizeImage(file, targetMimeType);
}

export function revokeObjectUrl(url?: string): void {
  if (url) {
    URL.revokeObjectURL(url);
  }
}
