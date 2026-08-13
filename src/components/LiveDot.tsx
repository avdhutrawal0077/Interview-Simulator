import React from 'react';

interface LiveDotProps {
  active?: boolean;
  className?: string;
}

export const LiveDot: React.FC<LiveDotProps> = ({ active = true, className = '' }) => {
  if (!active) {
    return (
      <span className={`inline-block w-2 h-2 rounded-full bg-[#8E8E93] ${className}`} />
    );
  }

  return (
    <span className={`status-dot ${className}`} aria-label="Live indicator" />
  );
};
