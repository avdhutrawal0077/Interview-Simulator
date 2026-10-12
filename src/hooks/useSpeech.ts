import { useEffect, useRef, useState, useCallback } from "react";
import { SphereState } from "../types/interview";

interface UseSpeechProps {
  sessionId?: string;
  onFinalTranscript: (text: string) => void;
  onInterimTranscript: (text: string) => void;
  onMicStatus: (status: "active" | "blocked" | "unsupported" | "idle") => void;
  setSphereState: (state: SphereState) => void;
  isListening: boolean;
  setIsListening: (listening: boolean) => void;
}

const SpeechRecognitionAPI =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const hasSpeechRecognition = !!SpeechRecognitionAPI;

export function useSpeech({
  sessionId,
  onFinalTranscript,
  onInterimTranscript,
  onMicStatus,
  setSphereState,
  isListening,
  setIsListening,
}: UseSpeechProps) {
  const onFinalRef = useRef(onFinalTranscript);
  const onInterimRef = useRef(onInterimTranscript);
  const onMicStatusRef = useRef(onMicStatus);
  const setSphereStateRef = useRef(setSphereState);
  const setIsListeningRef = useRef(setIsListening);
  const isListeningRef = useRef(isListening);

  useEffect(() => { onFinalRef.current = onFinalTranscript; });
  useEffect(() => { onInterimRef.current = onInterimTranscript; });
  useEffect(() => { onMicStatusRef.current = onMicStatus; });
  useEffect(() => { setSphereStateRef.current = setSphereState; });
  useEffect(() => { setIsListeningRef.current = setIsListening; });
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const isSpeakingRef = useRef(false);
  const [liveAudioLevel, setLiveAudioLevel] = useState(0);

  const recognitionRef = useRef<any>(null);
  const recognitionActiveRef = useRef(false);

  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const vadIntervalRef = useRef<any>(null);
  const amplitudeIntervalRef = useRef<any>(null);

  const hasSpokenRef = useRef(false);
  const lastSpokenTimeRef = useRef(0);
  const speechStartTimeRef = useRef(0);
  const socketCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finalizeBeforeClose = useCallback(() => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN && hasSpokenRef.current) {
      try { socketRef.current.send(JSON.stringify({ type: "finalize" })); } catch { }
    }
  }, []);

  const stopDevicesOnly = useCallback(() => {
    if (amplitudeIntervalRef.current) { clearInterval(amplitudeIntervalRef.current); amplitudeIntervalRef.current = null; }
    if (vadIntervalRef.current) { clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; }
    if (mediaRecorderRef.current) {
      try { if (mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop(); } catch { }
      mediaRecorderRef.current = null;
    }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (audioContextRef.current) { try { audioContextRef.current.close(); } catch { } audioContextRef.current = null; }
    setLiveAudioLevel(0);
  }, []);

  const cleanupRecording = useCallback(() => {
    stopDevicesOnly();
    if (socketRef.current) {
      try {
        if (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING)
          socketRef.current.close();
      } catch { }
      socketRef.current = null;
    }
  }, [stopDevicesOnly]);

  const stopWebSpeech = useCallback(() => {
    recognitionActiveRef.current = false;
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch { } recognitionRef.current = null; }
    setLiveAudioLevel(0);
  }, []);

  const sendFinalize = useCallback(() => {
    if (!hasSpeechRecognition) finalizeBeforeClose();
  }, [finalizeBeforeClose]);

  useEffect(() => {
    if (!isListening) {
      if (hasSpeechRecognition) {
        stopWebSpeech();
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        if (amplitudeIntervalRef.current) { clearInterval(amplitudeIntervalRef.current); amplitudeIntervalRef.current = null; }
        if (audioContextRef.current) { try { audioContextRef.current.close(); } catch { } audioContextRef.current = null; }
      } else {
        stopDevicesOnly();
        if (socketCloseTimerRef.current) clearTimeout(socketCloseTimerRef.current);
        socketCloseTimerRef.current = setTimeout(() => {
          if (socketRef.current) {
            try { if (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING) socketRef.current.close(); } catch { }
            socketRef.current = null;
          }
          socketCloseTimerRef.current = null;
        }, 4000);
      }
      onMicStatusRef.current("idle");
      return;
    }

    if (socketCloseTimerRef.current) { clearTimeout(socketCloseTimerRef.current); socketCloseTimerRef.current = null; }

    if (hasSpeechRecognition) {
      // -- PATH A: Browser Web Speech API (Chrome/Edge/Safari) --
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.maxAlternatives = 1;
      recognitionRef.current = recognition;
      recognitionActiveRef.current = true;

      recognition.onresult = (event: any) => {
        let interimText = "";
        let finalText = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalText += t + " ";
          else interimText += t;
        }
        if (finalText.trim()) { onFinalRef.current(finalText.trim()); onInterimRef.current(""); }
        else if (interimText) onInterimRef.current(interimText);
      };

      recognition.onerror = (event: any) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          onMicStatusRef.current("blocked"); setIsListeningRef.current(false);
        } else if (event.error === "no-speech" && recognitionActiveRef.current && isListeningRef.current) {
          try { recognition.start(); } catch { }
        }
      };

      recognition.onend = () => {
        if (recognitionActiveRef.current && isListeningRef.current) { try { recognition.start(); } catch { } }
      };

      try { recognition.start(); onMicStatusRef.current("active"); }
      catch { onMicStatusRef.current("unsupported"); }

      // Amplitude tracking for sphere (separate stream, doesn't interfere with STT)
      navigator.mediaDevices?.getUserMedia({ audio: true, video: false }).then(stream => {
        if (!isListeningRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        audioContextRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        amplitudeIntervalRef.current = setInterval(() => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          setLiveAudioLevel(Math.min(1, (sum / data.length) / 80));
        }, 50);
      }).catch(() => { });

      return () => {
        stopWebSpeech();
        stopDevicesOnly();
        if (socketCloseTimerRef.current) { clearTimeout(socketCloseTimerRef.current); socketCloseTimerRef.current = null; }
      };

    } else {
      // -- PATH B: Gemini WebSocket fallback (Firefox etc.) --
      if (!navigator.mediaDevices?.getUserMedia) { onMicStatusRef.current("unsupported"); return; }

      let isCancelled = false;
      const startFallback = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          if (isCancelled) { stream.getTracks().forEach(t => t.stop()); return; }
          streamRef.current = stream;
          onMicStatusRef.current("active");

          const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
          const ws = new WebSocket(`${protocol}//${window.location.host}/ws/transcribe/${sessionId || "default"}`);
          socketRef.current = ws;
          ws.onopen = () => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "config", mimeType: "audio/webm" })); };
          ws.onmessage = (e) => { try { const d = JSON.parse(e.data); if (d.type === "interim" && d.text) onInterimRef.current(d.text); else if (d.type === "final" && d.text) { onFinalRef.current(d.text); onInterimRef.current(""); } } catch { } };
          ws.onerror = () => console.warn("[WS STT] error");

          let mimeType = "audio/webm;codecs=opus";
          if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
          const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
          mediaRecorderRef.current = recorder;
          recorder.ondataavailable = async (e) => { if (e.data && e.data.size > 0 && ws.readyState === WebSocket.OPEN) { try { ws.send(await e.data.arrayBuffer()); } catch { } } };
          recorder.start(250);

          const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
          if (AC) {
            const ctx = new AC();
            audioContextRef.current = ctx;
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            const bufferLength = analyser.frequencyBinCount;
            const data = new Uint8Array(bufferLength);
            hasSpokenRef.current = false; lastSpokenTimeRef.current = Date.now(); speechStartTimeRef.current = 0;

            vadIntervalRef.current = setInterval(() => {
              if (!analyser || ws.readyState !== WebSocket.OPEN) return;
              analyser.getByteFrequencyData(data);
              let sum = 0; for (let i = 0; i < bufferLength; i++) sum += data[i];
              const avg = sum / bufferLength;
              setLiveAudioLevel(Math.min(1, avg / 80));
              if (avg > 30) {
                if (speechStartTimeRef.current === 0) speechStartTimeRef.current = Date.now();
                else if (!hasSpokenRef.current && Date.now() - speechStartTimeRef.current >= 500) hasSpokenRef.current = true;
                lastSpokenTimeRef.current = Date.now();
              } else {
                speechStartTimeRef.current = 0;
                if (hasSpokenRef.current && Date.now() - lastSpokenTimeRef.current > 1100) { hasSpokenRef.current = false; try { ws.send(JSON.stringify({ type: "finalize" })); } catch { } }
              }
            }, 100);
          }
        } catch (err: any) {
          if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") { onMicStatusRef.current("blocked"); setIsListeningRef.current(false); }
          else onMicStatusRef.current("unsupported");
        }
      };

      startFallback();
      return () => {
        isCancelled = true;
        if (socketCloseTimerRef.current) { clearTimeout(socketCloseTimerRef.current); socketCloseTimerRef.current = null; }
        cleanupRecording();
      };
    }
  }, [isListening, sessionId, stopWebSpeech, stopDevicesOnly, cleanupRecording]);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) { setTimeout(() => setIsListeningRef.current(true), 0); return; }
    window.speechSynthesis.cancel();
    isSpeakingRef.current = true; setIsSpeaking(true);
    setSphereStateRef.current("speaking");
    setIsListeningRef.current(false);
    onMicStatusRef.current("idle");

    const cleanText = text.replace(/```[\s\S]*?```/g, "").replace(/`([^`]+)`/g, "$1").replace(/[*#_~]/g, "").trim();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 0.95; utterance.pitch = 1.0;

    const done = () => {
      isSpeakingRef.current = false; setIsSpeaking(false);
      setSphereStateRef.current("listening");
      setTimeout(() => setIsListeningRef.current(true), 0);
    };
    utterance.onend = done;
    utterance.onerror = (e) => { console.warn("[TTS]", e.error); done(); };

    const doSpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find(v => v.lang === "en-US" && v.name.toLowerCase().includes("google")) || voices.find(v => v.lang.startsWith("en"));
      if (v) utterance.voice = v;
      window.speechSynthesis.speak(utterance);
    };
    if (window.speechSynthesis.getVoices().length > 0) doSpeak();
    else window.speechSynthesis.addEventListener("voiceschanged", doSpeak, { once: true });
  }, []);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    isSpeakingRef.current = false; setIsSpeaking(false);
  }, []);

  return { speak, stopSpeaking, isSpeaking, sendFinalize, liveAudioLevel };
}
