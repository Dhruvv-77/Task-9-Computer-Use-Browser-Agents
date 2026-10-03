import { OLLAMA_URL, VISION_MODEL, TEXT_MODEL } from "./config.js";

export interface ActionCall {
    ok: boolean;
    action?: Record<string, unknown>;
    error?: string;
    rawResponse?: string;
    /** Full model output (prose reasoning + JSON) for trajectory auditing. */
    prose?: string;
}

export interface ChatMessage {
    role: string;
    content: string;
}

/**
 * Collect balanced top-level JSON objects from a response that may contain
 * prose around them. Objects are de-duplicated by exact text: a model that
 * states the same action twice (prose + fenced copy) still proposes ONE
 * action, while two DIFFERENT objects mean it is proposing a plan.
 */
function collectObjects(text: string): string[] {
    const found: string[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escape = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (ch === "\\") {
            escape = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (ch === "{") {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === "}" && depth > 0) {
            depth--;
            if (depth === 0 && start !== -1) {
                found.push(text.slice(start, i + 1));
                start = -1;
            }
        }
    }
    const seen = new Set<string>();
    return found.filter((o) => (seen.has(o) ? false : (seen.add(o), true)));
}

async function chat(
    model: string,
    systemPrompt: string,
    messages: ChatMessage[],
    imageB64?: string
): Promise<string> {
    const msgs = [
        { role: "system", content: systemPrompt },
        ...messages.map((m) =>
            imageB64 && m === messages[messages.length - 1]
                ? { ...m, images: [imageB64] }
                : m
        ),
    ];

    const payload = {
        model,
        messages: msgs,
        stream: false,
        // No format:"json": it forbids reasoning-before-answer, which measurably
        // degrades decisions (the model answered immediately and skipped steps).
        // parseAction() extracts the final JSON object from prose instead.
        options: { temperature: 0 },
    };

    let res: Response;
    try {
        res = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    } catch (err: any) {
        throw new Error(
            `Ollama connection failed (${OLLAMA_URL}). Ensure Ollama is running with '${model}'. Error: ${err.message}`
        );
    }

    if (!res.ok) {
        throw new Error(`Ollama returned status ${res.status}: ${await res.text()}`);
    }

    const data: any = await res.json();
    return (data.message?.content || "").trim();
}

/** Parse a raw model reply into exactly one action, or a precise error. */
export function parseAction(content: string): ActionCall {
    const withProse = (r: Omit<ActionCall, "prose">): ActionCall => ({ ...r, prose: content });

    // Protocol check: exactly ONE distinct action per reply. A restated copy
    // of the same object is fine; two different objects mean the model is
    // handing the harness a plan - the harness executes one action per step,
    // so this is a protocol violation and gets a precise retry signal.
    const objects = collectObjects(content);
    const kindObjects: string[] = [];
    for (const obj of objects) {
        try {
            const p = JSON.parse(obj);
            if (p && typeof p === "object" && !Array.isArray(p) && typeof p.kind === "string") {
                kindObjects.push(obj);
            }
        } catch {
            /* skip unparseable fragments */
        }
    }
    if (kindObjects.length > 1) {
        return withProse({
            ok: false,
            error: `Malformed action: reply proposed ${kindObjects.length} different actions - the harness executes ONE action per turn; return exactly one JSON object`,
            rawResponse: kindObjects[0],
        });
    }

    const candidates = [content, kindObjects[0] || objects[0] || ""];
    for (const c of candidates) {
        if (!c) continue;
        try {
            const parsed = JSON.parse(c);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                if (typeof parsed.kind === "string") {
                    return withProse({ ok: true, action: parsed, rawResponse: c });
                }
                return withProse({
                    ok: false,
                    error: "Malformed action: missing 'kind' string property",
                    rawResponse: c,
                });
            }
            return withProse({
                ok: false,
                error: "Malformed action: model returned a non-object",
                rawResponse: c,
            });
        } catch {
            /* try next candidate */
        }
    }
    return withProse({
        ok: false,
        error: "Malformed action: JSON parse failed",
        rawResponse: content,
    });
}

/** Text-only decision (dom / dom+text contexts without an image). */
export async function queryText(
    systemPrompt: string,
    messages: ChatMessage[]
): Promise<ActionCall> {
    const content = await chat(TEXT_MODEL, systemPrompt, messages);
    return parseAction(content);
}

/** Vision decision: screenshot attached to the final message. */
export async function queryVision(
    systemPrompt: string,
    messages: ChatMessage[],
    imageB64: string
): Promise<ActionCall> {
    const content = await chat(VISION_MODEL, systemPrompt, messages, imageB64);
    return parseAction(content);
}
