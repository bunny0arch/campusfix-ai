import { Button } from "@/components/ui/button";
import { Check, ChevronRight, CircleHelp, Headphones, Loader2, Mic, MicOff, Radio, RefreshCw, Send, ShieldCheck, Sparkles, Ticket, Volume2, Wifi, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { streamPublicDiagnosis, type PublicStreamEvent } from "@/lib/public-support-stream";
import { getVoiceCapabilities, voiceFallbackMessage } from "@/lib/voice-support";

type Stage = "clarify" | "retrieve" | "guide" | "check" | "escalate";
type ChatMessage = { id: string; role: "assistant" | "user"; content: string; citations?: Array<{ title: string; sourceUrl?: string | null }> };

type SpeechRecognitionCtor = new () => {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const stages: Array<{ id: Stage; label: string; detail: string }> = [
  { id: "clarify", label: "Understand", detail: "One useful question" },
  { id: "retrieve", label: "Verify", detail: "Knowledge first" },
  { id: "guide", label: "Guide", detail: "Safe next steps" },
  { id: "check", label: "Confirm", detail: "Did it work?" },
  { id: "escalate", label: "Escalate", detail: "Human IT when needed" },
];

const starters = [
  { label: "Wi-Fi will not connect", icon: Wifi, prompt: "Campus Wi-Fi will not connect on my device." },
  { label: "I cannot access my account", icon: CircleHelp, prompt: "I cannot sign in to a campus service." },
  { label: "Printer is unavailable", icon: Wrench, prompt: "The campus printer is unavailable for me." },
];

function AssistantText({ content }: { content: string }) {
  return <>{content.split("\n").map((line, index) => {
    const formatted = line.split(/(\*\*[^*]+\*\*)/g).map((part, partIndex) => part.startsWith("**") && part.endsWith("**") ? <strong key={partIndex}>{part.slice(2, -2)}</strong> : part);
    return line.match(/^\d+\.\s/) ? <div className="step-line" key={index}>{formatted}</div> : <p key={index}>{formatted || "\u00A0"}</p>;
  })}</>;
}

function visitorToken() {
  const key = "campusfix-public-visitor";
  const current = localStorage.getItem(key);
  if (current) return current;
  const next = crypto.randomUUID();
  localStorage.setItem(key, next);
  return next;
}

export default function PublicSupport() {
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: "welcome", role: "assistant", content: "**Describe what is not working.** I will ask one useful question at a time, check verified IT guidance, and only create an IT ticket if the problem cannot be safely resolved here." }]);
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState<string>();
  const [stage, setStage] = useState<Stage>("clarify");
  const [status, setStatus] = useState("Ready when you are");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [canEscalate, setCanEscalate] = useState(false);
  const [ticketNumber, setTicketNumber] = useState<string>();
  const [resolved, setResolved] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);
  const token = useMemo(() => visitorToken(), []);
  const activeStageIndex = stages.findIndex(item => item.id === stage);

  useEffect(() => { contentRef.current?.scrollTo({ top: contentRef.current.scrollHeight, behavior: "smooth" }); }, [messages, isStreaming]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const speakLatest = () => {
    const text = [...messages].reverse().find(message => message.role === "assistant")?.content.replace(/[*#_]/g, " ");
    if (!text || !getVoiceCapabilities(window).output) return toast.error(voiceFallbackMessage("output"));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  };

  const toggleVoice = () => {
    const SpeechRecognition = (window as typeof window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition || (window as typeof window & { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;
    if (!getVoiceCapabilities(window).input || !SpeechRecognition) return toast.error(voiceFallbackMessage("input"));
    if (isListening) { recognitionRef.current?.stop(); return; }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = event => setDraft(event.results[0]?.[0]?.transcript ?? "");
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => { setIsListening(false); toast.error(voiceFallbackMessage("capture")); };
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const handleEvent = (event: PublicStreamEvent, placeholderId: string) => {
    if (event.type === "session") setSessionId(event.sessionId);
    if (event.type === "status") setStatus(event.label);
    if (event.type === "stage") { setStage(event.stage); setStatus(event.intent); }
    if (event.type === "token") setMessages(current => current.map(message => message.id === placeholderId ? { ...message, content: message.content + event.delta } : message));
    if (event.type === "complete") {
      setStage(event.stage); setCanEscalate(event.canEscalate); setStatus(event.stage === "escalate" ? "IT handoff recommended" : "Waiting for your outcome");
      setMessages(current => current.map(message => message.id === placeholderId ? { ...message, citations: event.citations } : message));
    }
    if (event.type === "error") toast.error(event.message);
  };

  const submit = async (prompt = draft) => {
    const clean = prompt.trim();
    if (!clean || isStreaming) return;
    const placeholderId = `assistant-${Date.now()}`;
    setMessages(current => [...current, { id: `user-${Date.now()}`, role: "user", content: clean }, { id: placeholderId, role: "assistant", content: "" }]);
    setDraft(""); setResolved(false); setTicketNumber(undefined); setIsStreaming(true); setStatus("Understanding the issue");
    try { await streamPublicDiagnosis({ message: clean, visitorToken: token, sessionId }, event => handleEvent(event, placeholderId)); }
    catch (error) { setMessages(current => current.filter(message => message.id !== placeholderId)); toast.error(error instanceof Error ? error.message : "CampusFix could not start."); }
    finally { setIsStreaming(false); }
  };

  const recordOutcome = async (outcome: "resolved" | "still_need_help") => {
    if (!sessionId) return;
    const response = await fetch("/api/campusfix/public/outcome", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, visitorToken: token, outcome }) });
    if (!response.ok) return toast.error("The outcome could not be saved.");
    if (outcome === "resolved") { setResolved(true); setStatus("Resolved — session recorded"); toast.success("Great — the resolution has been recorded."); }
    else { setCanEscalate(true); setStatus("An IT ticket can now be created"); }
  };

  const createTicket = async () => {
    if (!sessionId || ticketNumber) return;
    const response = await fetch("/api/campusfix/public/ticket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, visitorToken: token }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return toast.error(payload.error || "The IT ticket could not be created.");
    setTicketNumber(payload.ticket.ticketNumber); setStage("escalate"); setStatus("Ticket created and queued for IT"); toast.success(`IT ticket ${payload.ticket.ticketNumber} created.`);
  };

  return <main className="support-shell">
    <div className="support-noise" aria-hidden="true" />
    <header className="support-header">
      <div className="brand-lockup"><span className="brand-orbit"><span /></span><span>CampusFix</span><span className="brand-subtitle">IT support, simplified</span></div>
      <div className="header-status"><span className="live-pulse" /> Autonomous first-level support <span className="header-divider" /> No sign-in required</div>
    </header>

    <section className="support-intro motion-enter">
      <div><p className="section-kicker">UNIVERSITY IT SERVICE DESK</p><h1>Fix the everyday stuff.<br /><em>Fast, safely, together.</em></h1></div>
      <p className="intro-copy">CampusFix diagnoses common IT issues without asking for passwords or credentials. It uses verified guidance, reversible steps, and a direct handoff to IT when the issue needs a person.</p>
    </section>

    <section className="support-grid motion-enter" aria-label="CampusFix diagnostic workspace">
      <div className="conversation-panel">
        <div className="panel-topbar"><div><p className="panel-label">LIVE DIAGNOSIS</p><p className="panel-status"><Radio size={13} /> {status}</p></div><Button variant="ghost" size="icon" className="utility-button" onClick={speakLatest} aria-label="Read last assistant message aloud"><Volume2 size={17} /></Button></div>
        <div className="conversation-stream" ref={contentRef} aria-live="polite">
          {messages.map(message => <article key={message.id} className={`message-row message-enter ${message.role}`}>
            {message.role === "assistant" && <div className="message-mark"><Sparkles size={14} /></div>}
            <div className="message-copy">{message.content ? <AssistantText content={message.content} /> : <span className="typing-wave"><i /><i /><i /></span>}{message.citations?.length ? <div className="citation-row">{message.citations.map(citation => citation.sourceUrl ? <a key={citation.title} href={citation.sourceUrl} target="_blank" rel="noreferrer">Source · {citation.title} <ChevronRight size={12} /></a> : <span key={citation.title}>Source · {citation.title}</span>)}</div> : null}</div>
          </article>)}
        </div>
        <div className="quick-starts" aria-label="Common IT issues">{starters.map(item => <button key={item.label} className="starter-chip" onClick={() => submit(item.prompt)} disabled={isStreaming}><item.icon size={14} />{item.label}</button>)}</div>
        <div className="composer-wrap"><textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder="Describe the issue — no passwords or private codes." rows={2} disabled={isStreaming} aria-label="Describe the IT issue" /><div className="composer-actions"><button className={`voice-toggle ${isListening ? "listening" : ""}`} onClick={toggleVoice} type="button" aria-label={isListening ? "Stop voice input" : "Use voice input"}>{isListening ? <MicOff size={17} /> : <Mic size={17} />}<span>{isListening ? "Listening" : "Voice"}</span></button><Button className="send-button" onClick={() => submit()} disabled={!draft.trim() || isStreaming}>{isStreaming ? <Loader2 className="animate-spin" size={17} /> : <Send size={17} />}<span>Send</span></Button></div></div>
      </div>

      <aside className="diagnostic-rail">
        <section className="rail-card diagnosis-card"><div className="rail-heading"><span className="rail-icon"><Headphones size={16} /></span><div><p className="panel-label">DIAGNOSIS FLOW</p><p className="rail-title">One clear step at a time</p></div></div><div className="stage-list">{stages.map((item, index) => <div key={item.id} className={`stage-item ${index <= activeStageIndex ? "active" : ""} ${item.id === stage ? "current" : ""}`}><span className="stage-number">{index < activeStageIndex ? <Check size={12} /> : `0${index + 1}`}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div></div>)}</div></section>
        <section className="rail-card safety-card"><ShieldCheck size={18} /><div><p className="panel-label">SAFETY BY DESIGN</p><p>Never asks for passwords, MFA codes, or recovery codes. It will not recommend unsafe network or system changes.</p></div></section>
        <section className="rail-card outcome-card"><p className="panel-label">OUTCOME CHECK</p>{ticketNumber ? <div className="ticket-created"><Ticket size={18} /><div><strong>{ticketNumber}</strong><span>Your IT request is queued.</span></div></div> : resolved ? <div className="resolved-state"><Check size={18} /> Resolved and recorded</div> : <><p>Did the last step solve it?</p><div className="outcome-actions"><button onClick={() => recordOutcome("resolved")} disabled={!sessionId || isStreaming}>Yes, fixed</button><button onClick={() => recordOutcome("still_need_help")} disabled={!sessionId || isStreaming}>Not yet</button></div>{canEscalate && <Button onClick={createTicket} className="escalate-button"><Ticket size={16} />Create IT ticket</Button>}</>}</section>
      </aside>
    </section>

    <footer className="support-footer"><span>CampusFix is a first-level IT assistant. It cannot access your account or device.</span><span><RefreshCw size={13} /> Reversible support only</span></footer>
  </main>;
}
