import { BASE_URL } from "../config.js";

export class SafetyViolationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SafetyViolationError";
    }
}

export class GroundingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "GroundingError";
    }
}

export class VerificationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "VerificationError";
    }
}

/**
 * URL allowlist: the agent may only ever navigate to the local corpus origin.
 * A runaway browser agent hitting a real third-party site is exactly the
 * failure mode this task guards against — so external navigation is a
 * hard safety violation, not a soft warning.
 */
export function safeUrl(url: string): string {
    let resolved: URL;
    try {
        resolved = new URL(url, BASE_URL);
    } catch {
        throw new SafetyViolationError(`Unparseable navigation target: ${url}`);
    }

    const base = new URL(BASE_URL);
    if (resolved.protocol !== base.protocol || resolved.host !== base.host) {
        throw new SafetyViolationError(
            `Navigation blocked: '${resolved.href}' is outside the local corpus origin ${base.origin}.`
        );
    }
    return resolved.href;
}
