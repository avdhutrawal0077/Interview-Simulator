import React, { useEffect, useRef } from 'react';
import { Message } from '../types/interview';
import { LiveDot } from './LiveDot';
import { MessageBubble } from './MessageBubble';

interface TranscriptPanelProps {
  messages: Message[];
  isListening: boolean;
  onToggleListening?: () => void;
  onRefreshMessage?: (id: string) => void;
  onSubmitAnswer?: (answer: string) => void;
  isSubmitting?: boolean;
  inputText: string;
  setInputText: (text: string) => void;
  micStatus?: 'active' | 'blocked' | 'unsupported' | 'idle';
}

export const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
  messages,
  isListening,
  onToggleListening,
  onRefreshMessage,
  onSubmitAnswer,
  isSubmitting = false,
  inputText,
  setInputText,
  micStatus = 'idle',
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isSubmitting]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isSubmitting || !onSubmitAnswer) return;
    onSubmitAnswer(inputText.trim());
    setInputText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const micBanner = (() => {
    if (micStatus === 'blocked' || micStatus === 'unsupported') {
      return {
        bg: 'bg-[#FF453A]/10 border-[#FF453A]/30',
        icon: 'mic_off',
        iconColor: 'text-[#FF453A]',
        text: micStatus === 'unsupported'
          ? 'Speech recognition not supported in this browser. Use Chrome or Edge, or type your answers below.'
          : 'Microphone access was blocked. Please allow mic access in your browser settings, or type your answers below.',
      };
    }
    if (micStatus === 'active') {
      return {
        bg: 'bg-[#30D158]/10 border-[#30D158]/30',
        icon: 'mic',
        iconColor: 'text-[#30D158]',
        text: 'Microphone active — speak your answer, then click Submit Answer.',
      };
    }
    return null;
  })();

  return (
    <aside className="w-full md:w-[400px] lg:w-[440px] h-full flex flex-col bg-[#1C1C1E] border-t md:border-t-0 border-[#2C2C2E] shrink-0">
      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-[#2C2C2E] select-none shrink-0">
        <h2 className="text-[#F5F5F7] font-semibold text-base">Transcript</h2>

        {/* Mic Toggle Button */}
        <button
          type="button"
          onClick={onToggleListening}
          disabled={isSubmitting || micStatus === 'unsupported'}
          title={isListening ? 'Click to pause mic' : 'Click to activate mic'}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
            isListening
              ? 'bg-[#30D158]/15 border-[#30D158]/40 text-[#30D158] hover:bg-[#30D158]/25'
              : 'bg-[#2C2C2E] border-[#3A3A3C] text-[#8E8E93] hover:border-[#48484A] hover:text-[#F5F5F7]'
          }`}
        >
          <LiveDot active={isListening} />
          <span className="material-symbols-outlined text-[15px]">
            {isListening ? 'mic' : 'mic_off'}
          </span>
          <span>{isListening ? 'Listening' : 'Mic Off'}</span>
        </button>
      </header>

      {/* Mic status banner */}
      {micBanner && (
        <div className={`mx-4 mt-3 flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border text-[12px] ${micBanner.bg} shrink-0`}>
          <span className={`material-symbols-outlined text-[17px] shrink-0 mt-0.5 ${micBanner.iconColor}`}>
            {micBanner.icon}
          </span>
          <span className="text-[#C7C7CC] leading-snug">{micBanner.text}</span>
        </div>
      )}

      {/* Transcript Canvas */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-5 flex flex-col gap-5 custom-scrollbar min-h-0"
      >
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-[#8E8E93] gap-2 my-auto">
            <span className="material-symbols-outlined text-3xl opacity-40">forum</span>
            <p className="text-xs">Preparing the interview transcript...</p>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onRefresh={onRefreshMessage}
            />
          ))
        )}

        {isSubmitting && (
          <div className="flex items-center gap-2 text-xs text-[#8E8E93] pl-3 py-2 animate-pulse">
            <span className="material-symbols-outlined text-sm animate-spin text-[#30D158]">progress_activity</span>
            <span>Evaluating your response...</span>
          </div>
        )}
      </div>

      {/* Answer Input Bar */}
      <div className="p-4 border-t border-[#2C2C2E] bg-[#141416] shrink-0">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
          <div className="relative">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isSubmitting
                  ? 'Evaluating answer...'
                  : isListening
                  ? 'Speak now — your words appear here in real time...'
                  : 'Type your answer or click Mic Off to enable voice...'
              }
              disabled={isSubmitting}
              rows={3}
              className="w-full bg-[#1C1C1E] border border-[#2C2C2E] focus:border-[#48484A] rounded-xl px-3.5 py-2.5 text-[13px] text-[#F5F5F7] placeholder-[#636366] resize-none outline-none transition-colors leading-relaxed"
            />
            {/* Live recording indicator inside textarea when mic is active */}
            {isListening && !isSubmitting && (
              <div className="absolute bottom-2 right-2 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#FF453A] animate-pulse" />
                <span className="text-[10px] text-[#FF453A] font-medium">REC</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            {/* Mic toggle shortcut */}
            <button
              type="button"
              onClick={onToggleListening}
              disabled={isSubmitting || micStatus === 'unsupported'}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[12px] font-medium transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                isListening
                  ? 'bg-[#FF453A]/15 border-[#FF453A]/40 text-[#FF453A] hover:bg-[#FF453A]/25'
                  : 'bg-[#2C2C2E] border-[#3A3A3C] text-[#8E8E93] hover:text-[#F5F5F7]'
              }`}
            >
              <span className="material-symbols-outlined text-[15px]">
                {isListening ? 'mic_off' : 'mic'}
              </span>
              {isListening ? 'Stop Mic' : 'Start Mic'}
            </button>

            <button
              type="submit"
              disabled={!inputText.trim() || isSubmitting}
              className="flex-1 py-2 px-4 bg-[#30D158] hover:bg-[#28B84D] disabled:opacity-30 disabled:cursor-not-allowed text-black font-semibold text-[13px] rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
            >
              <span>Submit Answer</span>
              <span className="material-symbols-outlined text-[15px]">send</span>
            </button>
          </div>

          <p className="text-[10px] text-[#636366] text-center">
            Press <kbd className="bg-[#2C2C2E] px-1 py-0.5 rounded text-[#8E8E93]">Enter</kbd> to submit &nbsp;·&nbsp;
            <kbd className="bg-[#2C2C2E] px-1 py-0.5 rounded text-[#8E8E93]">Shift+Enter</kbd> for new line
          </p>
        </form>
      </div>
    </aside>
  );
};
