import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxy = {
  "/v1": { target: "http://localhost:3100", changeOrigin: true },
  "/admin": { target: "http://localhost:3100", changeOrigin: true },
  "/advisor": { target: "http://localhost:3100", changeOrigin: true },
  "/health": { target: "http://localhost:3100", changeOrigin: true }
};

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5100, proxy },
  preview: { port: 5100, proxy }
});
