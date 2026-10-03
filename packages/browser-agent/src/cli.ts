import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";
import { runFlow } from "./loop.js";
import { startServer, stopServer } from "./server.js";
import type { GoldenFlow } from "./flows.js";
import {
    GOLDEN_FILE,
    OLLAMA_URL,
    VISION_MODEL,
    TEXT_MODEL,
    BASE_URL,
    TRAJECTORY_DIR,
    RESULTS_DIR,
    EVALS_DIR,
    type PerceptionMode,
} from "./config.js";

// ─── Visual Styling & Colors ──────────────────────────────────────────────────
const c = {
    reset: "\x1b[0m",
    bold: (t: string) => `\x1b[1m${t}\x1b[0m`,
    dim: (t: string) => `\x1b[2m${t}\x1b[0m`,
    italic: (t: string) => `\x1b[3m${t}\x1b[0m`,
    underline: (t: string) => `\x1b[4m${t}\x1b[0m`,
    red: (t: string) => `\x1b[31m${t}\x1b[0m`,
    green: (t: string) => `\x1b[32m${t}\x1b[0m`,
    yellow: (t: string) => `\x1b[33m${t}\x1b[0m`,
    blue: (t: string) => `\x1b[34m${t}\x1b[0m`,
    magenta: (t: string) => `\x1b[35m${t}\x1b[0m`,
    cyan: (t: string) => `\x1b[36m${t}\x1b[0m`,
    gray: (t: string) => `\x1b[90m${t}\x1b[0m`,
    white: (t: string) => `\x1b[97m${t}\x1b[0m`,
    bgCyan: (t: string) => `\x1b[46m\x1b[30m${t}\x1b[0m`,
    bgGreen: (t: string) => `\x1b[42m\x1b[30m${t}\x1b[0m`,
    bgRed: (t: string) => `\x1b[41m\x1b[97m${t}\x1b[0m`,
    bgYellow: (t: string) => `\x1b[43m\x1b[30m${t}\x1b[0m`,
    boldCyan: (t: string) => `\x1b[1m\x1b[36m${t}\x1b[0m`,
    boldGreen: (t: string) => `\x1b[1m\x1b[32m${t}\x1b[0m`,
    boldRed: (t: string) => `\x1b[1m\x1b[31m${t}\x1b[0m`,
    boldYellow: (t: string) => `\x1b[1m\x1b[33m${t}\x1b[0m`,
    boldBlue: (t: string) => `\x1b[1m\x1b[34m${t}\x1b[0m`,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function flag(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("-")
        ? process.argv[i + 1]
        : null;
}

function hasFlag(...names: string[]): boolean {
    return names.some((n) => process.argv.includes(n));
}

async function loadFlows(): Promise<GoldenFlow[]> {
    const text = await fs.readFile(GOLDEN_FILE, "utf8");
    return text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as GoldenFlow);
}

// ─── Banner ──────────────────────────────────────────────────────────────────
function printBanner(): void {
    console.log();
    console.log(c.boldCyan("  ┌────────────────────────────────────────────────────────┐"));
    console.log(c.boldCyan("  │") + c.bold("   🌐 Browser Agent ") + c.dim("— Task 9 CLI") + c.boldCyan("                       │"));
    console.log(c.boldCyan("  │") + c.gray("   Visual Grounding, Safety Gate & Flow Evaluation") + c.boldCyan("     │"));
    console.log(c.boldCyan("  └────────────────────────────────────────────────────────┘"));
    console.log();
}

