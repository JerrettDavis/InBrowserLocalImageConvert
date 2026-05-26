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
import { runOcr, terminateOcr } from './lib/ocr';
import { parseReceipt } from './lib/receipt-parser';
import { buildExport } from './lib/export';
import type { OcrResult, ExportFormat } from './lib/ocr-types';

type NoticeTone = 'neutral' | 'error' | 'success';
type Mode = 'convert' | 'ocr';

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

type WorkflowStage = 'upload' | 'convert' | 'download';

// Track last-rendered progress per item for throttling
const lastRenderedProgress: Record<string, number> = {};

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
  mode: 'convert' as Mode,
  ocr: {
    results: {} as Record<string, OcrResult>,
    progress: {} as Record<string, number>,
    isRunning: false,
    exportFormat: 'txt' as ExportFormat,
    receiptMode: false,
    combined: true,
  },
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
        <div class="notice notice--${notice.tone}" ${notice.tone === 'error' ? 'role="alert"' : 'role="status"'}>
          ${escapeHtml(notice.text)}
        </div>
      `,
    )
    .join('');
}

function getWorkflowStage(convertedCount: number): WorkflowStage {
  if (convertedCount > 0) {
    return 'download';
  }

  if (state.items.length > 0) {
    return 'convert';
  }

  return 'upload';
}

function renderWorkflowSteps(convertedCount: number): string {
  const stage = getWorkflowStage(convertedCount);
  const steps = [
    {
      key: 'upload' as const,
      label: 'Upload',
      detail: 'Single image or full batch',
      state: state.items.length > 0 ? 'complete' : stage === 'upload' ? 'active' : 'idle',
    },
    {
      key: 'convert' as const,
      label: 'Convert',
      detail: `Source to ${destinationLabel(state.destination)}`,
      state: convertedCount > 0 ? 'complete' : stage === 'convert' ? 'active' : 'idle',
    },
    {
      key: 'download' as const,
      label: 'Download',
      detail: 'One by one or as ZIP',
      state: stage === 'download' ? 'active' : 'idle',
    },
  ];

  return steps
    .map(
      (step, index) => `
        <li class="step-card step-card--${step.state}">
          <span class="step-card__index">0${index + 1}</span>
          <div>
            <strong>${step.label}</strong>
            <p>${escapeHtml(step.detail)}</p>
          </div>
        </li>
      `,
    )
    .join('');
}

function renderPrimaryAction(destinationText: string): string {
  if (state.isPreparing) {
    return `
      <span class="button__content">
        <span class="button__spinner" aria-hidden="true"></span>
        Preparing previews
      </span>
    `;
  }

  if (state.isConverting) {
    return `
      <span class="button__content">
        <span class="button__spinner" aria-hidden="true"></span>
        ${escapeHtml(state.progressLabel || 'Converting')}
      </span>
    `;
  }

  return `<span class="button__content">Convert to ${escapeHtml(destinationText)}</span>`;
}

function renderActionHint(convertedCount: number): string {
  if (state.isPreparing) {
    return 'Preparing image previews so the batch is ready for conversion.';
  }

  if (state.isConverting) {
    return 'Converting locally in your browser. Keep this tab open until the batch finishes.';
  }

  if (convertedCount > 0) {
    return 'Downloads are ready. Grab single files from the cards or the full batch as a ZIP.';
  }

  if (state.items.length > 0) {
    return `Everything is loaded. Review the previews, confirm ${destinationLabel(state.destination)}, and convert when ready.`;
  }

  return 'Start by uploading one image or a full batch. ZIP files stay disabled by design.';
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
      const cardStateClass = item.error ? 'card--error' : item.converted ? 'card--converted' : 'card--uploaded';
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
        : `<span class="badge ${item.error ? 'badge--error' : ''}">${item.error ? 'Needs attention' : 'Uploaded'}</span>`;

      const mediaMarkup = item.previewUrl
        ? `<img class="card__preview" src="${item.previewUrl}" alt="${escapeHtml(item.file.name)} preview" loading="lazy" />`
        : `<div class="card__preview card__preview--placeholder">${escapeHtml(formatKeyToLabel(item.sourceFormat))}</div>`;

      return `
        <article class="card ${cardStateClass}">
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

