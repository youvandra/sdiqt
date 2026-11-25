import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In dev, /api goes to a watchtower started with `--listen 127.0.0.1:8801`.
const TOWER = process.env.SDIQT_TOWER_URL ?? "http://127.0.0.1:8801";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5320,
    strictPort: true,
    proxy: { "/api": TOWER },
  },
  build: { target: "es2022", sourcemap: true },
});
