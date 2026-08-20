import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  profile: vi.fn(),
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock("../localAuth.js", () => ({
  LocalAccountError: class LocalAccountError extends Error { reason = "invalid_credentials"; },
  registerLocalAccount: mocks.register,
  loginLocalAccount: mocks.login,
  logoutLocalAccount: mocks.logout,
  getLocalProfile: mocks.profile,
  updateLocalProfile: mocks.updateProfile,
  changeLocalPassword: mocks.changePassword,
}));

import { localAccountRouter } from "./localAccount";

const localUser = { id: 7, openId: "local-router-test", name: "Router User", email: "router@campus.example", loginMethod: "local", role: "user" as const, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
const context = (overrides: Partial<Record<"user" | "localUser", typeof localUser | null>> = {}) => ({ req: {}, res: {}, user: null, localUser: null, ...overrides });

describe("local account router", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validates public registration input before dispatching the handler", async () => {
    const caller = localAccountRouter.createCaller(context());
    await expect(caller.register({ username: "admin' OR '1'='1", password: "CampusFixSecurePass2026" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("creates an account through the public router and returns only safe user fields", async () => {
    mocks.register.mockResolvedValue(localUser);
    const caller = localAccountRouter.createCaller(context());

    await expect(caller.register({ username: "router.user", password: "CampusFixSecurePass2026" })).resolves.toEqual({ user: { id: 7, name: "Router User", email: "router@campus.example", role: "user" } });
  });

  it("refuses profile access for an unauthenticated or non-local request", async () => {
    const caller = localAccountRouter.createCaller(context({ user: localUser, localUser: null }));
    await expect(caller.profile()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.updateProfile({ department: "Computing" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("allows a local session to persist profile changes and rotate a password only through guarded procedures", async () => {
    mocks.profile.mockResolvedValue({ user: localUser, profile: { userId: 7, campusRole: "student" } });
    mocks.updateProfile.mockResolvedValue({ user: localUser, profile: { userId: 7, department: "Computing" } });
    const caller = localAccountRouter.createCaller(context({ user: localUser, localUser }));

    await expect(caller.profile()).resolves.toMatchObject({ user: { id: 7 } });
    await caller.updateProfile({ department: "Computing" });
    await caller.changePassword({ oldPassword: "CampusFixSecurePass2026", newPassword: "CampusFixRotatedPass2026" });
    expect(mocks.updateProfile).toHaveBeenCalledWith(7, { department: "Computing" });
    expect(mocks.changePassword).toHaveBeenCalledWith({}, {}, 7, { oldPassword: "CampusFixSecurePass2026", newPassword: "CampusFixRotatedPass2026" });
  });

  it("exposes an explicit logout operation for the current account cookie", async () => {
    const req = { headers: {} };
    const res = {};
    const caller = localAccountRouter.createCaller({ ...context({ user: localUser, localUser }), req, res });
    await expect(caller.logout()).resolves.toEqual({ success: true });
    expect(mocks.logout).toHaveBeenCalledWith(req, res);
  });
});
