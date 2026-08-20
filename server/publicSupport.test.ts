import { describe, expect, it } from "vitest";
import { canCreatePublicTicket, nextPublicSessionStatusForOutcome, redactSensitiveSupportInput } from "./publicSupport";

describe("public CampusFix diagnostic privacy guard", () => {
  it("redacts credential-like values before they can be persisted or sent to the model", () => {
    expect(redactSensitiveSupportInput("My password: campusSecret and MFA code: 123456 are rejected.")).toBe("My password: [redacted] and MFA code: [redacted] are rejected.");
  });

  it("preserves ordinary IT issue details", () => {
    expect(redactSensitiveSupportInput("Wi-Fi fails in the library on Windows 11.")).toBe("Wi-Fi fails in the library on Windows 11.");
  });

  it("allows IT ticket escalation only after an unresolved outcome or escalation state", () => {
    expect(canCreatePublicTicket("diagnosing")).toBe(false);
    expect(canCreatePublicTicket("resolved")).toBe(false);
    expect(canCreatePublicTicket("escalated")).toBe(true);
    expect(nextPublicSessionStatusForOutcome("still_need_help")).toBe("escalated");
    expect(nextPublicSessionStatusForOutcome("resolved")).toBe("resolved");
  });
});
