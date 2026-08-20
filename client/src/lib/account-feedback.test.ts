import { describe, expect, it } from "vitest";
import { accountSuccessFeedback, isUsernameUnavailableError } from "./account-feedback";

describe("account success feedback", () => {
  it("confirms successful account creation", () => {
    expect(accountSuccessFeedback("register")).toEqual({ title: "Account created", description: "Your secure CampusFix workspace is ready." });
  });

  it("confirms successful existing-user sign-in", () => {
    expect(accountSuccessFeedback("login")).toEqual({ title: "Signed in successfully", description: "Opening your CampusFix workspace." });
  });

  it("recognizes only the expected duplicate-username response as a recoverable account conflict", () => {
    expect(isUsernameUnavailableError(new Error("That username is unavailable. Choose another one."))).toBe(true);
    expect(isUsernameUnavailableError(new Error("Invalid credentials"))).toBe(false);
  });
});
