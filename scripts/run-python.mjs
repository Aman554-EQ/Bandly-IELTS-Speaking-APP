// Runs a Python script with the project's virtual environment (.venv), on Windows, macOS and Linux.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const win = process.platform === "win32";
const py = path.join(root, ".venv", win ? "Scripts" : "bin", win ? "python.exe" : "python");
if (!existsSync(py)) {
  console.error(
    "Python venv not found. Create it first:\n  python -m venv .venv\n  .venv/Scripts/pip install -r tools/voice/requirements.txt   (Windows)\n  .venv/bin/pip install -r tools/voice/requirements.txt       (macOS/Linux)",
  );
  process.exit(1);
}
const res = spawnSync(py, process.argv.slice(2), { stdio: "inherit", cwd: root });
process.exit(res.status ?? 1);
