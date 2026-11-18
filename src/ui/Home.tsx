import { PATHS, lessonsInPath } from '../content/lessons';
import type { PathId } from '../engine/types';
import { DAILY_GOAL_MIN } from '../state/progress';
import type { Progress } from '../state/progress';
import Stars from './Stars';

interface Props {
  progress: Progress;
  onPath: (p: PathId) => void;
  onKit: () => void;
  onSongs: () => void;
}

export default function Home({ progress, onPath, onKit, onSongs }: Props) {
  const totalStars = Object.values(progress.lessons).reduce((s, r) => s + r.stars, 0);
  const plays = Object.values(progress.lessons).reduce((s, r) => s + r.plays, 0);
  const goalMin = progress.goal.day === todayStr() ? progress.goal.minutes : 0;
  const goalPct = Math.min(1, goalMin / DAILY_GOAL_MIN);
  const R = 20;
  const C = 2 * Math.PI * R;

  return (
    <div className="app">
      <header className="home-header">
        <div className="brand">
          <span className="dot" />
          DrumLab
        </div>
        <span className="pill">🔥 {progress.streak.count}-day streak</span>
      </header>

      <div className="hero">
        <h1>
          Drum practice,
          <br />
          <span className="accent">gamified.</span>
        </h1>
        <p>
          Notes fall, you hit. Real-time timing feedback, streaks and stars. Pad, e-kit, or
          just your keyboard — build muscle memory 5 minutes a day.
        </p>
      </div>

      <div className="stat-row">
        <div className="card stat-card">
          <span className="icon">🔥</span>
          <div>
            <div className="big">{progress.streak.count} days</div>
            <div className="lbl">practice streak</div>
          </div>
        </div>
        <div className="card stat-card">
          <span className="icon">⭐</span>
          <div>
            <div className="big">{totalStars}</div>
            <div className="lbl">stars earned</div>
          </div>
        </div>
        <div className="card stat-card">
          <span className="icon">🎯</span>
          <div>
            <div className="big">{plays}</div>
            <div className="lbl">lessons played</div>
          </div>
        </div>
        <div className="card stat-card">
          <div className="goal-ring">
            <svg width="52" height="52" viewBox="0 0 52 52">
              <circle cx="26" cy="26" r={R} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="5" />
              <circle
                cx="26"
                cy="26"
                r={R}
                fill="none"
                stroke={goalPct >= 1 ? '#34d399' : '#ff6a3d'}
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={`${C * goalPct} ${C}`}
              />
            </svg>
            <span className="num">{Math.floor(goalMin)}/{DAILY_GOAL_MIN}m</span>
          </div>
          <div>
            <div className="big">{goalPct >= 1 ? 'Done!' : 'Today'}</div>
            <div className="lbl">daily goal</div>
          </div>
        </div>
      </div>

      <div className="path-grid">
        {PATHS.map((p) => {
          const lessons = lessonsInPath(p.id);
          const earned = lessons.reduce((s, l) => s + (progress.lessons[l.id]?.stars ?? 0), 0);
          return (
            <button
              key={p.id}
              type="button"
              className="card path-card"
              onClick={() => onPath(p.id)}
              style={{ textAlign: 'left' }}
            >
              <span className="emoji">{p.emoji}</span>
              <h3>{p.name}</h3>
              <p>{p.blurb}</p>
              <div className="meta">
                <span className="pill">{lessons.length} lessons</span>
                <span className="stars">
                  <Stars count={3} filled={0} dim />
                  <b style={{ fontSize: 13, color: 'var(--muted)' }}>
                    {earned}/{lessons.length * 3}
                  </b>
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="tool-row">
        <button type="button" className="card tool-card" onClick={onSongs}>
          <span className="emoji">🎧</span>
          <h3>My songs</h3>
          <p>Import an MP3 — it becomes a playable drum chart with backing track.</p>
        </button>
        <button type="button" className="card tool-card" onClick={onKit}>
          <span className="emoji">🥁</span>
          <h3>Kit setup</h3>
          <p>Connect your USB kit to the lanes — learn each pad, see live MIDI.</p>
        </button>
      </div>

      <div className="card hint-card">
        <div>
          <div className="tag">How to play</div>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '6px 0 0', maxWidth: 420 }}>
            Hit the pads with <b style={{ color: 'var(--text)' }}>D F J K L ;</b> — or click/tap
            them. Plug in any MIDI e-kit, pads or keyboard and it just works.
          </p>
        </div>
        <div className="keys">
          {['D', 'F', 'J', 'K', 'L', ';'].map((k) => (
            <span className="kbd" key={k}>
              {k}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
