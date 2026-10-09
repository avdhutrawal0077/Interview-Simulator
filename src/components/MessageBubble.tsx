import React, { useState } from 'react';
import { Message } from '../types/interview';

interface MessageBubbleProps {
  message: Message;
  onRefresh?: (id: string) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onRefresh }) => {
  const [isInsightExpanded, setIsInsightExpanded] = useState(true);

  if (message.role === 'user') {
    return (
      <div className="flex flex-col gap-1 w-full items-end mt-2">
        <span className="text-[#8E8E93] text-[11px] font-medium tracking-widest uppercase mr-1">
          You
        </span>
        <div className="user-bubble p-3 max-w-[90%] bg-[#2C2C2E] rounded-[14px_14px_2px_14px]">
          <p className="text-[#F5F5F7] text-sm leading-relaxed">
            {message.text}
          </p>
        </div>

        {message.turnScores && (
          <div className="flex items-center gap-2 mt-1 mr-1">
            <span className="text-[10px] bg-[#1C1C1E] border border-[#2C2C2E] px-2 py-0.5 rounded text-[#30D158]">
              Tech: {message.turnScores.technical}/10
            </span>
            <span className="text-[10px] bg-[#1C1C1E] border border-[#2C2C2E] px-2 py-0.5 rounded text-[#0A84FF]">
              Comm: {message.turnScores.communication}/10
            </span>
            <span className="text-[10px] bg-[#1C1C1E] border border-[#2C2C2E] px-2 py-0.5 rounded text-[#FFD60A]">
              Conf: {message.turnScores.confidence}/10
            </span>
          </div>
        )}
      </div>
    );
  }

  // Active / Streaming AI Message
  if (message.isStreaming) {
    return (
      <div className="flex flex-col gap-1 w-full pl-3 ai-bubble mt-2 opacity-80 border-l-2 border-[#3A3A3C]">
        <span className="text-[#8E8E93] text-[11px] font-medium tracking-widest uppercase">
          Interviewer
        </span>
        <p className="text-[#EBEBF5] text-sm leading-relaxed font-light flex items-center gap-1 min-h-[24px]">
          {message.text && <span>{message.text}</span>}
          <span className="inline-block w-1 h-4 bg-[#8E8E93] animate-pulse" />
        </p>
      </div>
    );
  }

  // Standard AI Message
  return (
    <div className="flex flex-col gap-1 w-full pl-3 ai-bubble border-l-2 border-[#3A3A3C]">
      <div className="flex items-center justify-between w-full mb-1">
        <span className="text-[#8E8E93] text-[11px] font-medium tracking-widest uppercase">
          Interviewer
        </span>
        {onRefresh && (
          <button
            onClick={() => onRefresh(message.id)}
            className="inline-flex items-center justify-center w-6 h-6 bg-[#2C2C2E] border border-[#3A3A3C] rounded-full transition-colors group focus:outline-none hover:border-[#8E8E93]"
            title="Regenerate response"
            aria-label="Regenerate response"
          >
            <span className="material-symbols-outlined text-[14px] text-[#8E8E93] group-hover:text-[#F5F5F7] transition-colors">
              refresh
            </span>
          </button>
        )}
      </div>

      <p className="text-[#EBEBF5] text-sm leading-relaxed font-light">
        {message.text}
      </p>

      {message.insight && (
        <div className="mt-3 pt-2.5 border-t border-[#2C2C2E]">
          <button
            onClick={() => setIsInsightExpanded(!isInsightExpanded)}
            className="flex items-center gap-1 text-[#8E8E93] hover:text-[#F5F5F7] text-[11px] font-medium transition-colors focus:outline-none group text-left w-full"
            aria-expanded={isInsightExpanded}
          >
            <span className="text-[#30D158] font-medium">Feedback / Insight</span>
            <span
              className={`material-symbols-outlined text-[14px] transition-transform duration-200 ${
                isInsightExpanded ? 'rotate-90 text-[#F5F5F7]' : 'rotate-0 text-[#8E8E93]'
              }`}
            >
              arrow_forward
            </span>
          </button>
          {isInsightExpanded && (
            <p className="mt-1 text-[#8E8E93] text-[11px] italic leading-relaxed">
              {message.insight}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
