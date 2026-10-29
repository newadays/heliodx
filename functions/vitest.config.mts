import { defineConfig } from "vitest/config";

// Two suites live here:
//  - unit tests (`test/*.test.ts`): pure logic, no emulator; `npm test`
//  - rules tests (`test/rules/*.test.ts`): need the Auth/Firestore/Storage
//    emulators; run through `npm run test:rules` (firebase emulators:exec)
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
