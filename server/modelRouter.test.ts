import { describe, expect, it, vi } from "vitest";
import { fastJsonCompletion, fastModelPolicy, streamFastSupportResponse } from "./modelRouter";

describe("CampusFix fast model router", () => {
  it("uses the verified OpenRouter fast-model chain for compact diagnostic plans", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"stage":"clarify"}' } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const original = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-key";
    await expect(fastJsonCompletion([{ role: "user", content: "Wi-Fi failed" }])).resolves.toContain("clarify");
    expect(fetchMock).toHaveBeenCalledWith("https://openrouter.ai/api/v1/chat/completions", expect.objectContaining({ method: "POST" }));
    expect(fastModelPolicy.candidates).toHaveLength(2);
    process.env.OPENROUTER_API_KEY = original;
  });

  it("requires a response body when starting a streamed response", async () => {
    const original = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("data: [DONE]\n\n", { status: 200 })));
    await expect(streamFastSupportResponse([{ role: "user", content: "Help" }], new AbortController().signal)).resolves.toBeInstanceOf(Response);
    process.env.OPENROUTER_API_KEY = original;
  });
});
