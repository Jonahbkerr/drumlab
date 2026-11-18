import type { ReactNode } from 'react';
import { DAILY_GOAL_MIN } from '../state/progress';
import type { Progress } from '../state/progress';
import { Mark } from './Icon';

export type Section = 'learn' | 'songs' | 'kit';

interface Props {
  section: Section | null;
  progress: Progress;
  onNav: (s: Section) => void;
  children: ReactNode;
}

const NAV: { id: Section; label: string }[] = [
  { id: 'learn', label: 'Learn' },
  { id: 'songs', label: 'Songs' },
  { id: 'kit', label: 'Kit' },
];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Shell({ section, progress, onNav, children }: Props) {
  const minutes = progress.goal.day === todayStr() ? progress.goal.minutes : 0;
  const goal = Math.min(1, minutes / DAILY_GOAL_MIN);
  const streak = progress.streak.count;
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <Mark />
          DrumLab
        </div>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              aria-current={section === n.id ? 'page' : undefined}
              onClick={() => onNav(n.id)}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="topbar-stats">
          <span>
            <b>{streak}</b> day{streak === 1 ? '' : 's'} streak
          </span>
          <span className="goal" title={`Daily goal: ${DAILY_GOAL_MIN} minutes`}>
            <span className={`goal-track${goal >= 1 ? ' done' : ''}`}>
              <span style={{ width: `${goal * 100}%` }} />
            </span>
            <span>
              <b className="mono">{Math.floor(minutes)}</b>/{DAILY_GOAL_MIN} min today
            </span>
          </span>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
