import { describe, it, expect, afterEach } from "vitest";
import { requestApproval } from "../src/safety/approval.js";
import { safeUrl, SafetyViolationError } from "../src/safety/navigation.js";
import { PolicyEngine } from "../src/safety/policy.js";
import { BASE_URL } from "../src/config.js";

afterEach(() => {
    delete process.env.AUTO_APPROVE;
    delete process.env.AUTO_DENY;
});

describe("approval gate", () => {
    it("auto-approves post-classification when AUTO_APPROVE=1", async () => {
        process.env.AUTO_APPROVE = "1";
        const d = PolicyEngine.evaluate({ kind: "click", target: { tag: "button", text: "Place order", dataIrreversible: "true" } });
        expect(await requestApproval(d, { target: "place-order" })).toBe(true);
    });

    it("auto-denies when AUTO_DENY=1 (review-gate proof)", async () => {
        process.env.AUTO_DENY = "1";
        const d = PolicyEngine.evaluate({ kind: "click", target: { tag: "button", text: "Cancel subscription", dataIrreversible: "true" } });
        expect(await requestApproval(d, { target: "confirm-cancel" })).toBe(false);
    });
});

describe("navigation allowlist (safeUrl)", () => {
    it("allows the local corpus origin", () => {
        expect(safeUrl("/checkout/index.html")).toContain(BASE_URL);
        expect(safeUrl(`${BASE_URL}/cart/index.html`)).toBe(`${BASE_URL}/cart/index.html`);
    });

    it("blocks external origins", () => {
        expect(() => safeUrl("https://example.com/phish")).toThrow(SafetyViolationError);
        expect(() => safeUrl("http://evil.test/")).toThrow(SafetyViolationError);
        expect(() => safeUrl("http://127.0.0.1:9999/")).toThrow(SafetyViolationError);
        expect(() => safeUrl("file:///C:/Windows/System32")).toThrow(SafetyViolationError);
    });

    it("blocks javascript: scheme", () => {
        expect(() => safeUrl("javascript:alert(1)")).toThrow(SafetyViolationError);
    });

    it("blocks unparseable targets", () => {
        expect(() => safeUrl("http://")).toThrow(SafetyViolationError);
    });
});
