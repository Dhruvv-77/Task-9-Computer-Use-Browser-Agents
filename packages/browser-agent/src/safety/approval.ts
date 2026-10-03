import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { PolicyDecision } from "./policy.js";

/**
 * Human-in-the-loop approval gate (pattern from Task 3).
 * Runs strictly AFTER policy classification. The eval harness sets
 * AUTO_APPROVE=1 (grant) or AUTO_DENY=1 (deny); interactive runs prompt.
 */
export async function requestApproval(
    decision: PolicyDecision,
    preview: Record<string, unknown>
): Promise<boolean> {
    console.log("\n--- IRREVERSIBLE ACTION: approval required ---");
    console.log(`reason: ${decision.reason}`);
    console.log(JSON.stringify(preview, null, 2));

    if (process.env.AUTO_APPROVE === "1") {
        console.log("Approve? (y/n): y [auto-approved post-classification]");
        return true;
    }
    if (process.env.AUTO_DENY === "1") {
        console.log("Approve? (y/n): n [auto-denied]");
        return false;
    }

    const rl = readline.createInterface({ input, output });
    const answer = await rl.question("Approve? (y/n): ");
    rl.close();

    return answer.trim().toLowerCase() === "y";
}