// ── OCR render helpers ────────────────────────────────────────────────────────

function confidenceLevel(confidence: number): 'high' | 'mid' | 'low' {
  if (confidence >= 85) return 'high';
  if (confidence >= 60) return 'mid';
  return 'low';
}

function renderOcrCards(): string {
  if (state.items.length === 0) {
    return `
      <div class="empty-state">
        <h2>No images loaded yet</h2>
        <p>Drop images here or use the upload button, then run OCR.</p>
      </div>
    `;
  }

  return state.items
    .map((item) => {
      const result = state.ocr.results[item.id];
      const progress = state.ocr.progress[item.id] ?? 0;
      const isRunning = state.ocr.isRunning;

      const mediaMarkup = item.previewUrl
        ? `<img class="card__preview" src="${item.previewUrl}" alt="${escapeHtml(item.file.name)} preview" loading="lazy" />`
        : `<div class="card__preview card__preview--placeholder">${escapeHtml(formatKeyToLabel(item.sourceFormat))}</div>`;

      let statusBlock = '';
      if (result?.error) {
        statusBlock = `<p class="card__error">${escapeHtml(result.error)}</p>`;
      } else if (result) {
        const level = confidenceLevel(result.confidence);
        const confLabel = level === 'high' ? 'High' : level === 'mid' ? 'Mid' : 'Low';

        let receiptSummary = '';
        if (state.ocr.receiptMode && result.parsed) {
          const p = result.parsed;
          const itemCount = p.items.length;
          receiptSummary = `
            <div class="ocr-receipt-summary">
              ${p.merchant ? `<strong>${escapeHtml(p.merchant)}</strong>` : ''}
              ${p.date ? `<span>${escapeHtml(p.date)}</span>` : ''}
              ${p.total !== undefined ? `<span>Total: ${p.currency ? escapeHtml(p.currency) + ' ' : ''}${p.total.toFixed(2)}</span>` : ''}
              <span>${itemCount} line item${itemCount === 1 ? '' : 's'}</span>
            </div>
          `;
        }

        statusBlock = `
          <div class="ocr-card__confidence-row">
            <span class="confidence-badge confidence-badge--${level}" aria-label="Confidence: ${confLabel}">${confLabel} (${Math.round(result.confidence)}%)</span>
          </div>
          ${receiptSummary}
          <textarea
            class="ocr-card__text"
            data-action="edit-ocr-text"
            data-id="${item.id}"
            aria-label="Extracted text for ${escapeHtml(item.file.name)}"
          ></textarea>
        `;
      } else if (isRunning && progress > 0) {
        statusBlock = `<p class="ocr-card__pending">Processing&#x2026;</p>`;
      } else {
        statusBlock = `<p class="ocr-card__pending">Ready to run OCR</p>`;
      }

      const progressPct = Math.round(progress * 100);
      const progressBar = (isRunning || progress > 0)
        ? `<div class="ocr-progress" role="progressbar" aria-valuenow="${progressPct}" aria-valuemin="0" aria-valuemax="100">
             <div class="ocr-progress__fill" style="width: ${progressPct}%"></div>
           </div>`
        : '';

      const downloadBtn = result && !result.error
        ? `<button class="button button--ghost" data-action="download-ocr-single" data-id="${item.id}">Download</button>`
        : '';

      return `
        <article class="card ocr-card" data-id="${item.id}">
          <div class="card__media">
            ${mediaMarkup}
          </div>
          <div class="card__body">
            <div class="card__meta">
              <strong>${escapeHtml(item.file.name)}</strong>
              <span>${escapeHtml(formatFileSize(item.file.size))}</span>
            </div>
            ${progressBar}
            ${statusBlock}
            <div class="ocr-card__actions">
              ${downloadBtn}
              <button class="button button--ghost" data-action="remove-item" data-id="${item.id}">Remove</button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderOcrControlPanel(): string {
  const completedResults = Object.values(state.ocr.results).filter(r => !r.error);
  const hasResults = completedResults.length > 0;
  const runDisabled = state.items.length === 0 || state.ocr.isRunning;
  const downloadAllDisabled = !hasResults || state.ocr.isRunning;

  return `
    <div class="ocr-panel">
      <div class="ocr-panel__header">
        <span class="eyebrow">OCR setup</span>
        <p>Extract text from images locally in your browser.</p>
      </div>

      <div class="controls">
        <label class="field">
          <span>Export format</span>
          <select data-action="set-ocr-format" aria-label="OCR export format">
            <option value="txt" ${state.ocr.exportFormat === 'txt' ? 'selected' : ''}>Plain Text (.txt)</option>
            <option value="csv" ${state.ocr.exportFormat === 'csv' ? 'selected' : ''}>CSV (.csv)</option>
            <option value="xlsx" ${state.ocr.exportFormat === 'xlsx' ? 'selected' : ''}>Excel (.xlsx)</option>
          </select>
        </label>

        <label class="ocr-panel__check">
          <input type="checkbox" data-action="toggle-receipt-mode" ${state.ocr.receiptMode ? 'checked' : ''} />
          <span>Receipt mode (beta) &#x2014; parse merchant, totals &amp; line items</span>
        </label>

        <label class="ocr-panel__check">
          <input type="checkbox" data-action="toggle-combined" ${state.ocr.combined ? 'checked' : ''} />
          <span>Combined output &#x2014; merge all results into one file</span>
        </label>
      </div>

      <div class="stat-strip" aria-label="OCR summary">
        <div class="stat-tile">
          <span>Loaded</span>
          <strong>${state.items.length}</strong>
        </div>
        <div class="stat-tile">
          <span>Done</span>
          <strong>${completedResults.length}</strong>
        </div>
        <div class="stat-tile">
          <span>Status</span>
          <strong>${state.ocr.isRunning ? 'Running' : hasResults ? 'Ready' : 'Idle'}</strong>
        </div>
      </div>

      <button class="button button--primary button--full" data-action="run-ocr" ${runDisabled ? 'disabled' : ''}>
        ${state.ocr.isRunning
          ? `<span class="button__content"><span class="button__spinner" aria-hidden="true"></span>Running OCR&#x2026;</span>`
          : `<span class="button__content">Run OCR</span>`
        }
      </button>

      <button class="button button--ghost button--full" data-action="download-ocr-all" ${downloadAllDisabled ? 'disabled' : ''}>
        Download all
      </button>

      <button class="button button--ghost button--full" data-action="clear-ocr-results" ${!hasResults ? 'disabled' : ''}>
        Clear results
      </button>
    </div>
  `;
}

function renderModeToggle(): string {
  return `
    <div class="mode-toggle" role="group" aria-label="App mode">
      <button
        class="mode-toggle__btn"
        data-action="set-mode"
        data-mode="convert"
        aria-pressed="${state.mode === 'convert'}"
        type="button"
      >Convert</button>
      <button
        class="mode-toggle__btn"
        data-action="set-mode"
        data-mode="ocr"
        aria-pressed="${state.mode === 'ocr'}"
        type="button"
      >OCR</button>
    </div>
  `;
}

function render(): void {
  if (state.mode === 'convert') {
    renderConvertMode();
  } else {
    renderOcrMode();
  }
}

function renderOcrMode(): void {
  app.innerHTML = `
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <main class="shell" id="main-content">
      ${renderModeToggle()}

      <section class="hero" aria-busy="${state.ocr.isRunning}">
        <div class="hero__copywrap">
          <span class="eyebrow">100% local, in-browser OCR</span>
          <h1>Extract text from images without leaving your browser.</h1>
          <p class="hero__copy">
            Drop image files below, run OCR, then edit and download the results as plain text, CSV, or Excel.
            Optionally enable Receipt mode to parse merchant names, totals and line items.
          </p>
          <div class="hero__actions">
            <button class="button button--primary button--hero-inline" type="button" data-action="open-files">
              Upload images
            </button>
          </div>
        </div>

        ${renderOcrControlPanel()}
      </section>

      <section class="dropzone ${state.dragActive ? 'dropzone--active' : ''}" id="dropzone" aria-label="Choose images or drop them here">
        <input id="file-input" type="file" accept="${FILE_INPUT_ACCEPT}" multiple hidden />
        <div class="dropzone__content">
          <div class="dropzone__icon" aria-hidden="true">
            <span></span>
          </div>
          <span class="eyebrow">Step 1 &#xB7; upload</span>
          <h2>Drop images here or choose them from your device.</h2>
          <p>Upload your images, then click <strong>Run OCR</strong> to extract text.</p>
          <button class="button button--primary button--hero" type="button" data-action="open-files">
            Upload images
          </button>
          <div class="dropzone__meta">
            <p class="dropzone__hint">No ZIP uploads. Unsupported files are rejected.</p>
            <p class="dropzone__hint">Drag and drop works for single images and batches.</p>
          </div>
        </div>
      </section>

      <section class="notices" aria-live="polite">
        ${renderNotices()}
      </section>

      <section class="grid ocr-grid" aria-live="polite">
        ${renderOcrCards()}
      </section>
    </main>
  `;

  // Populate textareas after innerHTML to avoid </textarea> injection issues
  for (const item of state.items) {
    const result = state.ocr.results[item.id];
    if (!result || result.error) continue;
    const textarea = app.querySelector<HTMLTextAreaElement>(
      `textarea[data-action="edit-ocr-text"][data-id="${CSS.escape(item.id)}"]`,
    );
    if (textarea) {
      textarea.value = result.text;
    }
  }

  bindEvents();
}

function renderConvertMode(): void {
  const convertedCount = state.items.filter((item) => item.converted).length;
  const destinationLabel =
    DESTINATION_OPTIONS.find((option) => option.key === state.destination)?.label ?? 'JPG';
  const convertDisabled = state.items.length === 0 || state.isPreparing || state.isConverting;
  const workflowMarkup = renderWorkflowSteps(convertedCount);
  const actionHint = renderActionHint(convertedCount);
  const selectedSourceLabel =
    SOURCE_OPTIONS.find((option) => option.key === state.sourceFilter)?.label ?? 'Auto detect';

  app.innerHTML = `
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <main class="shell" id="main-content">
      ${renderModeToggle()}

      <section class="hero" aria-busy="${state.isPreparing || state.isConverting}">
        <div class="hero__copywrap">
          <span class="eyebrow">100% local, in-browser conversion</span>
          <h1>Simple image conversion that never leaves your browser.</h1>
          <p class="hero__copy">
            HEIC to JPG comes first, but you can also move between JPG, PNG, WEBP, BMP, and AVIF.
            Upload one image or a whole batch, preview them, convert them, and download one by one or as a ZIP.
          </p>
          <div class="hero__actions">
            <button class="button button--primary button--hero-inline" type="button" data-action="open-files">
              Upload images
            </button>
          </div>
          <div class="hero__route">
            <span class="hero__route-label">Current route</span>
            <strong>${escapeHtml(selectedSourceLabel)}</strong>
            <span aria-hidden="true">→</span>
            <strong>${escapeHtml(destinationLabel)}</strong>
          </div>
          <ul class="step-grid" aria-label="Conversion workflow">
            ${workflowMarkup}
          </ul>
        </div>

        <div class="control-panel">
          <div class="control-panel__header">
            <span class="eyebrow">Conversion setup</span>
            <p>Choose the direction once, then use the same flow for one file or the whole batch.</p>
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
          </div>

          <div class="stat-strip" aria-label="Conversion summary">
            <div class="stat-tile">
              <span>Uploaded</span>
              <strong>${state.items.length}</strong>
            </div>
            <div class="stat-tile">
              <span>Ready</span>
              <strong>${convertedCount}</strong>
            </div>
            <div class="stat-tile">
              <span>Mode</span>
              <strong>${state.items.length === 0 ? 'Idle' : state.items.length > 1 ? 'Batch' : 'Single'}</strong>
            </div>
          </div>

          <button id="clear-files" class="button button--ghost button--full" ${state.items.length === 0 ? 'disabled' : ''}>
            Clear selection
          </button>
        </div>
      </section>

      <section class="dropzone ${state.dragActive ? 'dropzone--active' : ''}" id="dropzone" aria-label="Choose images or drop them here">
        <input id="file-input" type="file" accept="${FILE_INPUT_ACCEPT}" multiple hidden />
        <div class="dropzone__content">
          <div class="dropzone__icon" aria-hidden="true">
            <span></span>
          </div>
          <span class="eyebrow">Step 1 · upload</span>
          <h2>Drop images here or choose them from your device.</h2>
          <p>HEIC to JPG is the default path, but the same flow works for every supported source.</p>
          <button class="button button--primary button--hero" type="button" data-action="open-files">
            Upload images
          </button>
          <div class="dropzone__meta">
            <p class="dropzone__hint">No ZIP uploads. Unsupported files are rejected before conversion.</p>
            <p class="dropzone__hint">Drag and drop works for single images and batches.</p>
          </div>
        </div>
      </section>

      <section class="action-bar">
        <div class="action-bar__summary">
          <span class="eyebrow">Step 2 · convert</span>
          <strong>${escapeHtml(actionHint)}</strong>
          <div class="progress-track" aria-hidden="true">
            <span class="progress-track__fill" style="width: ${convertedCount > 0 ? '100%' : state.items.length > 0 ? '58%' : '18%'}"></span>
          </div>
        </div>

        <div class="action-bar__buttons">
          <button id="convert-files" class="button button--primary" ${convertDisabled ? 'disabled' : ''}>
            ${renderPrimaryAction(destinationLabel)}
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
      text:
        state.items.length > 0
          ? `Destination updated to ${DESTINATION_OPTIONS.find((option) => option.key === nextDestination)?.label ?? nextDestination}. Run conversion again to refresh downloads.`
          : `Destination updated to ${DESTINATION_OPTIONS.find((option) => option.key === nextDestination)?.label ?? nextDestination}. Upload files when you're ready to convert.`,
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

  // Clear OCR state when new files are loaded
  state.ocr.results = {};
  state.ocr.progress = {};

  const notices: AppNotice[] = [
    {
      tone: 'success',
      text: `${preparedItems.length} file${preparedItems.length === 1 ? '' : 's'} ready${state.mode === 'ocr' ? ' for OCR' : ' for conversion'}.`,
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

// ── OCR logic ─────────────────────────────────────────────────────────────────

function shouldRenderOcrProgress(itemId: string, ratio: number): boolean {
  const last = lastRenderedProgress[itemId] ?? -1;
  return ratio - last >= 0.05 || ratio >= 1;
}

async function runOcrAll(): Promise<void> {
  if (state.items.length === 0 || state.ocr.isRunning) return;

  state.ocr.isRunning = true;
  render();

  for (const item of state.items) {
    try {
      const result = await runOcr(item.file, item.id, {
        onProgress: ({ ratio }) => {
          state.ocr.progress[item.id] = ratio;
          if (shouldRenderOcrProgress(item.id, ratio)) {
            lastRenderedProgress[item.id] = ratio;
            render();
          }
        },
      });
      const parsed = state.ocr.receiptMode ? parseReceipt(result.text) : undefined;
      state.ocr.results[item.id] = parsed !== undefined ? { ...result, parsed } : result;
      state.ocr.progress[item.id] = 1;
    } catch (e) {
      state.ocr.results[item.id] = {
        id: item.id,
        fileName: item.file.name,
        text: '',
        confidence: 0,
        error: e instanceof Error ? e.message : String(e),
      };
      setNotices([{ tone: 'error', text: `OCR failed for ${item.file.name}: ${String(e)}` }]);
    }
    render();
  }

  state.ocr.isRunning = false;
  const doneCount = Object.values(state.ocr.results).filter(r => !r.error).length;
  setNotices([{
    tone: doneCount > 0 ? 'success' : 'error',
    text: `OCR complete. ${doneCount} of ${state.items.length} file${state.items.length === 1 ? '' : 's'} processed successfully.`,
  }]);
  render();
}

async function downloadOcrSingle(itemId: string): Promise<void> {
  const result = state.ocr.results[itemId];
  if (!result || result.error) return;

  const artifacts = await buildExport(
    [result],
    state.ocr.exportFormat,
    { combined: false, receiptMode: state.ocr.receiptMode },
  );

  if (artifacts.length === 1) {
    downloadBlob(artifacts[0].blob, artifacts[0].fileName);
  } else {
    const zip = await createZipBlob(artifacts.map(a => ({ fileName: a.fileName, blob: a.blob })));
    downloadBlob(zip, `ocr-${Date.now()}.zip`);
  }
}

async function downloadOcrAll(): Promise<void> {
  const results = Object.values(state.ocr.results).filter(r => !r.error);
  if (results.length === 0) return;

  const artifacts = await buildExport(
    results,
    state.ocr.exportFormat,
    { combined: state.ocr.combined, receiptMode: state.ocr.receiptMode },
  );

  if (artifacts.length === 1) {
    downloadBlob(artifacts[0].blob, artifacts[0].fileName);
  } else {
    const zip = await createZipBlob(artifacts.map(a => ({ fileName: a.fileName, blob: a.blob })));
    downloadBlob(zip, `ocr-results-${Date.now()}.zip`);
  }
}

// ── Event binding ─────────────────────────────────────────────────────────────

function bindEvents(): void {
  const fileInput = document.querySelector<HTMLInputElement>('#file-input');
  const dropzone = document.querySelector<HTMLElement>('#dropzone');
  const openFileButtons = document.querySelectorAll<HTMLButtonElement>('[data-action="open-files"]');

  if (!fileInput || !dropzone || openFileButtons.length === 0) {
    return;
  }

  // Shared: file input + dropzone
  openFileButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      fileInput.click();
    });
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

  // Mode toggle (present in both modes)
  document.querySelectorAll<HTMLButtonElement>('[data-action="set-mode"]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode as Mode | undefined;
      if (mode && mode !== state.mode) {
        state.mode = mode;
        render();
      }
    });
  });

  if (state.mode === 'convert') {
    bindConvertEvents();
  } else {
    bindOcrEvents();
  }
}

