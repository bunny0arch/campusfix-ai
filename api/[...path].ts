import type { Request, Response } from "express";

type ExpressHandler = (request: Request, response: Response) => void;

let appPromise: Promise<ExpressHandler> | undefined;

async function getApplication(): Promise<ExpressHandler> {
  appPromise ??= import("../server/app").then(({ createCampusFixApp }) =>
    createCampusFixApp(),
  );
  return appPromise;
}

// Vercel owns the HTTP listener. This function only loads and delegates to the
// shared Express application after a request arrives.
export default async function vercelHandler(request: Request, response: Response) {
  if (request.url?.endsWith("/api/health") || request.url?.endsWith("/_health")) {
    response.status(200).json({ status: "ok", runtime: "vercel" });
    return;
  }

  try {
    const app = await getApplication();
    app(request, response);
  } catch (error) {
    // Keep implementation details in platform logs while returning a stable,
    // non-sensitive response that distinguishes startup faults from API errors.
    console.error("[Vercel] API startup failed", error);
    response.status(500).json({
      error: "CampusFix API could not start. Check the Vercel function log and production environment variables.",
      code: "VERCEL_API_STARTUP_ERROR",
    });
  }
}
