import { useMemo } from 'react';
import { BeatGrid } from '../engine/chart/arrange';
import type { SongChart } from '../engine/transcribe';
import { LANE_LABEL } from '../engine/types';
import type { Lane } from '../engine/types';

const ROWS: Lane[] = ['crash', 'hh', 'tomHi', 'snare', 'tomLo', 'kick'];
const BARS = 2;

/** Two bars of the chart as a drum grid, starting at the first busy bar. */
export default function ChartPreview({ chart }: { chart: SongChart }) {
  const view = useMemo(() => {
    const beats = chart.beats ?? [];
    const grid = new BeatGrid(beats, 60 / chart.bpm);
    const down = chart.downbeat ?? 0;
    const bySlot = new Map<number, Set<Lane>>();
    for (const n of chart.notes) {
      const s = grid.slotAt(n.t) - down * 4;
      const set = bySlot.get(s) ?? new Set<Lane>();
      set.add(n.lane);
      bySlot.set(s, set);
    }
    // first stretch as busy as this chart's typical bar (skip sparse intros)
    const totalBars = Math.max(1, Math.floor((beats.length - down) / 4));
    const perBar = Array.from({ length: totalBars }, (_, bar) => {
      let c = 0;
      for (let s = bar * 16; s < (bar + 1) * 16; s++) c += bySlot.get(s)?.size ?? 0;
      return c;
    });
    const busy = perBar.filter((c) => c > 0).sort((a, b) => a - b);
    const typical = busy[Math.floor(busy.length / 2)] ?? 0;
    let start = 0;
    for (let bar = 0; bar + BARS <= totalBars; bar++) {
      if (perBar.slice(bar, bar + BARS).every((c) => c >= typical * 0.75)) {
        start = bar;
        break;
      }
    }
    const used = new Set(chart.notes.map((n) => n.lane));
    const rows = ROWS.filter((l) => used.has(l));
    const at = grid.slotTime((down + start * 4) * 4);
    return { rows, bySlot, start, at };
  }, [chart]);

  const cells = BARS * 16;
  return (
    <div className="chart-preview" aria-label="Chart preview">
      <div className="chart-preview-head">
        <span>
          Bars {view.start + 1}–{view.start + BARS}
        </span>
        <span>
          {Math.floor(view.at / 60)}:{String(Math.floor(view.at % 60)).padStart(2, '0')}
        </span>
      </div>
      <div className="chart-preview-grid" style={{ gridTemplateColumns: `64px repeat(${cells}, 1fr)` }}>
        {view.rows.map((lane) => (
          <div key={lane} className="chart-preview-row">
            <span className="chart-preview-label">{LANE_LABEL[lane]}</span>
            {Array.from({ length: cells }, (_, i) => {
              const slot = view.start * 16 + i;
              const on = view.bySlot.get(slot)?.has(lane) ?? false;
              const cls = ['cell', i % 4 === 0 ? 'beat' : '', i % 16 === 0 ? 'bar' : ''].join(' ');
              return (
                <span key={i} className={cls}>
                  {on && <i style={{ background: `var(--${lane.toLowerCase()})` }} />}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
