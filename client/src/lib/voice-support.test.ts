import { describe, expect, it } from "vitest";
import { getVoiceCapabilities, voiceFallbackMessage } from "./voice-support";

describe("public support voice capability fallbacks", () => {
  it("reports independent browser support for voice input and output", () => {
    expect(getVoiceCapabilities({})).toEqual({ input: false, output: false });
    expect(getVoiceCapabilities({ webkitSpeechRecognition: {}, speechSynthesis: {} })).toEqual({ input: true, output: true });
  });

  it("keeps every fallback understandable and typed-support safe", () => {
    expect(voiceFallbackMessage("input")).toContain("still type");
    expect(voiceFallbackMessage("output")).toContain("unavailable");
    expect(voiceFallbackMessage("capture")).toContain("microphone access");
  });
});
