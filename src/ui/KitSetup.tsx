import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sharedAudio } from '../engine/audio';
import { GM_TO_LANE, LANE_KEY, MidiManager } from '../engine/midi';
import type { MidiDevice, MidiEvent } from '../engine/midi';
import { LANES, LANE_LABEL } from '../engine/types';
import type { Lane } from '../engine/types';
import KitView from './KitView';
import type { KitHandle, KitLabel } from './KitView';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

/** cymbals on top, kick at the bottom, like the play screen and drum notation */
const ROWS: Lane[] = ['crash', 'hh', 'tomHi', 'snare', 'tomLo', 'kick'];

const KEY_FOR = LANE_KEY;

const STATUS: Record<string, { text: string; tone: 'ok' | 'bad' | 'idle' }> = {
  'no-midi': { text: 'This browser has no Web MIDI. Open DrumLab in Chrome or Edge.', tone: 'bad' },
  'midi-denied': { text: 'MIDI access is blocked. Allow it to use your kit.', tone: 'bad' },
  'midi:none': { text: 'MIDI is on, but no kit is connected. Plug it in over USB.', tone: 'idle' },
  'checking…': { text: 'Checking for MIDI devices…', tone: 'idle' },
};

const gmNotesFor = (lane: Lane) =>
  Object.entries(GM_TO_LANE)
    .filter(([, l]) => l === lane)
    .map(([n]) => Number(n));

