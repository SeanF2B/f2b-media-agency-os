import { spawnSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readExecutionProfile } from "./execution-profile.mjs";

const [command, ...args] = process.argv.slice(2);
if (!["dev", "build"].includes(command)) throw new Error("Expected dev or build.");
const root = fileURLToPath(new URL("..", import.meta.url));
const stockfishPublic = join(root, "public", "stockfish");
const stockfishPackage = join(root, "node_modules", "stockfish");
await mkdir(stockfishPublic, { recursive: true });
await Promise.all([
  copyFile(join(stockfishPackage, "bin", "stockfish-19-lite-single.js"), join(stockfishPublic, "stockfish-19-lite-single.js")),
  copyFile(join(stockfishPackage, "bin", "stockfish-19-lite-single.wasm"), join(stockfishPublic, "stockfish-19-lite-single.wasm")),
  copyFile(join(stockfishPackage, "Copying.txt"), join(stockfishPublic, "Copying.txt")),
]);
await import("node:fs/promises").then(({ writeFile }) => writeFile(join(stockfishPublic, "README.txt"), "F2B Agency OS uses Stockfish.js 19.0.1 for chess moves. Connor is the interface persona; Stockfish provides the chess engine.\n\nStockfish.js source and build scripts: https://github.com/nmrugg/stockfish.js\nStockfish source: https://github.com/official-stockfish/Stockfish\nLicense: GNU GPL v3. See Copying.txt.\n"));
const managedLinux = readExecutionProfile() === "managed-linux";

if (managedLinux && command === "build") {
  const result = spawnSync("bash", [
    fileURLToPath(new URL("./build-verified.sh", import.meta.url)), ...args,
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

// Import in this process so the preview owner retains its PID and signals.
const cli = new URL(managedLinux
  ? "../node_modules/vite/bin/vite.js"
  : "../node_modules/vinext/dist/cli.js", import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), command,
  ...(!managedLinux && command === "dev" ? ["--port", "5173"] : []), ...args];
await import(cli.href);
