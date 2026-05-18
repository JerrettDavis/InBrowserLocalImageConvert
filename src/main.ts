import './style.css';
import {
  DESTINATION_OPTIONS,
  FILE_INPUT_ACCEPT,
  SOURCE_OPTIONS,
  detectInputFormat,
  formatKeyToLabel,
  matchesSourceFilter,
  type DetectedFormatKey,
  type OutputFormatKey,
  type SourceFormatKey,
} from './lib/formats';
import { buildConvertedFileName, buildZipFileName, formatFileSize, validateFiles } from './lib/files';
import { convertImageFile, createPreviewUrl, revokeObjectUrl } from './lib/convert';
import { createZipBlob, downloadBlob } from './lib/downloads';

type NoticeTone = 'neutral' | 'error' | 'success';

interface AppNotice {
  readonly tone: NoticeTone;
  readonly text: string;
}

interface ConvertedAsset {
  readonly blob: Blob;
  readonly fileName: string;
  readonly url: string;
}

interface SelectedItem {
  readonly id: string;
  readonly file: File;
  readonly sourceFormat: DetectedFormatKey;
  readonly previewUrl: string;
  readonly error?: string;
  readonly converted?: ConvertedAsset;
}

const appRoot = document.querySelector<HTMLDivElement>('#app');

if (!appRoot) {
  throw new Error('App root was not found.');
}

const app: HTMLDivElement = appRoot;

