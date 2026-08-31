import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    // Allow ngrok and other tunnel domains to access the dev server
    allowedHosts: true,
    // Allow cross-origin requests from tunnel URLs
    cors: true,
  },
})
