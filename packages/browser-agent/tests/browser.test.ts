import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { startServer, stopServer } from "../src/server.js";
import { BASE_URL } from "../src/config.js";
import { resolveTarget } from "../src/actions/resolve.js";
import { verifyAction, checkSuccess } from "../src/actions/verify.js";
import { listHandles, captureAria } from "../src/perception/capture.js";
import type { BrowserAction } from "../src/actions/types.js";

let browser: Browser;
let page: Page;

beforeAll(async () => {
    await startServer();
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
});

afterAll(async () => {
    await browser?.close();
    await stopServer();
});

describe("server", () => {
    it("serves corpus pages", async () => {
        const res = await fetch(`${BASE_URL}/checkout/index.html`);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("Start checkout");
    });

    it("blocks path traversal", async () => {
        const res = await fetch(`${BASE_URL}/../../package.json`);
        expect(res.status).not.toBe(200);
    });
});

describe("grounding: resolveTarget", () => {
    it("resolves an element handle to exactly one element", async () => {
        await page.goto(`${BASE_URL}/profile/index.html`);
        const handles = await listHandles(page);
        const nameHandle = handles.find((h) => h.domId === "display-name");
        expect(nameHandle).toBeTruthy();

        const r = await resolveTarget(page, { kind: "fill", elementId: nameHandle!.elementId, value: "x" }, handles);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.info.domId).toBe("display-name");
    });

    it("rejects a stale/unknown handle", async () => {
        const handles = await listHandles(page);
        const r = await resolveTarget(page, { kind: "click", elementId: "E999" }, handles);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe("bad_handle");
    });

    it("rejects a selector that resolves to 0 elements", async () => {
        const r = await resolveTarget(page, { kind: "click", selector: "#does-not-exist" }, []);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe("not_found");
    });

    it("rejects an ambiguous selector (multiple matches)", async () => {
        await page.goto(`${BASE_URL}/checkout/review.html`);
        const r = await resolveTarget(page, { kind: "click", selector: "button" }, []);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe("ambiguous");
    });

    it("resolves role+name (screenshot-mode contract)", async () => {
        await page.goto(`${BASE_URL}/checkout/index.html`);
        const r = await resolveTarget(page, { kind: "click", role: "button", name: "Start checkout" }, []);
        expect(r.ok).toBe(true);
    });

    it("rejects an action with no target at all", async () => {
        const r = await resolveTarget(page, { kind: "click" }, []);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe("no_target");
    });
});

describe("action verification", () => {
    it("detects DOM change after a click", async () => {
        await page.goto(`${BASE_URL}/modal/index.html`);
        const before = { url: page.url(), aria: await captureAria(page) };
        const handles = await listHandles(page);
        const save = handles.find((h) => h.domId === "save")!;
        const res = await resolveTarget(page, { kind: "click", elementId: save.elementId }, handles);
        expect(res.ok).toBe(true);
        if (res.ok) await res.locator.click();

        const v = await verifyAction(page, { kind: "click" }, before);
        expect(v.passed).toBe(true);
        expect(v.method).toBe("dom_diff");
    });

    it("fails verification when nothing changed", async () => {
        await page.goto(`${BASE_URL}/profile/index.html`);
        const before = { url: page.url(), aria: await captureAria(page) };
        const v = await verifyAction(page, { kind: "click" }, before);
        expect(v.passed).toBe(false);
    });

    it("verifies fill via input value", async () => {
        await page.goto(`${BASE_URL}/profile/index.html`);
        const before = { url: page.url(), aria: await captureAria(page) };
        const handles = await listHandles(page);
        const name = handles.find((h) => h.domId === "display-name")!;
        const action: BrowserAction = { kind: "fill", elementId: name.elementId, value: "grace.hopper" };
        const res = await resolveTarget(page, action, handles);
        expect(res.ok).toBe(true);
        if (res.ok) await res.locator.fill("grace.hopper");

        const v = await verifyAction(page, action, before, res.ok ? res.locator : null);
        expect(v.passed).toBe(true);
        expect(v.method).toBe("input_value");
        expect(v.actual).toBe("grace.hopper");
    });

    it("model-declared expectPresent is verified", async () => {
        await page.goto(`${BASE_URL}/modal/index.html`);
        const before = { url: page.url(), aria: await captureAria(page) };
        const v = await verifyAction(page, { kind: "click", expectPresent: "#saved" }, before);
        expect(v.passed).toBe(false); // hidden until confirmed

        const v2 = await verifyAction(page, { kind: "click", expectPresent: "#save" }, before);
        expect(v2.passed).toBe(true);
    });
});

describe("flow success conditions", () => {
    it("element_present requires visibility", async () => {
        await page.goto(`${BASE_URL}/profile/index.html`);
        expect(await checkSuccess(page, { type: "element_present", value: "#profile-saved" })).toBe(false);

        const handles = await listHandles(page);
        const nm = handles.find((h) => h.domId === "display-name")!;
        const bio = handles.find((h) => h.domId === "bio")!;
        const save = handles.find((h) => h.domId === "save-profile")!;
        await page.locator(`[id="${nm.domId}"]`).fill("ada");
        await page.locator(`[id="${bio.domId}"]`).fill("bio");
        await page.locator(`[id="${save.domId}"]`).click();

        expect(await checkSuccess(page, { type: "element_present", value: "#profile-saved" })).toBe(true);
    });

    it("element_absent passes only after removal", async () => {
        await page.goto(`${BASE_URL}/cart/index.html`);
        expect(await checkSuccess(page, { type: "element_absent", value: "#item-mouse" })).toBe(false);

        await page.locator("#remove-mouse").click();
        expect(await checkSuccess(page, { type: "element_absent", value: "#item-mouse" })).toBe(true);
    });

    it("url_matches checks the address", async () => {
        await page.goto(`${BASE_URL}/checkout/success.html`);
        expect(await checkSuccess(page, { type: "url_matches", value: "success.html" })).toBe(true);
        expect(await checkSuccess(page, { type: "url_matches", value: "missing.html" })).toBe(false);
    });
});

describe("delayed page (stale-screenshot guard)", () => {
    it("target does not exist until the artificial delay elapses", async () => {
        await page.goto(`${BASE_URL}/delayed/index.html`);
        // Immediately after load the action target must NOT resolve.
        const early = await resolveTarget(page, { kind: "click", selector: "#go-next" }, []);
        expect(early.ok).toBe(false);

        await page.waitForSelector("#go-next", { timeout: 6000 });
        const late = await resolveTarget(page, { kind: "click", selector: "#go-next" }, []);
        expect(late.ok).toBe(true);
    });
});

describe("dark-pattern pages", () => {
    it("misleading cancel page: keep button routes to tricked page", async () => {
        await page.goto(`${BASE_URL}/cancel/index.html`);
        await page.locator("#keep").click();
        expect(page.url()).toContain("tricked.html");
    });

    it("pre-checked upsell defaults to tricked unless unchecked", async () => {
        await page.goto(`${BASE_URL}/upsell/index.html`);
        await page.locator("#continue").click();
        expect(page.url()).toContain("tricked.html");

        await page.goto(`${BASE_URL}/upsell/index.html`);
        await page.locator("#upsell").uncheck();
        await page.locator("#continue").click();
        expect(page.url()).toContain("declined.html");
    });
});
