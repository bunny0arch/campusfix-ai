import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSessionCookieOptions: vi.fn(() => ({ httpOnly: true, secure: false, sameSite: "lax" as const, path: "/" })),
}));

vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./_core/cookies", () => ({ getSessionCookieOptions: mocks.getSessionCookieOptions }));

import { changeLocalPassword, getLocalSessionUser, hashPassword, LocalAccountError, loginLocalAccount, logoutLocalAccount, registerLocalAccount, updateLocalProfile } from "./localAuth";

const user = { id: 42, openId: "local-test", name: "test.user", email: null, loginMethod: "local", role: "user" as const, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
const request = (cookie?: string) => ({ headers: cookie ? { cookie } : {}, ip: "127.0.0.1" } as Request);
const response = () => ({ cookie: vi.fn(), clearCookie: vi.fn() } as unknown as Response & { cookie: ReturnType<typeof vi.fn>; clearCookie: ReturnType<typeof vi.fn> });

describe("local account handlers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers a unique account with a salted digest and opaque httpOnly session", async () => {
    const inserts: unknown[] = [];
    const tx = {
      insert: () => ({ values: async (value: unknown) => { inserts.push(value); } }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [user] }) }) }),
    };
    const db = {
      transaction: async (work: (inner: typeof tx) => Promise<unknown>) => work(tx),
      insert: () => ({ values: async (value: unknown) => { inserts.push(value); } }),
    };
    mocks.getDb.mockResolvedValue(db);
    const res = response();

    await registerLocalAccount(request(), res, { username: "Test.User", password: "CampusFixSecurePass2026" });

    const accountInsert = inserts.find(value => typeof value === "object" && value !== null && "passwordHash" in value) as { username: string; passwordHash: string };
    expect(accountInsert.username).toBe("test.user");
    expect(accountInsert.passwordHash).toMatch(/^scrypt\$/);
    expect(accountInsert.passwordHash).not.toContain("CampusFixSecurePass2026");
    expect(res.cookie).toHaveBeenCalledWith("campusfix_local_session", expect.any(String), expect.objectContaining({ httpOnly: true, sameSite: "lax" }));
  });

  it("maps a driver-wrapped duplicate username error to the safe username-taken response", async () => {
    const driverError = Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
    const queryError = Object.assign(new Error("Failed query"), { cause: driverError });
    const tx = {
      insert: () => ({ values: async (value: unknown) => {
        if (typeof value === "object" && value !== null && "passwordHash" in value) throw queryError;
      } }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [user] }) }) }),
    };
    const db = { transaction: async (work: (inner: typeof tx) => Promise<unknown>) => work(tx) };
    mocks.getDb.mockResolvedValue(db);

    await expect(registerLocalAccount(request(), response(), { username: "taken.user", password: "CampusFixSecurePass2026" }))
      .rejects.toMatchObject<Partial<LocalAccountError>>({ reason: "username_taken" });
  });

  it("resolves only a matching unexpired opaque local session", async () => {
    const db = {
      select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [{ user }] }) }) }) }),
    };
    mocks.getDb.mockResolvedValue(db);

    await expect(getLocalSessionUser(request("campusfix_local_session=opaque-token"))).resolves.toMatchObject({ id: 42, name: "test.user" });
    await expect(getLocalSessionUser(request())).resolves.toBeNull();
  });

  it("requires the old password, rotates the digest, and invalidates prior sessions", async () => {
    const updates: unknown[] = [];
    const deletes: unknown[] = [];
    const sessionInserts: unknown[] = [];
    const currentHash = await (await import("./localAuth")).hashPassword("CampusFixSecurePass2026");
    const tx = {
      update: () => ({ set: (value: unknown) => ({ where: async () => { updates.push(value); } }) }),
      delete: () => ({ where: async (value: unknown) => { deletes.push(value); } }),
    };
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ userId: 42, passwordHash: currentHash }] }) }) }),
      transaction: async (work: (inner: typeof tx) => Promise<unknown>) => work(tx),
      insert: () => ({ values: async (value: unknown) => { sessionInserts.push(value); } }),
    };
    mocks.getDb.mockResolvedValue(db);
    const res = response();

    await expect(changeLocalPassword(request(), res, 42, { oldPassword: "WrongPasswordValue2026", newPassword: "CampusFixRotatedPass2026" })).rejects.toMatchObject<Partial<LocalAccountError>>({ reason: "invalid_credentials" });
    await changeLocalPassword(request(), res, 42, { oldPassword: "CampusFixSecurePass2026", newPassword: "CampusFixRotatedPass2026" });

    expect(updates).toHaveLength(1);
    expect(deletes).toHaveLength(1);
    expect(sessionInserts).toHaveLength(1);
    expect(res.cookie).toHaveBeenCalled();
  });

  it("revokes the presented session on logout", async () => {
    const deletes: unknown[] = [];
    const db = { delete: () => ({ where: async (value: unknown) => { deletes.push(value); } }) };
    mocks.getDb.mockResolvedValue(db);
    const res = response();

    await logoutLocalAccount(request("campusfix_local_session=opaque-token"), res);

    expect(deletes).toHaveLength(1);
    expect(res.clearCookie).toHaveBeenCalledWith("campusfix_local_session", expect.objectContaining({ sameSite: "lax" }));
  });

  it("rate-limits repeated invalid credential attempts from the same client", async () => {
    const db = { select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [] }) }) }) }) };
    mocks.getDb.mockResolvedValue(db);
    const limitedRequest = { headers: {}, ip: "198.51.100.12" } as Request;
    const res = response();

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expect(loginLocalAccount(limitedRequest, res, { username: "valid.user", password: "WrongPasswordValue2026" })).rejects.toMatchObject<Partial<LocalAccountError>>({ reason: "invalid_credentials" });
    }
    await expect(loginLocalAccount(limitedRequest, res, { username: "valid.user", password: "WrongPasswordValue2026" })).rejects.toMatchObject<Partial<LocalAccountError>>({ reason: "rate_limited" });
  });

  it("authenticates valid credentials and issues a fresh opaque local session", async () => {
    const passwordHash = await hashPassword("CampusFixSecurePass2026");
    const sessionInserts: unknown[] = [];
    const db = {
      select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [{ account: { userId: 42, passwordHash }, user }] }) }) }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      insert: () => ({ values: async (value: unknown) => { sessionInserts.push(value); } }),
    };
    mocks.getDb.mockResolvedValue(db);
    const res = response();

    await expect(loginLocalAccount(request(), res, { username: "test.user", password: "CampusFixSecurePass2026" })).resolves.toMatchObject({ id: 42, name: "test.user" });
    expect(sessionInserts).toHaveLength(1);
    expect(res.cookie).toHaveBeenCalledWith("campusfix_local_session", expect.any(String), expect.objectContaining({ httpOnly: true }));
  });

  it("persists a local profile through parameterized user and profile updates", async () => {
    const updates: unknown[] = [];
    const profiles: unknown[] = [];
    const results = [[{ id: 42, name: "Profile User", email: "profile@campus.example" }], [{ userId: 42, campusRole: "student", department: "Computing" }]];
    const tx = {
      update: () => ({ set: (value: unknown) => ({ where: async () => { updates.push(value); } }) }),
      insert: () => ({ values: (value: unknown) => ({ onDuplicateKeyUpdate: async () => { profiles.push(value); } }) }),
    };
    const db = {
      transaction: async (work: (inner: typeof tx) => Promise<unknown>) => work(tx),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => results.shift() ?? [] }) }) }),
    };
    mocks.getDb.mockResolvedValue(db);

    await expect(updateLocalProfile(42, { name: "Profile User", email: "profile@campus.example", campusRole: "student", department: "Computing" })).resolves.toMatchObject({ profile: { department: "Computing" } });
    expect(updates).toContainEqual({ name: "Profile User", email: "profile@campus.example" });
    expect(profiles).toContainEqual(expect.objectContaining({ userId: 42, department: "Computing" }));
  });

  it("rejects the old password but permits a subsequent login with the rotated password", async () => {
    let storedHash = await hashPassword("CampusFixSecurePass2026");
    const sessionInserts: unknown[] = [];
    const tx = {
      update: () => ({ set: (value: { passwordHash: string }) => ({ where: async () => { storedHash = value.passwordHash; } }) }),
      delete: () => ({ where: async () => undefined }),
    };
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ userId: 42, passwordHash: storedHash }] }),
          innerJoin: () => ({ where: () => ({ limit: async () => [{ account: { userId: 42, passwordHash: storedHash }, user }] }) }),
        }),
      }),
      transaction: async (work: (inner: typeof tx) => Promise<unknown>) => work(tx),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      insert: () => ({ values: async (value: unknown) => { sessionInserts.push(value); } }),
    };
    mocks.getDb.mockResolvedValue(db);
    const res = response();
    const rotationRequest = { headers: {}, ip: "203.0.113.37" } as Request;

    await changeLocalPassword(rotationRequest, res, 42, { oldPassword: "CampusFixSecurePass2026", newPassword: "CampusFixRotatedPass2026" });
    await expect(loginLocalAccount(rotationRequest, res, { username: "test.user", password: "CampusFixSecurePass2026" })).rejects.toMatchObject<Partial<LocalAccountError>>({ reason: "invalid_credentials" });
    await expect(loginLocalAccount(rotationRequest, res, { username: "test.user", password: "CampusFixRotatedPass2026" })).resolves.toMatchObject({ id: 42 });
    expect(sessionInserts).toHaveLength(2);
  });
});
