import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../src/safety/policy.js";

describe("PolicyEngine classification (browser actions)", () => {
    it("classifies navigate as read_only without approval", () => {
        const d = PolicyEngine.evaluate({ kind: "navigate" });
        expect(d.category).toBe("read_only");
        expect(d.requiresApproval).toBe(false);
    });

    it("classifies wait as read_only", () => {
        const d = PolicyEngine.evaluate({ kind: "wait" });
        expect(d.requiresApproval).toBe(false);
    });

    it("classifies fill as reversible without approval", () => {
        const d = PolicyEngine.evaluate({ kind: "fill", target: { tag: "input", text: "Full name" } });
        expect(d.category).toBe("reversible_write");
        expect(d.requiresApproval).toBe(false);
    });

    it("gates elements explicitly marked data-irreversible", () => {
        const d = PolicyEngine.evaluate({
            kind: "click",
            target: { tag: "button", domId: "place-order", text: "Place order", dataIrreversible: "true" },
        });
        expect(d.category).toBe("irreversible_or_external");
        expect(d.requiresApproval).toBe(true);
    });

    it("gates buttons whose label matches the irreversible allowlist", () => {
        const d = PolicyEngine.evaluate({
            kind: "click",
            target: { tag: "button", text: "Redeem code" },
        });
        expect(d.requiresApproval).toBe(true);
    });

    it("does NOT gate ordinary buttons", () => {
        const d = PolicyEngine.evaluate({
            kind: "click",
            target: { tag: "button", domId: "to-payment", text: "Continue to payment" },
        });
        expect(d.category).toBe("reversible_write");
        expect(d.requiresApproval).toBe(false);
    });

    it("does NOT gate anchors: links only navigate (reversible)", () => {
        const d = PolicyEngine.evaluate({
            kind: "click",
            target: { tag: "a", domId: "cancel-sub", text: "cancel my subscription" },
        });
        expect(d.requiresApproval).toBe(false);
    });

    it("gates declared submits conservatively even without target info", () => {
        const d = PolicyEngine.evaluate({ kind: "submit" });
        expect(d.requiresApproval).toBe(true);
    });

    it("unknown kinds default to irreversible (conservative)", () => {
        const d = PolicyEngine.evaluate({ kind: "exec_js" });
        expect(d.category).toBe("irreversible_or_external");
        expect(d.requiresApproval).toBe(true);
    });

    it("ask_clarification has no side effect", () => {
        const d = PolicyEngine.evaluate({ kind: "ask_clarification" });
        expect(d.requiresApproval).toBe(false);
    });
});