const state = {
  sourceFilter: 'auto' as SourceFormatKey,
  destination: 'jpg' as OutputFormatKey,
  items: [] as SelectedItem[],
  notices: [
    {
      tone: 'neutral' as NoticeTone,
      text: 'Everything stays on your device. Nothing is uploaded anywhere.',
    },
  ],
  isPreparing: false,
  isConverting: false,
  dragActive: false,
  progressLabel: '',
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function makeId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `file-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function releaseItemResources(items: SelectedItem[]): void {
  for (const item of items) {
    revokeObjectUrl(item.previewUrl);
    revokeObjectUrl(item.converted?.url);
  }
}

function clearConvertedOutputs(): void {
  state.items = state.items.map((item) => {
    revokeObjectUrl(item.converted?.url);
    return {
      ...item,
      converted: undefined,
      error: undefined,
    };
  });
}

function setNotices(notices: AppNotice[]): void {
  state.notices = notices.length
    ? notices
    : [
        {
          tone: 'neutral',
          text: 'Everything stays on your device. Nothing is uploaded anywhere.',
        },
      ];
}

function renderNotices(): string {
  return state.notices
    .map(
      (notice) => `
        <div class="notice notice--${notice.tone}">
          ${escapeHtml(notice.text)}
        </div>
      `,
    )
    .join('');
}

function renderFileCards(): string {
  if (state.items.length === 0) {
    return `
      <div class="empty-state">
        <h2>No images loaded yet</h2>
        <p>Select one image or a batch to unlock conversion and downloads.</p>
      </div>
    `;
  }

  return state.items
    .map((item) => {
      const convertedMarkup = item.converted
        ? `
          <div class="card__result">
            <span class="badge badge--success">Ready</span>
            <span>${escapeHtml(item.converted.fileName)}</span>
          </div>
          <button class="button button--ghost" data-action="download-item" data-id="${item.id}">
            Download
          </button>
        `
        : '<span class="badge">Uploaded</span>';

      const mediaMarkup = item.previewUrl
        ? `<img class="card__preview" src="${item.previewUrl}" alt="${escapeHtml(item.file.name)} preview" loading="lazy" />`
        : `<div class="card__preview card__preview--placeholder">${escapeHtml(formatKeyToLabel(item.sourceFormat))}</div>`;

      return `
        <article class="card">
          <div class="card__media">
            ${mediaMarkup}
          </div>
          <div class="card__body">
            <div class="card__meta">
              <strong>${escapeHtml(item.file.name)}</strong>
              <span>${escapeHtml(formatKeyToLabel(item.sourceFormat))} • ${escapeHtml(formatFileSize(item.file.size))}</span>
            </div>
            <div class="card__actions">
              ${convertedMarkup}
            </div>
            ${item.error ? `<p class="card__error">${escapeHtml(item.error)}</p>` : ''}
          </div>
        </article>
      `;
    })
    .join('');
}

function render(): void {
  const convertedCount = state.items.filter((item) => item.converted).length;
  const destinationLabel =
    DESTINATION_OPTIONS.find((option) => option.key === state.destination)?.label ?? 'JPG';
  const convertDisabled = state.items.length === 0 || state.isPreparing || state.isConverting;

  app.innerHTML = `
    <main class="shell">
      <section class="hero">
        <div>
          <span class="eyebrow">100% local, in-browser conversion</span>
          <h1>Simple image conversion that never leaves your browser.</h1>
          <p class="hero__copy">
            HEIC to JPG comes first, but you can also move between JPG, PNG, WEBP, BMP, and AVIF.
            Upload one image or a whole batch, preview them, convert them, and download one by one or as a ZIP.
          </p>
        </div>

        <div class="controls">
          <label class="field">
            <span>Source</span>
            <select id="source-filter">
              ${SOURCE_OPTIONS.map(
                (option) =>
                  `<option value="${option.key}" ${option.key === state.sourceFilter ? 'selected' : ''}>${escapeHtml(option.label)}</option>`,
              ).join('')}
            </select>
          </label>

          <label class="field">
            <span>Destination</span>
            <select id="destination-format">
              ${DESTINATION_OPTIONS.map(
                (option) =>
                  `<option value="${option.key}" ${option.key === state.destination ? 'selected' : ''}>${escapeHtml(option.label)}</option>`,
              ).join('')}
            </select>
          </label>

          <button id="clear-files" class="button button--ghost" ${state.items.length === 0 ? 'disabled' : ''}>
            Clear
          </button>
        </div>
      </section>

      <section class="dropzone ${state.dragActive ? 'dropzone--active' : ''}" id="dropzone" tabindex="0" role="button" aria-label="Choose images or drop them here">
        <input id="file-input" type="file" accept="${FILE_INPUT_ACCEPT}" multiple hidden />
        <div class="dropzone__content">
          <span class="eyebrow">Single or batch upload</span>
          <h2>Drop images here</h2>
          <p>or use the big upload button</p>
          <button id="choose-files" class="button button--primary" type="button">
            Upload images
          </button>
          <p class="dropzone__hint">No ZIP uploads. Unsupported files are rejected before conversion.</p>
        </div>
      </section>

      <section class="action-bar">
        <div class="action-bar__summary">
          <strong>${state.items.length}</strong>
          <span>uploaded</span>
          <strong>${convertedCount}</strong>
          <span>converted</span>
        </div>

        <div class="action-bar__buttons">
          <button id="convert-files" class="button button--primary" ${convertDisabled ? 'disabled' : ''}>
            ${state.isPreparing ? 'Preparing previews…' : state.isConverting ? escapeHtml(state.progressLabel || 'Converting…') : `Convert to ${escapeHtml(destinationLabel)}`}
          </button>
          <button
            id="download-zip"
            class="button button--ghost"
            ${convertedCount < 2 || state.isConverting ? 'disabled' : ''}
          >
            Download ZIP
          </button>
        </div>
      </section>

      <section class="notices" aria-live="polite">
        ${renderNotices()}
      </section>

      <section class="grid" aria-live="polite">
        ${renderFileCards()}
      </section>
    </main>
  `;

  bindEvents();
}

function resetItems(): void {
  releaseItemResources(state.items);
  state.items = [];
}

function onDestinationChange(nextDestination: OutputFormatKey): void {
  if (state.destination === nextDestination) {
    return;
  }

  state.destination = nextDestination;
  clearConvertedOutputs();
  setNotices([
    {
      tone: 'neutral',
      text: `Destination updated to ${DESTINATION_OPTIONS.find((option) => option.key === nextDestination)?.label ?? nextDestination}. Run conversion again to refresh downloads.`,
    },
  ]);
  render();
}

function onSourceChange(nextSource: SourceFormatKey): void {
  if (state.sourceFilter === nextSource) {
    return;
  }

  state.sourceFilter = nextSource;

  if (state.items.length === 0) {
    render();
    return;
  }

  const keptItems = state.items.filter((item) => matchesSourceFilter(item.sourceFormat, nextSource));
  const removedItems = state.items.filter((item) => !matchesSourceFilter(item.sourceFormat, nextSource));

  if (removedItems.length > 0) {
    releaseItemResources(removedItems);
    state.items = keptItems;
    setNotices([
      {
        tone: 'error',
        text: `${removedItems.length} file${removedItems.length === 1 ? '' : 's'} no longer match the selected source filter and were removed.`,
      },
    ]);
  }

  clearConvertedOutputs();
  render();
}

async function loadFiles(files: File[]): Promise<void> {
  const { accepted, errors } = validateFiles(files, state.sourceFilter);

  if (accepted.length === 0) {
    resetItems();
    setNotices(errors.map((error) => ({ tone: 'error', text: error })));
    render();
    return;
  }

  state.isPreparing = true;
  render();

  const preparedItems = await Promise.all(
    accepted.map(async (file) => {
      const sourceFormat = detectInputFormat(file);

      if (!sourceFormat) {
        throw new Error(`Unsupported input format for ${file.name}.`);
      }

      try {
        const previewUrl = await createPreviewUrl(file);
        return {
          id: makeId(),
          file,
          sourceFormat,
          previewUrl,
        } satisfies SelectedItem;
      } catch {
        return {
          id: makeId(),
          file,
          sourceFormat,
          previewUrl: '',
          error: 'Preview unavailable, but conversion is still allowed.',
        } satisfies SelectedItem;
      }
    }),
  );

  resetItems();
  state.items = preparedItems;
  state.isPreparing = false;

  const notices: AppNotice[] = [
    {
      tone: 'success',
      text: `${preparedItems.length} file${preparedItems.length === 1 ? '' : 's'} ready for conversion.`,
    },
    ...errors.map((error) => ({ tone: 'error' as const, text: error })),
  ];

  setNotices(notices);
  render();
}

async function convertAll(): Promise<void> {
  if (state.items.length === 0 || state.isConverting) {
    return;
  }

  clearConvertedOutputs();
  state.isConverting = true;

  let successCount = 0;
  let failureCount = 0;

  for (const [index, item] of state.items.entries()) {
    state.progressLabel = `Converting ${index + 1} of ${state.items.length}`;
    render();

    try {
      const blob = await convertImageFile(item.file, state.destination);
      const converted: ConvertedAsset = {
        blob,
        fileName: buildConvertedFileName(item.file.name, state.destination),
        url: URL.createObjectURL(blob),
      };

      state.items = state.items.map((current) =>
        current.id === item.id
          ? {
              ...current,
              converted,
              error: undefined,
            }
          : current,
      );
      successCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Conversion failed.';
      state.items = state.items.map((current) =>
        current.id === item.id
          ? {
              ...current,
              converted: undefined,
              error: message,
            }
          : current,
      );
      failureCount += 1;
    }
  }

  state.isConverting = false;
  state.progressLabel = '';
  setNotices([
    {
      tone: successCount > 0 ? 'success' : 'error',
      text:
        failureCount === 0
          ? `Converted ${successCount} file${successCount === 1 ? '' : 's'} to ${destinationLabel(state.destination)}.`
          : `Converted ${successCount} file${successCount === 1 ? '' : 's'} with ${failureCount} failure${failureCount === 1 ? '' : 's'}.`,
    },
  ]);
  render();
}

function destinationLabel(destination: OutputFormatKey): string {
  return DESTINATION_OPTIONS.find((option) => option.key === destination)?.label ?? destination.toUpperCase();
}

async function downloadZip(): Promise<void> {
  const convertedItems = state.items
    .filter((item): item is SelectedItem & { converted: ConvertedAsset } => Boolean(item.converted))
    .map((item) => ({
      fileName: item.converted.fileName,
      blob: item.converted.blob,
    }));

  if (convertedItems.length < 2) {
    return;
  }

  const zipBlob = await createZipBlob(convertedItems);
  downloadBlob(zipBlob, buildZipFileName(state.destination));
}

function bindEvents(): void {
  const fileInput = document.querySelector<HTMLInputElement>('#file-input');
  const chooseFilesButton = document.querySelector<HTMLButtonElement>('#choose-files');
  const convertButton = document.querySelector<HTMLButtonElement>('#convert-files');
  const downloadZipButton = document.querySelector<HTMLButtonElement>('#download-zip');
  const clearFilesButton = document.querySelector<HTMLButtonElement>('#clear-files');
  const sourceSelect = document.querySelector<HTMLSelectElement>('#source-filter');
  const destinationSelect = document.querySelector<HTMLSelectElement>('#destination-format');
  const dropzone = document.querySelector<HTMLElement>('#dropzone');

  if (
    !fileInput ||
    !chooseFilesButton ||
    !convertButton ||
    !downloadZipButton ||
    !clearFilesButton ||
    !sourceSelect ||
    !destinationSelect ||
    !dropzone
  ) {
    return;
  }

  chooseFilesButton.addEventListener('click', (event) => {
    event.stopPropagation();
    fileInput.click();
  });
  convertButton.addEventListener('click', () => {
    void convertAll();
  });
  downloadZipButton.addEventListener('click', () => {
    void downloadZip();
  });
  clearFilesButton.addEventListener('click', () => {
    resetItems();
    setNotices([
      {
        tone: 'neutral',
        text: 'Selection cleared.',
      },
    ]);
    render();
  });

  sourceSelect.addEventListener('change', (event) => {
    onSourceChange((event.currentTarget as HTMLSelectElement).value as SourceFormatKey);
  });

  destinationSelect.addEventListener('change', (event) => {
    onDestinationChange((event.currentTarget as HTMLSelectElement).value as OutputFormatKey);
  });

  fileInput.addEventListener('change', async () => {
    const selectedFiles = Array.from(fileInput.files ?? []);
    fileInput.value = '';
    await loadFiles(selectedFiles);
  });

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (!state.dragActive) {
      state.dragActive = true;
      render();
    }
  });
  dropzone.addEventListener('dragleave', (event) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && dropzone.contains(nextTarget)) {
      return;
    }

    if (state.dragActive) {
      state.dragActive = false;
      render();
    }
  });
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    state.dragActive = false;
    const droppedFiles = Array.from(event.dataTransfer?.files ?? []);
    void loadFiles(droppedFiles);
  });

  document.querySelectorAll<HTMLButtonElement>('[data-action="download-item"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      const item = state.items.find((current) => current.id === id);

      if (!item?.converted) {
        return;
      }

      downloadBlob(item.converted.blob, item.converted.fileName);
    });
  });
}

window.addEventListener('beforeunload', () => {
  releaseItemResources(state.items);
});

render();
