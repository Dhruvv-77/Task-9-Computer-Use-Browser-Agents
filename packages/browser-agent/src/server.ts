import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { CORPUS_ROOT, SERVER_HOST, SERVER_PORT, BASE_URL } from "./config.js";

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
};

let server: http.Server | null = null;

export function baseUrl(): string {
    return BASE_URL;
}

export async function startServer(): Promise<string> {
    if (server) return BASE_URL;

    server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url || "/", BASE_URL);
            let rel = decodeURIComponent(url.pathname);
            if (rel.endsWith("/")) rel += "index.html";
            if (rel === "") rel = "/index.html";

            // Path traversal guard — never escape the corpus root.
            const resolved = path.resolve(CORPUS_ROOT, "." + rel);
            if (!resolved.startsWith(path.resolve(CORPUS_ROOT))) {
                res.writeHead(403);
                res.end("Forbidden");
                return;
            }

            const data = await fs.readFile(resolved);
            const ext = path.extname(resolved).toLowerCase();
            res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
            res.end(data);
        } catch {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not found");
        }
    });

    await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(SERVER_PORT, SERVER_HOST, () => resolve());
    });

    return BASE_URL;
}

export async function stopServer(): Promise<void> {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
}
