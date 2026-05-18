interface ZipEntry {
  readonly fileName: string;
  readonly blob: Blob;
}

export async function createZipBlob(entries: readonly ZipEntry[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  for (const entry of entries) {
    zip.file(entry.fileName, entry.blob);
  }

  return zip.generateAsync({ type: 'blob' });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
