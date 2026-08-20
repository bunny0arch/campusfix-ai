import { and, desc, eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import { publicSupportMessages, publicSupportSessions, publicSupportTickets } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { invokeLLM, type Message } from "./_core/llm";
import { findKnowledge, requireDb } from "./campusfix";

type DiagnosticStage = "clarify" | "retrieve" | "guide" | "check" | "escalate";
type ITCategory = "wifi" | "account" | "password" | "software" | "network" | "printing" | "configuration" | "general";

type DiagnosticPlan = {
  stage: DiagnosticStage;
  category: ITCategory;
  priority: "low" | "medium" | "high" | "critical";
  escalationRecommended: boolean;
  intent: string;
};

type PublicMessage = { role: "user" | "assistant"; content: string };

const MAX_PUBLIC_MESSAGES = 18;

export function redactSensitiveSupportInput(input: string) {
  return input
    .replace(/\b(password|passcode|mfa code|verification code|recovery code)\s*[:=-]\s*[^\s,;]+/gi, "$1: [redacted]")
    .replace(/\b(?:one[- ]?time|verification|mfa)\s+code\s+is\s+\d{4,8}\b/gi, "verification code is [redacted]");
}

export function canCreatePublicTicket(sessionStatus: "diagnosing" | "resolved" | "escalated") {
  return sessionStatus === "escalated";
}

export function nextPublicSessionStatusForOutcome(outcome: "resolved" | "still_need_help") {
  return outcome === "resolved" ? "resolved" : "escalated" as const;
}

function writeEvent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function getTextDelta(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const choice = Array.isArray((payload as { choices?: unknown[] }).choices) ? (payload as { choices: Array<{ delta?: { content?: unknown } }> }).choices[0] : undefined;
  return typeof choice?.delta?.content === "string" ? choice.delta.content : "";
}

function contentAsText(content: unknown) {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map(part => (part && typeof part === "object" && "text" in part ? String(part.text) : "")).join("") : "";
}

async function createPlan(message: string, history: PublicMessage[]): Promise<DiagnosticPlan> {
  const response = await invokeLLM({
    model: "gpt-5-mini",
    messages: [
      {
        role: "system",
        content: "You are a first-level university IT intake coordinator. Return a compact JSON plan only. Support Wi-Fi, login/account access, password access, software installation, connectivity, printing, and safe system configuration. Stage rules: clarify when a key fact is missing; retrieve when verified documentation should be located; guide for safe reversible user steps; check after steps are given; escalate for security, privileged administration, data-loss risk, suspected outage, repeated failure, or human-only work. Never ask for passwords, MFA codes, recovery codes, or personal identifiers. Never prescribe privilege escalation, firewall/registry/antivirus changes, remote access, or destructive network/system actions.",
      },
      ...history.slice(-6).map(item => ({ role: item.role, content: item.content })),
      { role: "user", content: message },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "campusfix_public_diagnostic_plan",
        strict: true,
        schema: {
          type: "object",
          properties: {
            stage: { type: "string", enum: ["clarify", "retrieve", "guide", "check", "escalate"] },
            category: { type: "string", enum: ["wifi", "account", "password", "software", "network", "printing", "configuration", "general"] },
            priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
            escalationRecommended: { type: "boolean" },
            intent: { type: "string" },
          },
          required: ["stage", "category", "priority", "escalationRecommended", "intent"],
          additionalProperties: false,
        },
      },
    },
  });
  return JSON.parse(contentAsText(response.choices[0]?.message.content)) as DiagnosticPlan;
}

