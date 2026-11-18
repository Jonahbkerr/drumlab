import type { RunResult } from '../engine/game';

export interface LessonRecord {
  stars: number;
  bestAcc: number;
  bestScore: number;
  maxCombo: number;
  plays: number;
}

export interface Progress {
  lessons: Record<string, LessonRecord>;
  streak: { count: number; lastDay: string | null };
  goal: { day: string; minutes: number };
}

const KEY = 'drumlab:v1';
export const DAILY_GOAL_MIN = 5;

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

const EMPTY: Progress = {
  lessons: {},
  streak: { count: 0, lastDay: null },
  goal: { day: todayStr(), minutes: 0 },
};

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY, goal: { ...EMPTY.goal } };
    const p = JSON.parse(raw) as Progress;
    return {
      lessons: p.lessons ?? {},
      streak: p.streak ?? { count: 0, lastDay: null },
      goal: p.goal ?? { day: todayStr(), minutes: 0 },
    };
  } catch {
    return { ...EMPTY, goal: { ...EMPTY.goal } };
  }
}

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage unavailable — progress just won't persist
  }
}

/** Record a finished run. Performance runs earn stars/bests; every run feeds the daily goal. */
export function recordResult(
  p: Progress,
  lessonId: string,
  r: RunResult,
  isPerformance: boolean,
): Progress {
  const today = todayStr();
  const next: Progress = {
    lessons: { ...p.lessons },
    streak: { ...p.streak },
    goal: { ...p.goal },
  };

  const prev = next.lessons[lessonId] ?? {
    stars: 0,
    bestAcc: 0,
    bestScore: 0,
    maxCombo: 0,
    plays: 0,
  };
  if (isPerformance && r.completed) {
    next.lessons[lessonId] = {
      stars: Math.max(prev.stars, r.accuracy >= 0.9 ? 3 : r.accuracy >= 0.75 ? 2 : r.accuracy >= 0.6 ? 1 : 0),
      bestAcc: Math.max(prev.bestAcc, r.accuracy),
      bestScore: Math.max(prev.bestScore, r.score),
      maxCombo: Math.max(prev.maxCombo, r.maxCombo),
      plays: prev.plays + 1,
    };
  } else {
    next.lessons[lessonId] = { ...prev, plays: prev.plays + 1 };
  }

  // daily goal + streak
  const minutes = r.seconds / 60;
  if (next.goal.day !== today) {
    next.goal = { day: today, minutes };
  } else {
    next.goal = { day: today, minutes: next.goal.minutes + minutes };
  }
  if (next.streak.lastDay !== today) {
    if (next.streak.lastDay === yesterdayStr()) {
      next.streak = { count: next.streak.count + 1, lastDay: today };
    } else {
      next.streak = { count: 1, lastDay: today };
    }
  }
  return next;
}

export function starsForLesson(p: Progress, lessonId: string): number {
  return p.lessons[lessonId]?.stars ?? 0;
}
