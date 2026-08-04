import React, { useEffect, useRef } from 'react';
import { Message } from '../types/interview';
import { LiveDot } from './LiveDot';
import { MessageBubble } from './MessageBubble';

interface TranscriptPanelProps {
  messages: Message[];
  isListening: boolean;
  onToggleListening?: () => void;
  onRefreshMessage?: (id: string) => void;
}

export const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
  messages,
  isListening,
  onToggleListening,
  onRefreshMessage,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <aside className="w-full md:w-[360px] h-full flex flex-col bg-[#1C1C1E] border-t md:border-t-0 border-[#2C2C2E] shrink-0">
      {/* Right Header */}
      <header className="px-6 py-5 flex items-center justify-between border-b border-[#2C2C2E] select-none">
        <h2 className="text-[#F5F5F7] font-semibold text-base">Transcript</h2>
        <div
          onClick={onToggleListening}
          className={`flex items-center gap-2 ${
            onToggleListening ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''
          }`}
          title={onToggleListening ? 'Click to toggle listening status' : undefined}
        >
          <LiveDot active={isListening} />
          <span className="text-[#8E8E93] text-xs font-medium uppercase tracking-wider">
            {isListening ? 'Listening...' : 'Paused'}
          </span>
        </div>
      </header>

      {/* Transcript Canvas / Scrollable List */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 flex flex-col gap-8 custom-scrollbar"
      >
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onRefresh={onRefreshMessage}
          />
        ))}
      </div>
    </aside>
  );
};
