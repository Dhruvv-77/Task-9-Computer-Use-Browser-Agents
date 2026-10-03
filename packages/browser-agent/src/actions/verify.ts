import type { Page, Locator } from "playwright";
import type { BrowserAction, SuccessCondition, VerificationResult } from "./types.js";
import { captureAria } from "../perception/capture.js";
import { VerificationError } from "../safety/navigation.js";

/**
 * Post-action verification: the harness confirms the page actually changed
 * as expected BEFORE the agent takes its next action.
 *
 * - Model-declared expectations (expectPresent/expectAbsent) win when present.
 * - navigate: URL must match the target AND page content must have changed
 *   (a URL change alone with identical content does not pass).
 * - click/submit: URL change or accessibility-tree diff (content, not just nav).
 * - fill: the input must actually hold the typed value.
 */
export async function verifyAction(
    page: Page,
    action: BrowserAction,
    before: { url: string; aria: string; activeId?: string },
    locator: Locator | null = null
): Promise<VerificationResult> {
    const afterUrl = page.url();

    // Model-declared expectations.
    if (action.expectPresent) {
        const count = await page.locator(action.expectPresent).count();
        const visible = count > 0 ? await page.locator(action.expectPresent).first().isVisible().catch(() => false) : false;
        return {
            passed: count > 0 && visible,
            method: "element_present",
            expected: `element ${action.expectPresent} present and visible`,
            actual: count === 0 ? "0 matches" : visible ? "present" : "present but hidden",
        };
    }
    if (action.expectAbsent) {
        const count = await page.locator(action.expectAbsent).count();
        return {
            passed: count === 0,
            method: "element_absent",
            expected: `element ${action.expectAbsent} absent`,
            actual: `${count} match(es)`,
        };
    }

    switch (action.kind) {
        case "navigate": {
            const afterAria = await captureAria(page);
            const urlMatches = afterUrl.includes(String(action.url || ""));
            const contentChanged = afterAria !== before.aria;
            return {
                passed: urlMatches && contentChanged,
                method: "url_change",
                expected: `url contains '${action.url}' and page content changed`,
                actual: `url=${afterUrl}, contentChanged=${contentChanged}`,
            };
        }

        case "click":
        case "submit": {
            const afterAria = await captureAria(page);
            const urlChanged = afterUrl !== before.url;
            const domChanged = afterAria !== before.aria;
            if (urlChanged || domChanged) {
                return {
                    passed: true,
                    method: domChanged ? "dom_diff" : "url_change",
                    expected: "page state changed (URL or DOM) after the action",
                    actual: `urlChanged=${urlChanged}, domChanged=${domChanged}`,
                };
            }
            // Fallback: clicking an editable field only focuses it - that IS an
            // observable state change for the click-then-type pattern (but a
            // focus change to a button never counts; only editable targets).
            if (locator) {
                const tag = await locator
                    .first()
                    .evaluate((el) => el.tagName.toLowerCase())
                    .catch(() => "");
                if (tag === "input" || tag === "textarea") {
                    const activeId = await page
                        .evaluate(() => ((document.activeElement as HTMLElement | null)?.id) || "")
                        .catch(() => "");
                    const beforeId = before.activeId ?? "";
                    if (activeId && activeId !== beforeId) {
                        return {
                            passed: true,
                            method: "focus",
                            expected: "clicked input focused",
                            actual: `focus moved to #${activeId}`,
                        };
                    }
                }
            }
            return {
                passed: false,
                method: "dom_diff",
                expected: "page state changed (URL or DOM) after the action",
                actual: `urlChanged=${urlChanged}, domChanged=${domChanged}`,
            };
        }

        case "fill": {
            if (locator) {
                const value = await locator.inputValue().catch(() => null);
                return {
                    passed: value === action.value,
                    method: "input_value",
                    expected: String(action.value ?? ""),
                    actual: String(value),
                };
            }
            if (action.selector) {
                const value = await page
                    .locator(action.selector)
                    .first()
                    .inputValue()
                    .catch(() => null);
                return {
                    passed: value === action.value,
                    method: "input_value",
                    expected: String(action.value ?? ""),
                    actual: String(value),
                };
            }
            return { passed: true, method: "none", expected: "value typed", actual: "ok" };
        }

        case "wait": {
            const afterAria = await captureAria(page);
            return {
                passed: true,
                method: "none",
                expected: "wait completed",
                actual: afterAria !== before.aria ? "content changed during wait" : "no change during wait",
            };
        }

        default:
            return { passed: true, method: "none", expected: "-", actual: "-" };
    }
}

/** Flow-level success condition, checked after every action. */
export async function checkSuccess(
    page: Page,
    condition: SuccessCondition | null
): Promise<boolean> {
    if (!condition) return false;
    switch (condition.type) {
        case "element_present": {
            const loc = page.locator(condition.value);
            const count = await loc.count();
            if (count === 0) return false;
            return await loc.first().isVisible().catch(() => false);
        }
        case "element_absent": {
            const count = await page.locator(condition.value).count();
            return count === 0;
        }
        case "url_matches": {
            return page.url().includes(condition.value);
        }
        case "input_value": {
            const actual = await page
                .locator(condition.selector)
                .first()
                .inputValue()
                .catch(() => null);
            return actual === condition.value;
        }
        case "all": {
            for (const c of condition.conditions) {
                if (!(await checkSuccess(page, c))) return false;
            }
            return true;
        }
        default:
            return false;
    }
}

export function assertVerified(result: VerificationResult): void {
    if (!result.passed) {
        throw new VerificationError(
            `Verification failed (${result.method}): expected ${result.expected}; actual ${result.actual}`
        );
    }
}
