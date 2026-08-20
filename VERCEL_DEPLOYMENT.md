# CampusFix deployment on Vercel

CampusFix now uses a Vercel-compatible deployment shape. The Vite client is built to `dist`, while `api/[...path].ts` exports the existing Express application as one Node serverless function. The conventional Node server bundle is emitted separately to `server-dist`, outside Vercel’s static output directory. This separation prevents Vercel from serving server code as the root document. Vercel owns the HTTP listener; the local `server/_core/index.ts` entrypoint remains responsible only for local development and conventional Node hosting.

## Required configuration

| Vercel setting | Value |
| --- | --- |
| Framework preset | Vite, or **Other** if Vercel does not auto-detect Vite. |
| Build command | `pnpm build` |
| Output directory | `dist` |
| Node.js runtime | 22.x or newer |

## Required environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Network-reachable MySQL/TiDB connection string used by local accounts, profiles, tickets, and support history. |
| `JWT_SECRET` | A strong, production-only secret used by the retained platform authentication routes. |
| `OPENROUTER_API_KEY` | Server-only key for CampusFix diagnostic responses. |

`NODE_ENV=production` is supplied by Vercel. Configure the variables above for **Production**, **Preview**, and **Development** environments as appropriate; never prefix private values with `VITE_`.

## Optional feature boundaries

The public local-account flow, database, and OpenRouter diagnostic path do not require Manus-specific credentials. However, `/manus-storage/*`, Manus OAuth, the built-in LLM fallback, and Heartbeat-driven scheduled operations depend on `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY`, and related Manus environment values. Do not assume those internal values transfer to Vercel. Keep those features disabled or supply independently supported replacements before relying on them in a Vercel deployment.

## Deployment behavior

Requests under `/api/*` and `/manus-storage/*` are routed to the serverless Express handler. All other paths return the Vite SPA, preserving direct navigation to client routes. The Express app trusts Vercel’s first proxy so HTTPS local-account cookies and client-IP login throttling work correctly behind Vercel’s edge.

## References

- [Vercel: Deploying Vite applications](https://vercel.com/docs/frameworks/frontend/vite)
- [Vercel: Rewrites and internal routing](https://vercel.com/docs/rewrites)
- [Vercel: Function configuration](https://vercel.com/docs/functions/configuring-functions/advanced-configuration)