function bindConvertEvents(): void {
  const convertButton = document.querySelector<HTMLButtonElement>('#convert-files');
  const downloadZipButton = document.querySelector<HTMLButtonElement>('#download-zip');
  const clearFilesButton = document.querySelector<HTMLButtonElement>('#clear-files');
  const sourceSelect = document.querySelector<HTMLSelectElement>('#source-filter');
  const destinationSelect = document.querySelector<HTMLSelectElement>('#destination-format');

  if (!convertButton || !downloadZipButton || !clearFilesButton || !sourceSelect || !destinationSelect) {
    return;
  }

  convertButton.addEventListener('click', () => {
    void convertAll();
  });
  downloadZipButton.addEventListener('click', () => {
    void downloadZip();
  });
  clearFilesButton.addEventListener('click', () => {
    resetItems();
    setNotices([{ tone: 'neutral', text: 'Selection cleared.' }]);
    render();
  });
  sourceSelect.addEventListener('change', (event) => {
    onSourceChange((event.currentTarget as HTMLSelectElement).value as SourceFormatKey);
  });
  destinationSelect.addEventListener('change', (event) => {
    onDestinationChange((event.currentTarget as HTMLSelectElement).value as OutputFormatKey);
  });

  document.querySelectorAll<HTMLButtonElement>('[data-action="download-item"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      const item = state.items.find((current) => current.id === id);
      if (!item?.converted) return;
      downloadBlob(item.converted.blob, item.converted.fileName);
    });
  });
}

