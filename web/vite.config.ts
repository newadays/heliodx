/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// The web client (cards W1–W11). It reads the repo's `.env.<mode>` files
// (EXPO_PUBLIC_* keys, a prefix kept so existing env files keep working) and
// imports shared modules from the repo root (`@/types`, `@/utils`, functions libs).
export default defineConfig({
  plugins: [react()],
  envDir: repoRoot,
  envPrefix: "EXPO_PUBLIC_",
  resolve: {
    alias: {
      "@": repoRoot.replace(/\/$/, ""),
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: { port: 5173, fs: { allow: [repoRoot] } },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // The Firebase SDK alone is ~580 kB; it is cached as its own chunk.
    chunkSizeWarningLimit: 700,
    rollupOptions: { output: { manualChunks: { firebase: ["firebase/app", "firebase/auth", "firebase/firestore", "firebase/functions", "firebase/storage"] } } },
  },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
});
