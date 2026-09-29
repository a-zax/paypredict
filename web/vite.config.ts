import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8000" } },
  build: {
    rollupOptions: {
      output: {
        // Long-lived vendor chunks: cached across deploys, and charts load only on pages that draw them.
        manualChunks: { react: ["react", "react-dom", "react-router-dom", "@tanstack/react-query"], charts: ["recharts"], motion: ["motion"] },
      },
    },
  },
});
