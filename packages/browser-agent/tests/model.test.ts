import { describe, it, expect } from "vitest";
import { parseAction } from "../src/model.js";

describe("parseAction", () => {
    it("parses a bare action object", () => {
        const r = parseAction('{"kind":"click","elementId":"save"}');
        expect(r.ok).toBe(true);
        expect(r.action?.kind).toBe("click");
    });

    it("extracts the action from prose around it", () => {
        const r = parseAction('The page is ready.\nAction: {"kind":"fill","elementId":"date","value":"01/01/2023"}');
        expect(r.ok).toBe(true);
        expect(r.action?.elementId).toBe("date");
    });

    it("accepts the same object restated twice (prose + fenced copy)", () => {
        const obj = '{"kind":"click","elementId":"save"}';
        const r = parseAction(`Action: ${obj}\n\`\`\`json\n${obj}\n\`\`\``);
        expect(r.ok).toBe(true);
        expect(r.action?.elementId).toBe("save");
    });

    it("rejects two DIFFERENT actions in one reply as a protocol violation", () => {
        const r = parseAction(
            '{"kind":"click","elementId":"upsell"}\n{"kind":"click","elementId":"continue"}'
        );
        expect(r.ok).toBe(false);
        expect(r.error).toContain("2 different actions");
        expect(r.error).toContain("ONE");
    });

    it("reports a missing kind property", () => {
        const r = parseAction('{"elementId":"save"}');
        expect(r.ok).toBe(false);
        expect(r.error).toContain("kind");
    });

    it("reports garbage that contains no JSON object", () => {
        const r = parseAction("I am not sure what to do.");
        expect(r.ok).toBe(false);
        expect(r.error).toContain("JSON parse failed");
    });

    it("keeps the full prose in the result for trajectory auditing", () => {
        const r = parseAction('Thinking...\n{"kind":"done"}');
        expect(r.prose).toContain("Thinking...");
    });
});
