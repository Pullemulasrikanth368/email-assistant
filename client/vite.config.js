import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import commonjs from 'vite-plugin-commonjs';
import postcssPresetEnv from 'postcss-preset-env';
import postcssImport from 'postcss-import';
import tailwindcss from 'tailwindcss';
import path from 'path';

export default defineConfig({
  plugins: [react(), commonjs()],
  resolve: {
    alias: {
      '@': path.resolve('./src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8676',
        changeOrigin: true,
      },
    },
  },
  define: {
    global: 'window',
    'process.env': {},
  },
  css: {
    modules: {
      scopeBehaviour: 'global',
    },
    postcss: {
      plugins: [
        postcssImport(),
        tailwindcss(),
        postcssPresetEnv({
          features: { 'cascade-layers': true },
        }),
      ],
    },
  },
});
