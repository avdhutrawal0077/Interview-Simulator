/**
 * src/hooks/useSpeech.ts
 * ──────────────────────
 * Local Streaming STT — WebSocket + PCM AudioWorklet + Whisper backend.
 *
 * This works correctly because the interview is only started AFTER the
 * backend `/health` endpoint confirms `stt_ready: true`. The WS connects
 * to an already-loaded model, so `ready` arrives in < 1s and there is no
 * model-loading delay during the interview itself.
 *
 * Architecture:
 *  • One persistent AudioContext + MediaStream per session (not per-turn).
 *  • PCM AudioWorklet → raw PCM16LE 16 kHz frames → reconnecting WebSocket.
 *  • Muting gates frame dispatch; hardware stays alive.
 *  • Pure transcript reducer with monotonic seq ordering.
 *  • 30 s ring buffer — full replay sent on WS `ready` so no audio is lost
 *    even during the brief WS handshake window.
 *  • Exponential-backoff WebSocket reconnection.
 *  • TTS gate: frames suppressed during speechSynthesis + 400 ms tail.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SphereState } from "../types/interview";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MicStatus =
  | "idle"
  | "active"
  | "blocked"
  | "unsupported"
  | "reconnecting"
  | "model_loading";

interface UseSpeechProps {
  sessionId?: string;
  onFinalTranscript: (text: string) => void;
  onInterimTranscript: (text: string) => void;
  onMicStatus: (status: MicStatus) => void;
  setSphereState: (state: SphereState) => void;
  isListening: boolean;
  setIsListening: (listening: boolean) => void;
}

// ─── Transcript reducer ───────────────────────────────────────────────────────

interface TranscriptState {
  committedText: string;
  interimText: string;
  lastFinalSeq: number;
}

type TranscriptAction =
  | { type: "FINAL"; text: string; seq: number }
  | { type: "INTERIM"; text: string; seq: number }
  | { type: "CLEAR" };

function transcriptReducer(
  state: TranscriptState,
  action: TranscriptAction
): TranscriptState {
  switch (action.type) {
    case "FINAL":
      return {
        committedText: state.committedText
          ? state.committedText + " " + action.text
          : action.text,
        interimText: "",
        lastFinalSeq: action.seq,
      };
    case "INTERIM":
      if (action.seq <= state.lastFinalSeq) return state;
      return { ...state, interimText: action.text };
    case "CLEAR":
      return { committedText: "", interimText: "", lastFinalSeq: 0 };
    default:
      return state;
  }
}

// ─── Ring buffer (30 s × 16 kHz × 2 bytes) ───────────────────────────────────

const RING_BUFFER_CAPACITY = 30 * 16000 * 2;

class PcmRingBuffer {
  private buf: Uint8Array;
  private writePos = 0;
  private totalMs = 0;
  readonly capacity: number;

  constructor(capacity = RING_BUFFER_CAPACITY) {
    this.capacity = capacity;
    this.buf = new Uint8Array(capacity);
  }

  push(frame: ArrayBuffer): void {
    const bytes = new Uint8Array(frame);
    for (let i = 0; i < bytes.length; i++) {
      this.buf[this.writePos % this.capacity] = bytes[i];
      this.writePos++;
    }
    this.totalMs += Math.round((bytes.length / 2 / 16000) * 1000);
  }

  /** Return all bytes from `fromMs` ms offset onward (chronological order). */
  bytesAfter(fromMs: number): Uint8Array {
    const bytesPerMs = (16000 * 2) / 1000;
    const byteOffset = Math.floor(fromMs * bytesPerMs);
    const available = Math.min(this.writePos, this.capacity) - byteOffset;
    if (available <= 0) return new Uint8Array(0);
    const startIdx = this.writePos - available;
    const result = new Uint8Array(available);
    for (let i = 0; i < available; i++) {
      result[i] = this.buf[(startIdx + i) % this.capacity];
    }
    return result;
  }

  get durationMs(): number {
    return this.totalMs;
  }
}

// ─── WebSocket constants ──────────────────────────────────────────────────────

