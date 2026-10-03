import fs from "node:fs/promises";
import path from "node:path";
import { TRAJECTORY_DIR } from "./config.js";

let currentLog = path.join(TRAJECTORY_DIR, "run.jsonl");

export function setTrajectoryFile(name: string): void {
    currentLog = path.join(TRAJECTORY_DIR, `${name}.jsonl`);
}

export function currentTrajectoryPath(): string {
    return currentLog;
}

export async function clearLog(): Promise<void> {
    await fs.mkdir(path.dirname(currentLog), { recursive: true });
    await fs.writeFile(currentLog, "");
}

export async function log(entry: Record<string, unknown>): Promise<void> {
    await fs.mkdir(path.dirname(currentLog), { recursive: true });
    await fs.appendFile(
        currentLog,
        JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n"
    );
}

export async function readLog(): Promise<Record<string, any>[]> {
    try {
        const text = await fs.readFile(currentLog, "utf8");
        return text
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l));
    } catch {
        return [];
    }
}