// ─── Help ────────────────────────────────────────────────────────────────────
function printHelp(): void {
    printBanner();

    console.log(c.bold("USAGE"));
    console.log(`  ${c.cyan("pnpm browser-agent")} ${c.green("<command>")} ${c.yellow("[flow-id]")} ${c.yellow("[options]")}`);
    console.log();

    console.log(c.bold("COMMANDS"));
    console.log(`  ${c.green("run")}       ${c.yellow("[id]")}     Run a single flow interactively (or prompt to select one)`);
    console.log(`  ${c.green("eval")}              Run the benchmark evaluation harness across flows`);
    console.log(`  ${c.green("list")}              List all 12 golden flows categorized by type`);
    console.log(`  ${c.green("replay")}     ${c.yellow("[id]")}     Replay and inspect step trajectory logs of past runs`);
    console.log(`  ${c.green("status")}            Diagnose environment (Ollama server, models, Playwright)`);
    console.log(`  ${c.green("serve")}             Start the local corpus web server for manual browsing`);
    console.log(`  ${c.green("help")}              Show this help message`);
    console.log();

    console.log(c.bold("RUN OPTIONS"));
    console.log(`  ${c.yellow("--flow")} ${c.dim("<id>")}            Flow ID to run (can also be passed as positional arg)`);
    console.log(`  ${c.yellow("--mode")} ${c.dim("<mode>")}          Perception: ${c.cyan("both")} | ${c.cyan("dom")} | ${c.cyan("screenshot")} ${c.dim("(default: both)")}`);
    console.log(`  ${c.yellow("--headed")}               Open real Chromium window to watch the agent live`);
    console.log(`  ${c.yellow("--slowmo")} ${c.dim("<ms>")}          Delay per action in ms (default: 300ms with --headed)`);
    console.log(`  ${c.yellow("--deny-approvals")}       Auto-deny irreversible actions (tests safety halt)`);
    console.log(`  ${c.yellow("-y, --yes")}              Auto-approve irreversible actions (non-interactive)`);
    console.log();

    console.log(c.bold("EVAL OPTIONS"));
    console.log(`  ${c.yellow("--mode")} ${c.dim("<mode>")}          Perception: ${c.cyan("all")} | ${c.cyan("dom")} | ${c.cyan("screenshot")} | ${c.cyan("both")}`);
    console.log(`  ${c.yellow("--flows")} ${c.dim("<ids>")}          Comma-separated list of flow IDs`);
    console.log(`  ${c.yellow("--compare")} ${c.dim("<file>")}       Compare results against baseline JSON (e.g. baseline.json)`);
    console.log(`  ${c.yellow("--update-baseline")}      Save current run as new verified baseline`);
    console.log();

    console.log(c.bold("EXAMPLES"));
    console.log(c.gray("  # Run interactive flow selector:"));
    console.log(`  ${c.cyan("pnpm browser-agent run")}`);
    console.log();
    console.log(c.gray("  # Run 3-step checkout directly:"));
    console.log(`  ${c.cyan("pnpm browser-agent run")} checkout-3-step`);
    console.log();
    console.log(c.gray("  # Run with visible browser window (watch live):"));
    console.log(`  ${c.cyan("pnpm browser-agent run")} checkout-3-step --headed`);
    console.log();
    console.log(c.gray("  # Run dark-pattern cancellation test:"));
    console.log(`  ${c.cyan("pnpm browser-agent run")} cancel-subscription`);
    console.log();
    console.log(c.gray("  # Run eval in fast DOM mode:"));
    console.log(`  ${c.cyan("pnpm browser-agent eval")} --mode dom`);
    console.log();
    console.log(c.gray("  # Replay steps of the last checkout run:"));
    console.log(`  ${c.cyan("pnpm browser-agent replay")} checkout-3-step`);
    console.log();
}

// ─── List flows ──────────────────────────────────────────────────────────────
async function cmdList(): Promise<void> {
    printBanner();
    const flows = await loadFlows();

    const categories: Record<string, GoldenFlow[]> = {};
    for (const f of flows) {
        (categories[f.category] ??= []).push(f);
    }

    const categoryMeta: Record<string, { icon: string; label: string; color: (s: string) => string; desc: string }> = {
        straightforward: {
            icon: "✅",
            label: "Straightforward Flows",
            color: c.green,
            desc: "Multi-step navigation, form completion, and content verification.",
        },
        dark_pattern: {
            icon: "⚠️",
            label: "Dark Pattern Defense Flows",
            color: c.yellow,
            desc: "Deceptive buttons, pre-checked checkboxes, and fake urgency modals.",
        },
        should_stop: {
            icon: "🛑",
            label: "Should-Stop / Clarification Flows",
            color: c.red,
            desc: "Ambiguous instructions or conflicting constraints where agent must halt and ask.",
        },
    };

    console.log(c.bold(`  📋 Available Golden Flows (${flows.length} total)`));
    console.log(c.gray("  " + "─".repeat(56)));
    console.log();

    let index = 1;
    for (const [cat, meta] of Object.entries(categoryMeta)) {
        const items = categories[cat] || [];
        if (items.length === 0) continue;

        console.log(`  ${meta.icon} ${c.bold(meta.label)} ${c.dim(`(${items.length})`)}`);
        console.log(`     ${c.dim(meta.desc)}`);
        console.log();

        for (const f of items) {
            const num = c.dim(`[${String(index++).padStart(2, " ")}]`);
            const id = meta.color(f.id.padEnd(25));
            const start = c.dim(f.start.padEnd(26));
            const goalPreview = f.goal.length > 55 ? f.goal.slice(0, 52) + "..." : f.goal;
            console.log(`    ${num} ${id} ${start} ${c.gray(goalPreview)}`);
        }
        console.log();
    }

    console.log(c.gray("  " + "─".repeat(56)));
    console.log(`  Run any flow:  ${c.cyan("pnpm browser-agent run <flow-id>")}`);
    console.log();
}

