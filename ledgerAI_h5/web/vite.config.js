import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { global: 'globalThis' }, // amazon-cognito-identity-js expects a Node-style global
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
