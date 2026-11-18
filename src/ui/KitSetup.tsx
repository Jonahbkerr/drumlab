import { useEffect, useRef, useState } from 'react';
import { MidiManager } from '../engine/midi';
import type { MidiDevice, MidiEvent } from '../engine/midi';
import { LANES, LANE_LABEL } from '../engine/types';
import type { Lane } from '../engine/types';
import { LANE_COLOR } from '../engine/game';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

const STATUS_LABEL: Record<string, string> = {
  'no-midi': 'This browser has no Web MIDI. Open the game in Chrome or Edge — the embedded preview pane may block it.',
  'midi-denied': 'MIDI access was blocked. Click "Grant MIDI access" and allow it.',
  'midi:none': 'MIDI ready, but no devices found. Plug in your kit over USB, then reload this page.',
};

interface Props {
  onBack: () => void;
}

export default function KitSetup({ onBack }: Props) {
  const [status, setStatus] = useState('checking…');
  const [devices, setDevices] = useState<MidiDevice[]>([]);
  const [events, setEvents] = useState<MidiEvent[]>([]);
  const [map, setMap] = useState<Record<number, Lane>>({});
  const [learning, setLearning] = useState<Lane | null>(null);
  const [busy, setBusy] = useState(false);

  const mmRef = useRef<MidiManager | null>(null);
  if (!mmRef.current) {
    mmRef.current = new MidiManager(
      () => {},
      (ev) => {
        setEvents((e) => [ev, ...e].slice(0, 10));
        const mm = mmRef.current!;
        if (learning) {
          mm.assign(ev.note, learning);
          setMap(mm.customMap);
          setLearning(null);
        }
      },
      (devs) => setDevices(devs),
    );
  }
  const mm = mmRef.current;

  useEffect(() => {
    let cancelled = false;
    void mm.init().then((s) => {
      if (!cancelled) {
        setStatus(s);
        setMap(mm.customMap);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mm]);

  const requestAccess = async () => {
    setBusy(true);
    const s = await mm.init();
    setStatus(s);
    setMap(mm.customMap);
    setBusy(false);
  };

  const noteForLane = (lane: Lane): number | undefined => {
    const entries = Object.entries(map);
    const hit = entries.find(([, l]) => l === lane);
    return hit ? Number(hit[0]) : undefined;
  };

  return (
    <div className="app">
      <div className="view-head">
        <button type="button" className="back-link" onClick={onBack}>
          ← Back
        </button>
        <div>
          <h2 style={{ fontSize: 26 }}>🥁 Kit setup</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '4px 0 0' }}>
            Connect your kit to the lanes — hit each pad to learn it.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="tag">MIDI status</div>
            <p style={{ margin: '6px 0 0', color: 'var(--text)', fontSize: 14.5, fontWeight: 600 }}>
              {STATUS_LABEL[status] ?? `${devices.length} device(s) connected`}
            </p>
            {devices.length > 0 && (
              <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 13 }}>
                {devices.map((d) => d.name).join(' · ')}
              </p>
            )}
          </div>
          <button type="button" className="btn primary" onClick={requestAccess} disabled={busy}>
            {busy ? 'Requesting…' : 'Grant MIDI access'}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="tag">Live monitor</div>
        <p style={{ color: 'var(--muted)', fontSize: 13.5, margin: '6px 0 10px' }}>
          Hit any pad — the note number your kit sends appears here.
        </p>
        {events.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13.5, margin: 0 }}>No hits seen yet.</p>
        ) : (
          <div className="event-list">
            {events.map((ev, i) => (
              <div key={i} className="event-row">
                <span className="kbd">{noteName(ev.note)}</span>
                <span className="kbd">#{ev.note}</span>
                <span
                  className="lane-chip"
                  style={{
                    borderColor: ev.lane ? LANE_COLOR[ev.lane] : 'var(--border)',
                    color: ev.lane ? LANE_COLOR[ev.lane] : 'var(--muted)',
                  }}
                >
                  {ev.lane ? LANE_LABEL[ev.lane] : 'unmapped'}
                </span>
                <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>{ev.device}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="tag">Connect the dots — pad → lane</div>
        <p style={{ color: 'var(--muted)', fontSize: 13.5, margin: '6px 0 14px' }}>
          Click a lane&apos;s Learn button, then hit the pad you want on that lane. Unmapped pads
          fall back to the standard General MIDI drum map.
        </p>
        <div className="lane-map">
          {LANES.map((lane) => {
            const note = noteForLane(lane);
            return (
              <div key={lane} className="lane-map-row">
                <span
                  className="lane-dot"
                  style={{ background: LANE_COLOR[lane], boxShadow: `0 0 12px ${LANE_COLOR[lane]}66` }}
                />
                <span style={{ fontWeight: 700, width: 110 }}>{LANE_LABEL[lane]}</span>
                <span className="pill" style={{ minWidth: 110, justifyContent: 'center' }}>
                  {note !== undefined ? `${noteName(note)} (#${note})` : 'GM default'}
                </span>
                <button
                  type="button"
                  className={`btn${learning === lane ? ' active learn' : ''}`}
                  onClick={() => setLearning(learning === lane ? null : lane)}
                >
                  {learning === lane ? 'Listening… hit a pad' : 'Learn'}
                </button>
                {note !== undefined && (
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => {
                      mm.unassign(note);
                      setMap(mm.customMap);
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="btn ghost"
          style={{ marginTop: 14 }}
          onClick={() => {
            mm.resetMap();
            setMap(mm.customMap);
          }}
        >
          Reset all to GM defaults
        </button>
      </div>
    </div>
  );
}
