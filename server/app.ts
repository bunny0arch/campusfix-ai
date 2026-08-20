import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./_core/oauth";
import { registerStorageProxy } from "./_core/storageProxy";
import { appRouter } from "./routers";
import { streamCampusFixAgent } from "./agentStream";
import { createPublicSupportTicket, recordPublicOutcome, streamPublicITDiagnosis } from "./publicSupport";
import { runCampusFixScheduledOperation } from "./scheduledOperations";
import { createContext } from "./_core/context";

/**
 * Creates the reusable HTTP application without binding a port.
 * Local development attaches Vite and listens in server/_core/index.ts; Vercel
 * imports this same application directly as a serverless function.
 */
export function createCampusFixApp() {
  const app = express();

  // Vercel terminates TLS at its edge and forwards the original protocol/client IP.
  // Trusting the first proxy keeps secure cookies and login throttling correct.
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.post("/api/campusfix/stream", streamCampusFixAgent);
  app.post("/api/campusfix/public/diagnose", streamPublicITDiagnosis);
  app.post("/api/campusfix/public/outcome", recordPublicOutcome);
  app.post("/api/campusfix/public/ticket", createPublicSupportTicket);
  app.post("/api/scheduled/campusfix-operations", runCampusFixScheduledOperation);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  return app;
}