export default function KitSetup() {
  const [status, setStatus] = useState('checking…');
  const [devices, setDevices] = useState<MidiDevice[]>([]);
  const [events, setEvents] = useState<MidiEvent[]>([]);
  const [map, setMap] = useState<Record<number, Lane>>({});
  const [learning, setLearning] = useState<Lane | null>(null);
  const [busy, setBusy] = useState(false);
  // the MIDI handler is created once; it must read the CURRENT learn target
  const learningRef = useRef<Lane | null>(null);
  const learn = (lane: Lane | null) => {
    learningRef.current = lane;
    setLearning(lane);
  };

  const kitRef = useRef<KitHandle | null>(null);
  // a pad (or key) was played: light its drum on the kit and sound it
  const play = (lane: Lane, vel: number) => {
    kitRef.current?.strike(lane, vel);
    sharedAudio.ensure();
    sharedAudio.hit(lane, sharedAudio.time(), vel);
  };

  const mmRef = useRef<MidiManager | null>(null);
  useEffect(() => {
    let cancelled = false;
    const m: MidiManager = new MidiManager(
      (lane, vel) => {
        // while assigning, the pad belongs to the drum being assigned (below)
        if (!learningRef.current) play(lane, vel);
      },
      (ev) => {
        setEvents((e) => [ev, ...e].slice(0, 8));
        const target = learningRef.current;
        if (target) {
          // one pad per lane: drop the lane's previous pad first
          for (const [n, l] of Object.entries(m.customMap)) if (l === target) m.unassign(Number(n));
          m.assign(ev.note, target);
          setMap(m.customMap);
          learningRef.current = null;
          setLearning(null);
          play(target, ev.vel);
        }
      },
      (devs) => setDevices(devs),
    );
    mmRef.current = m;
    m.attachKeyboard();
    void m.init().then((s) => {
      if (!cancelled) {
        setStatus(s);
        setMap(m.customMap);
      }
    });
    return () => {
      cancelled = true;
      m.detach();
    };
    // play() only touches refs and the shared audio engine
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestAccess = async () => {
    const mm = mmRef.current;
    if (!mm) return;
    setBusy(true);
    setStatus(await mm.init());
    setMap(mm.customMap);
    setBusy(false);
  };

  const padFor = (lane: Lane): number | undefined => {
    const hit = Object.entries(map).find(([, l]) => l === lane);
    return hit ? Number(hit[0]) : undefined;
  };

  const connected = devices.length > 0;
  // stable between MIDI hits, so the drawn kit only re-renders when a pad changes
  const kitLabels = useMemo(() => {
    const padOf = (lane: Lane) => Object.entries(map).find(([, l]) => l === lane)?.[0];
    return Object.fromEntries(
      LANES.map((l) => [l, { name: LANE_LABEL[l], hint: learning === l ? 'Hit a pad…' : padOf(l) }]),
    ) as Record<Lane, KitLabel>;
  }, [map, learning]);
  const pickDrum = useCallback((lane: Lane) => {
    sharedAudio.ensure();
    const next = learningRef.current === lane ? null : lane;
    learningRef.current = next;
    setLearning(next);
  }, []);
  const st = connected
    ? { text: `${devices.length === 1 ? devices[0].name : `${devices.length} devices`} connected`, tone: 'ok' as const }
    : (STATUS[status] ?? { text: status, tone: 'idle' as const });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Kit</h1>
          <p>Connect an electronic kit over USB and choose which pad plays each lane. Unassigned pads use the General MIDI drum map.</p>
        </div>
      </div>

      <div className="surface status">
        <div>
          <div className="status-text">
            <span className={`status-dot ${st.tone === 'ok' ? 'ok' : st.tone === 'bad' ? 'bad' : ''}`} />
            <span>{st.text}</span>
          </div>
          {devices.length > 1 && <div className="status-devices">{devices.map((d) => d.name).join(' · ')}</div>}
        </div>
        {!connected && (
          <button type="button" className="btn" onClick={requestAccess} disabled={busy}>
            {busy ? 'Requesting…' : 'Allow MIDI'}
          </button>
        )}
      </div>

      <section className="surface kit-stage" aria-label="Your kit">
        <KitView
          ref={kitRef}
          labels={kitLabels}
          selected={learning}
          onPad={pickDrum}
        />
        <p className="kit-stage-hint" aria-live="polite">
          {learning ? (
            <>
              Hit the pad you want for <b>{LANE_LABEL[learning]}</b>. Click the drum again to cancel.
            </>
          ) : connected ? (
            'Hit any pad and its drum lights up. Click a drum to give it a different pad.'
          ) : (
            'Connect your kit, or press D F J K L ; to try it. Click a drum to choose its pad.'
          )}
        </p>
      </section>

      <div className="kit-grid">
        <section aria-labelledby="map-title">
          <h2 className="section-title" id="map-title">
            Pads
          </h2>
          <p className="section-sub">Press Assign, then hit the pad you want for that lane.</p>
          {ROWS.map((lane) => {
            const pad = padFor(lane);
            const isLearning = learning === lane;
            return (
              <div key={lane} className={`map-row${isLearning ? ' learning' : ''}`}>
                <span className="swatch" style={{ background: `var(--${lane.toLowerCase()})` }} />
                <span>
                  <div className="map-name">{LANE_LABEL[lane]}</div>
                  <div className="map-key">
                    Key <span className="kbd">{KEY_FOR[lane]}</span>
                  </div>
                </span>
                <span className={`map-note${pad === undefined ? ' default' : ''}`}>
                  {isLearning
                    ? 'Hit a pad…'
                    : pad !== undefined
                      ? `${noteName(pad)} · ${pad}`
                      : `GM ${gmNotesFor(lane).slice(0, 3).join(', ')}`}
                </span>
                <span className="map-actions">
                  <button type="button" className={`btn${isLearning ? ' btn-primary' : ''}`} onClick={() => learn(isLearning ? null : lane)}>
                    {isLearning ? 'Cancel' : 'Assign'}
                  </button>
                  {pad !== undefined && !isLearning && (
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => {
                        const mm = mmRef.current;
                        mm?.unassign(pad);
                        if (mm) setMap(mm.customMap);
                      }}
                    >
                      Reset
                    </button>
                  )}
                </span>
              </div>
            );
          })}
          {Object.keys(map).length > 0 && (
            <button
              type="button"
              className="btn btn-quiet"
              style={{ marginTop: 12 }}
              onClick={() => {
                const mm = mmRef.current;
                mm?.resetMap();
                if (mm) setMap(mm.customMap);
              }}
            >
              Reset all pads to General MIDI
            </button>
          )}
        </section>

        <aside className="surface monitor" aria-labelledby="monitor-title">
          <h2 className="section-title" id="monitor-title">
            Live input
          </h2>
          <p className="section-sub" style={{ marginBottom: 0 }}>
            Every pad you hit shows here with its MIDI note.
          </p>
          {events.length === 0 ? (
            <p className="faint" style={{ marginTop: 14, fontSize: 12.5 }}>
              Nothing yet. Hit a pad.
            </p>
          ) : (
            <ul className="monitor-list">
              {events.map((ev, i) => (
                <li key={i}>
                  <span className="mono">{noteName(ev.note)}</span>
                  <span className="mono faint">{ev.note}</span>
                  <span className="lane">
                    {ev.lane ? (
                      <>
                        <span className="swatch" style={{ background: `var(--${ev.lane.toLowerCase()})` }} />
                        {LANE_LABEL[ev.lane]}
                      </>
                    ) : (
                      <span className="faint">Not mapped</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </>
  );
}
