import { defineConfig } from 'vite';

const githubPagesBase = '/InBrowserLocalImageConvert/';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === 'true' ? githubPagesBase : '/',
  build: {
    chunkSizeWarningLimit: 1600,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
