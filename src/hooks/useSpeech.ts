import { useEffect, useRef, useState, useCallback } from 'react';
import { SphereState } from '../types/interview';

interface UseSpeechProps {
  sessionId?: string;
  onFinalTranscript: (text: string) => void;
  onInterimTranscript: (text: string) => void;
  onMicStatus: (status: 'active' | 'blocked' | 'unsupported' | 'idle') => void;
  setSphereState: (state: SphereState) => void;
  isListening: boolean;
  setIsListening: (listening: boolean) => void;
}

export function useSpeech({
  sessionId,
  onFinalTranscript,
  onInterimTranscript,
  onMicStatus,
  setSphereState,
  isListening,
  setIsListening,
}: UseSpeechProps) {
  // ── Keep ALL callbacks in refs to avoid stale closures ──
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

  // References for WebSocket & Audio Recording
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const vadIntervalRef = useRef<any>(null);

  // VAD tracking refs
  const hasSpokenRef = useRef(false);
  const lastSpokenTimeRef = useRef(0);

  // ── Helper to stop all audio recording and socket resources ──
  const cleanupRecording = useCallback(() => {
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }

    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch (e) { /* ignore */ }
      mediaRecorderRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch (e) { /* ignore */ }
      audioContextRef.current = null;
    }

    if (socketRef.current) {
      try {
        if (socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.close();
        }
      } catch (e) { /* ignore */ }
      socketRef.current = null;
    }
  }, []);

  // ── Start WebSocket and MediaRecorder when isListening becomes true ──
  useEffect(() => {
    if (!isListening || isSpeaking) {
      cleanupRecording();
      onMicStatusRef.current('idle');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      onMicStatusRef.current('unsupported');
      console.warn('[STT WebSocket] navigator.mediaDevices.getUserMedia not supported in this browser.');
      return;
    }

    let isCancelled = false;

    const startRecordingSession = async () => {
      try {
        // 1. Request microphone access
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        if (isCancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        onMicStatusRef.current('active');

        // 2. Open WebSocket connection to FastAPI
        // Use window.location.host (hostname + port) so the Vite dev proxy (port 3000)
        // transparently forwards /ws/* to the backend, and the built bundle on port 8000
        // connects directly. Never hardcode port 8000.
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/transcribe/${sessionId || 'default'}`;

        console.log(`[STT WebSocket] Connecting to ${wsUrl}`);
        const ws = new WebSocket(wsUrl);
        socketRef.current = ws;

        ws.onopen = () => {
          console.log('[STT WebSocket] Connected successfully');
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'config', mimeType: 'audio/webm' }));
          }
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'interim' && data.text) {
              onInterimRef.current(data.text);
            } else if (data.type === 'final' && data.text) {
              onFinalRef.current(data.text);
              onInterimRef.current('');
            }
          } catch (e) {
            console.error('[STT WebSocket] Error parsing incoming message:', e);
          }
        };

        ws.onerror = (err) => {
          console.warn('[STT WebSocket] WebSocket error:', err);
        };

        ws.onclose = () => {
          console.log('[STT WebSocket] Connection closed');
        };

        // 3. Setup MediaRecorder for streaming audio frames
        let mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
        }

        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = async (e) => {
          if (e.data && e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            try {
              const buffer = await e.data.arrayBuffer();
              ws.send(buffer);
            } catch (err) {
              console.warn('[STT WebSocket] Failed to send audio chunk:', err);
            }
          }
        };

        // Send slices every 250ms for low-latency streaming
        recorder.start(250);

        // 4. Setup AudioContext + AnalyserNode for Client-side VAD (Voice Activity Detection)
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioContextClass) {
            const audioCtx = new AudioContextClass();
            audioContextRef.current = audioCtx;
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            hasSpokenRef.current = false;
            lastSpokenTimeRef.current = Date.now();

            vadIntervalRef.current = setInterval(() => {
              if (!analyser || ws.readyState !== WebSocket.OPEN) return;

              analyser.getByteFrequencyData(dataArray);
              let sum = 0;
              for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
              }
              const avgVolume = sum / bufferLength;

              // Threshold for detected speech energy
              if (avgVolume > 14) {
                hasSpokenRef.current = true;
                lastSpokenTimeRef.current = Date.now();
              } else if (hasSpokenRef.current && Date.now() - lastSpokenTimeRef.current > 1100) {
                // Pause detected (>1.1s of silence after speech): finalize current utterance
                hasSpokenRef.current = false;
                ws.send(JSON.stringify({ type: 'finalize' }));
              }
            }, 100);
          }
        } catch (vadErr) {
          console.warn('[STT VAD] Could not initialize volume monitor:', vadErr);
        }

      } catch (err: any) {
        console.error('[STT WebSocket] Microphone initialization error:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          onMicStatusRef.current('blocked');
          setIsListeningRef.current(false);
        } else {
          onMicStatusRef.current('unsupported');
        }
      }
    };

    startRecordingSession();

    return () => {
      isCancelled = true;
      cleanupRecording();
    };
  }, [isListening, isSpeaking, sessionId, cleanupRecording]);

  // ── TTS (Text-to-Speech) using Browser SpeechSynthesis ──────────────────────
  const speak = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) {
      setIsListeningRef.current(true);
      return;
    }

    window.speechSynthesis.cancel();
    isSpeakingRef.current = true;
    setIsSpeaking(true);
    setSphereStateRef.current('speaking');
    setIsListeningRef.current(false);
    onMicStatusRef.current('idle');

    const cleanText = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[*#_~]/g, '')
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 0.95;
    utterance.pitch = 1.0;

    const done = () => {
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      setSphereStateRef.current('listening');
      setIsListeningRef.current(true); // auto-open mic after TTS
    };

    utterance.onend = done;
    utterance.onerror = (e) => {
      console.warn('[TTS] Error:', e.error);
      done();
    };

    const doSpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      const v =
        voices.find((v) => v.lang === 'en-US' && v.name.toLowerCase().includes('google')) ||
        voices.find((v) => v.lang.startsWith('en'));
      if (v) utterance.voice = v;
      window.speechSynthesis.speak(utterance);
    };

    if (window.speechSynthesis.getVoices().length > 0) {
      doSpeak();
    } else {
      window.speechSynthesis.addEventListener('voiceschanged', doSpeak, { once: true });
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    isSpeakingRef.current = false;
    setIsSpeaking(false);
  }, []);

  return { speak, stopSpeaking, isSpeaking };
}
