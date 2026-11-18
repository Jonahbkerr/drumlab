import type { RunResult } from '../engine/game';
import { LANE_COLOR } from '../engine/game';
import { LANES, LANE_LABEL } from '../engine/types';
import { starsForAccuracy } from '../engine/judge';

interface Props {
  title: string;
  result: RunResult;
  isBest: boolean;
  nextLabel?: string;
  onRetry: () => void;
  onNext?: () => void;
  onHome: () => void;
  homeLabel?: string;
}

export default function ResultsView({
  title,
  result,
  isBest,
  nextLabel,
  onRetry,
  onNext,
  onHome,
  homeLabel = 'Home',
}: Props) {
  const stars = result.completed ? starsForAccuracy(result.accuracy) : 0;
  const earlyAvg = result.earlyCount > 0 ? result.earlySumMs / result.earlyCount : 0;
  const lateAvg = result.lateCount > 0 ? result.lateSumMs / result.lateCount : 0;

  return (
    <div className="results">
      <span className="tag">{result.mode === 'performance' ? 'Performance' : 'Practice'}</span>
      <h1 style={{ fontSize: 34, marginTop: 8 }}>{title}</h1>
      {isBest && (
        <p style={{ color: 'var(--amber)', fontWeight: 700, margin: '8px 0 0' }}>
          ★ New best accuracy!
        </p>
      )}

      <div className="big-stars">
        {[0, 1, 2].map((i) => (
          <svg key={i} viewBox="0 0 24 24">
            <path
              d="M12 2l2.9 6.2 6.8.9-5 4.7 1.3 6.7-6-3.3-6 3.3 1.3-6.7-5-4.7 6.8-.9z"
              fill={i < stars ? '#ffc53d' : 'rgba(255,255,255,0.12)'}
            />
          </svg>
        ))}
      </div>

      <div className="result-grid">
        <div className="cell">
          <div className="big">{Math.round(result.accuracy * 100)}%</div>
          <div className="lbl">Accuracy</div>
        </div>
        <div className="cell">
          <div className="big">{result.score.toLocaleString()}</div>
          <div className="lbl">Score</div>
        </div>
        <div className="cell">
          <div className="big">{result.maxCombo}</div>
          <div className="lbl">Max combo</div>
        </div>
        <div className="cell">
          <div className="big">{result.hits}</div>
          <div className="lbl">/{result.total} notes</div>
        </div>
      </div>

      <div className="lane-bars">
        {LANES.map((lane) => {
          const s = result.perLane[lane];
          const total = s.hit + s.miss;
          if (total === 0) return null;
          const pct = (s.hit / total) * 100;
          return (
            <div className="lane-bar" key={lane}>
              <span className="name">{LANE_LABEL[lane]}</span>
              <div className="track">
                <div className="fill" style={{ width: `${pct}%`, background: LANE_COLOR[lane] }} />
              </div>
              <span className="pct">{Math.round(pct)}%</span>
            </div>
          );
        })}
      </div>

      <p className="timing-note">
        <b>{result.earlyCount}</b> early (avg <b>{earlyAvg.toFixed(0)}ms</b>) ·{' '}
        <b>{result.lateCount}</b> late (avg <b>{lateAvg.toFixed(0)}ms</b>) ·{' '}
        <b>{result.perfects}</b> perfect · <b>{result.misses}</b> missed
      </p>

      <div className="result-actions">
        <button type="button" className="btn primary big" onClick={onRetry}>
          ↻ Play again
        </button>
        {nextLabel && onNext && (
          <button type="button" className="btn big" onClick={onNext}>
            {nextLabel} →
          </button>
        )}
        <button type="button" className="btn ghost big" onClick={onHome}>
          {homeLabel}
        </button>
      </div>
    </div>
  );
}
