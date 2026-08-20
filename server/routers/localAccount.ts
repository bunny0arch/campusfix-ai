import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { changeLocalPassword, getLocalProfile, LocalAccountError, loginLocalAccount, logoutLocalAccount, registerLocalAccount, updateLocalProfile } from "../localAuth.js";

const usernameSchema = z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "Use letters, numbers, dots, hyphens, or underscores.");
const passwordSchema = z.string().min(12, "Use at least 12 characters.").max(128, "Password is too long.");
const profileSchema = z.object({
  name: z.string().max(120).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  campusId: z.string().max(64).nullable().optional(),
  campusRole: z.enum(["student", "faculty", "it_staff"]).optional(),
  department: z.string().max(140).nullable().optional(),
  program: z.string().max(160).nullable().optional(),
  yearOfStudy: z.string().max(32).nullable().optional(),
});

const localProtectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.localUser) throw new TRPCError({ code: "UNAUTHORIZED", message: "Please sign in to access your CampusFix profile." });
  return next({ ctx: { ...ctx, user: ctx.localUser, localUser: ctx.localUser } });
});

function accountError(error: unknown): never {
  if (error instanceof LocalAccountError && ["invalid_input", "username_taken", "invalid_credentials", "rate_limited", "unavailable"].includes(error.reason)) {
    const messages = {
      invalid_input: "Check the username or password requirements and try again.",
      username_taken: "That username is unavailable. Choose another one.",
      invalid_credentials: "Invalid username or password.",
      rate_limited: "Too many attempts. Please wait a few minutes before trying again.",
      unavailable: "Account service is temporarily unavailable.",
    } as const;
    const reason = error.reason as keyof typeof messages;
    const code = reason === "rate_limited" ? "TOO_MANY_REQUESTS" : reason === "unavailable" ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST";
    throw new TRPCError({ code, message: messages[reason] });
  }
  throw error;
}

export const localAccountRouter = router({
  session: publicProcedure.query(({ ctx }) => ctx.localUser ? { id: ctx.localUser.id, name: ctx.localUser.name, email: ctx.localUser.email, role: ctx.localUser.role } : null),
  register: publicProcedure.input(z.object({ username: usernameSchema, password: passwordSchema })).mutation(async ({ ctx, input }) => {
    try {
      const user = await registerLocalAccount(ctx.req, ctx.res, input);
      return { user: { id: user.id, name: user.name, email: user.email, role: user.role } };
    } catch (error) { return accountError(error); }
  }),
  login: publicProcedure.input(z.object({ username: usernameSchema, password: passwordSchema })).mutation(async ({ ctx, input }) => {
    try {
      const user = await loginLocalAccount(ctx.req, ctx.res, input);
      return { user: { id: user.id, name: user.name, email: user.email, role: user.role } };
    } catch (error) { return accountError(error); }
  }),
  logout: publicProcedure.mutation(async ({ ctx }) => {
    await logoutLocalAccount(ctx.req, ctx.res);
    return { success: true } as const;
  }),
  profile: localProtectedProcedure.query(async ({ ctx }) => {
    try { return await getLocalProfile(ctx.user.id); } catch (error) { return accountError(error); }
  }),
  updateProfile: localProtectedProcedure.input(profileSchema).mutation(async ({ ctx, input }) => {
    try { return await updateLocalProfile(ctx.user.id, input); } catch (error) { return accountError(error); }
  }),
  changePassword: localProtectedProcedure.input(z.object({ oldPassword: passwordSchema, newPassword: passwordSchema })).mutation(async ({ ctx, input }) => {
    try { await changeLocalPassword(ctx.req, ctx.res, ctx.user.id, input); return { success: true } as const; } catch (error) { return accountError(error); }
  }),
});
