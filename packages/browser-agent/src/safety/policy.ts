/**
 * Browser-action policy: 3-tier HITL classification (adapted from Task 5 PolicyEngine).
 * Classification is deterministic — an explicit allowlist plus an explicit
 * irreversible-element marker on the corpus pages — never the model's judgment alone.
 */

export type ActionCategory = "read_only" | "reversible_write" | "irreversible_or_external";

export interface PolicyDecision {
    category: ActionCategory;
    requiresApproval: boolean;
    action: string;
    reason: string;
}

export interface TargetInfo {
    /** DOM id attribute of the resolved element, if any. */
    domId?: string;
    tag?: string;
    /** Visible text of the element. */
    text?: string;
    /** value of data-irreversible attribute (author-marked on corpus pages). */
    dataIrreversible?: string | null;
}

export interface ActionRequest {
    /** Declared action kind from the model. */
    kind: string;
    target?: TargetInfo;
}

/** Only genuinely irreversible button labels (case-insensitive substring match). */
export const IRREVERSIBLE_LABELS = [
    "place order",
    "pay now",
    "purchase",
    "buy now",
    "subscribe",
    "send",
    "delete",
    "cancel subscription",
    "redeem",
    "confirm order",
    "complete purchase",
];

const READ_ONLY_KINDS = new Set(["navigate", "wait", "observe", "done"]);
const REVERSIBLE_KINDS = new Set(["click", "fill"]);
const NO_SIDE_EFFECT_KINDS = new Set(["ask_clarification"]);

export class PolicyEngine {
    static evaluate(req: ActionRequest): PolicyDecision {
        const { kind, target } = req;

        // Model explicitly declares a form submit — conservative: gate it.
        if (kind === "submit") {
            return {
                category: "irreversible_or_external",
                requiresApproval: true,
                action: kind,
                reason:
                    "Model declared a form submit; submits are gated conservatively regardless of target.",
            };
        }

        if (READ_ONLY_KINDS.has(kind)) {
            return {
                category: "read_only",
                requiresApproval: false,
                action: kind,
                reason: "Observation/navigation/wait actions have no side effects on the page state we care about.",
            };
        }

        if (NO_SIDE_EFFECT_KINDS.has(kind)) {
            return {
                category: "read_only",
                requiresApproval: false,
                action: kind,
                reason: "Clarification request halts the agent without mutating the page.",
            };
        }

        if (kind === "fill") {
            return {
                category: "reversible_write",
                requiresApproval: false,
                action: kind,
                reason: "Typing into a field is reversible (the value can be changed again).",
            };
        }

        if (REVERSIBLE_KINDS.has(kind)) {
            // Author-marked irreversible element on the page.
            if (target?.dataIrreversible === "true") {
                return {
                    category: "irreversible_or_external",
                    requiresApproval: true,
                    action: kind,
                    reason: `Target element <${target.tag}${target.domId ? "#" + target.domId : ""}> is explicitly marked data-irreversible="true".`,
                };
            }

            // Label-based check: only BUTTON/submit controls (anchors merely navigate).
            const tag = (target?.tag || "").toLowerCase();
            const text = (target?.text || "").toLowerCase();
            const isControl = tag === "button" || tag === "input";
            if (isControl && IRREVERSIBLE_LABELS.some((k) => text.includes(k))) {
                return {
                    category: "irreversible_or_external",
                    requiresApproval: true,
                    action: kind,
                    reason: `Control label "${target?.text}" matches the irreversible allowlist.`,
                };
            }

            return {
                category: "reversible_write",
                requiresApproval: false,
                action: kind,
                reason: "Click on a reversible control (no irreversible marker or label match).",
            };
        }

        // Unknown kind — conservative default.
        return {
            category: "irreversible_or_external",
            requiresApproval: true,
            action: kind,
            reason: `Unknown action kind '${kind}' defaulted to irreversible tier for safety.`,
        };
    }
}
