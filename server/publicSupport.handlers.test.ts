import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const mocks = vi.hoisted(() => ({
  requireDb: vi.fn(),
  findKnowledge: vi.fn(),
  invokeLLM: vi.fn(),
  fastJsonCompletion: vi.fn(),
  streamFastSupportResponse: vi.fn(),
}));

vi.mock("./campusfix", () => ({ requireDb: mocks.requireDb, findKnowledge: mocks.findKnowledge }));
vi.mock("./_core/llm", () => ({ invokeLLM: mocks.invokeLLM }));
vi.mock("./modelRouter.js", () => ({ fastJsonCompletion: mocks.fastJsonCompletion, streamFastSupportResponse: mocks.streamFastSupportResponse }));

import { configuredPublicSupportContact, createPublicSupportTicket, listPublicSupportTickets, recordPublicOutcome, streamPublicITDiagnosis } from "./publicSupport";

function createDb(selectQueue: unknown[][]) {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  return {
    inserts,
    updates,
    db: {
      select: () => {
        const result = selectQueue.shift() ?? [];
        const ordered = Object.assign(Promise.resolve(result), { limit: async () => result });
        return { from: () => ({ where: () => ({ limit: async () => result, orderBy: () => ordered }), orderBy: () => ordered }) };
      },
      insert: () => ({ values: async (value: unknown) => { inserts.push(value); } }),
      update: () => ({ set: (value: unknown) => ({ where: async () => { updates.push(value); } }) }),
    },
  };
}

function createResponse() {
  const writes: string[] = [];
  const response = {
    headersSent: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: (value: string) => writes.push(value),
    end: vi.fn(),
    on: vi.fn(),
  };
  return { response: response as unknown as Response, writes, raw: response };
}

function createTicketListDb() {
  const tickets = [
    { id: "open-ticket", ticketNumber: "IT-2026-OPEN", status: "open", title: "Wi-Fi request" },
    { id: "resolved-ticket", ticketNumber: "IT-2026-DONE", status: "resolved", title: "Printer request" },
  ];
  let selectCount = 0;
  return {
    db: {
      select: () => {
        selectCount += 1;
        return {
          from: () => ({
            where: () => selectCount === 1
              ? Promise.resolve([{ id: "session-1" }, { id: "session-2" }])
              : ({ orderBy: async () => tickets }),
          }),
        };
      },
    },
  };
}

