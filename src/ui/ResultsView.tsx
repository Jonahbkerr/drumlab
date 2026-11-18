import type { RunResult } from '../engine/game';
import { LANES, LANE_LABEL } from '../engine/types';
import Stars from './Stars';
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
  /** small line above the title: path name or "Song" */
  kicker: string;
  result: RunResult;
  isBest: boolean;
  nextLabel?: string;
  onRetry: () => void;
  onNext?: () => void;
  onHome: () => void;
  homeLabel?: string;
}

export default function ResultsView({ title, kicker, result, isBest, nextLabel, onRetry, onNext, onHome, homeLabel = 'Back' }: Props) {
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
  const acc = Math.round(result.accuracy * 100);
  const nextFirst = result.completed && nextLabel && onNext;

  return (
    <div className="results">
      <div className="result-hero">
        <div className="kicker">
          {kicker} · {result.mode === 'performance' ? 'Perform' : 'Practice'}
        </div>
        <h1>{title}</h1>
        <div className="result-acc">
          {acc}
          <small>%</small>
        </div>
        <Stars count={3} filled={stars} size={22} />
        {isBest && <p className="result-best">New best accuracy</p>}
        {!result.completed && result.mode === 'performance' && (
          <p className="faint" style={{ marginTop: 10, fontSize: 13 }}>
            60% earns the first star.
          </p>
        )}
        <div className="result-actions">
          {nextFirst ? (
            <>
              <button type="button" className="btn btn-primary btn-lg" onClick={onNext}>
                {nextLabel}
              </button>
              <button type="button" className="btn btn-lg" onClick={onRetry}>
                Play again
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-primary btn-lg" onClick={onRetry}>
                Play again
              </button>
              {nextLabel && onNext && (
                <button type="button" className="btn btn-lg" onClick={onNext}>
                  {nextLabel}
                </button>
              )}
            </>
          )}
          <button type="button" className="btn btn-quiet" onClick={onHome}>
            {homeLabel}
          </button>
        </div>
      </div>

      <div>
        <div className="result-table">
          <div>
            <div className="label">Notes hit</div>
            <div className="v">
              {result.hits}
              <span className="faint">/{result.total}</span>
            </div>
          </div>
          <div>
            <div className="label">Perfect</div>
            <div className="v">{result.perfects}</div>
          </div>
          <div>
            <div className="label">Best streak</div>
            <div className="v">{result.maxCombo}</div>
          </div>
          <div>
            <div className="label">Score</div>
            <div className="v">{result.score.toLocaleString()}</div>
          </div>
        </div>

        <h2 className="result-sub">By drum</h2>
        {LANES.map((lane) => {
          const s = result.perLane[lane];
          const total = s.hit + s.miss;
          if (total === 0) return null;
          const pct = (s.hit / total) * 100;
          return (
            <div className="lane-acc" key={lane}>
              <span>{LANE_LABEL[lane]}</span>
              <span className="track">
                <span style={{ width: `${pct}%`, background: `var(--${lane.toLowerCase()})` }} />
              </span>
              <span className="pct">
                {s.hit}/{total}
              </span>
            </div>
          );
        })}

        <h2 className="result-sub">Timing</h2>
        <div className="timing">
          <div>
            <div className="label">Early</div>
            <div className="v">
              {result.earlyCount} <span className="faint" style={{ fontSize: 13 }}>avg {earlyAvg.toFixed(0)} ms</span>
            </div>
          </div>
          <div>
            <div className="label">Late</div>
            <div className="v">
              {result.lateCount} <span className="faint" style={{ fontSize: 13 }}>avg {lateAvg.toFixed(0)} ms</span>
            </div>
          </div>
          <div>
            <div className="label">Missed</div>
            <div className="v">{result.misses}</div>
          </div>
        </div>
        {offerShift && (
          <div className="timing-fix">
            {applied === null ? (
              <>
                <span>
                  You played <b>{Math.round(Math.abs(lean))} ms {lean > 0 ? 'late' : 'early'}</b> on average. If you were playing along
                  to what you heard, your audio has extra delay.
                </span>
                <button type="button" className="btn" onClick={applyShift}>
                  Shift timing {lean > 0 ? '+' : '−'}
                  {Math.round(Math.abs(lean))} ms
                </button>
              </>
            ) : (
              <span>
                Timing set to <b className="mono">{applied} ms</b>. Play again to feel it, or adjust it in the play menu under Audio delay.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
