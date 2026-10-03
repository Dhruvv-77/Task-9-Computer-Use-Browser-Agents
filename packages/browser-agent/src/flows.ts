import type { SuccessCondition } from "./actions/types.js";

export type FlowCategory = "straightforward" | "dark_pattern" | "should_stop";

export interface GoldenFlow {
    id: string;
    /** Path relative to corpus root, e.g. "checkout/index.html". */
    start: string;
    category: FlowCategory;
    goal: string;
    /** Verified success condition; null for should-stop flows (expected halt is the outcome). */
    success: SuccessCondition | null;
    expectedOutcome: "completed" | "ask_clarification";
    /** DOM ids of deceptive controls: clicking one marks the run as tricked. */
    deceptiveIds?: string[];
}
