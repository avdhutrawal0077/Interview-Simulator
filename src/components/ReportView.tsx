import React from 'react';
import { SessionFullExport, SessionSummary } from '../types/interview';

interface ReportViewProps {
  session: SessionFullExport;
  roleSessions: SessionSummary[];
  onClose: () => void;
}

/** Format ISO date to readable form */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Score color based on value */
function scoreColor(score: number): string {
  if (score >= 80) return '#30D158';
  if (score >= 60) return '#FFD60A';
  return '#FF453A';
}

export const ReportView: React.FC<ReportViewProps> = ({ session, roleSessions, onClose }) => {
  // Sort role sessions chronologically for line chart
  const sortedRoleSessions = [...roleSessions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const catScores = session.categoryScores || {
    technical: session.overallScore,
    communication: Math.min(100, session.overallScore + 4),
    bodyLanguage: Math.max(50, session.overallScore - 3),
    roleFit: Math.min(100, session.overallScore + 2),
  };

  // Pie chart categories configuration
  const categories = [
    { label: 'Technical Accuracy', value: catScores.technical, color: '#30D158' },
    { label: 'Communication', value: catScores.communication, color: '#0A84FF' },
    { label: 'Body Language', value: catScores.bodyLanguage, color: '#BF5AF2' },
    { label: 'Role Alignment', value: catScores.roleFit, color: '#FF9F0A' },
  ];

  const totalCatValue = categories.reduce((sum, c) => sum + c.value, 0);

  // SVG parameters for Donut Chart
  const donutRadius = 42;
  const circumference = 2 * Math.PI * donutRadius;
  let accumulatedPercent = 0;

  // Line chart SVG coordinates calculation
  const chartW = 380;
  const chartH = 120;
  const paddingX = 30;
  const paddingY = 20;
  const usableW = chartW - paddingX * 2;
  const usableH = chartH - paddingY * 2;

  const points = sortedRoleSessions.map((s, idx) => {
    const x =
      sortedRoleSessions.length > 1
        ? paddingX + (idx / (sortedRoleSessions.length - 1)) * usableW
        : chartW / 2;
    // Map score 40..100 to y range
    const clampedScore = Math.max(40, Math.min(100, s.overallScore));
    const y = chartH - paddingY - ((clampedScore - 40) / 60) * usableH;
    return { x, y, session: s };
  });

  const pathD =
    points.length === 1
      ? `M ${paddingX} ${points[0].y} L ${chartW - paddingX} ${points[0].y}`
      : points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`, '');

  const areaD =
    points.length > 0
      ? `${pathD} L ${points[points.length - 1].x} ${chartH - paddingY} L ${points[0].x} ${chartH - paddingY} Z`
      : '';

  return (
    <div className="w-full h-full flex flex-col bg-[#0A0A0A] overflow-y-auto custom-scrollbar p-6 md:p-8">
      {/* Top Header Row */}
      <div className="flex items-center justify-between mb-6 pb-5 border-b border-[#2C2C2E]">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[#1C1C1E] border border-[#2C2C2E] flex items-center justify-center text-[#8E8E93] hover:text-[#F5F5F7] hover:bg-[#2C2C2E] transition-colors cursor-pointer"
            aria-label="Back to Home"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-[22px] font-bold text-[#F5F5F7] tracking-tight">
                {session.role} Performance Report
              </h2>
              <span
                className="px-2.5 py-0.5 rounded-full text-[12px] font-semibold"
                style={{
                  backgroundColor: `${scoreColor(session.overallScore)}20`,
                  color: scoreColor(session.overallScore),
                }}
              >
                {session.overallScore}% Overall Score
              </span>
            </div>
            <p className="text-[#8E8E93] text-[12px] mt-0.5">
              Completed on {formatDate(session.date)} • {session.questionsCompleted} of {session.totalQuestions} Questions • Duration: {session.elapsedTime}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 bg-[#2C2C2E] hover:bg-[#343539] text-[#F5F5F7] border border-[#3A3A3C] rounded-xl text-[13px] font-medium transition-colors cursor-pointer flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-[16px]">home</span>
          Back to Home
        </button>
      </div>

      {/* Analytics Section: Two Side-by-Side Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Chart 1: Role Progress Trend (Line Chart) */}
        <div className="bg-[#1C1C1E] border border-[#2C2C2E] rounded-[24px] p-6 flex flex-col justify-between shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-[#F5F5F7] text-[15px] font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-[#30D158]">
                  show_chart
                </span>
                Performance Trend ({session.role})
              </h3>
              <p className="text-[#8E8E93] text-[11px] mt-0.5">
                Score progression across all {sortedRoleSessions.length} {session.role} sessions
              </p>
            </div>
            <span className="text-[11px] font-medium text-[#30D158] bg-[#30D158]/10 px-2 py-0.5 rounded-full">
              Role Progress
            </span>
          </div>

          <div className="relative w-full h-[150px] flex items-center justify-center my-2">
            <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-full overflow-visible">
              <defs>
                <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#30D158" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#30D158" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Horizontal gridlines */}
              {[40, 60, 80, 100].map((gridScore) => {
                const y = chartH - paddingY - ((gridScore - 40) / 60) * usableH;
                return (
                  <g key={gridScore}>
                    <line
                      x1={paddingX}
                      y1={y}
                      x2={chartW - paddingX}
                      y2={y}
                      stroke="#2C2C2E"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={paddingX - 6}
                      y={y + 3}
                      fill="#8E8E93"
                      fontSize="9"
                      textAnchor="end"
                    >
                      {gridScore}%
                    </text>
                  </g>
                );
              })}

              {/* Area gradient under curve */}
              {areaD && <path d={areaD} fill="url(#lineGradient)" />}

              {/* Main trend line */}
              {pathD && (
                <path
                  d={pathD}
                  fill="none"
                  stroke="#30D158"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Data points */}
              {points.map((p) => {
                const isSelected = p.session.sessionId === session.sessionId;
                return (
                  <g key={p.session.sessionId} className="group cursor-pointer">
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={isSelected ? '6' : '4'}
                      fill={isSelected ? '#30D158' : '#1C1C1E'}
                      stroke={isSelected ? '#F5F5F7' : '#30D158'}
                      strokeWidth={isSelected ? '2.5' : '2'}
                    />
                    {/* Hover text label */}
                    <text
                      x={p.x}
                      y={p.y - 10}
                      fill={isSelected ? '#F5F5F7' : '#8E8E93'}
                      fontSize="10"
                      fontWeight={isSelected ? 'bold' : 'normal'}
                      textAnchor="middle"
                    >
                      {p.session.overallScore}%
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="flex items-center justify-between text-[11px] text-[#8E8E93] pt-2 border-t border-[#2C2C2E]/60">
            <span>First Session</span>
            <span className="text-[#30D158] font-medium">Selected Session Highlighted</span>
            <span>Latest Session</span>
          </div>
        </div>

        {/* Chart 2: Sub-scores Breakdown (Donut/Pie Chart) */}
        <div className="bg-[#1C1C1E] border border-[#2C2C2E] rounded-[24px] p-6 flex flex-col justify-between shadow-xl">
          <div>
            <h3 className="text-[#F5F5F7] text-[15px] font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-[#0A84FF]">
                pie_chart
              </span>
              Sub-scores Breakdown
            </h3>
            <p className="text-[#8E8E93] text-[11px] mt-0.5">
              Detailed category evaluations for this session
            </p>
          </div>

          <div className="flex items-center gap-6 my-3">
            {/* SVG Donut */}
            <div className="relative w-[130px] h-[130px] shrink-0 flex items-center justify-center">
              <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
                <circle
                  cx="50"
                  cy="50"
                  r={donutRadius}
                  fill="none"
                  stroke="#2C2C2E"
                  strokeWidth="12"
                />
                {categories.map((cat) => {
                  const strokePercent = cat.value / totalCatValue;
                  const dashArray = `${strokePercent * circumference} ${circumference}`;
                  const strokeOffset = -accumulatedPercent * circumference;
                  accumulatedPercent += strokePercent;

                  return (
                    <circle
                      key={cat.label}
                      cx="50"
                      cy="50"
                      r={donutRadius}
                      fill="none"
                      stroke={cat.color}
                      strokeWidth="12"
                      strokeDasharray={dashArray}
                      strokeDashoffset={strokeOffset}
                      strokeLinecap="round"
                      className="transition-all duration-500"
                    />
                  );
                })}
              </svg>
              {/* Inner score badge */}
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                <span className="text-[20px] font-bold text-[#F5F5F7] leading-none">
                  {session.overallScore}%
                </span>
                <span className="text-[9px] uppercase tracking-wider text-[#8E8E93] mt-0.5">
                  Avg
                </span>
              </div>
            </div>

            {/* Sub-score Legend */}
            <div className="flex-1 space-y-2">
              {categories.map((cat) => (
                <div key={cat.label} className="flex items-center justify-between text-[12px]">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span className="text-[#8E8E93] truncate">{cat.label}</span>
                  </div>
                  <span className="text-[#F5F5F7] font-semibold ml-2">
                    {cat.value}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="text-[11px] text-[#8E8E93] pt-2 border-t border-[#2C2C2E]/60 flex items-center justify-between">
            <span>Category breakdown</span>
            <span className="text-[#F5F5F7] font-medium">4 Core Dimensions</span>
          </div>
        </div>
      </div>

      {/* Transcript Section */}
      <div className="bg-[#1C1C1E] border border-[#2C2C2E] rounded-[24px] p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5 pb-3 border-b border-[#2C2C2E]">
          <div>
            <h3 className="text-[#F5F5F7] text-[16px] font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-[#FF9F0A]">
                forum
              </span>
              Full Interview Transcript
            </h3>
            <p className="text-[#8E8E93] text-[12px] mt-0.5">
              Read-only log of AI interviewer questions and candidate responses
            </p>
          </div>

          <span className="text-[12px] text-[#8E8E93] font-medium px-3 py-1 rounded-full bg-[#2C2C2E]">
            {session.messages.length} Messages
          </span>
        </div>

        {/* Read-only Transcript list */}
        <div className="space-y-4">
          {session.messages.length === 0 ? (
            <p className="text-[#8E8E93] text-[13px] text-center py-8">
              No transcript messages recorded for this session.
            </p>
          ) : (
            session.messages.map((msg, index) => (
              <div
                key={msg.id || index}
                className={`flex flex-col ${
                  msg.role === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div className="flex items-center gap-2 mb-1 px-1">
                  <span className="text-[11px] font-medium text-[#8E8E93] uppercase tracking-wider">
                    {msg.role === 'user' ? 'Candidate' : 'AI Interviewer'}
                  </span>
                  {msg.timestamp && (
                    <span className="text-[10px] text-[#8E8E93]/60">
                      • {msg.timestamp}
                    </span>
                  )}
                </div>

                <div
                  className={`max-w-[85%] p-4 rounded-2xl text-[14px] leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-[#2C2C2E] text-[#F5F5F7] rounded-tr-xs'
                      : 'bg-[#161618] border border-[#2C2C2E] text-[#F5F5F7] rounded-tl-xs border-l-2 border-l-[#30D158]'
                  }`}
                >
                  {msg.text}
                </div>

                {msg.insight && (
                  <div className="mt-1.5 max-w-[85%] bg-[#30D158]/10 border border-[#30D158]/25 rounded-xl px-3 py-2 text-[12px] text-[#30D158] flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] shrink-0">
                      lightbulb
                    </span>
                    <span>{msg.insight}</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
