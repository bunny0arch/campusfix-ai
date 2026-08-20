import { createCampusFixApp } from "../server/app";

// Vercel imports this handler directly. It must not call listen() because Vercel
// owns the HTTP server lifecycle for the function invocation.
const app = createCampusFixApp();

export default app;
