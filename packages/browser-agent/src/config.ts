import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// packages/browser-agent/src -> packages/browser-agent -> packages -> repo root
export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const CORPUS_ROOT = path.join(REPO_ROOT, "corpus");
export const TRAJECTORY_DIR = path.join(REPO_ROOT, "packages", "browser-agent", "trajectories");
export const EVALS_DIR = path.join(REPO_ROOT, "evals");
export const GOLDEN_FILE = path.join(EVALS_DIR, "golden-browser.jsonl");
export const EVAL_REPORT = path.join(EVALS_DIR, "report.json");
export const RESULTS_DIR = path.join(REPO_ROOT, "results");

// Local corpus server — the ONLY network endpoint the agent may ever reach.
export const SERVER_HOST = "127.0.0.1";
export const SERVER_PORT = Number(process.env.CORPUS_PORT) || 4173;
export const BASE_URL = `http://${SERVER_HOST}:${SERVER_PORT}`;

// Budgets
export const MAX_STEPS = Number(process.env.MAX_STEPS) || 12;
export const WALL_CLOCK_MS = Number(process.env.WALL_CLOCK_MS) || 300_000;

// Perception mode: which observations the model receives.
export type PerceptionMode = "screenshot" | "dom" | "both";
export const PERCEPTION_MODE: PerceptionMode =
    (process.env.PERCEPTION_MODE as PerceptionMode) || "both";

// Vision + text models (all local via Ollama — zero cost)
export const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
export const VISION_MODEL = process.env.VISION_MODEL || "qwen2.5vl:7b";
export const TEXT_MODEL = process.env.TEXT_MODEL || "qwen2.5:7b-instruct";

// Max wait the agent may request in one `wait` action (ms)
export const MAX_WAIT_MS = 15_000;
