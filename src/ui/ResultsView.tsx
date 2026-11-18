import type { RunResult } from '../engine/game';
import { LANE_COLOR } from '../engine/game';
import { LANES, LANE_LABEL } from '../engine/types';
import { starsForAccuracy } from '../engine/judge';
import { sharedAudio } from '../engine/audio';
import { useState } from 'react';

const CAL_KEY = 'drumlab:cal-ms';

/** timing offset currently in use (ms): the saved one, or the device's reported latency */
function currentCalMs(): number {
  try {
    const v = localStorage.getItem(CAL_KEY);
    if (v !== null && Number.isFinite(Number(v))) return Number(v);
  } catch {
    // storage blocked: fall through to auto
  }
  return Math.round(sharedAudio.latencySec() * 1000);
}

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
  // a steady lean one way usually means the speakers/headphones add delay the
  // device doesn't report; offer to fold it into the timing
  const timed = result.earlyCount + result.lateCount;
  const lean = timed > 0 ? (result.lateSumMs - result.earlySumMs) / timed : 0;
  const offerShift = timed >= 16 && Math.abs(lean) >= 12;
  const [applied, setApplied] = useState<number | null>(null);
  const applyShift = () => {
    const next = Math.max(-100, Math.min(500, Math.round(currentCalMs() + lean)));
    try {
      localStorage.setItem(CAL_KEY, String(next));
    } catch {
      // storage blocked: nothing to persist
    }
    setApplied(next);
  };

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

      {offerShift && (
        <div className="timing-fix">
          {applied === null ? (
            <>
              <span>
                You hit <b>{Math.round(Math.abs(lean))} ms {lean > 0 ? 'late' : 'early'}</b> on average. If you were
                playing along to what you heard, your audio has extra delay.
              </span>
              <button type="button" className="btn" onClick={applyShift}>
                Shift timing {lean > 0 ? '+' : '−'}
                {Math.round(Math.abs(lean))} ms
              </button>
            </>
          ) : (
            <span>
              Timing set to <b>{applied} ms</b>. Play again to feel it (change it any time in ☰ Menu → Audio sync).
            </span>
          )}
        </div>
      )}

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
