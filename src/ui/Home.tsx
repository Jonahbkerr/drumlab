import { PATHS, lessonsInPath } from '../content/lessons';
import type { Progress } from '../state/progress';
import Icon from './Icon';
import Stars from './Stars';

interface Props {
  progress: Progress;
  onPlay: (lessonId: string) => void;
}

/** Learn: every path and its lessons on one page, as rows. */
export default function Home({ progress, onPlay }: Props) {
  const all = PATHS.flatMap((p) => lessonsInPath(p.id));
  const stars = all.reduce((s, l) => s + (progress.lessons[l.id]?.stars ?? 0), 0);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Learn</h1>
          <p>Short lessons that build one skill at a time. Earn stars in Perform mode; slow anything down in Practice.</p>
        </div>
        <span className="muted">
          <b className="mono" style={{ color: 'var(--text)' }}>
            {stars}
          </b>{' '}
          of {all.length * 3} stars
        </span>
      </div>

      {PATHS.map((p) => {
        const lessons = lessonsInPath(p.id);
        const earned = lessons.reduce((s, l) => s + (progress.lessons[l.id]?.stars ?? 0), 0);
        return (
          <section className="path" key={p.id} aria-labelledby={`path-${p.id}`}>
            <div className="path-head">
              <div>
                <h2 id={`path-${p.id}`}>{p.name}</h2>
                <p>{p.blurb}</p>
              </div>
              <span className="score mono">
                {earned}/{lessons.length * 3}
              </span>
            </div>
            <ul className="row-list">
              {lessons.map((l, i) => {
                const rec = progress.lessons[l.id];
                return (
                  <li key={l.id}>
                    <button type="button" className="lesson-row" onClick={() => onPlay(l.id)}>
                      <span className="idx">{String(i + 1).padStart(2, '0')}</span>
                      <span style={{ minWidth: 0 }}>
                        <span className="title">{l.title}</span>
                        <span className="desc" style={{ display: 'block' }}>
                          {l.desc}
                        </span>
                      </span>
                      <span className="bpm">{l.bpm} bpm</span>
                      <span className="diff-cell" title={`Difficulty ${l.difficulty} of 5`}>
                        <span className="difficulty" aria-label={`Difficulty ${l.difficulty} of 5`}>
                          {Array.from({ length: 5 }, (_, k) => (
                            <span key={k} className={k < l.difficulty ? 'on' : ''} style={{ height: 5 + k * 2 }} />
                          ))}
                        </span>
                      </span>
                      <span className="stars-cell">
                        <Stars count={3} filled={rec?.stars ?? 0} size={13} />
                      </span>
                      <span className={`best${rec && rec.plays > 0 ? '' : ' none'}`}>
                        {rec && rec.plays > 0 ? `${Math.round(rec.bestAcc * 100)}%` : '—'}
                      </span>
                      <span className="go" aria-hidden="true">
                        <Icon name="play" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <p className="howto">
        Play with a MIDI kit, or the keys
        <span className="kbd">D</span> kick <span className="kbd">F</span> snare <span className="kbd">J</span> hi-hat
        <span className="kbd">K</span> low tom <span className="kbd">L</span> high tom <span className="kbd">;</span> crash
      </p>
    </>
  );
}
