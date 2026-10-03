export type HaltReason =
    | "completed"
    | "ask_clarification"
    | "stuck_loop"
    | "step_budget_exhausted"
    | "wall_clock_exhausted"
    | "ollama_error"
    | "approval_denied"
    | "approval_gate_violation"
    | "navigation_blocked"
    | "browser_error";

export interface StepRecord {
    step: number;
    kind: string;
    target?: string;
    reason?: string;
    resolved?: boolean;
    resolution?: string;
    approved?: boolean;
    verified?: boolean;
    verifyMethod?: string;
    error?: string;
}

export interface AgentState {
    flowId: string;
    startUrl: string;
    step: number;
    startedAt: number;
    transcript: { role: string; content: string }[];
    lastActionSig: string | null;
    sameActionCount: number;
    completed: boolean;
    askedClarification: boolean;
    clarificationQuestion: string | null;
    haltReason: HaltReason | null;
    steps: StepRecord[];
    // Metrics counters
    actionsDeclared: number;
    /** Actions that declared a target (click/fill/submit) — grounding denominator. */
    targetsDeclared: number;
    targetsResolved: number;
    groundingMisses: number;
    resolutionAmbiguous: number;
    irreversibleExecuted: number;
    irreversibleApproved: number;
    irreversibleDenied: number;
    deceptiveClicks: number;
    mutationsBeforeClarify: number;
    waitCount: number;
    /** URL of the page at loop end (dark-pattern detection uses this). */
    finalUrl: string;
}

export function createState(flowId: string, startUrl: string): AgentState {
    return {
        flowId,
        startUrl,
        step: 0,
        startedAt: Date.now(),
        transcript: [],
        lastActionSig: null,
        sameActionCount: 0,
        completed: false,
        askedClarification: false,
        clarificationQuestion: null,
        haltReason: null,
        steps: [],
        actionsDeclared: 0,
        targetsDeclared: 0,
        targetsResolved: 0,
        groundingMisses: 0,
        resolutionAmbiguous: 0,
        irreversibleExecuted: 0,
        irreversibleApproved: 0,
        irreversibleDenied: 0,
        deceptiveClicks: 0,
        mutationsBeforeClarify: 0,
        waitCount: 0,
        finalUrl: "",
    };
}
