import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf8");
const { version } = JSON.parse(readFileSync("package.json", "utf8"));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outExtension: () => ({ js: ".mjs" }),
  banner: { js: "#!/usr/bin/env node" },
  target: "node20",
  clean: true,
  splitting: false,
  define: {
    __README__: JSON.stringify(readme),
    __VERSION__: JSON.stringify(version),
  },
});
