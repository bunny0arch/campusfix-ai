import { describe, expect, it } from "vitest";
import vercelHandler from "../api/[...path]";
import { createCampusFixApp } from "./app";

describe("Vercel application adapter", () => {
  it("exports a guarded handler without starting a listener", async () => {
    const app = createCampusFixApp();
    let responseStatus = 0;
    let responseBody: unknown;
    const response = {
      status(code: number) {
        responseStatus = code;
        return this;
      },
      json(body: unknown) {
        responseBody = body;
        return this;
      },
    };

    expect(typeof app).toBe("function");
    expect(typeof vercelHandler).toBe("function");
    expect(app.get("trust proxy")).toBe(1);
    await vercelHandler({ url: "/api/health" } as any, response as any);
    expect(responseStatus).toBe(200);
    expect(responseBody).toEqual({ status: "ok", runtime: "vercel" });
  });
});