const WS_PING_INTERVAL_MS  = 15_000;
const WS_RECONNECT_BASE_MS = 500;
const WS_RECONNECT_MAX_MS  = 8_000;
const WS_MAX_RETRIES       = 10;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSpeech({
  sessionId,
  onFinalTranscript,
  onInterimTranscript,
  onMicStatus,
  setSphereState,
  isListening,
  setIsListening,
}: UseSpeechProps) {
  // Stable callback refs
  const onFinalRef        = useRef(onFinalTranscript);
  const onInterimRef      = useRef(onInterimTranscript);
  const onMicStatusRef    = useRef(onMicStatus);
  const setSphereRef      = useRef(setSphereState);
  const setIsListeningRef = useRef(setIsListening);
  const isListeningRef    = useRef(isListening);
  useEffect(() => { onFinalRef.current       = onFinalTranscript; });
  useEffect(() => { onInterimRef.current     = onInterimTranscript; });
  useEffect(() => { onMicStatusRef.current   = onMicStatus; });
  useEffect(() => { setSphereRef.current     = setSphereState; });
  useEffect(() => { setIsListeningRef.current = setIsListening; });
  useEffect(() => { isListeningRef.current   = isListening; }, [isListening]);

  // Transcript reducer (pure, no React state — avoids render loops)
  const transcriptRef = useRef<TranscriptState>({
    committedText: "",
    interimText: "",
    lastFinalSeq: 0,
  });

  const dispatchTranscript = useCallback((action: TranscriptAction) => {
    const next = transcriptReducer(transcriptRef.current, action);
    transcriptRef.current = next;
    if (action.type === "FINAL") {
      onFinalRef.current(next.committedText);
      // Only clear the interim display if we have committed text
      // (avoids a race where an empty FINAL wipes user's typed text)
      if (next.committedText) {
        onInterimRef.current("");
      }
    } else if (action.type === "INTERIM") {
      // Build the combined display string
      const display = next.committedText
        ? next.committedText + " " + next.interimText
        : next.interimText;
      // NEVER emit an empty string — it would wipe the input box
      if (display.trim()) {
        onInterimRef.current(display);
      }
    }
  }, []);

  // Audio hardware refs
  const audioCtxRef       = useRef<AudioContext | null>(null);
  const streamRef         = useRef<MediaStream | null>(null);
  const workletNodeRef    = useRef<AudioWorkletNode | null>(null);
  const analyserRef       = useRef<AnalyserNode | null>(null);
  const amplitudeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hardwareReadyRef  = useRef(false);

  // WebSocket refs
  const wsRef             = useRef<WebSocket | null>(null);
  const wsReadyRef        = useRef(false);
  const retryCountRef     = useRef(0);
  const retryTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectingRef   = useRef(false);
  const sessionActiveRef  = useRef(false);

  // Frame queue (small buffer for the brief WS handshake window)
  const frameQueueRef = useRef<ArrayBuffer[]>([]);
  // 3000 frames × 32 ms = 96 s — more than enough for any handshake delay
  const MAX_QUEUE = 3000;

  // 30 s ring buffer — full contents replayed on WS `ready`
  const ringRef = useRef(new PcmRingBuffer());

  // TTS gate
  const ttsMutedRef      = useRef(false);
  const ttsTailTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isSpeaking, setIsSpeaking]         = useState(false);
  const [liveAudioLevel, setLiveAudioLevel] = useState(0);

  // ─── Send PCM frame ─────────────────────────────────────────────────────────

  const sendFrame = useCallback((frame: ArrayBuffer) => {
    ringRef.current.push(frame);
    if (!wsReadyRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      if (frameQueueRef.current.length < MAX_QUEUE) {
        frameQueueRef.current.push(frame);
      }
      return;
    }
    try {
      wsRef.current.send(frame);
    } catch {
      frameQueueRef.current.push(frame);
    }
  }, []);

  // ─── WebSocket connection ────────────────────────────────────────────────────

  const connectWS = useCallback((resumeFromMs = 0) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const wsHost = window.location.port === "3000"
      ? `${window.location.hostname}:8000`
      : window.location.host;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${wsHost}/ws/transcribe/${sessionId || "default"}`;
    console.log("[STT Client] Connecting to WebSocket:", url);
    const ws = new WebSocket(url);
    wsRef.current  = ws;
    wsReadyRef.current = false;

    ws.onopen = () => {
      console.log("[STT Client] WebSocket connected! Handshaking with STT server...");
      ws.send(JSON.stringify({ type: "start", sampleRate: 16000 }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);

        if (msg.type === "ready") {
          console.log("[STT Client] STT server is READY — audio transmission active!");
          wsReadyRef.current    = true;
          reconnectingRef.current = false;
          retryCountRef.current  = 0;
          onMicStatusRef.current("active");

          // Replay ALL buffered audio from the ring buffer.
          const replayMs    = msg.resume_from_ms ?? resumeFromMs;
          const ringDuration = ringRef.current.durationMs;
          if (ringDuration > 0) {
            const replayFrom = (replayMs > 0 && replayMs < ringDuration) ? replayMs : 0;
            const buffered   = ringRef.current.bytesAfter(replayFrom);
            if (buffered.length > 0 && ws.readyState === WebSocket.OPEN) {
              console.log(`[STT Client] Replaying ${buffered.length} bytes of pre-buffered audio`);
              ws.send(buffered.buffer);
            }
          }
          // Clear frame queue — ring buffer replay covers everything
          frameQueueRef.current = [];

        } else if (msg.type === "loading") {
          console.log("[STT Client] Server model loading...");
          onMicStatusRef.current("model_loading");

        } else if (msg.type === "final" && msg.text) {
          console.log("[STT Client] Final transcript:", msg.text);
          dispatchTranscript({ type: "FINAL", text: msg.text, seq: msg.seq ?? 0 });
        } else if (msg.type === "interim" && msg.text) {
          console.log("[STT Client] Interim transcript:", msg.text);
          dispatchTranscript({ type: "INTERIM", text: msg.text, seq: msg.seq ?? 0 });
        } else if (msg.type === "pong") {
          /* heartbeat */
        } else if (msg.type === "error") {
          console.warn("[STT Client] Server error:", msg);
        }
      } catch {
        // non-JSON — ignore
      }
    };

    ws.onerror = () => console.warn("[WS STT] socket error");

    ws.onclose = () => {
      wsReadyRef.current = false;
      if (!sessionActiveRef.current) return;
      reconnectingRef.current = true;
      onMicStatusRef.current("reconnecting");
      retryCountRef.current++;
      if (retryCountRef.current > WS_MAX_RETRIES) {
        onMicStatusRef.current("unsupported");
        return;
      }
      const delay = Math.min(
        WS_RECONNECT_BASE_MS * 2 ** (retryCountRef.current - 1),
        WS_RECONNECT_MAX_MS
      );
      retryTimerRef.current = setTimeout(() => {
        if (sessionActiveRef.current) connectWS(ringRef.current.durationMs);
      }, delay);
    };

    // Keepalive pings
    if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    pingTimerRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try { wsRef.current.send(JSON.stringify({ type: "ping" })); } catch {}
      }
    }, WS_PING_INTERVAL_MS);
  }, [sessionId, dispatchTranscript]);

  // ─── Audio hardware (init once per session) ──────────────────────────────────

  const initHardware = useCallback(async () => {
    if (hardwareReadyRef.current) return;

    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) { onMicStatusRef.current("unsupported"); return; }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;

    const ctx: AudioContext = new AC();
    audioCtxRef.current = ctx;

    // Browsers often create AudioContext in suspended state until explicitly resumed
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
        console.log("[STT Client] AudioContext resumed, state:", ctx.state);
      } catch (err) {
        console.warn("[STT Client] AudioContext resume failed:", err);
      }
    }

    await ctx.audioWorklet.addModule("/pcm-worklet.js");
    const workletNode = new AudioWorkletNode(ctx, "pcm-processor");
    workletNodeRef.current = workletNode;

    // NOTE: No isListeningRef gate here — worklet muting is handled exclusively
    // by setWorkletMuted() which messages the audio thread directly.
    workletNode.port.onmessage = (e: MessageEvent) => {
      if (ttsMutedRef.current) return;
      sendFrame(e.data as ArrayBuffer);
    };

    const source  = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;
    source.connect(workletNode);
    source.connect(analyser);
    workletNode.connect(ctx.destination);

    const data = new Uint8Array(analyser.frequencyBinCount);
    amplitudeTimerRef.current = setInterval(() => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      setLiveAudioLevel(Math.min(1, sum / data.length / 80));
    }, 50);

    hardwareReadyRef.current = true;
  }, [sendFrame]);

  // ─── Mute / unmute worklet ────────────────────────────────────────────────────

  const setWorkletMuted = useCallback((muted: boolean) => {
    workletNodeRef.current?.port.postMessage({ type: muted ? "mute" : "unmute" });
  }, []);

  // ─── Session start / stop ─────────────────────────────────────────────────────

  const startSession = useCallback(async () => {
    sessionActiveRef.current = true;
    retryCountRef.current    = 0;
    frameQueueRef.current    = [];
    ringRef.current          = new PcmRingBuffer();

    try {
      await initHardware();
      if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }
    } catch (err: any) {
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        onMicStatusRef.current("blocked");
        setIsListeningRef.current(false);
      } else {
        onMicStatusRef.current("unsupported");
      }
      return;
    }

    setWorkletMuted(false);
    connectWS(0);
  }, [initHardware, connectWS, setWorkletMuted]);

  const stopSession = useCallback(async () => {
    sessionActiveRef.current = false;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try { wsRef.current.send(JSON.stringify({ type: "stop" })); } catch {}
      await new Promise(r => setTimeout(r, 200));
    }

    if (pingTimerRef.current)  { clearInterval(pingTimerRef.current);  pingTimerRef.current = null; }
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current);  retryTimerRef.current = null; }
    try { wsRef.current?.close(); } catch {}
    wsRef.current  = null;
    wsReadyRef.current = false;

    if (amplitudeTimerRef.current) { clearInterval(amplitudeTimerRef.current); amplitudeTimerRef.current = null; }
    try { workletNodeRef.current?.disconnect(); } catch {}
    workletNodeRef.current = null;
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current  = null;
    analyserRef.current = null;
    hardwareReadyRef.current = false;

    setLiveAudioLevel(0);
    onMicStatusRef.current("idle");
  }, []);

  // ─── flushAndStop (called when user toggles mic off) ─────────────────────────

  const flushAndStop = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try { wsRef.current.send(JSON.stringify({ type: "finalize" })); } catch {}
    }
    setWorkletMuted(true);
    onMicStatusRef.current("idle");
  }, [setWorkletMuted]);

  // ─── React to isListening changes ────────────────────────────────────────────

  useEffect(() => {
    if (isListening) {
      setSphereRef.current("listening");
      if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {});
      }
      if (!sessionActiveRef.current) {
        startSession();
      } else {
        setWorkletMuted(false);
        onMicStatusRef.current("active");
      }
    } else {
      if (sessionActiveRef.current && hardwareReadyRef.current) {
        setWorkletMuted(true);
        onMicStatusRef.current("idle");
      }
    }
  }, [isListening, startSession, setWorkletMuted]);

  // ─── Cleanup on unmount ──────────────────────────────────────────────────────

  useEffect(() => {
    return () => { stopSession(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── TTS: speak() and stopSpeaking() ─────────────────────────────────────────

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) {
      setTimeout(() => setIsListeningRef.current(true), 0);
      return;
    }

    window.speechSynthesis.cancel();
    setIsSpeaking(true);
    setSphereRef.current("speaking");
    setIsListeningRef.current(false);
    onMicStatusRef.current("idle");

    ttsMutedRef.current = true;
    setWorkletMuted(true);

    const cleanText = text
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[*#_~]/g, "")
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate  = 0.95;
    utterance.pitch = 1.0;

    let completed = false;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    const done = () => {
      if (completed) return;
      completed = true;
      if (safetyTimer) clearTimeout(safetyTimer);
      setIsSpeaking(false);
      setSphereRef.current("listening");
      if (ttsTailTimerRef.current) clearTimeout(ttsTailTimerRef.current);
      ttsTailTimerRef.current = setTimeout(() => {
        ttsMutedRef.current = false;
        setWorkletMuted(false);
        setTimeout(() => setIsListeningRef.current(true), 0);
      }, 400);
    };

    // Safety timeout: if browser speech synthesis hangs, auto-unmute so user can answer
    const wordCount = cleanText.split(/\s+/).length;
    const maxSpeechMs = Math.max(8000, (wordCount / 2) * 1000 + 4000);
    safetyTimer = setTimeout(() => {
      console.warn("[TTS] Completion timeout safety triggered — unmuting mic");
      done();
    }, maxSpeechMs);

    utterance.onend   = done;
    utterance.onerror = (e) => { console.warn("[TTS]", e.error); done(); };

    const doSpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      const v =
        voices.find(v => v.lang === "en-US" && v.name.toLowerCase().includes("google")) ||
        voices.find(v => v.lang.startsWith("en"));
      if (v) utterance.voice = v;
      window.speechSynthesis.speak(utterance);
    };

    if (window.speechSynthesis.getVoices().length > 0) doSpeak();
    else window.speechSynthesis.addEventListener("voiceschanged", doSpeak, { once: true });
  }, [setWorkletMuted]);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
    ttsMutedRef.current = false;
    setWorkletMuted(false);
  }, [setWorkletMuted]);

  // ─── clearTranscript (called on turn submission) ──────────────────────────────

  const clearTranscript = useCallback(() => {
    transcriptRef.current = { committedText: "", interimText: "", lastFinalSeq: 0 };
  }, []);

  return {
    speak,
    stopSpeaking,
    isSpeaking,
    flushAndStop,
    clearTranscript,
    liveAudioLevel,
  };
}
