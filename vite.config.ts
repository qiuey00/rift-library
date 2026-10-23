import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The screens live in src/client. `npm run build` writes them to dist/client, which the
// server serves at http://localhost:4300. `npm run dev` serves them on port 5173 with hot
// reload and passes /api calls to the server.
export default defineConfig({
  root: path.join(import.meta.dirname, 'src', 'client'),
  plugins: [react(), tailwindcss()],
  // `@/` is src/client, as in components.json, so shadcn/ui parts keep their own imports.
  resolve: {
    alias: { '@': path.join(import.meta.dirname, 'src', 'client') },
  },
  build: {
    outDir: path.join(import.meta.dirname, 'dist', 'client'),
    emptyOutDir: true,
    // The screens load from this computer, so one large bundle costs nothing worth splitting.
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4300',
    },
  },
});
