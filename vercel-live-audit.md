# CampusFix Vercel Live Audit

**Target:** https://campusfix-trinetras.vercel.app  
**Observed:** 2026-08-20

## Finding

The supplied production URL does not render the CampusFix Vite application. It returns a large JavaScript bundle whose visible content begins with bundled server modules such as `server/_core/notification.ts`, `server/_core/index.ts`, and `drizzle/schema.ts`.

The response headers confirm the issue: the root returns **HTTP 200** with `content-type: application/javascript; charset=utf-8`, a `content-length` of 108,207 bytes, and Vercel caching headers. A valid Vite SPA root must instead return its `index.html` as `text/html`.

The associated routes are also absent from the live deployment: `GET /api/trpc` returns Vercel `404 NOT_FOUND`, and the client deep link `GET /profile` returns the same `404 NOT_FOUND`. These results confirm that neither the serverless API rewrite nor the SPA fallback is active in the deployment currently behind the supplied URL.

After the static and SPA routing repair, the Vercel root and deep links updated successfully, but both tRPC and public POST probes returned `FUNCTION_INVOCATION_FAILED`. The serverless cold-start graph has been made portable by replacing local Vite-only `@shared/*` aliases in the eager OAuth and tRPC dependencies with explicit relative imports. The complete suite, type check, and separated production build pass locally; the next deployment revision requires live API verification.

This indicates that the currently deployed Vercel project is serving the Node server bundle as its static entry point rather than serving the Vite client build from `dist/public` and routing API requests through a Vercel Function.

## Required production configuration

The committed `vercel.json` repair specifies `pnpm build`, `dist/public` as the output directory, an `api/[...path].ts` serverless Express handler, API and storage rewrites, and an SPA fallback. The actual Vercel project must build from the repository revision containing these files and use the documented production environment variables before the URL can be validated as fixed.

The build layout was further hardened after this observation: Vite now emits the static site directly to `dist`, while the conventional Node bundle is emitted to `server-dist`. `vercel.json` now points only at `dist`, eliminating the prior ambiguity in which a project configured with `dist` could expose `dist/index.js` as the website root.

## Current limitation

The connected Vercel account does not expose the project behind the supplied URL, so its live build settings, environment values, and deployment logs cannot be inspected or changed through the connected integration.
