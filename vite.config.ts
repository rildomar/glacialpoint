import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), {
    name: 'development-csp',
    transformIndexHtml(html, context) {
      // Vite injects an inline React refresh preamble only during development.
      return context.server ? html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';") : html;
    },
  }],
  server: { port: 1420, strictPort: true },
  clearScreen: false,
});
