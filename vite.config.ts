import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the built app works from any sub-path (GitHub Pages serves it at /<repo>/).
  base: './',
  build: {
    // three.js alone is ~700 kB; that is expected for a 3D app.
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