function buildDiagnosticMessages(history: PublicMessage[], plan: DiagnosticPlan, knowledge: Awaited<ReturnType<typeof findKnowledge>>): Message[] {
  const sources = knowledge.length
    ? knowledge.map(article => `VERIFIED CAMPUS SOURCE — ${article.title}\n${article.content.slice(0, 800)}`).join("\n\n")
    : "No verified campus source was found for this specific issue. Say so plainly and do not invent campus policy, network status, or contact details.";
  const stageInstruction: Record<DiagnosticStage, string> = {
    clarify: "Ask exactly one high-signal diagnostic question. Do not overwhelm the user with steps yet.",
    retrieve: "Briefly identify the relevant verified source and give the next single safe action.",
    guide: "Give no more than four numbered, reversible user-level steps. Include what success should look like.",
    check: "Ask whether the last step worked and state the next route if it did not. Keep it concise.",
    escalate: "State why this needs IT involvement. Do not claim a ticket exists; invite the user to create one with the visible escalation control.",
  };
  return [
    {
      role: "system",
      content: `You are CampusFix, an autonomous first-level IT support assistant. Current diagnosis: ${plan.intent}. Stage: ${plan.stage}. ${stageInstruction[plan.stage]} Safety requirements: never request or handle passwords, MFA/recovery codes, student records, or private device data; never suggest unsafe system/network changes, security bypasses, elevated permissions, remote-control software, or destructive commands. You cannot inspect devices, accounts, printers, or networks. You must distinguish verified source facts from general safe troubleshooting. Use short, calm markdown. ${sources}`,
    },
    ...history.slice(-10),
  ];
}

async function ensureSession(visitorToken: string, sessionId: string | undefined, openingMessage: string) {
  const db = await requireDb();
  if (sessionId) {
    const existing = await db.select().from(publicSupportSessions).where(and(eq(publicSupportSessions.id, sessionId), eq(publicSupportSessions.visitorToken, visitorToken))).limit(1);
    if (existing[0]) return existing[0];
  }
  const session = { id: nanoid(18), visitorToken, title: openingMessage.slice(0, 180) || "IT support session" };
  await db.insert(publicSupportSessions).values(session);
  return session;
}

async function getSessionHistory(sessionId: string) {
  const db = await requireDb();
  return db.select({ role: publicSupportMessages.role, content: publicSupportMessages.content }).from(publicSupportMessages).where(eq(publicSupportMessages.sessionId, sessionId)).orderBy(publicSupportMessages.createdAt);
}

async function saveMessage(params: { sessionId: string; role: "user" | "assistant"; stage: DiagnosticStage; content: string; citations?: Array<{ title: string; sourceUrl?: string | null }> }) {
  const db = await requireDb();
  await db.insert(publicSupportMessages).values({ id: nanoid(18), ...params, citations: params.citations ?? null });
  await db.update(publicSupportSessions).set({ updatedAt: new Date() }).where(eq(publicSupportSessions.id, params.sessionId));
}

export async function streamPublicITDiagnosis(req: Request, res: Response) {
  try {
    const message = typeof req.body?.message === "string" ? redactSensitiveSupportInput(req.body.message).trim() : "";
    const visitorToken = typeof req.body?.visitorToken === "string" ? req.body.visitorToken.trim().slice(0, 64) : "";
    const requestedSessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : undefined;
    if (!message || message.length > 3000 || !visitorToken) return res.status(400).json({ error: "Describe the issue and retry." });

    const session = await ensureSession(visitorToken, requestedSessionId, message);
    const history = await getSessionHistory(session.id);
    if (history.length >= MAX_PUBLIC_MESSAGES) return res.status(429).json({ error: "Start a new support session to continue." });

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    writeEvent(res, "session", { sessionId: session.id });
    writeEvent(res, "status", { label: "Understanding the issue", state: "diagnosing" });

    await saveMessage({ sessionId: session.id, role: "user", stage: "clarify", content: message });
    const plan = await createPlan(message, history as PublicMessage[]);
    const knowledge = await findKnowledge(message);
    writeEvent(res, "stage", { stage: plan.stage, intent: plan.intent, sourceCount: knowledge.length });
    writeEvent(res, "status", { label: knowledge.length ? "Checking verified IT guidance" : "Preparing a safe next step", state: "responding" });

    const controller = new AbortController();
    let closed = false;
    res.on("close", () => { closed = true; controller.abort(); });
    const upstream = await fetch(`${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ENV.forgeApiKey}` },
      body: JSON.stringify({ model: "gpt-5-mini", stream: true, messages: buildDiagnosticMessages([...history, { role: "user", content: message }] as PublicMessage[], plan, knowledge) }),
      signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) throw new Error("The AI response stream is unavailable.");

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    while (!closed) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find(entry => entry.startsWith("data: "));
        if (!line || line.slice(6) === "[DONE]") continue;
        try {
          const delta = getTextDelta(JSON.parse(line.slice(6)));
          if (delta) { content += delta; writeEvent(res, "token", { delta }); }
        } catch { /* Ignore malformed upstream chunks while preserving the session. */ }
      }
    }

    if (!closed) {
      const citations = knowledge.map(article => ({ title: article.title, sourceUrl: article.sourceUrl }));
      await saveMessage({ sessionId: session.id, role: "assistant", stage: plan.stage, content, citations });
      if (plan.escalationRecommended || plan.stage === "escalate") {
        const db = await requireDb();
        await db.update(publicSupportSessions).set({ status: "escalated" }).where(eq(publicSupportSessions.id, session.id));
      }
      writeEvent(res, "complete", { stage: plan.stage, citations, canEscalate: plan.escalationRecommended || plan.stage === "escalate" });
      res.end();
    }
  } catch (error) {
    if (!res.headersSent) return res.status(500).json({ error: "CampusFix could not complete the diagnosis. Please retry." });
    writeEvent(res, "error", { message: "CampusFix could not complete the diagnosis. Please retry." });
    res.end();
  }
}

