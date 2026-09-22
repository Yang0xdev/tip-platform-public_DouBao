import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5100,
    proxy: {
      "/v1": { target: "http://localhost:3100", changeOrigin: true },
      "/health": { target: "http://localhost:3100", changeOrigin: true }
    }
  },
  preview: {
    port: 5100,
    proxy: {
      "/v1": { target: "http://localhost:3100", changeOrigin: true },
      "/health": { target: "http://localhost:3100", changeOrigin: true }
    }
  }
});
