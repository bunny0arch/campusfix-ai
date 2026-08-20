import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import type { Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { localAccounts, localAccountSessions, userProfiles, users, type User } from "../drizzle/schema";
import { getDb } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";

const scrypt = promisify(scryptCallback);
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOCAL_SESSION_COOKIE = "campusfix_local_session";

type ProfileInput = {
  name?: string | null;
  email?: string | null;
  campusId?: string | null;
  campusRole?: "student" | "faculty" | "it_staff";
  department?: string | null;
  program?: string | null;
  yearOfStudy?: string | null;
};

type AttemptWindow = { count: number; resetAt: number };
const loginAttempts = new Map<string, AttemptWindow>();
const dummyHashPromise = hashPassword("CampusFix-credential-check-only");

export class LocalAccountError extends Error {
  constructor(readonly reason: "invalid_input" | "username_taken" | "invalid_credentials" | "rate_limited" | "unavailable") {
    super(reason);
  }
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function validateLocalUsername(value: string) {
  const username = normalizeUsername(value);
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)) throw new LocalAccountError("invalid_input");
  return username;
}

function assertPassword(value: string) {
  if (value.length < 12 || value.length > 128 || Buffer.byteLength(value, "utf8") > 256) throw new LocalAccountError("invalid_input");
  return value;
}

function tokenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function requestKey(request: Request) {
  return request.ip || request.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || "unknown";
}

function assertAttemptAllowed(request: Request) {
  const key = requestKey(request);
  const existing = loginAttempts.get(key);
  if (!existing || existing.resetAt <= Date.now()) {
    loginAttempts.delete(key);
    return;
  }
  if (existing.count >= MAX_LOGIN_ATTEMPTS) throw new LocalAccountError("rate_limited");
}

function recordFailedAttempt(request: Request) {
  const key = requestKey(request);
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= Date.now()) {
    loginAttempts.set(key, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
    return;
  }
  current.count += 1;
}

function clearAttempts(request: Request) {
  loginAttempts.delete(requestKey(request));
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, expected] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  try {
    const derived = await scrypt(password, salt, 64) as Buffer;
    const expectedBuffer = Buffer.from(expected, "base64url");
    return expectedBuffer.length === derived.length && timingSafeEqual(expectedBuffer, derived);
  } catch {
    return false;
  }
}

function readCookie(request: Request) {
  const pair = request.headers.cookie?.split(";").map(value => value.trim()).find(value => value.startsWith(`${LOCAL_SESSION_COOKIE}=`));
  if (!pair) return undefined;
  try { return decodeURIComponent(pair.slice(LOCAL_SESSION_COOKIE.length + 1)); } catch { return undefined; }
}

function sessionCookieOptions(request: Request) {
  return { ...getSessionCookieOptions(request), sameSite: "lax" as const, maxAge: SESSION_TTL_MS };
}

