import { describe, expect, it } from "vitest";
import vercelHandler from "../api/[...path]";
import { createCampusFixApp } from "./app";

describe("Vercel application adapter", () => {
  it("exports the shared Express handler without starting a listener", () => {
    const app = createCampusFixApp();

    expect(typeof app).toBe("function");
    expect(typeof vercelHandler).toBe("function");
    expect(app.get("trust proxy")).toBe(1);
    expect(vercelHandler.get("trust proxy")).toBe(1);
  });
});
