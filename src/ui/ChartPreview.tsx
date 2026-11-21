import { useMemo } from 'react';
import { BeatGrid } from '../engine/chart/arrange';
import type { SongChart } from '../engine/transcribe';
import { LANE_LABEL, rowsFor } from '../engine/types';
import type { Lane } from '../engine/types';

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
    // ...and that has the groove's kick and snare in every bar (not a hats-only intro)
    const used = new Set(chart.notes.map((n) => n.lane));
    const core = (['kick', 'snare'] as Lane[]).filter((l) => used.has(l));
    const hasCore = (bar: number) =>
      core.every((lane) => {
        for (let s = bar * 16; s < (bar + 1) * 16; s++) if (bySlot.get(s)?.has(lane)) return true;
        return false;
      });
    let start = 0;
    for (let bar = 0; bar + BARS <= totalBars; bar++) {
      const window = Array.from({ length: BARS }, (_, k) => bar + k);
      if (window.every((b) => perBar[b] >= typical * 0.75 && hasCore(b))) {
        start = bar;
        break;
      }
    }
    const rows = rowsFor(chart.notes);
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
              const here = view.bySlot.get(slot);
              // the hi-hat row holds open hats too, hollow
              const open = lane === 'hh' && (here?.has('hhOpen') ?? false);
              const on = here?.has(lane) ?? false;
              const cls = ['cell', i % 4 === 0 ? 'beat' : '', i % 16 === 0 ? 'bar' : ''].join(' ');
              return (
                <span key={i} className={cls}>
                  {open ? <i className="open" /> : on && <i style={{ background: `var(--${lane.toLowerCase()})` }} />}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
