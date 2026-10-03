import type { Page, Locator } from "playwright";
import type { PerceptionMode } from "../config.js";

export interface ElementHandleInfo {
    elementId: string; // E1, E2, ... — the handle the model refers to
    domId?: string; // underlying id attribute, if present
    tag: string;
    text: string; // visible text (truncated)
    ariaLabel?: string;
    dataIrreversible?: string | null;
    /** Current value for input/textarea/select (aria snapshot does not show it). */
    value?: string;
    /** For checkbox/radio inputs: real checked state (value attr is always "on"). */
    checked?: boolean;
}

/** Selector used to enumerate interactable elements for handles. */
const INTERACTIVE_SELECTOR =
    "a[href], button, input, textarea, select, [role=button], [onclick], [data-irreversible]";

const MAX_HANDLES = 40;
const MAX_TEXT = 60;

/** Screenshot as base64 JPEG (primary observation). */
export async function captureScreenshot(page: Page): Promise<string> {
    const buf = await page.screenshot({ type: "jpeg", quality: 70 });
    return buf.toString("base64");
}

/** Accessibility tree (YAML aria snapshot) — DOM fallback / verification signal. */
export async function captureAria(page: Page): Promise<string> {
    return await page.locator("body").ariaSnapshot();
}

/**
 * Enumerate interactable elements into stable handles (E1..En).
 * These are the "element handles" the model must target — resolvable by the
 * harness, never free text the harness has to guess at.
 */
export async function listHandles(page: Page): Promise<ElementHandleInfo[]> {
    const root = page.locator(INTERACTIVE_SELECTOR);
    const count = Math.min(await root.count(), MAX_HANDLES);
    const handles: ElementHandleInfo[] = [];

    for (let i = 0; i < count; i++) {
        const loc = root.nth(i);
        // Only actionable targets qualify: visible AND receiving pointer events.
        // A button behind an open modal is "visible" to Playwright but covered;
        // listing it invites the model to re-click a stale handle.
        const actionable = await loc
            .evaluate((el: Element) => {
                const html = el as HTMLElement;
                const before = html.getBoundingClientRect();
                const offscreen =
                    before.bottom < 0 ||
                    before.top > window.innerHeight ||
                    before.right < 0 ||
                    before.left > window.innerWidth;
                if (offscreen) html.scrollIntoView({ block: "center", inline: "nearest" });
                const r = html.getBoundingClientRect();
                if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > window.innerHeight)
                    return false;
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return hit !== null && (hit === el || el.contains(hit));
            })
            .catch(() => false);
        if (!actionable) continue;

        const tag =
            (await loc.evaluate((el: Element) => el.tagName.toLowerCase()).catch(() => "")) || "";
        const text = ((await loc.textContent()) || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
        const domId = (await loc.getAttribute("id")) || undefined;
        const ariaLabel = (await loc.getAttribute("aria-label")) || undefined;
        const dataIrreversible = await loc.getAttribute("data-irreversible");
        let value: string | undefined;
        let checked: boolean | undefined;
        if (tag === "input" || tag === "textarea" || tag === "select") {
            const type = (await loc.getAttribute("type")) || "";
            if (tag === "input" && (type === "checkbox" || type === "radio")) {
                checked = await loc.isChecked().catch(() => undefined);
            } else {
                value = await loc.inputValue().catch(() => undefined);
                if (value && value.length > 60) value = value.slice(0, 60) + "...";
            }
        }

        handles.push({
            // Prefer the DOM id as the handle: it is stable across captures, so a
            // stale reference fails as bad_handle instead of silently re-mapping
            // to whatever now occupies E3 after the page changed.
            elementId: domId ?? `E${handles.length + 1}`,
            domId,
            tag,
            text,
            ariaLabel,
            dataIrreversible,
            value,
            checked,
        });
    }
    return handles;
}

export interface Observation {
    url: string;
    handles: ElementHandleInfo[];
    aria: string;
    screenshotB64: string | null;
}

export async function capture(
    page: Page,
    mode: PerceptionMode
): Promise<Observation> {
    const url = page.url();
    const wantScreenshot = mode === "screenshot" || mode === "both";
    const wantDom = mode === "dom" || mode === "both";

    // Handles first: enumeration may scroll elements into view, so the
    // screenshot must be taken afterwards to match what the model is told.
    const handles = wantDom ? await listHandles(page) : [];
    const aria = wantDom ? await captureAria(page) : "";
    const screenshotB64 = wantScreenshot ? await captureScreenshot(page) : null;

    return { url, handles, aria, screenshotB64 };
}

export function formatHandles(handles: ElementHandleInfo[]): string {
    if (handles.length === 0) return "(no interactive handles available in this mode)";
    return handles
        .map((h) => {
            const parts = [`[${h.elementId}] <${h.tag}>`];
            if (h.domId && h.domId !== h.elementId) parts.push(`#${h.domId}`);
            if (h.ariaLabel) parts.push(`label="${h.ariaLabel}"`);
            if (h.text) parts.push(`text="${h.text}"`);
            if (h.value !== undefined) parts.push(`value="${h.value}"`);
            if (h.checked !== undefined) parts.push(h.checked ? "[checked]" : "[unchecked]");
            if (h.dataIrreversible === "true") parts.push("(data-irreversible)");
            return parts.join(" ");
        })
        .join("\n");
}

export function formatObservation(obs: Observation, mode: PerceptionMode): string {
    const lines: string[] = [];
    lines.push(`CURRENT URL: ${obs.url}`);

    if (mode === "screenshot") {
        lines.push(
            "TARGETING: this observation has NO element handles and NO CSS selector support. elementId and selector will ALWAYS fail here.",
            'You MUST target elements as: {"kind":"click","role":"button","name":"exact visible label"} or {"kind":"fill","role":"textbox","name":"field label","value":"text"}',
            "Read the target's role and exact visible text from the attached screenshot."
        );
    } else {
        lines.push("", "INTERACTIVE ELEMENT HANDLES:", formatHandles(obs.handles));
        lines.push("", "ACCESSIBILITY TREE:", obs.aria);
        if (mode === "both") {
            lines.push("", "A screenshot of the page is also attached to this message.");
        }
    }
    return lines.join("\n");
}
