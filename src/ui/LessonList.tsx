import { PATHS, lessonsInPath } from '../content/lessons';
import type { PathId } from '../engine/types';
import type { Progress } from '../state/progress';
import Stars from './Stars';

interface Props {
  pathId: PathId;
  progress: Progress;
  onBack: () => void;
  onPlay: (lessonId: string) => void;
}

export default function LessonList({ pathId, progress, onBack, onPlay }: Props) {
  const path = PATHS.find((p) => p.id === pathId);
  const lessons = lessonsInPath(pathId);

  return (
    <div className="app">
      <div className="view-head">
        <button type="button" className="back-link" onClick={onBack}>
          ← Back
        </button>
        <div>
          <h2 style={{ fontSize: 26 }}>
            {path?.emoji} {path?.name}
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '4px 0 0' }}>{path?.blurb}</p>
        </div>
      </div>

      <div className="lesson-list">
        {lessons.map((l) => {
          const rec = progress.lessons[l.id];
          return (
            <button
              key={l.id}
              type="button"
              className="card lesson-card"
              onClick={() => onPlay(l.id)}
              style={{ textAlign: 'left' }}
            >
              <div className="top">
                <Stars count={3} filled={rec?.stars ?? 0} />
                <span className="pill">{l.bpm} BPM</span>
              </div>
              <h3>{l.title}</h3>
              <p>{l.desc}</p>
              <div className="meta">
                <span className="diff-pips">
                  {Array.from({ length: 5 }, (_, i) => (
                    <span key={i} className={i < l.difficulty ? 'on' : ''} />
                  ))}
                </span>
                <span style={{ color: 'var(--muted)', fontSize: 13, fontWeight: 600 }}>
                  {rec && rec.plays > 0 ? `best ${(rec.bestAcc * 100).toFixed(0)}%` : 'not played yet'}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
