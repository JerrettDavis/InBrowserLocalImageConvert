# Local Image Convert

Local Image Convert is a lightweight static web app for browser-only image conversion. The first-class path is **HEIC to JPG**, but the app also supports JPG/JPEG, PNG, WEBP, BMP, and AVIF inputs with JPG, PNG, and WEBP outputs.

## What it does

- Converts a single image or a full batch entirely in the browser
- Shows uploaded image previews before conversion
- Rejects ZIP uploads and unsupported file types up front
- Downloads converted images individually or as a ZIP archive
- Adapts automatically to the system light/dark theme
- Deploys cleanly to GitHub Pages

## Privacy and processing

All processing happens locally in the browser. Files are never uploaded to a backend because there is no backend.

## Supported flows

| Source | Outputs |
| --- | --- |
| HEIC / HEIF | JPG, PNG, WEBP |
| JPG / JPEG | JPG, PNG, WEBP |
| PNG | JPG, PNG, WEBP |
| WEBP | JPG, PNG, WEBP |
| BMP | JPG, PNG, WEBP |
| AVIF | JPG, PNG, WEBP |

## Development

```bash
npm install
npm run test
npm run build
npm run dev
```

## GitHub Pages deployment

The repository includes:

- `.github/workflows/ci.yml` for install, test, and build validation
- `.github/workflows/deploy-pages.yml` for GitHub Pages publishing from `main`

To enable Pages:

1. Open **Settings** -> **Pages** in GitHub.
2. Set the source to **GitHub Actions**.
3. Push to `main`.

The Vite base path is already configured for the repository name `InBrowserLocalImageConvert`.

## Testing and guarantees

- Unit tests cover format detection, validation, and file naming helpers.
- Builds run through TypeScript and Vite.
- CI and deployment both run the test suite before building.
