import {
  detectInputFormat,
  getDestinationExtension,
  matchesSourceFilter,
  type OutputFormatKey,
  type SourceFormatKey,
} from './formats';

export const MAX_FILE_COUNT = 50;
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export interface FileValidationResult {
  readonly accepted: File[];
  readonly errors: string[];
}

export function validateFiles(files: File[], selectedSource: SourceFormatKey): FileValidationResult {
  const accepted: File[] = [];
  const errors: string[] = [];

  if (files.length === 0) {
    return {
      accepted,
      errors: ['Choose at least one image to continue.'],
    };
  }

  if (files.length > MAX_FILE_COUNT) {
    errors.push(`Only the first ${MAX_FILE_COUNT} files were kept for this batch.`);
  }

  for (const file of files.slice(0, MAX_FILE_COUNT)) {
    const lowerName = file.name.toLowerCase();

    if (lowerName.endsWith('.zip') || file.type === 'application/zip') {
      errors.push(`${file.name}: ZIP uploads are not supported.`);
      continue;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      errors.push(`${file.name}: ${formatFileSize(file.size)} exceeds the 50 MB per-file limit.`);
      continue;
    }

    const format = detectInputFormat(file);

    if (!format) {
      errors.push(`${file.name}: unsupported image format.`);
      continue;
    }

    if (!matchesSourceFilter(format, selectedSource)) {
      errors.push(`${file.name}: does not match the selected source type.`);
      continue;
    }

    accepted.push(file);
  }

  return {
    accepted,
    errors,
  };
}

export function buildConvertedFileName(fileName: string, destination: OutputFormatKey): string {
  const extension = getDestinationExtension(destination);
  const baseName = fileName.replace(/\.[^.]+$/u, '');
  return `${baseName}${extension}`;
}

export function buildZipFileName(destination: OutputFormatKey): string {
  return `converted-${destination}.zip`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB'];
  let size = bytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
