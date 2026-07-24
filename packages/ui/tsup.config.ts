import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  banner: { js: '"use client";' },
  external: ['react', 'react-dom', 'react/jsx-runtime', 'tailwindcss'],
});