export async function establishLocalSession(response: Response, request: Request, userId: number) {
  const db = await getDb();
  if (!db) throw new LocalAccountError("unavailable");
  const token = randomBytes(32).toString("base64url");
  await db.insert(localAccountSessions).values({
    id: nanoid(24),
    userId,
    tokenHash: tokenDigest(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  response.cookie(LOCAL_SESSION_COOKIE, token, sessionCookieOptions(request));
}

export async function getLocalSessionUser(request: Request): Promise<User | null> {
  const token = readCookie(request);
  if (!token) return null;
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ user: users }).from(localAccountSessions)
    .innerJoin(users, eq(localAccountSessions.userId, users.id))
    .where(and(eq(localAccountSessions.tokenHash, tokenDigest(token)), gt(localAccountSessions.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.user ?? null;
}

export async function registerLocalAccount(request: Request, response: Response, input: { username: string; password: string }) {
  assertAttemptAllowed(request);
  const username = validateLocalUsername(input.username);
  const password = assertPassword(input.password);
  const passwordHash = await hashPassword(password);
  const db = await getDb();
  if (!db) throw new LocalAccountError("unavailable");
  try {
    const user = await db.transaction(async tx => {
      const openId = `local_${nanoid(24)}`;
      await tx.insert(users).values({ openId, name: username, loginMethod: "local", lastSignedIn: new Date() });
      const created = await tx.select().from(users).where(eq(users.openId, openId)).limit(1);
      if (!created[0]) throw new LocalAccountError("unavailable");
      await tx.insert(localAccounts).values({ id: nanoid(24), userId: created[0].id, username, passwordHash });
      return created[0];
    });
    await establishLocalSession(response, request, user.id);
    clearAttempts(request);
    return user;
  } catch (error) {
    if (error instanceof LocalAccountError) throw error;
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") throw new LocalAccountError("username_taken");
    throw error;
  }
}

export async function loginLocalAccount(request: Request, response: Response, input: { username: string; password: string }) {
  assertAttemptAllowed(request);
  const username = validateLocalUsername(input.username);
  const password = assertPassword(input.password);
  const db = await getDb();
  if (!db) throw new LocalAccountError("unavailable");
  const rows = await db.select({ account: localAccounts, user: users }).from(localAccounts)
    .innerJoin(users, eq(localAccounts.userId, users.id))
    .where(eq(localAccounts.username, username)).limit(1);
  const account = rows[0];
  const valid = account ? await verifyPassword(password, account.account.passwordHash) : await verifyPassword(password, await dummyHashPromise);
  if (!account || !valid) {
    recordFailedAttempt(request);
    throw new LocalAccountError("invalid_credentials");
  }
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, account.user.id));
  await establishLocalSession(response, request, account.user.id);
  clearAttempts(request);
  return account.user;
}

export async function logoutLocalAccount(request: Request, response: Response) {
  const token = readCookie(request);
  const db = await getDb();
  if (token && db) await db.delete(localAccountSessions).where(eq(localAccountSessions.tokenHash, tokenDigest(token)));
  response.clearCookie(LOCAL_SESSION_COOKIE, { ...sessionCookieOptions(request), maxAge: -1 });
}

function cleanText(value: string | null | undefined, maxLength: number) {
  if (value === undefined || value === null) return null;
  const cleaned = value.trim();
  if (cleaned.length > maxLength) throw new LocalAccountError("invalid_input");
  return cleaned || null;
}

export async function getLocalProfile(userId: number) {
  const db = await getDb();
  if (!db) throw new LocalAccountError("unavailable");
  const [user] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
  return { user, profile };
}

export async function updateLocalProfile(userId: number, input: ProfileInput) {
  const db = await getDb();
  if (!db) throw new LocalAccountError("unavailable");
  const values = {
    name: cleanText(input.name, 120),
    email: cleanText(input.email, 320),
    campusId: cleanText(input.campusId, 64),
    department: cleanText(input.department, 140),
    program: cleanText(input.program, 160),
    yearOfStudy: cleanText(input.yearOfStudy, 32),
    campusRole: input.campusRole ?? "student",
  };
  await db.transaction(async tx => {
    await tx.update(users).set({ name: values.name, email: values.email }).where(eq(users.id, userId));
    await tx.insert(userProfiles).values({ userId, ...values }).onDuplicateKeyUpdate({ set: { ...values, updatedAt: new Date() } });
  });
  return getLocalProfile(userId);
}

export async function changeLocalPassword(request: Request, response: Response, userId: number, input: { oldPassword: string; newPassword: string }) {
  const oldPassword = assertPassword(input.oldPassword);
  const newPassword = assertPassword(input.newPassword);
  const db = await getDb();
  if (!db) throw new LocalAccountError("unavailable");
  const [account] = await db.select().from(localAccounts).where(eq(localAccounts.userId, userId)).limit(1);
  if (!account || !await verifyPassword(oldPassword, account.passwordHash)) throw new LocalAccountError("invalid_credentials");
  const passwordHash = await hashPassword(newPassword);
  await db.transaction(async tx => {
    await tx.update(localAccounts).set({ passwordHash, updatedAt: new Date() }).where(eq(localAccounts.userId, userId));
    await tx.delete(localAccountSessions).where(eq(localAccountSessions.userId, userId));
  });
  await establishLocalSession(response, request, userId);
}
