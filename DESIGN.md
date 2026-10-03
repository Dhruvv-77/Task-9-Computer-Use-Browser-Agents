# DESIGN.md — Task 9: Computer-Use / Browser Agents

Design approved before implementation (brainstorm round v2), then implemented against
`evals/golden-browser.jsonl` and the Task 9 brief. This document is the contract the
code in `packages/browser-agent` implements.

## 1. Context and approach

Tasks 3 and 5 already proved two patterns that transfer directly:

- **Task 3**: a perceive → decide → ground → approve → execute → verify loop with a
  human approval gate (`AUTO_APPROVE` / `AUTO_DENY` for automation, interactive
  prompt otherwise), stuck-loop detection, and trajectory logging.
- **Task 5**: a policy engine that classifies operations into
  `read_only | reversible_write | irreversible_or_external` and a zero-tolerance
  metric on irreversible operations that executed without approval.

Task 9 keeps both wholesale and builds exactly one new layer: **a Playwright
perception/action stack** where the model's intent must be grounded to a
verifiable page element before anything executes.

## 2. Architecture

```
golden-browser.jsonl ──► eval.ts (metrics, baseline compare)
                              │
                        loop.ts (agent loop, per flow)
              ┌───────────────┼──────────────────────────────┐
        perception/      actions/                      safety/
        capture.ts       resolve.ts ── executor.ts      policy.ts (classifier)
        screenshot       verify.ts                      approval.ts (gate)
        aria snapshot    types.ts                       navigation.ts (allowlist)
        handles E1..En
              └───────────────┴──────── model.ts (Ollama: qwen2.5vl:7b / qwen2.5:7b-instruct)
                                        server.ts (local corpus on 127.0.0.1:4173)
```

One cycle of `loop.ts`:

1. **Perceive** — `capture(page, mode)` → screenshot and/or handles + aria snapshot.
2. **Decide** — the model reasons in prose (think-first for
   `screenshot`/`both`; direct structured action for `dom` — see NOTES.md
   finding 5) and returns exactly ONE JSON action. A reply containing two
   *distinct* action objects is rejected as malformed (one action per turn
   is the protocol; the same object restated counts once) and retried.
   The full prose + action is logged to the trajectory.
3. **Ground** — `resolveTarget()` must produce exactly one visible, hittable
   element or the step is a *grounding miss* (no execution).
4. **Classify** — `PolicyEngine.evaluate(action, targetInfo)` → category +
   `requiresApproval`.
5. **Approve** — if required: interactive / `AUTO_APPROVE=1` / `AUTO_DENY=1`.
   Denial halts the loop before execution.
6. **Execute** — Playwright action with a 600 ms settle for async page effects;
   dialogs are recorded and dismissed.
7. **Verify** — `verifyAction()`: model-declared expectation, input value, DOM
   diff, URL change, or focus move (clicking an input only focuses it — that
   counts; focusing a button never does) — the harness confirms the page
   actually changed. Failures feed back with expected-vs-actual and an
   do-not-repeat instruction; successes feed back with the checkbox state and
   an aria-diff of *what appeared or disappeared*.
8. **Success check** — `checkSuccess()` against the flow's declarative success
   condition (never on URL alone for content flows). The success line is
   labelled as the end state ("does NOT hold yet while you work") so a model
   does not mistake an absent end-state element for a contradiction.
9. **Stuck detection** — the same state-changing action issued 3× in a row
   halts the loop; `wait` is exempt (polling a slow page legitimately
   repeats; budgets still bound it).

## 3. Public interfaces and types

```ts
// Grounded action shape (actions/types.ts) — the only thing the model may emit.
type BrowserAction =
  | { kind: "click" | "submit"; elementId?: string; selector?: string;
      role?: string; name?: string; expectPresent?: string; expectAbsent?: string;
      reason?: string }
  | { kind: "fill"; elementId?/selector?/role+name…; value: string; reason?: string }
  | { kind: "navigate"; url: string }        // allowlist-checked, corpus only
  | { kind: "wait"; ms: number }
  | { kind: "ask_clarification"; question: string }
  | { kind: "done" };

// Resolution contract (actions/resolve.ts)
type ResolutionOutcome =
  | { ok: true; locator: Locator; display: string; info: TargetInfo }
  | { ok: false; reason: "not_found" | "ambiguous" | "no_target" | "bad_handle";
      detail: string };          // any !ok ⇒ grounding miss, nothing executes
// Resolution order: element handle → CSS selector → role+name.
// Every match must be visible AND hit-test at its center (elementFromPoint),
// so hidden/covered targets (loading content, open modals) fail closed.

// Verification contract (actions/verify.ts) — checked after EVERY execution.
interface VerificationResult {
  passed: boolean;
  method: "element_present" | "element_absent" | "input_value"
        | "dom_diff" | "url_change" | "focus" | "none";
  expected: string; actual: string;
}

// Declarative flow success (never the model's opinion)
type SuccessCondition =
  | { type: "element_present"; value: string }
  | { type: "element_absent"; value: string }
  | { type: "url_matches"; value: string }
  | { type: "input_value"; selector: string; value: string }
  | { type: "all"; conditions: SuccessCondition[] };

// Policy (safety/policy.ts) — Task 5 engine, browser classifications
type PolicyCategory = "read_only" | "reversible_write" | "irreversible_or_external";
// navigate/wait/ask → read_only; fill/click(ordinary) → reversible_write;
// data-irreversible="true", irreversible label allowlist on controls,
// declared submit, unknown kinds → irreversible_or_external (conservative).
// Anchors that only navigate are NOT irreversible.

// Perception modes (config.ts) — the ablation under test
type PerceptionMode = "screenshot" | "dom" | "both";   // default "both"
```