export async function recordPublicOutcome(req: Request, res: Response) {
  try {
    const { sessionId, visitorToken, outcome } = req.body ?? {};
    if (typeof sessionId !== "string" || typeof visitorToken !== "string" || !["resolved", "still_need_help"].includes(outcome)) return res.status(400).json({ error: "Invalid support outcome." });
    const db = await requireDb();
    const session = await db.select().from(publicSupportSessions).where(and(eq(publicSupportSessions.id, sessionId), eq(publicSupportSessions.visitorToken, visitorToken))).limit(1);
    if (!session[0]) return res.status(404).json({ error: "Support session not found." });
    await db.update(publicSupportSessions).set({ status: nextPublicSessionStatusForOutcome(outcome) }).where(eq(publicSupportSessions.id, sessionId));
    res.json({ success: true, outcome });
  } catch {
    res.status(500).json({ error: "CampusFix could not record the outcome." });
  }
}

export async function createPublicSupportTicket(req: Request, res: Response) {
  try {
    const { sessionId, visitorToken } = req.body ?? {};
    if (typeof sessionId !== "string" || typeof visitorToken !== "string") return res.status(400).json({ error: "Support session not found." });
    const db = await requireDb();
    const session = await db.select().from(publicSupportSessions).where(and(eq(publicSupportSessions.id, sessionId), eq(publicSupportSessions.visitorToken, visitorToken))).limit(1);
    if (!session[0]) return res.status(404).json({ error: "Support session not found." });
    if (!canCreatePublicTicket(session[0].status)) return res.status(409).json({ error: "Continue diagnosis or select ‘Not yet’ before creating an IT ticket." });
    const existing = await db.select().from(publicSupportTickets).where(eq(publicSupportTickets.sessionId, sessionId)).orderBy(desc(publicSupportTickets.createdAt)).limit(1);
    if (existing[0]) return res.json({ ticket: existing[0], reused: true });
    const history = await getSessionHistory(sessionId);
    const issue = history.filter(item => item.role === "user").map(item => item.content).join("\n").slice(0, 5000);
    const plan = await createPlan(issue, history as PublicMessage[]);
    const ticket = {
      id: nanoid(18),
      ticketNumber: `IT-${new Date().getFullYear()}-${nanoid(6).toUpperCase()}`,
      sessionId,
      title: `${plan.category.replace(/^./, char => char.toUpperCase())} support request`,
      description: issue || session[0].title,
      category: plan.category,
      priority: plan.priority,
      triageSummary: plan.intent.slice(0, 1000),
    };
    await db.insert(publicSupportTickets).values(ticket);
    await db.update(publicSupportSessions).set({ status: "escalated" }).where(eq(publicSupportSessions.id, sessionId));
    res.status(201).json({ ticket });
  } catch {
    res.status(500).json({ error: "CampusFix could not create the IT ticket." });
  }
}
