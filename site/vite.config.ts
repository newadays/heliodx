/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// E18 · The public results site. Static: it fetches the results file that
// `npm run eval -- export` puts in Cloud Storage (VITE_RESULTS_URL, from the
// repo's gitignored `.env.<mode>`), and shares the file's schema with the
// eval code (`@/functions/src/eval/publicSchema`). zod always resolves here.
export default defineConfig({
  plugins: [react()],
  envDir: repoRoot,
  envPrefix: "VITE_",
  resolve: {
    alias: {
      "@": repoRoot.replace(/\/$/, ""),
      "~": fileURLToPath(new URL("./src", import.meta.url)),
      zod: fileURLToPath(new URL("./node_modules/zod", import.meta.url)),
    },
  },
  server: { port: 5180, fs: { allow: [repoRoot] } },
  build: { outDir: "dist", emptyOutDir: true },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
});