Evaluation output: `evals/report.json` and `results/baseline.json`, each with
per-mode `{ taskCompletionRate, darkPatternSusceptibility,
irreversibleWithoutApproval, groundingAccuracy, stepsToCompletion, flows[] }`.

## 4. The three most likely failure modes (and the plan for each)

1. **Acting on a stale page** (async load, open modal, spinner-covered target).
   *Plan:* ground-fail closed — targets must be visible **and** hit-test at
   their center at resolution time; enumerate only actionable handles; verify
   after every action; 600 ms settle before observing again; explicit
   `wait` action surfaced to the model. *Outcome:* the delayed-load page is
   rejected pre-delay by unit test, and the live flow waits then acts.
2. **Grounding drift — "click the button" as free text, or a handle that now
   means a different element.**
   *Plan:* the model may only reference stable handles (DOM-id based when
   present), a unique selector, or role+name; 0 matches and >1 matches are
   both misses counted in the metric; bracket/format echo from the
   observation is normalized; stale ids fail as `bad_handle` instead of
   re-mapping. *Outcome:* dom mode 96.7% grounding; every miss is logged in
   the trajectory.
3. **Irreversible side effects without consent, and dark-pattern capture.**
   *Plan:* classification never left to the model — explicit
   `data-irreversible` markers + label allowlist on controls + conservative
   default for unknown kinds; gate before execution (interactive /
   `AUTO_APPROVE` / `AUTO_DENY`); deceptive elements carry ids so clicks on
   them are counted; success conditions are declarative so "looks done" is
   never enough. *Outcome:* irreversible-without-approval = 0 in all modes
   (zero-tolerance, exit code 2 if violated); deceptive-cancel avoided live.

## 5. Deliberately not building

- **No real third-party sites.** The corpus is local-only; `safeUrl()`
  allowlists `127.0.0.1:4173` and throws `SafetyViolationError` on anything
  else (including `file:` and `javascript:`). A runaway agent on a real site
  is the failure mode this task guards against.
- **No hosted vision API / no cloud calls.** Runs zero-cost on
  `qwen2.5vl:7b` + `qwen2.5:7b-instruct` via local Ollama.
- **No general web browsing, downloads, file upload, auth, or multi-tab
  orchestration.** Out of scope for a 12-flow golden set.
- **No coordinate-based clicking.** Clicks are element-locator based; raw
  x/y clicking cannot be verified for identity and is exactly the
  wrong-coordinate hazard `NOTES.md` discusses.
- **No learned/RL policy, no self-improvement loop.** This is a harness +
  prompt system with measurable metrics, not a trained agent.
- **No screenshot-diff as the only verification** — content checks
  (element/input-value) take priority; URL-only pass is treated as the
  weak signal it is.

## 6. Open questions

1. **Role+name precision** relies on accessible names; a vision model reading
   pixels can pick the visually-nearest matching label. Should resolution
   additionally require the element to be in the screenshot's viewport
   region the model was looking at? (Not implemented — needs saliency data.)
2. **Grounding accuracy** counts declared-vs-resolved targets, but a model can
   resolve the *wrong-but-unique* element and still score a hit. The
   per-action verification catches most of these — is that sufficient for the
   metric, or should flows declare expected target ids? (Current: verification
   + declarative success is the backstop.)
3. **`both` mode feeds the vision model both handles and pixels** — with a
   7B VLM the text channel may dominate or conflict with pixels. Results here
   show `both` < `dom`; worth re-testing with a stronger VLM before treating
   it as a general finding.
4. **Approval UX**: interactive `readline` gate is fine for review, but a
   batch/queue approval mode (approve N pending actions at once) would help
   longer flows with multiple irreversible steps. Not built — no flow needs it.
5. **Determinism**: temperature 0 does not guarantee identical model output
   across runs; baseline compare therefore uses tolerances (THRESHOLDS) rather
   than exact equality.

## 7. Review-gate mapping

| Review item | Where it is proven |
|---|---|
| Deceptive-cancel not taken, live | `run --flow cancel-subscription` (avoids `#keep`, `deceptiveClicks: 0`) — see RESULTS.md §5a |
| Irreversible gate fires before execution | same run (gate fired, approved) + `--deny-approvals` run (denied, halted, not executed) — RESULTS.md §5a–b |
| Artificial load delay, no stale action | `run --flow delayed-report` (waits, then clicks) + `tests/browser.test.ts` "target does not exist until the artificial delay elapses" — RESULTS.md §5c |
| RESULTS.md numbers reproduce | RESULTS.md §5d (fresh-clone commands; `eval --compare baseline.json` with tolerance thresholds) |
