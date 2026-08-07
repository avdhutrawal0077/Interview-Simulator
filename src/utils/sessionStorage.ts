import { SessionSummary, SessionFullExport } from '../types/interview';

const HISTORY_KEY = 'gethired-history';
const SESSION_PREFIX = 'gethired-session-';

/** Generate a compact, unique session ID */
export function generateSessionId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

/** Read all session summaries from localStorage */
export function getHistory(): SessionSummary[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SessionSummary[];
  } catch {
    return [];
  }
}

/** Save a session summary to the history list + store full data */
export function saveSession(summary: SessionSummary, fullData: SessionFullExport): void {
  try {
    const history = getHistory();
    // Prepend newest first
    history.unshift(summary);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    localStorage.setItem(SESSION_PREFIX + summary.sessionId, JSON.stringify(fullData));
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

/** Retrieve full session data by ID */
export function getFullSession(sessionId: string): SessionFullExport | null {
  try {
    const raw = localStorage.getItem(SESSION_PREFIX + sessionId);
    if (!raw) return null;
    return JSON.parse(raw) as SessionFullExport;
  } catch {
    return null;
  }
}

/** Trigger a JSON file download in the browser */
export function downloadJson(data: object, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
