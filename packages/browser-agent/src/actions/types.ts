export type ActionKind =
    | "navigate"
    | "click"
    | "fill"
    | "submit"
    | "wait"
    | "ask_clarification"
    | "done";

/**
 * A grounded browser action. The model must give the harness something it can
 * verify exists on the page: an element handle (E1..En), a resolvable selector,
 * or a role+name pair — never free text like "click the button".
 */
export interface BrowserAction {
    kind: ActionKind;
    /** Handle from the perception element list (dom/both modes). */
    elementId?: string;
    /** CSS selector (resolvable via Playwright locator). */
    selector?: string;
    /** Accessible role+name fallback (screenshot mode). */
    role?: string;
    name?: string;
    /** For navigate. */
    url?: string;
    /** For fill. */
    value?: string;
    /** For wait (ms, capped). */
    ms?: number;
    /** For ask_clarification. */
    question?: string;
    /** Why the model is taking this action. */
    reason?: string;
    /** Optional model-declared expectation, verified after execution. */
    expectPresent?: string;
    expectAbsent?: string;
}

export interface VerificationResult {
    passed: boolean;
    method: "url_change" | "dom_diff" | "element_present" | "element_absent" | "input_value" | "focus" | "none";
    expected: string;
    actual: string;
}

/** Flow success condition (checked after every action). */
export type SuccessCondition =
    | { type: "element_present"; value: string }
    | { type: "element_absent"; value: string }
    | { type: "url_matches"; value: string }
    | { type: "input_value"; selector: string; value: string }
    | { type: "all"; conditions: SuccessCondition[] };