// ─── Status / Doctor ─────────────────────────────────────────────────────────
async function cmdStatus(): Promise<void> {
    printBanner();
    console.log(c.bold("  🩺 System Diagnostics & Status"));
    console.log(c.gray("  " + "─".repeat(56)));
    console.log();

    // 1. Node.js
    console.log(`  ${c.bold("Node.js runtime:")}     ${c.green(process.version)} ${c.dim(`(${process.platform} ${process.arch})`)}`);

    // 2. Ollama connection
    let ollamaOk = false;
    let ollamaLatency = 0;
    let models: string[] = [];
    try {
        const t0 = Date.now();
        const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(4000) });
        ollamaLatency = Date.now() - t0;
        if (res.ok) {
            ollamaOk = true;
            const data: any = await res.json();
            models = (data.models || []).map((m: any) => m.name);
        }
    } catch { /* unreachable */ }

    if (ollamaOk) {
        console.log(`  ${c.bold("Ollama server:")}       ${c.green("● Connected")} ${c.dim(`(${ollamaLatency}ms, ${OLLAMA_URL})`)}`);
    } else {
        console.log(`  ${c.bold("Ollama server:")}       ${c.boldRed("✗ Unreachable")} ${c.dim(`(${OLLAMA_URL})`)}`);
    }

    // 3. Models
    const hasVision = models.some((m) => m.startsWith(VISION_MODEL.split(":")[0]));
    const hasText = models.some((m) => m.startsWith(TEXT_MODEL.split(":")[0]));

    console.log(`  ${c.bold("Vision model:")}        ${hasVision ? c.green(`● ${VISION_MODEL}`) : c.boldRed(`✗ Missing (${VISION_MODEL})`)}`);
    console.log(`  ${c.bold("Text model:")}          ${hasText ? c.green(`● ${TEXT_MODEL}`) : c.boldRed(`✗ Missing (${TEXT_MODEL})`)}`);

    if (!ollamaOk || !hasVision || !hasText) {
        console.log();
        console.log(c.yellow("  💡 Quick fix:"));
        if (!ollamaOk) console.log(c.yellow("     Start server:  ollama serve"));
        if (!hasVision) console.log(c.yellow(`     Pull vision:   ollama pull ${VISION_MODEL}`));
        if (!hasText) console.log(c.yellow(`     Pull text:     ollama pull ${TEXT_MODEL}`));
    }

    // 4. Playwright Chromium
    let playwrightOk = false;
    try {
        const testBrowser = await chromium.launch({ headless: true });
        await testBrowser.close();
        playwrightOk = true;
    } catch { /* not installed */ }

    console.log(`  ${c.bold("Playwright Chromium:")} ${playwrightOk ? c.green("● Installed & Ready") : c.boldRed("✗ Not installed (run: pnpm exec playwright install chromium)")}`);

    // 5. Golden flows
    try {
        const flows = await loadFlows();
        console.log(`  ${c.bold("Golden test flows:")}   ${c.green(`● ${flows.length} flows loaded`)} ${c.dim(`(${path.basename(GOLDEN_FILE)})`)}`);
    } catch {
        console.log(`  ${c.bold("Golden test flows:")}   ${c.boldRed("✗ golden-browser.jsonl not found")}`);
    }

    // 6. Baseline
    const baselinePath = path.join(RESULTS_DIR, "baseline.json");
    try {
        const stat = await fs.stat(baselinePath);
        const ageMin = Math.round((Date.now() - stat.mtimeMs) / 60_000);
        const ageStr = ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`;
        console.log(`  ${c.bold("Regression baseline:")} ${c.green("● Configured")} ${c.dim(`(results/baseline.json, updated ${ageStr})`)}`);
    } catch {
        console.log(`  ${c.bold("Regression baseline:")} ${c.dim("○ None saved yet")} ${c.dim("(generate with: pnpm browser-agent eval --update-baseline)")}`);
    }

    // 7. Trajectories
    try {
        const count = await getTrajectoryCount();
        console.log(`  ${c.bold("Trajectory logs:")}     ${c.dim(`${count} run logs stored in packages/browser-agent/trajectories/`)}`);
    } catch { /* ignore */ }

    console.log();
}

async function getTrajectoryCount(): Promise<number> {
    let count = 0;
    try {
        const entries = await fs.readdir(TRAJECTORY_DIR, { withFileTypes: true });
        for (const e of entries) {
            if (e.isDirectory()) {
                const sub = await fs.readdir(path.join(TRAJECTORY_DIR, e.name)).catch(() => []);
                count += sub.filter((f) => f.endsWith(".jsonl")).length;
            } else if (e.name.endsWith(".jsonl")) {
                count++;
            }
        }
    } catch { /* ignore */ }
    return count;
}

// ─── Serve ───────────────────────────────────────────────────────────────────
async function cmdServe(): Promise<void> {
    printBanner();
    const url = await startServer();
    console.log(`  ${c.boldGreen("● Local Corpus Server Active:")} ${c.boldCyan(url)}`);
    console.log(c.dim("  Open these test pages directly in your browser:"));
    console.log(`    - 3-Step Checkout:  ${c.cyan(`${url}/checkout/shipping.html`)}`);
    console.log(`    - Subscription:     ${c.cyan(`${url}/cancel/subscription.html`)}`);
    console.log(`    - Travel Upsell:    ${c.cyan(`${url}/upsell/booking.html`)}`);
    console.log(`    - Delayed Report:   ${c.cyan(`${url}/delayed/report.html`)}`);
    console.log(`    - Profile Modal:    ${c.cyan(`${url}/modal/settings.html`)}`);
    console.log();
    console.log(c.gray("  Press Ctrl+C to stop."));
    console.log();

    await new Promise(() => {});
}

// ─── Interactive Flow Selector ───────────────────────────────────────────────
async function promptFlowSelection(flows: GoldenFlow[]): Promise<GoldenFlow | null> {
    console.log(c.bold("  ? Select a flow to run:"));
    console.log();

    flows.forEach((f, idx) => {
        const num = c.cyan(`[${String(idx + 1).padStart(2, " ")}]`);
        const cat = f.category === "straightforward"
            ? c.green("straightforward")
            : f.category === "dark_pattern"
            ? c.yellow("dark-pattern   ")
            : c.red("should-stop    ");
        console.log(`    ${num} ${c.bold(f.id.padEnd(25))} ${c.dim(`(${cat})`)} - ${c.gray(f.goal.slice(0, 48))}...`);
    });

    console.log();
    const rl = readline.createInterface({ input, output });
    const answer = (await rl.question(c.bold("  Enter number [1-" + flows.length + "] or flow ID (or 'q' to quit): "))).trim();
    rl.close();

    if (!answer || answer.toLowerCase() === "q") return null;

    const num = parseInt(answer, 10);
    if (!isNaN(num) && num >= 1 && num <= flows.length) {
        return flows[num - 1];
    }

    return flows.find((f) => f.id.toLowerCase() === answer.toLowerCase() || f.id.toLowerCase().includes(answer.toLowerCase())) || null;
}

// ─── Run Command ─────────────────────────────────────────────────────────────
async function cmdRun(): Promise<void> {
    const flows = await loadFlows();

    // Check positional argument or --flow flag
    const args = process.argv.slice(2);
    let flowId = flag("--flow");
    if (!flowId) {
        // Check if argument 1 (after 'run') is a flow name and not a flag
        const positional = args[1] && !args[1].startsWith("-") ? args[1] : null;
        if (positional) flowId = positional;
    }

    let flow: GoldenFlow | null = null;
    if (flowId) {
        flow = flows.find((f) => f.id === flowId || f.id.toLowerCase() === flowId?.toLowerCase()) || null;
        if (!flow) {
            console.error();
            console.error(c.boldRed(`  ✗ Unknown flow: '${flowId}'`));
            console.error();
            console.error(c.bold("  Available flows:"));
            for (const f of flows) {
                console.error(`    - ${c.cyan(f.id)}`);
            }
            console.error();
            process.exit(1);
        }
    } else {
        // Interactive selection if in TTY
        if (process.stdin.isTTY) {
            printBanner();
            flow = await promptFlowSelection(flows);
            if (!flow) {
                console.log(c.dim("\n  Operation cancelled.\n"));
                return;
            }
        } else {
            console.error();
            console.error(c.boldRed("  ✗ Missing flow ID. Specify: pnpm browser-agent run <flow-id>"));
            console.error(c.gray("  Example: pnpm browser-agent run checkout-3-step"));
            console.error();
            process.exit(1);
        }
    }

    const mode = (flag("--mode") as PerceptionMode) || undefined;
    const isHeaded = hasFlag("--headed", "--headful");
    const slowMoMs = flag("--slowmo") ? parseInt(flag("--slowmo")!, 10) : isHeaded ? 300 : 0;
    const denyApprovals = hasFlag("--deny-approvals");
    const autoApprove = hasFlag("-y", "--yes", "--auto-approve");

    if (mode && !["screenshot", "dom", "both"].includes(mode)) {
        console.error(c.boldRed(`  ✗ Invalid mode: '${mode}'. Must be: screenshot | dom | both`));
        process.exit(1);
    }

    const modeEffective = mode || "both";
    const needsVision = modeEffective === "screenshot" || modeEffective === "both";

    // Pre-flight check: Ollama connectivity
    try {
        const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: any = await res.json();
        const names: string[] = (data.models || []).map((m: any) => m.name);

        if (needsVision && !names.some((n) => n.startsWith(VISION_MODEL.split(":")[0]))) {
            console.warn(c.boldYellow(`\n  ⚠ Vision model '${VISION_MODEL}' not found in Ollama.`));
            console.warn(c.gray(`    Pull it using:  ollama pull ${VISION_MODEL}\n`));
        }
        if (!needsVision && !names.some((n) => n.startsWith(TEXT_MODEL.split(":")[0]))) {
            console.warn(c.boldYellow(`\n  ⚠ Text model '${TEXT_MODEL}' not found in Ollama.`));
            console.warn(c.gray(`    Pull it using:  ollama pull ${TEXT_MODEL}\n`));
        }
    } catch {
        console.error();
        console.error(c.boldRed("  ✗ Ollama server is not reachable."));
        console.error(c.gray(`    Start it:  ollama serve`));
        console.error(c.gray(`    URL:       ${OLLAMA_URL}`));
        console.error();
        process.exit(1);
    }

    // Configure approval policy
    if (denyApprovals) {
        process.env.AUTO_DENY = "1";
    } else if (autoApprove || !process.stdin.isTTY) {
        process.env.AUTO_APPROVE = "1";
    }

    printBanner();
    console.log(c.bold("  ▶ Flow Execution Parameters"));
    console.log(`    ${c.bold("Flow:")}        ${c.boldCyan(flow.id)}`);
    console.log(`    ${c.bold("Category:")}    ${flow.category === "straightforward" ? c.green(flow.category) : flow.category === "dark_pattern" ? c.yellow(flow.category) : c.red(flow.category)}`);
    console.log(`    ${c.bold("Perception:")}  ${c.cyan(modeEffective)}`);
    console.log(`    ${c.bold("Browser:")}     ${isHeaded ? c.boldYellow(`Headed (visible window, ${slowMoMs}ms delay)`) : c.dim("Headless (background)")}`);
    console.log(`    ${c.bold("Approval:")}    ${denyApprovals ? c.red("Auto-deny irreversible actions (gate test)") : autoApprove ? c.green("Auto-approve") : c.yellow("Interactive prompt")}`);
    console.log(`    ${c.bold("Goal:")}        ${c.dim(flow.goal)}`);
    console.log();

    await startServer();
    try {
        const state = await runFlow(flow, {
            mode,
            headless: !isHeaded,
            slowMo: slowMoMs,
            trajectoryName: `run/${flow.id}`,
        });

        // ─── Formatted Run Summary ────────────────────────────────────
        console.log();
        console.log(c.boldCyan("  ┌────────────────────────────────────────────────────────┐"));
        console.log(c.boldCyan("  │") + c.bold("                     EXECUTION SUMMARY                  ") + c.boldCyan("│"));
        console.log(c.boldCyan("  └────────────────────────────────────────────────────────┘"));
        console.log();

        const statusBadge = state.completed
            ? c.bgGreen("  ✓ COMPLETED  ")
            : state.askedClarification
            ? c.bgYellow("  ? ASKED CLARIFICATION  ")
            : state.haltReason === "approval_denied"
            ? c.bgRed("  🛑 APPROVAL DENIED  ")
            : c.bgRed(`  ✗ ${(state.haltReason || "FAILED").toUpperCase()}  `);

        console.log(`    Result:       ${statusBadge}`);
        console.log(`    Flow ID:      ${c.bold(flow.id)}`);
        console.log(`    Halt Reason:  ${c.dim(state.haltReason || "none")}`);
        console.log(`    Steps Taken:  ${c.bold(String(state.step))}`);
        console.log();

        // Grounding stats
        const gAcc = state.targetsDeclared === 0 ? 1 : state.targetsResolved / state.targetsDeclared;
        const gPct = (gAcc * 100).toFixed(1) + "%";
        console.log(c.bold("    Grounding:"));
        console.log(`      Declared Targets:   ${state.targetsDeclared}`);
        console.log(`      Resolved Elements:  ${state.targetsResolved}`);
        console.log(`      Misses:             ${state.groundingMisses === 0 ? c.green("0") : c.boldRed(String(state.groundingMisses))}`);
        console.log(`      Accuracy:           ${gAcc >= 0.9 ? c.boldGreen(gPct) : c.boldYellow(gPct)}`);
        console.log();

        // Safety stats
        console.log(c.bold("    Safety & Policy:"));
        console.log(`      Irreversible Allowed: ${state.irreversibleApproved}`);
        console.log(`      Irreversible Denied:  ${state.irreversibleDenied === 0 ? "0" : c.red(String(state.irreversibleDenied))}`);
        console.log(`      Deceptive Clicks:     ${state.deceptiveClicks === 0 ? c.green("0 (Resisted dark pattern)") : c.boldRed(`${state.deceptiveClicks} (Tricked!)`)}`);
        console.log();

        if (state.askedClarification) {
            console.log(c.bold("    Clarification Asked:"));
            console.log(`      ${c.yellow("▶")} ${state.clarificationQuestion}`);
            console.log();
        }

        console.log(`    Final URL:    ${c.dim(state.finalUrl)}`);
        console.log(`    Trajectory:   ${c.dim(`packages/browser-agent/trajectories/run/${flow.id}.jsonl`)}`);
        console.log();
        console.log(`  To replay step trajectory:  ${c.cyan(`pnpm browser-agent replay ${flow.id}`)}`);
        console.log();
    } finally {
        await stopServer();
    }
}

// ─── Replay Command (Trajectory Viewer) ──────────────────────────────────────
async function cmdReplay(): Promise<void> {
    const args = process.argv.slice(2);
    let target = args[1] && !args[1].startsWith("-") ? args[1] : flag("--flow");

    // Discover trajectory files
    const runDir = path.join(TRAJECTORY_DIR, "run");
    let availableFiles: string[] = [];
    try {
        const files = await fs.readdir(runDir);
        availableFiles = files.filter((f) => f.endsWith(".jsonl"));
    } catch { /* no dir */ }

    if (!target) {
        if (availableFiles.length === 0) {
            console.log();
            console.log(c.yellow("  No trajectory logs found yet."));
            console.log(c.gray("  Run a flow first:  pnpm browser-agent run checkout-3-step"));
            console.log();
            return;
        }

        printBanner();
        console.log(c.bold("  📜 Recent Recorded Trajectories:"));
        console.log();
        availableFiles.forEach((file, idx) => {
            const id = file.replace(".jsonl", "");
            console.log(`    [${idx + 1}] ${c.cyan(id)}`);
        });
        console.log();

        if (process.stdin.isTTY) {
            const rl = readline.createInterface({ input, output });
            const answer = (await rl.question(c.bold("  Select a trajectory to replay (number or name): "))).trim();
            rl.close();
            const num = parseInt(answer, 10);
            if (!isNaN(num) && num >= 1 && num <= availableFiles.length) {
                target = availableFiles[num - 1].replace(".jsonl", "");
            } else if (answer) {
                target = answer.replace(".jsonl", "");
            }
        }
    }

    if (!target) return;

    const fileCandidate = path.join(runDir, target.endsWith(".jsonl") ? target : `${target}.jsonl`);
    let content = "";
    try {
        content = await fs.readFile(fileCandidate, "utf8");
    } catch {
        console.error(c.boldRed(`\n  ✗ Trajectory file not found: ${fileCandidate}\n`));
        return;
    }

    printBanner();
    console.log(c.bold(`  📜 Trajectory Replay: ${c.boldCyan(target)}`));
    console.log(c.gray("  " + "─".repeat(56)));
    console.log();

    const lines = content.trim().split("\n").filter(Boolean);
    for (const line of lines) {
        try {
            const entry = JSON.parse(line);
            const stepNum = entry.step !== undefined ? c.bold(`Step ${entry.step}`) : c.dim("Info");

            if (entry.action === "decision") {
                const dec = entry.decision;
                const kind = c.boldCyan(dec?.kind || "action");
                const targetDisplay = dec?.elementId || dec?.selector || dec?.role || dec?.url || "";
                console.log(`  ${stepNum} ➔ ${kind} ${c.bold(targetDisplay)} ${dec?.value ? `value="${dec.value}"` : ""}`);
                if (dec?.reason) console.log(`         ${c.dim("Reason:")} ${c.gray(dec.reason)}`);
            } else if (entry.action === "execution_result") {
                const okBadge = entry.ok ? c.green("✓ OK") : c.red("✗ FAILED");
                console.log(`         ${okBadge} ${c.dim("Effect:")} ${entry.effect || "done"}`);
            } else if (entry.action === "grounding_miss") {
                console.log(`         ${c.boldRed("⚠ GROUNDING MISS:")} ${entry.detail}`);
            } else if (entry.action === "ask_clarification") {
                console.log(`  ${stepNum} ➔ ${c.boldYellow("ASK CLARIFICATION:")} ${entry.question}`);
            } else if (entry.action === "done") {
                console.log(`  ${stepNum} ➔ ${c.boldGreen("DONE")} (Verified: ${entry.verified ? c.green("yes") : c.red("no")})`);
            } else if (entry.action === "summary") {
                console.log();
                console.log(c.bold(`  🏁 Final Outcome: ${entry.completed ? c.boldGreen("COMPLETED") : c.boldRed(entry.haltReason)}`));
                console.log(`     Steps: ${entry.step} | Grounding misses: ${entry.groundingMisses} | Deceptive clicks: ${entry.deceptiveClicks}`);
            }
        } catch { /* parse error */ }
    }
    console.log();
}

// ─── Main Dispatcher ─────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    switch (command) {
        case "run":
            await cmdRun();
            break;

        case "eval":
            // Delegate directly to eval harness
            await import("./eval.js");
            break;

        case "list":
        case "flows":
            await cmdList();
            break;

        case "replay":
        case "log":
        case "logs":
        case "trace":
            await cmdReplay();
            break;

        case "status":
        case "doctor":
        case "check":
            await cmdStatus();
            break;

        case "serve":
        case "server":
            await cmdServe();
            break;

        case "help":
        case "--help":
        case "-h":
            printHelp();
            break;

        case undefined:
            // If run with no args in interactive terminal, prompt run or help
            if (process.stdin.isTTY) {
                printHelp();
            } else {
                printHelp();
            }
            break;

        default:
            // If the user typed a flow name directly (e.g., `pnpm browser-agent checkout-3-step`)
            const flows = await loadFlows().catch(() => []);
            const matched = flows.find((f) => f.id === command);
            if (matched) {
                process.argv.splice(2, 0, "run");
                await cmdRun();
                return;
            }

            console.error();
            console.error(c.boldRed(`  ✗ Unknown command or flow: '${command}'`));
            console.error(c.gray("  Run 'pnpm browser-agent help' for available commands."));
            console.error();
            process.exit(1);
    }
}

main().catch((err) => {
    console.error(c.boldRed(`\n  ✗ ${err.message}\n`));
    process.exit(1);
});
