import { describe, expect, it } from "vitest";
import { accountSuccessFeedback } from "./account-feedback";

describe("account success feedback", () => {
  it("confirms successful account creation", () => {
    expect(accountSuccessFeedback("register")).toEqual({ title: "Account created", description: "Your secure CampusFix workspace is ready." });
  });

  it("confirms successful existing-user sign-in", () => {
    expect(accountSuccessFeedback("login")).toEqual({ title: "Signed in successfully", description: "Opening your CampusFix workspace." });
  });
});
