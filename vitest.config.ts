import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    alias: {
      vscode: resolve(__dirname, "src/__mocks__/vscode.ts"),
    },
  },
});
