import { copyFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outfile: "dist/extension.cjs",
});
await copyFile("src/renderer/renderer.js", "dist/renderer.js");
await build({
  entryPoints: ["scripts/installer.mjs"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/installer.cjs",
});
console.log("Copied the Workbench renderer bridge and built the privileged installer helper.");
