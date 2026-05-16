import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT = path.join(__dirname, "..", "..");
export const CONFIG = JSON.parse(
  fs.readFileSync(path.join(ROOT, "cameras.json"), "utf8")
);
