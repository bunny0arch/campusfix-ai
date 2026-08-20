import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { getLocalSessionUser } from "../localAuth.js";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  localUser: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let localUser: User | null = null;

  try {
    localUser = await getLocalSessionUser(opts.req);
    user = localUser ?? await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures and local sessions are self-contained.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    localUser,
  };
}