function bindOcrEvents(): void {
  // Format select
  const formatSelect = document.querySelector<HTMLSelectElement>('[data-action="set-ocr-format"]');
  if (formatSelect) {
    formatSelect.addEventListener('change', () => {
      state.ocr.exportFormat = formatSelect.value as ExportFormat;
    });
  }

  // Receipt mode toggle
  const receiptCheck = document.querySelector<HTMLInputElement>('[data-action="toggle-receipt-mode"]');
  if (receiptCheck) {
    receiptCheck.addEventListener('change', () => {
      state.ocr.receiptMode = receiptCheck.checked;
      // Re-parse all existing results
      for (const [id, result] of Object.entries(state.ocr.results)) {
        if (!result.error) {
          const parsed = state.ocr.receiptMode ? parseReceipt(result.text) : undefined;
          state.ocr.results[id] = parsed !== undefined
            ? { ...result, parsed }
            : { ...result, parsed: undefined };
        }
      }
      render();
    });
  }

  // Combined toggle
  const combinedCheck = document.querySelector<HTMLInputElement>('[data-action="toggle-combined"]');
  if (combinedCheck) {
    combinedCheck.addEventListener('change', () => {
      state.ocr.combined = combinedCheck.checked;
    });
  }

  // Run OCR
  const runBtn = document.querySelector<HTMLButtonElement>('[data-action="run-ocr"]');
  if (runBtn) {
    runBtn.addEventListener('click', () => {
      void runOcrAll();
    });
  }

  // Download all
  const downloadAllBtn = document.querySelector<HTMLButtonElement>('[data-action="download-ocr-all"]');
  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', () => {
      void downloadOcrAll();
    });
  }

  // Clear results
  const clearResultsBtn = document.querySelector<HTMLButtonElement>('[data-action="clear-ocr-results"]');
  if (clearResultsBtn) {
    clearResultsBtn.addEventListener('click', () => {
      state.ocr.results = {};
      state.ocr.progress = {};
      setNotices([{ tone: 'neutral', text: 'OCR results cleared.' }]);
      render();
    });
  }

  // Per-card: download single
  document.querySelectorAll<HTMLButtonElement>('[data-action="download-ocr-single"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      if (!id) return;
      void downloadOcrSingle(id);
    });
  });

  // Per-card: remove item
  document.querySelectorAll<HTMLButtonElement>('[data-action="remove-item"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      if (!id) return;
      const item = state.items.find(i => i.id === id);
      if (item) {
        revokeObjectUrl(item.previewUrl);
        revokeObjectUrl(item.converted?.url);
      }
      state.items = state.items.filter(i => i.id !== id);
      delete state.ocr.results[id];
      delete state.ocr.progress[id];
      delete lastRenderedProgress[id];
      render();
    });
  });

  // Per-card: edit OCR text (textarea input event)
  document.querySelectorAll<HTMLTextAreaElement>('[data-action="edit-ocr-text"]').forEach((textarea) => {
    textarea.addEventListener('input', () => {
      const id = textarea.dataset.id;
      if (!id) return;
      const existing = state.ocr.results[id];
      if (!existing || existing.error) return;
      const newText = textarea.value;
      const parsed = state.ocr.receiptMode ? parseReceipt(newText) : undefined;
      state.ocr.results[id] = parsed !== undefined
        ? { ...existing, text: newText, parsed }
        : { ...existing, text: newText, parsed: undefined };
      // Surgically update only the receipt summary to preserve textarea cursor
      if (state.ocr.receiptMode) {
        const card = textarea.closest<HTMLElement>('.ocr-card');
        if (card) {
          const summaryEl = card.querySelector<HTMLElement>('.ocr-receipt-summary');
          const updatedResult = state.ocr.results[id];
          if (updatedResult && !updatedResult.error && updatedResult.parsed) {
            const p = updatedResult.parsed;
            const div = document.createElement('div');
            div.className = 'ocr-receipt-summary';
            if (p.merchant) {
              const strong = document.createElement('strong');
              strong.textContent = p.merchant;
              div.appendChild(strong);
            }
            if (p.date) {
              const span = document.createElement('span');
              span.textContent = p.date;
              div.appendChild(span);
            }
            if (p.total !== undefined) {
              const span = document.createElement('span');
              span.textContent = `Total: ${p.currency ? p.currency + ' ' : ''}${p.total.toFixed(2)}`;
              div.appendChild(span);
            }
            const countSpan = document.createElement('span');
            countSpan.textContent = `${p.items.length} line item${p.items.length === 1 ? '' : 's'}`;
            div.appendChild(countSpan);
            if (summaryEl) {
              summaryEl.replaceWith(div);
            } else {
              textarea.insertAdjacentElement('beforebegin', div);
            }
          }
        }
      }
    });
  });
}

window.addEventListener('beforeunload', () => {
  releaseItemResources(state.items);
  void terminateOcr();
});

render();
