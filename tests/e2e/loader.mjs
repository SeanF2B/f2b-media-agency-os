// Test-only module hooks: resolve "@/…" to the repo root, extension-less TS imports, and
// "cloudflare:workers" to an in-memory shim, so the real server code runs under plain Node.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shim = pathToFileURL(path.join(root, "tests/e2e/cf-shim.mjs")).href;
function withExt(file) {
  if (existsSync(file) && !file.endsWith("/")) { try { if (!require_isDir(file)) return file; } catch { return file; } }
  for (const ext of [".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.mjs"]) if (existsSync(file + ext)) return file + ext;
  return null;
}
import { statSync } from "node:fs";
function require_isDir(file) { return statSync(file).isDirectory(); }
export async function resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return { url: shim, shortCircuit: true };
  let target = null;
  if (specifier.startsWith("@/")) target = path.join(root, specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  if (target) { const found = withExt(target); if (found) return { url: pathToFileURL(found).href, shortCircuit: true }; }
  return next(specifier, context);
}
