import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { InterviewShell } from './components/InterviewShell';
import { LandingShell } from './components/LandingShell';
import { Message, JobRole, SessionSummary, SphereState, CategoryScores, AiDebrief } from './types/interview';
import { generateSessionId, saveSession } from './utils/sessionStorage';
import { api } from './services/api';
import { useMediaPipe } from './hooks/useMediaPipe';
import { useSpeech } from './hooks/useSpeech';

/** Interview page — receives resumeFile, role, sessionId & initialQuestion via location state */
function InterviewPage() {
  const location = useLocation();
  const navigate = useNavigate();

  // Read state passed from LandingShell
  const locationState = location.state as {
    resumeFile?: File;
    role?: JobRole;
    sessionId?: string;
    initialQuestion?: string;
    totalQuestions?: number;
  } | null;

  const role: JobRole = locationState?.role ?? 'Software Engineer';
  const sessionId = useMemo(() => locationState?.sessionId ?? generateSessionId(), [locationState?.sessionId]);
  const sessionDate = useMemo(() => new Date().toISOString(), []);

  const [questionIndex, setQuestionIndex] = useState(1);
  const [totalQuestions, setTotalQuestions] = useState(locationState?.totalQuestions ?? 8);
  const [isListening, setIsListening] = useState(false); // Initially false, starts after TTS speaks
  const [messages, setMessages] = useState<Message[]>([]);
  const [showEndConfirmation, setShowEndConfirmation] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sphereState, setSphereState] = useState<SphereState>('idle');
  const [inputText, setInputText] = useState('');

  // Video Ref for MediaPipe Webcam Feed
  const videoRef = useRef<HTMLVideoElement>(null);

  // Initialize MediaPipe Vision Tracking Hook
  const {
    resetTurnMetrics,
    getAggregatedMetrics,
  } = useMediaPipe({
    active: !showEndConfirmation && !isSubmitting,
    videoRef,
  });

  // Separate committed (finalized) and interim (live preview) transcript text
  const committedTextRef = useRef('');
  const [micStatus, setMicStatus] = useState<'active' | 'blocked' | 'unsupported' | 'idle'>('idle');

  // Initialize Speech Audio Hook (STT & TTS)
  const { speak, stopSpeaking, sendFinalize } = useSpeech({
    sessionId,
    onFinalTranscript: useCallback((text: string) => {
      // Append each finalized word chunk to committed text
      committedTextRef.current = committedTextRef.current
        ? committedTextRef.current + ' ' + text
        : text;
      setInputText(committedTextRef.current);
    }, []),
    onInterimTranscript: useCallback((text: string) => {
      // Show live preview: committed words + current in-progress speech
      const preview = committedTextRef.current
        ? committedTextRef.current + ' ' + text
        : text;
      setInputText(preview);
    }, []),
    onMicStatus: setMicStatus,
    setSphereState,
    isListening,
    setIsListening,
  });

  // Track turn scores for final report synthesis
  const [scoresHistory, setScoresHistory] = useState<{
    tech: number[];
    comm: number[];
    conf: number[];
  }>({
    tech: [],
    comm: [],
    conf: [],
  });

  const initializedRef = useRef(false);

  // Initialize initial question on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const initQuestion = async () => {
      let qText = locationState?.initialQuestion;
      if (!qText) {
        try {
          const res = await api.getQuestion(sessionId);
          qText = res.questionText;
          if (res.totalQuestions) setTotalQuestions(res.totalQuestions);
        } catch (e) {
          qText = "Could you start by introducing yourself and highlighting your key background?";
        }
      }

      setMessages([
        {
          id: `q-1`,
          role: 'ai',
          text: qText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);

      // Speak initial question aloud
      setTimeout(() => {
        speak(qText!);
      }, 300);
    };

    initQuestion();

    return () => {
      stopSpeaking();
    };
  }, [locationState?.initialQuestion, sessionId, speak, stopSpeaking]);

  // Live timer — always ticks during an active interview
  useEffect(() => {
    if (showEndConfirmation) return;
    const interval = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [showEndConfirmation]);

  const formatTime = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return [hrs, mins, secs]
      .map((v) => String(v).padStart(2, '0'))
      .join(':');
  };

  const elapsedTime = formatTime(seconds);

  const handleToggleListening = () => {
    // FIX #10: Guard against toggling mic while an answer is being submitted.
    if (isSubmitting) return;

    setIsListening((prev) => {
      const next = !prev;
      setSphereState(next ? 'listening' : 'idle');

      if (!next) {
        // User is turning the mic OFF — send finalize FIRST so the backend
        // transcribes any audio buffered since the last VAD pause.
        // This is the critical fix for: "I stopped mic but no text appeared."
        sendFinalize();
        // FIX #13: Reset committed text ref so next mic session starts fresh.
        committedTextRef.current = '';
      }
      return next;
    });
  };

  const handleRefreshMessage = async (id: string) => {
    try {
      setSphereState('thinking');
      const res = await api.getQuestion(sessionId);
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === id) {
            // Speak refreshed question
            speak(res.questionText);
            return {
              ...msg,
              text: res.questionText,
            };
          }
          return msg;
        })
      );
    } catch {
      setSphereState('listening');
    }
  };

  // Submit Answer to Backend API
  const handleSubmitAnswer = async (answerText: string) => {
    if (!answerText.trim() || isSubmitting) return;

    const currentTurnId = questionIndex;
    const userMsgId = `a-${currentTurnId}-${Date.now()}`;
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // 1. Capture MediaPipe aggregated metrics for this turn
    const turnMetrics = getAggregatedMetrics();

    // Append candidate response to transcript
    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: 'user',
        text: answerText,
        timestamp,
      },
    ]);

    setIsSubmitting(true);
    setSphereState('thinking');
    setIsListening(false);

    try {
      // 2. Send transcript and metrics to FastAPI backend
      const res = await api.submitAnswer({
        sessionId,
        questionId: currentTurnId,
        transcript: answerText,
        eyeContact: turnMetrics.eyeContact,
        blinkRate: turnMetrics.blinkRate,
        headStability: turnMetrics.headStability,
      });

      // Update scores history
      setScoresHistory((prev) => ({
        tech: [...prev.tech, res.scores.technical],
        comm: [...prev.comm, res.scores.communication],
        conf: [...prev.conf, res.scores.confidence],
      }));

      // Update candidate message with turn score pill
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === userMsgId
            ? {
                ...msg,
                turnScores: res.scores,
              }
            : msg
        )
      );

      // Check if interview completed
      if (res.isComplete || !res.nextQuestion || currentTurnId >= totalQuestions) {
        handleFinishInterview();
        return;
      }

      // Next Question Flow
      const nextQ = res.nextQuestion;
      setQuestionIndex(nextQ.questionId);
      setInputText('');
      committedTextRef.current = '';  // reset spoken text for next turn
      resetTurnMetrics();

      setMessages((prev) => [
        ...prev,
        {
          id: `q-${nextQ.questionId}`,
          role: 'ai',
          text: nextQ.questionText,
          insight: res.feedback,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);

      // Speak next question
      speak(nextQ.questionText);
    } catch (error: any) {
      console.error('Error submitting answer:', error);
      // If the backend session was lost (e.g. server restarted), show a clear message
      if (error?.message?.includes('404') || error?.status === 404) {
        setMessages(prev => [...prev, {
          id: `err-${Date.now()}`,
          role: 'ai',
          text: 'Session expired — the backend was restarted. Returning to home screen in 3 seconds...',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }]);
        setTimeout(() => navigate('/'), 3000);
      } else {
        setSphereState('listening');
        setIsListening(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Compile full session summary, fetch AI debrief, then persist and navigate
  const handleFinishInterview = useCallback(async () => {
    stopSpeaking();
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 7.5);
    const techAvg = Math.round(avg(scoresHistory.tech) * 10);
    const commAvg = Math.round(avg(scoresHistory.comm) * 10);
    const confAvg = Math.round(avg(scoresHistory.conf) * 10);
    const overallScore = Math.round((techAvg + commAvg + confAvg) / 3);

    // Fetch AI debrief from backend — non-blocking, falls back to null
    let aiDebrief: AiDebrief | undefined;
    try {
      const reportData = await api.getFinalReport(sessionId);
      if (reportData) {
        aiDebrief = {
          overall_scores: reportData.overall_scores,
          body_language: reportData.body_language,
          strengths: reportData.strengths,
          improvements: reportData.improvements,
          debrief_narrative: reportData.debrief_narrative,
          hiring_recommendation: reportData.hiring_recommendation,
        };
      }
    } catch (e) {
      console.warn('getFinalReport failed, continuing without AI debrief:', e);
    }

    // Use AI scores if available, otherwise fall back to local averages
    const categoryScores: CategoryScores = aiDebrief
      ? {
          technical:     Math.round(aiDebrief.overall_scores.technical * 10),
          communication: Math.round(aiDebrief.overall_scores.communication * 10),
          bodyLanguage:  Math.round(aiDebrief.body_language.eye_contact),
          roleFit:       Math.round(aiDebrief.overall_scores.role_fit * 10),
        }
      : {
          technical:     techAvg || 75,
          communication: commAvg || 80,
          bodyLanguage:  confAvg || 82,
          roleFit:       Math.min(100, overallScore + 3),
        };

    const summary: SessionSummary = {
      sessionId,
      role,
      date: sessionDate,
      overallScore,
      questionsCompleted: questionIndex,
      totalQuestions,
      categoryScores,
      aiDebrief,
    };

    saveSession(summary, {
      sessionId,
      role,
      date: sessionDate,
      overallScore,
      questionsCompleted: questionIndex,
      totalQuestions,
      elapsedTime,
      messages,
      categoryScores,
      aiDebrief,
    });

    navigate('/');
  }, [scoresHistory, sessionId, role, sessionDate, questionIndex, totalQuestions, elapsedTime, messages, navigate, stopSpeaking]);

  // Open confirmation warning modal
  const handleRequestEndInterview = () => {
    setShowEndConfirmation(true);
  };

  // Confirm ending interview early
  const handleConfirmEndInterview = () => {
    setShowEndConfirmation(false);
    handleFinishInterview();
  };

  // Generate dynamic mock audio level while speaking to animate sphere
  const [liveAudioLevel, setLiveAudioLevel] = useState(0);
  useEffect(() => {
    if (sphereState !== 'speaking') {
      setLiveAudioLevel(0);
      return;
    }
    const interval = setInterval(() => {
      setLiveAudioLevel(Math.random() * 0.4 + 0.3); // mock amplitude oscillation
    }, 100);
    return () => clearInterval(interval);
  }, [sphereState]);

  return (
    <div className="w-screen h-screen min-h-screen overflow-hidden bg-[#0A0A0A] relative flex flex-col items-center justify-center p-0">
      <InterviewShell
        questionIndex={questionIndex}
        totalQuestions={totalQuestions}
        appName="GetHired"
        pacingStatus="Good Pacing"
        elapsedTime={elapsedTime}
        messages={messages}
        isListening={isListening}
        isFullScreen={true}
        onToggleListening={handleToggleListening}
        onRefreshMessage={handleRefreshMessage}
        onSubmitAnswer={handleSubmitAnswer}
        isSubmitting={isSubmitting}
        onEndInterview={handleRequestEndInterview}
        sphereState={sphereState}
        audioLevel={sphereState === 'speaking' ? liveAudioLevel : (isListening ? 0.15 : 0)}
        videoRef={videoRef}
        inputText={inputText}
        setInputText={(text) => {
          // When user manually types, sync committed ref too
          committedTextRef.current = text;
          setInputText(text);
        }}
        micStatus={micStatus}
      />

      {/* End Interview Confirmation Warning Modal */}
      {showEndConfirmation && (
        <div className="fixed inset-0 bg-[#0A0A0A]/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#1C1C1E] border border-[#2C2C2E] rounded-[24px] p-8 max-w-md w-full flex flex-col items-center text-center gap-5 shadow-2xl">
            <div className="w-14 h-14 rounded-full bg-[#FF9F0A]/15 border border-[#FF9F0A]/30 flex items-center justify-center text-[#FF9F0A]">
              <span className="material-symbols-outlined text-3xl">warning</span>
            </div>
            <div>
              <h3 className="text-xl font-semibold text-[#F5F5F7] mb-2">
                End Interview?
              </h3>
              <p className="text-sm text-[#8E8E93] leading-relaxed">
                Are you sure you want to end your current session? You will return to the home screen and your session will be saved in history.
              </p>
            </div>

            <div className="flex gap-3 w-full mt-2">
              <button
                onClick={() => setShowEndConfirmation(false)}
                className="flex-1 py-3 px-4 bg-[#2C2C2E] border border-[#3A3A3C] rounded-[12px] text-[#F5F5F7] text-sm font-medium hover:bg-[#343539] transition-colors cursor-pointer"
              >
                Resume Interview
              </button>
              <button
                onClick={handleConfirmEndInterview}
                className="flex-1 py-3 px-4 bg-[#FF453A] hover:bg-[#FF3B30] text-white rounded-[12px] text-sm font-semibold transition-colors shadow-lg cursor-pointer"
              >
                End Interview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingShell />} />
      <Route path="/interview" element={<InterviewPage />} />
    </Routes>
  );
}

export default App;
