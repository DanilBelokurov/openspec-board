import { defineConfig } from "vitest/config";
import path from "node:path";

const here = path.resolve(__dirname);

export default defineConfig({
  test: {
    include: [path.join(here, "src/**/*.test.ts")],
    environment: "node",
  },
});