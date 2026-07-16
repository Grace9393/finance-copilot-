import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001'
    }
  },
  define: {
    // Expose the backend URL to the client bundle (set VITE_API_URL in Vercel env vars)
    __API_URL__: JSON.stringify(process.env.VITE_API_URL ?? '')
  }
});
