import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxy = {
  "/portal": { target: "http://localhost:3100", changeOrigin: true },
  "/health": { target: "http://localhost:3100", changeOrigin: true }
};

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5200, proxy },
  preview: { port: 5200, proxy }
});
