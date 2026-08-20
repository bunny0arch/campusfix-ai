export type VoiceHost = {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  speechSynthesis?: unknown;
};

export function getVoiceCapabilities(host?: VoiceHost) {
  return {
    input: Boolean(host?.SpeechRecognition || host?.webkitSpeechRecognition),
    output: Boolean(host?.speechSynthesis),
  };
}

export function voiceFallbackMessage(kind: "input" | "output" | "capture") {
  if (kind === "input") return "Voice input is not available here. You can still type your issue.";
  if (kind === "output") return "Spoken responses are unavailable in this browser.";
  return "Voice capture could not start. Check microphone access and try again.";
}
