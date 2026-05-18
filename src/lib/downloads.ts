interface ZipEntry {
  readonly fileName: string;
  readonly blob: Blob;
}

export function createUniqueFileNames(fileNames: readonly string[]): string[] {
  const counts = new Map<string, number>();

  return fileNames.map((fileName) => {
    const nextCount = (counts.get(fileName) ?? 0) + 1;
    counts.set(fileName, nextCount);

    if (nextCount === 1) {
      return fileName;
    }

    const dotIndex = fileName.lastIndexOf('.');

    if (dotIndex <= 0) {
      return `${fileName} (${nextCount})`;
    }

    const baseName = fileName.slice(0, dotIndex);
    const extension = fileName.slice(dotIndex);
    return `${baseName} (${nextCount})${extension}`;
  });
}

export async function createZipBlob(entries: readonly ZipEntry[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const uniqueNames = createUniqueFileNames(entries.map((entry) => entry.fileName));

  for (const [index, entry] of entries.entries()) {
    zip.file(uniqueNames[index], entry.blob);
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