describe("public CampusFix support endpoints", () => {
  it("creates an anonymous session and persists both sides of a completed streamed diagnosis", async () => {
    const { db, inserts } = createDb([[], []]);
    mocks.requireDb.mockResolvedValue(db);
    mocks.findKnowledge.mockResolvedValue([]);
    mocks.fastJsonCompletion.mockResolvedValue(JSON.stringify({ stage: "clarify", category: "wifi", priority: "medium", escalationRecommended: false, intent: "Identify the Wi-Fi connection error." }));
    const encoder = new TextEncoder();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, body: new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Which network are you trying to join?"}}]}\n\ndata: [DONE]\n\n')); controller.close(); } }) })));
    mocks.streamFastSupportResponse.mockImplementation(async () => fetch("https://stream.test"));
    const { response, writes } = createResponse();

    await streamPublicITDiagnosis({ body: { visitorToken: "anonymous-demo", message: "Wi-Fi is not connecting." } } as Request, response);

    expect(inserts).toHaveLength(3);
    expect(inserts[0]).toMatchObject({ visitorToken: "anonymous-demo" });
    expect(inserts.slice(1)).toEqual(expect.arrayContaining([expect.objectContaining({ role: "user" }), expect.objectContaining({ role: "assistant", content: "Which network are you trying to join?" })]));
    expect(writes.join("")).toContain("event: latency");
    expect(writes.join("")).toContain("event: complete");
  });

  it("falls back to the built-in stream when the Groq response path is unavailable", async () => {
    const { db, inserts } = createDb([[], []]);
    mocks.requireDb.mockResolvedValue(db);
    mocks.findKnowledge.mockResolvedValue([]);
    mocks.fastJsonCompletion.mockResolvedValue(JSON.stringify({ stage: "clarify", category: "printing", priority: "medium", escalationRecommended: false, intent: "Identify the printer status." }));
    mocks.streamFastSupportResponse.mockRejectedValue(new Error("Groq 503"));
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Check whether the printer display shows an error."}}]}\n\ndata: [DONE]\n\n'));
          controller.close();
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { response, writes } = createResponse();

    await streamPublicITDiagnosis({ body: { visitorToken: "anonymous-fallback", message: "The printer is unavailable." } } as Request, response);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/v1/chat/completions"), expect.objectContaining({ method: "POST" }));
    expect(inserts).toEqual(expect.arrayContaining([expect.objectContaining({ role: "assistant", content: "Check whether the printer display shows an error." })]));
    expect(writes.join("")).toContain("Preparing a safe response");
  });

  it("lists the visitor's current and resolved tickets in separate groups", async () => {
    const { db } = createTicketListDb();
    mocks.requireDb.mockResolvedValue(db);
    const { response, raw } = createResponse();

    await listPublicSupportTickets({ query: { visitorToken: "visitor" } } as unknown as Request, response);

    expect(raw.json).toHaveBeenCalledWith({
      current: [expect.objectContaining({ ticketNumber: "IT-2026-OPEN", status: "open" })],
      resolved: [expect.objectContaining({ ticketNumber: "IT-2026-DONE", status: "resolved" })],
    });
  });

  it("only exposes an official support contact when a valid address is configured", () => {
    const originalEmail = process.env.CAMPUSFIX_SUPPORT_EMAIL;
    const originalLabel = process.env.CAMPUSFIX_SUPPORT_LABEL;
    process.env.CAMPUSFIX_SUPPORT_EMAIL = "helpdesk@university.example";
    process.env.CAMPUSFIX_SUPPORT_LABEL = "Campus Infrastructure Team";
    expect(configuredPublicSupportContact()).toEqual({ assigneeName: "Campus Infrastructure Team", assigneeEmail: "helpdesk@university.example" });
    process.env.CAMPUSFIX_SUPPORT_EMAIL = "invalid-address";
    expect(configuredPublicSupportContact()).toBeUndefined();
    process.env.CAMPUSFIX_SUPPORT_EMAIL = originalEmail;
    process.env.CAMPUSFIX_SUPPORT_LABEL = originalLabel;
  });

  it("accepts the configured deployment support contact without exposing its address", () => {
    const contact = configuredPublicSupportContact();
    expect(contact?.assigneeEmail).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });

  it("records an unresolved outcome as escalated for anonymous support", async () => {
    const { db, updates } = createDb([[{ id: "session-1", visitorToken: "visitor", status: "diagnosing" }]]);
    mocks.requireDb.mockResolvedValue(db);
    const { response, raw } = createResponse();

    await recordPublicOutcome({ body: { sessionId: "session-1", visitorToken: "visitor", outcome: "still_need_help" } } as Request, response);

    expect(updates).toEqual([expect.objectContaining({ status: "escalated" })]);
    expect(raw.json).toHaveBeenCalledWith({ success: true, outcome: "still_need_help" });
  });

  it("blocks tickets during diagnosis but allows a recorded escalation to return its existing ticket", async () => {
    const diagnosing = createDb([[{ id: "session-1", visitorToken: "visitor", status: "diagnosing" }]]);
    mocks.requireDb.mockResolvedValue(diagnosing.db);
    const blocked = createResponse();
    await createPublicSupportTicket({ body: { sessionId: "session-1", visitorToken: "visitor" } } as Request, blocked.response);
    expect(blocked.raw.status).toHaveBeenCalledWith(409);

    const escalated = createDb([[{ id: "session-1", visitorToken: "visitor", status: "escalated" }], [{ ticketNumber: "IT-2026-DEMO" }]]);
    mocks.requireDb.mockResolvedValue(escalated.db);
    const allowed = createResponse();
    await createPublicSupportTicket({ body: { sessionId: "session-1", visitorToken: "visitor" } } as Request, allowed.response);
    expect(allowed.raw.json).toHaveBeenCalledWith({ ticket: { ticketNumber: "IT-2026-DEMO" }, reused: true });
  });

  it("raises a safe classified ticket even when the secondary plan request is unavailable", async () => {
    const created = createDb([
      [{ id: "session-1", visitorToken: "visitor", status: "escalated", title: "Wi-Fi issue" }],
      [],
      [{ role: "user", content: "Campus Wi-Fi will not connect." }],
    ]);
    mocks.requireDb.mockResolvedValue(created.db);
    mocks.fastJsonCompletion.mockRejectedValue(new Error("Groq unavailable"));
    mocks.invokeLLM.mockRejectedValue(new Error("fallback unavailable"));
    const { response, raw } = createResponse();

    await createPublicSupportTicket({ body: { sessionId: "session-1", visitorToken: "visitor" } } as Request, response);

    expect(created.inserts).toEqual([expect.objectContaining({ category: "wifi", priority: "medium", ticketNumber: expect.stringMatching(/^IT-\d{4}-/) })]);
    expect(raw.status).toHaveBeenCalledWith(201);
  });

  it("normalizes provider connectivity labels before inserting a ticket", async () => {
    const created = createDb([
      [{ id: "session-1", visitorToken: "visitor", status: "escalated", title: "Connection issue" }],
      [],
      [{ role: "user", content: "The campus internet does not work." }],
    ]);
    mocks.requireDb.mockResolvedValue(created.db);
    mocks.fastJsonCompletion.mockResolvedValue(JSON.stringify({ stage: "escalate", category: "connectivity", priority: "medium", escalationRecommended: true, intent: "Network needs IT." }));
    const { response } = createResponse();

    await createPublicSupportTicket({ body: { sessionId: "session-1", visitorToken: "visitor" } } as Request, response);

    expect(created.inserts).toEqual([expect.objectContaining({ category: "network" })]);
  });
});
