export type SourceFormatKey = 'auto' | 'heic' | 'jpeg' | 'png' | 'webp' | 'bmp' | 'avif';
export type DetectedFormatKey = Exclude<SourceFormatKey, 'auto'>;
export type OutputFormatKey = 'jpg' | 'png' | 'webp';

interface SourceFormatDefinition {
  readonly key: DetectedFormatKey;
  readonly label: string;
  readonly mimeTypes: readonly string[];
  readonly extensions: readonly string[];
}

interface DestinationFormatDefinition {
  readonly key: OutputFormatKey;
  readonly label: string;
  readonly mimeType: string;
  readonly extension: string;
}

export const SOURCE_FORMATS: readonly SourceFormatDefinition[] = [
  {
    key: 'heic',
    label: 'HEIC / HEIF',
    mimeTypes: ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'],
    extensions: ['.heic', '.heif'],
  },
  {
    key: 'jpeg',
    label: 'JPG / JPEG',
    mimeTypes: ['image/jpeg', 'image/jpg'],
    extensions: ['.jpg', '.jpeg'],
  },
  {
    key: 'png',
    label: 'PNG',
    mimeTypes: ['image/png'],
    extensions: ['.png'],
  },
  {
    key: 'webp',
    label: 'WEBP',
    mimeTypes: ['image/webp'],
    extensions: ['.webp'],
  },
  {
    key: 'bmp',
    label: 'BMP',
    mimeTypes: ['image/bmp'],
    extensions: ['.bmp'],
  },
  {
    key: 'avif',
    label: 'AVIF',
    mimeTypes: ['image/avif'],
    extensions: ['.avif'],
  },
] as const;

export const SOURCE_OPTIONS = [
  { key: 'auto' as const, label: 'Auto detect' },
  ...SOURCE_FORMATS.map(({ key, label }) => ({ key, label })),
];

export const DESTINATION_OPTIONS: readonly DestinationFormatDefinition[] = [
  { key: 'jpg', label: 'JPG', mimeType: 'image/jpeg', extension: '.jpg' },
  { key: 'png', label: 'PNG', mimeType: 'image/png', extension: '.png' },
  { key: 'webp', label: 'WEBP', mimeType: 'image/webp', extension: '.webp' },
] as const;

const SOURCE_BY_MIME = new Map<string, DetectedFormatKey>();
const SOURCE_BY_EXTENSION = new Map<string, DetectedFormatKey>();

for (const source of SOURCE_FORMATS) {
  for (const mimeType of source.mimeTypes) {
    SOURCE_BY_MIME.set(mimeType, source.key);
  }

  for (const extension of source.extensions) {
    SOURCE_BY_EXTENSION.set(extension, source.key);
  }
}

export const FILE_INPUT_ACCEPT = SOURCE_FORMATS.flatMap((source) => source.extensions).join(',');

export function getDestinationMimeType(destination: OutputFormatKey): string {
  return DESTINATION_OPTIONS.find((option) => option.key === destination)?.mimeType ?? 'image/jpeg';
}

export function getDestinationExtension(destination: OutputFormatKey): string {
  return DESTINATION_OPTIONS.find((option) => option.key === destination)?.extension ?? '.jpg';
}

export function formatKeyToLabel(format: DetectedFormatKey): string {
  return SOURCE_FORMATS.find((definition) => definition.key === format)?.label ?? format.toUpperCase();
}

export function detectInputFormat(file: { readonly name: string; readonly type?: string }): DetectedFormatKey | null {
  const fileType = file.type?.toLowerCase() ?? '';
  const fileName = file.name.toLowerCase();
  const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';

  if (extension && SOURCE_BY_EXTENSION.has(extension)) {
    return SOURCE_BY_EXTENSION.get(extension) ?? null;
  }

  if (fileType && SOURCE_BY_MIME.has(fileType)) {
    return SOURCE_BY_MIME.get(fileType) ?? null;
  }

  return null;
}

export function matchesSourceFilter(format: DetectedFormatKey, selectedSource: SourceFormatKey): boolean {
  return selectedSource === 'auto' || format === selectedSource;
}

export function isSameMimeFamily(format: DetectedFormatKey, destination: OutputFormatKey): boolean {
  if (format === 'jpeg' && destination === 'jpg') {
    return true;
  }

  return getDestinationExtension(destination) === SOURCE_FORMATS.find((item) => item.key === format)?.extensions[0];
}
