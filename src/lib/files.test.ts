import { describe, expect, it } from 'vitest';

import { buildConvertedFileName, buildZipFileName, formatFileSize, validateFiles } from './files';

describe('validateFiles', () => {
  it('accepts supported files for auto detection', () => {
    const file = new File(['hello'], 'sample.heic', { type: 'image/heic' });
    const result = validateFiles([file], 'auto');

    expect(result.accepted).toEqual([file]);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects zip uploads and unsupported files', () => {
    const zipFile = new File(['zip'], 'photos.zip', { type: 'application/zip' });
    const textFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });

    const result = validateFiles([zipFile, textFile], 'auto');

    expect(result.accepted).toHaveLength(0);
    expect(result.errors).toEqual([
      'photos.zip: ZIP uploads are not supported.',
      'notes.txt: unsupported image format.',
    ]);
  });

  it('enforces the selected source type', () => {
    const jpegFile = new File(['hello'], 'sample.jpg', { type: 'image/jpeg' });

    const result = validateFiles([jpegFile], 'heic');

    expect(result.accepted).toHaveLength(0);
    expect(result.errors).toEqual(['sample.jpg: does not match the selected source type.']);
  });
});

describe('file naming helpers', () => {
  it('renames the file extension to the destination format', () => {
    expect(buildConvertedFileName('summer.heic', 'jpg')).toBe('summer.jpg');
    expect(buildConvertedFileName('holiday.photo.png', 'webp')).toBe('holiday.photo.webp');
  });

  it('builds zip names and readable sizes', () => {
    expect(buildZipFileName('jpg')).toBe('converted-jpg.zip');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1_536)).toBe('1.5 KB');
  });
});
