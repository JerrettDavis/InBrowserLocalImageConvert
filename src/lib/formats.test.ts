import { describe, expect, it } from 'vitest';

import { detectInputFormat, formatKeyToLabel, matchesSourceFilter } from './formats';

describe('detectInputFormat', () => {
  it('prefers file extensions when available', () => {
    expect(detectInputFormat({ name: 'photo.HEIC', type: 'application/octet-stream' })).toBe('heic');
  });

  it('falls back to mime types', () => {
    expect(detectInputFormat({ name: 'unknown-file', type: 'image/webp' })).toBe('webp');
  });

  it('returns null for unsupported files', () => {
    expect(detectInputFormat({ name: 'archive.zip', type: 'application/zip' })).toBeNull();
  });
});

describe('format helpers', () => {
  it('matches the chosen source filter', () => {
    expect(matchesSourceFilter('heic', 'auto')).toBe(true);
    expect(matchesSourceFilter('png', 'png')).toBe(true);
    expect(matchesSourceFilter('jpeg', 'heic')).toBe(false);
  });

  it('returns readable labels', () => {
    expect(formatKeyToLabel('jpeg')).toBe('JPG / JPEG');
  });
});
