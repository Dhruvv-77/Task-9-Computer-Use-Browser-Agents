import type { Page, Locator } from "playwright";
import type { BrowserAction } from "./types.js";
import type { ElementHandleInfo } from "../perception/capture.js";
import type { TargetInfo } from "../safety/policy.js";
import { GroundingError } from "../safety/navigation.js";

export type ResolutionOutcome =
    | { ok: true; locator: Locator; display: string; info: TargetInfo }
    | {
          ok: false;
          reason: "not_found" | "ambiguous" | "no_target" | "bad_handle";
          detail: string;
      };

/**
 * A match that is hidden or covered (e.g. behind an open modal, or still
 * loading) is NOT a resolvable target — acting on it would fire against a
 * stale page state or time out on an intercepted click.
 */
async function hiddenProblem(loc: Locator): Promise<string | null> {
    const actionable = await loc
        .first()
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
    return actionable
        ? null
        : "element matches but is hidden or covered (page may still be loading, or a dialog is open); wait and re-observe.";
}

async function infoFromLocator(loc: Locator, handle?: ElementHandleInfo): Promise<TargetInfo> {
    let tag = handle?.tag;
    if (!tag) {
        tag = (await loc.evaluate((el: Element) => el.tagName.toLowerCase()).catch(() => "")) || "";
    }
    let text = handle?.text;
    if (text === undefined) {
        text = ((await loc.textContent().catch(() => "")) || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80);
    }
    const domId =
        handle?.domId ?? (((await loc.getAttribute("id").catch(() => null)) || undefined) as string | undefined);
    const dataIrreversible =
        handle?.dataIrreversible ?? (await loc.getAttribute("data-irreversible").catch(() => null));
    return { domId, tag, text, dataIrreversible };
}

/**
 * Models sometimes echo the observation's display formatting back as an id
 * ('[save]', '"save"', ' save '). Strip it before matching handles.
 */
export function normalizeRef(s: string): string {
    return s
        .trim()
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .replace(/^["'`]/, "")
        .replace(/["'`]$/, "")
        .trim();
}

/**
 * Resolve a model-declared target to exactly one element on the page.
 * Resolution order: element handle -> CSS selector -> role+name.
 * 0 matches = grounding miss; >1 = ambiguous (both count as grounding failures).
 */
export async function resolveTarget(
    page: Page,
    action: BrowserAction,
    handles: ElementHandleInfo[]
): Promise<ResolutionOutcome> {
    // 1. Element handle (dom / both modes)
    if (action.elementId) {
        const ref = normalizeRef(action.elementId);
        const handle = handles.find((h) => h.elementId === ref);
        if (!handle) {
            return {
                ok: false,
                reason: "bad_handle",
                detail: `Handle '${action.elementId}' does not exist in the current observation. Available: ${
                    handles.map((h) => h.elementId).join(", ") || "none"
                }.`,
            };
        }
        const loc = buildLocator(page, handle);
        const count = await loc.count();
        if (count === 0) {
            return {
                ok: false,
                reason: "not_found",
                detail: `Handle ${ref} (<${handle.tag}> ${
                    handle.text ? '"' + handle.text + '"' : ""
                }) no longer resolves on the page - the page may have changed since the observation.`,
            };
        }
        if (count > 1) {
            return {
                ok: false,
                reason: "ambiguous",
                detail: `Handle ${ref} resolves to ${count} elements.`,
            };
        }
        const hidden = await hiddenProblem(loc);
        if (hidden) {
            return { ok: false, reason: "not_found", detail: `Handle ${ref}: ${hidden}` };
        }
        return {
            ok: true,
            locator: loc,
            display: ref,
            info: await infoFromLocator(loc, handle),
        };
    }

    // 2. CSS selector
    if (action.selector) {
        const loc = page.locator(action.selector);
        const count = await loc.count();
        if (count === 0) {
            return {
                ok: false,
                reason: "not_found",
                detail: `Selector '${action.selector}' resolves to 0 elements on ${page.url()}.`,
            };
        }
        if (count > 1) {
            return {
                ok: false,
                reason: "ambiguous",
                detail: `Selector '${action.selector}' resolves to ${count} elements - it must identify exactly one.`,
            };
        }
        const hidden = await hiddenProblem(loc);
        if (hidden) {
            return { ok: false, reason: "not_found", detail: `Selector '${action.selector}': ${hidden}` };
        }
        return { ok: true, locator: loc, display: action.selector, info: await infoFromLocator(loc) };
    }

    // 3. Accessible role + name (screenshot mode)
    if (action.role && action.name !== undefined) {
        const byRole = page.getByRole(action.role as any, { name: action.name, exact: false });
        const count = await byRole.count();
        if (count === 0) {
            const byText = page.getByText(action.name, { exact: false });
            const textCount = await byText.count();
            if (textCount === 1) {
                return {
                    ok: true,
                    locator: byText,
                    display: `role=${action.role} name="${action.name}" (via text)`,
                    info: await infoFromLocator(byText),
                };
            }
            if (textCount > 1) {
                return {
                    ok: false,
                    reason: "ambiguous",
                    detail: `role=${action.role} name="${action.name}" not found by role; text match found ${textCount} elements.`,
                };
            }
            return {
                ok: false,
                reason: "not_found",
                detail: `No element with role '${action.role}' and name '${action.name}' on ${page.url()}.`,
            };
        }
        if (count > 1) {
            return {
                ok: false,
                reason: "ambiguous",
                detail: `role='${action.role}' name='${action.name}' matches ${count} elements - it must identify exactly one.`,
            };
        }
        const hidden = await hiddenProblem(byRole);
        if (hidden) {
            return { ok: false, reason: "not_found", detail: `role=${action.role} name="${action.name}": ${hidden}` };
        }
        return {
            ok: true,
            locator: byRole,
            display: `role=${action.role} name="${action.name}"`,
            info: await infoFromLocator(byRole),
        };
    }

    return {
        ok: false,
        reason: "no_target",
        detail: `Action kind '${action.kind}' requires a target: provide elementId, selector, or role+name.`,
    };
}

function buildLocator(page: Page, handle: ElementHandleInfo): Locator {
    if (handle.domId) {
        // Attribute selector: no CSS identifier escaping needed.
        return page.locator(`[id="${handle.domId}"]`);
    }
    if (handle.text) {
        return page
            .locator("a[href], button, input, textarea, select, [role=button], [onclick]")
            .filter({ hasText: handle.text });
    }
    if (handle.ariaLabel) return page.locator(`[aria-label="${handle.ariaLabel}"]`);
    throw new GroundingError(
        `Handle ${handle.elementId} has no id, text, or aria-label to locate by.`
    );
}
