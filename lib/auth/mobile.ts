// The phone app's login: the same steps and rules as the website's login screens (app/login/actions.ts),
// but the session token comes back in the reply (the app keeps it in the phone's secure storage) instead of a cookie.
import * as auth from "./service";
import type { Deps, Step } from "./service";

const bad: Step = { step: "error", message: "Something went wrong. Please try again." };

// One login step. `body` is whatever the phone sent, so nothing in it is trusted: each step checks its own input.
export async function mobileLoginStep(deps: Deps, body: unknown): Promise<Step> {
  if (!body || typeof body !== "object") return bad;
  const b = body as Record<string, unknown>;
  switch (b.action) {
    case "lookupPhone":
      return auth.lookupPhone(deps, b.cell);
    case "submitPin":
      return auth.submitPin(deps, b.cell, b.pin);
    case "sendStarterCode":
      return auth.sendStarterCode(deps, b.cell, b.email ?? null);
    case "completeStarter":
      return auth.completeStarter(deps, b.cell, b.code, b.pin1, b.pin2);
    case "sendVerifyCode":
      return auth.sendVerifyCode(deps, b.cell, b.pin, b.email ?? null);
    case "completeVerify":
      return auth.completeVerify(deps, b.cell, b.pin, b.code);
    case "startForgot":
      return auth.startForgot(deps, b.cell);
    case "completeReset":
      return auth.completeReset(deps, b.cell, b.code, b.pin1, b.pin2);
    case "startSignup":
      return auth.startSignup(deps, {
        cell: b.cell,
        firstName: b.firstName,
        lastName: b.lastName,
        email: b.email,
        pin1: b.pin1,
        pin2: b.pin2,
        purpose: b.purpose,
        staffRole: b.staffRole,
        teamText: b.teamText,
        notes: b.notes,
      });
    case "completeSignup":
      return auth.completeSignup(deps, b.cell, b.code);
    case "devLogin":
      return auth.devLogin(deps, b.cell, b.code);
    default:
      return bad;
  }
}

// "Authorization: Bearer <token>" -> the token. Session tokens are long random strings with no spaces.
export function bearerToken(header: string | null): string | undefined {
  const m = header?.match(/^Bearer ([A-Za-z0-9_-]{20,200})$/);
  return m?.[1];
}
