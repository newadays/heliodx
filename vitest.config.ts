import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests for the shared types/ and utils/ used by web/ and functions/.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: {
    environment: "node",
    include: ["types/**/*.test.ts", "utils/**/*.test.ts"],
  },
});
