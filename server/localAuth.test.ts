import { describe, expect, it } from "vitest";
import { hashPassword, LocalAccountError, validateLocalUsername, verifyPassword } from "./localAuth";

describe("local account credentials", () => {
  it("normalizes a valid username without retaining its display casing", () => {
    expect(validateLocalUsername("Alex.Chen-01")).toBe("alex.chen-01");
  });

  it("rejects injection-like usernames before any database operation", () => {
    expect(() => validateLocalUsername("admin' OR '1'='1")).toThrow(LocalAccountError);
    try {
      validateLocalUsername("admin' OR '1'='1");
    } catch (error) {
      expect((error as LocalAccountError).reason).toBe("invalid_input");
    }
  });

  it("stores a salted scrypt digest and verifies only the original password", async () => {
    const password = "CampusFixSecurePass2026";
    const hash = await hashPassword(password);
    expect(hash).toMatch(/^scrypt\$/);
    expect(hash).not.toContain(password);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword("IncorrectPassword2026", hash)).resolves.toBe(false);
  });
});
