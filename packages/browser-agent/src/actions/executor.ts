import type { Page, Locator } from "playwright";
import type { BrowserAction } from "./types.js";
import { safeUrl } from "../safety/navigation.js";
import { MAX_WAIT_MS } from "../config.js";

export interface ExecutionResult {
    executed: boolean;
    detail: string;
    /** URL after the action (for verification). */
    urlAfter: string;
}

/**
 * Execute a grounded action. The locator must already be resolved and
 * classified by the caller — this function never picks targets on its own.
 */
export async function executeAction(
    page: Page,
    action: BrowserAction,
    locator: Locator | null
): Promise<ExecutionResult> {
    switch (action.kind) {
        case "navigate": {
            const target = safeUrl(String(action.url || ""));
            await page.goto(target, { waitUntil: "load", timeout: 10_000 });
            return { executed: true, detail: `navigated to ${target}`, urlAfter: page.url() };
        }

        case "click":
        case "submit": {
            if (!locator) throw new Error("executeAction: click/submit requires a resolved locator");
            await locator.click({ timeout: 5_000 });
            // Let async handlers (timers, redirects) settle a beat.
            await page.waitForLoadState("load", { timeout: 5_000 }).catch(() => {});
            return { executed: true, detail: `clicked ${action.elementId || action.selector || action.name}`, urlAfter: page.url() };
        }

        case "fill": {
            if (!locator) throw new Error("executeAction: fill requires a resolved locator");
            await locator.fill(String(action.value ?? ""), { timeout: 5_000 });
            return { executed: true, detail: `filled ${action.elementId || action.selector}`, urlAfter: page.url() };
        }

        case "wait": {
            const ms = Math.max(0, Math.min(Number(action.ms) || 1000, MAX_WAIT_MS));
            await page.waitForTimeout(ms);
            return { executed: true, detail: `waited ${ms}ms`, urlAfter: page.url() };
        }

        case "ask_clarification":
        case "done": {
            // No browser side effect — handled by the loop.
            return { executed: false, detail: action.kind, urlAfter: page.url() };
        }

        default:
            throw new Error(`Unknown action kind: ${action.kind}`);
    }
}
