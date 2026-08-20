export type AccountSuccessMode = "login" | "register";

export function accountSuccessFeedback(mode: AccountSuccessMode) {
  return mode === "register"
    ? { title: "Account created", description: "Your secure CampusFix workspace is ready." }
    : { title: "Signed in successfully", description: "Opening your CampusFix workspace." };
}

export function isUsernameUnavailableError(error: unknown) {
  return error instanceof Error && /username is unavailable/i.test(error.message);
}
