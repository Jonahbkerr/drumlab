import { memo, useId, useImperativeHandle, useRef } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, Ref } from 'react';
import { LANES } from '../engine/types';
import type { Lane } from '../engine/types';

/**
 * The drum kit, drawn: hi-hat, snare, kick, high tom, low tom, crash.
 * Each piece lights up in its lane colour when its pad is hit, glows as its
 * next note comes up, and flashes red when a note on it goes by unplayed.
 * Animations run straight on the SVG nodes (no React state per frame).
 */

export interface KitHandle {
  /** a pad was hit: light its drum (vel 0..1 sets how bright) */
  strike(lane: Lane, vel?: number): void;
  /** a note on this drum went by unplayed */
  miss(lane: Lane): void;
  /** per drum, 0..1: how close its next note is (1 = hit it now) */
  cue(levels: Record<Lane, number>): void;
}

export interface KitLabel {
  name: string;
  hint?: string;
}

interface Props {
  ref?: Ref<KitHandle>;
  labels: Record<Lane, KitLabel>;
  /** drums the lesson or song uses; the others are dimmed */
  inUse?: Lane[];
  /** drum waiting for its pad (Kit page) */
  selected?: Lane | null;
  onPad?: (lane: Lane, at: number) => void;
  /** short strip on the play screen: larger type so labels stay legible */
  compact?: boolean;
  className?: string;
}

const LANE_VAR: Record<Lane, string> = {
  kick: 'var(--kick)',
  snare: 'var(--snare)',
  hh: 'var(--hh)',
  tomLo: 'var(--tomlo)',
  tomHi: 'var(--tomhi)',
  crash: 'var(--crash)',
};

// geometry, in viewBox units
const FLOOR = 352;
const HH = { cx: 120, cy: 156, rx: 62, ry: 8.5 };
const SN = { cx: 258, top: 224, rx: 68, ry: 17, h: 34 };
const KK = { cx: 402, cy: 252, r: 98 };
const TH = { cx: 452, top: 112, rx: 57, ry: 15, h: 50 };
const TL = { cx: 594, top: 214, rx: 74, ry: 19, h: 90 };
const CR = { cx: 664, cy: 84, rx: 98, ry: 15, tilt: -9 };

type DrumGeo = { cx: number; top: number; rx: number; ry: number; h: number };

const DRUM_HIT: Keyframe[] = [{ transform: 'translateY(3px)' }, { transform: 'translateY(0px)' }];
const MOTION: Record<Lane, { frames: Keyframe[]; ms: number }> = {
  kick: { frames: [{ transform: 'scale(0.972)' }, { transform: 'scale(1)' }], ms: 230 },
  snare: { frames: DRUM_HIT, ms: 170 },
  tomHi: { frames: DRUM_HIT, ms: 190 },
  tomLo: { frames: DRUM_HIT, ms: 210 },
  hh: {
    frames: [
      { transform: 'translateY(3.5px) rotate(1.4deg)' },
      { transform: 'translateY(0px) rotate(-0.6deg)' },
      { transform: 'translateY(0px) rotate(0deg)' },
    ],
    ms: 260,
  },
  crash: {
    frames: [
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(-6deg)' },
      { transform: 'rotate(4deg)' },
      { transform: 'rotate(-2.2deg)' },
      { transform: 'rotate(1deg)' },
      { transform: 'rotate(0deg)' },
    ],
    ms: 950,
  },
};
const EASE_OUT = 'cubic-bezier(0.15, 0.7, 0.3, 1)';

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;


/** memoised: the play screen re-renders ten times a second for its score, the kit must not */
export default memo(KitView);

function KitView({ ref, labels, inUse, selected, onPad, compact, className }: Props) {
  const uid = `kit${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const url = (name: string) => `url(#${uid}-${name})`;
  const parts = useRef<Record<string, SVGElement | null>>({});
  const cues = useRef<Record<string, number>>({});
  const reg = (key: string) => (el: SVGElement | null) => {
    parts.current[key] = el;
  };

  useImperativeHandle(
    ref,
    () => ({
      strike(lane, vel = 1) {
        const v = 0.5 + 0.5 * Math.min(1, Math.max(0, vel));
        const p = parts.current;
        // a drum this song doesn't use is dimmed: bring it up while it sounds
        const g = p[`${lane}:g`];
        if (g?.classList.contains('off')) {
          g.animate([{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: 0.3 }], { duration: 700, easing: 'ease-out' });
        }
        p[`${lane}:flash`]?.animate([{ opacity: 0.9 * v }, { opacity: 0 }], { duration: 380, easing: EASE_OUT });
        p[`${lane}:halo`]?.animate([{ opacity: 0.7 * v }, { opacity: 0 }], { duration: 560, easing: EASE_OUT });
        if (!reducedMotion()) {
          const m = MOTION[lane];
          p[`${lane}:body`]?.animate(m.frames, { duration: m.ms, easing: EASE_OUT });
        }
      },
      miss(lane) {
        parts.current[`${lane}:miss`]?.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: 620, easing: 'ease-out' });
      },
      cue(levels) {
        for (const lane of LANES) {
          // ease in so the glow builds toward the hit; 1/24 steps keep DOM writes rare
          const v = Math.round(Math.pow(Math.min(1, Math.max(0, levels[lane])), 1.5) * 24) / 24;
          if (cues.current[lane] === v) continue;
          cues.current[lane] = v;
          // set on the two shapes that use it, not the group: no restyle of the whole drum
          for (const role of ['ring', 'cue']) parts.current[`${lane}:${role}`]?.style.setProperty('--cue', String(v));
        }
      },
    }),
    [],
  );

  const used = inUse ? new Set(inUse) : null;
  const pieceProps = (lane: Lane, kind: 'drum' | 'cym' | 'kick') => ({
    ref: reg(`${lane}:g`),
    className: `kp kp-${kind}${used && !used.has(lane) ? ' off' : ''}${selected === lane ? ' sel' : ''}`,
    style: { '--c': LANE_VAR[lane] } as CSSProperties,
    role: onPad ? 'button' : undefined,
    'aria-label': labels[lane].name,
    onPointerDown: onPad
      ? (e: ReactPointerEvent) => {
          e.preventDefault();
          onPad(lane, e.timeStamp);
        }
      : undefined,
  });

  const label = (lane: Lane, x: number, y: number) => (
    <text className="kp-name" x={x} y={y}>
      {labels[lane].name}
      {labels[lane].hint && (
        <tspan className="kp-hint" dx={compact ? 9 : 7}>
          {labels[lane].hint}
        </tspan>
      )}
    </text>
  );

  // a drum seen from the front and a little above: shell, lugs, hoops, mesh head
  const drum = (lane: Lane, d: DrumGeo) => {
    const { cx, top, rx, ry, h } = d;
    const lugs = [-58, -20, 20, 58].map((deg) => {
      const a = (deg * Math.PI) / 180;
      const x = cx + rx * Math.sin(a);
      const y = top + ry * Math.cos(a) + h * 0.5;
      const lh = Math.max(12, h * 0.42);
      return <rect key={deg} className="kp-lug" x={x - 2.2} y={y - lh / 2} width={4.4} height={lh} rx={2} />;
    });
    const head = { cx, cy: top, rx: rx - 2, ry: ry - 1.5 };
    return (
      <>
        <ellipse ref={reg(`${lane}:halo`)} className="kp-halo" filter={url('blur')} cx={cx} cy={top + h * 0.4} rx={rx + 16} ry={ry + h * 0.5 + 8} />
        <g ref={reg(`${lane}:body`)} className="kp-body">
          <path
            d={`M${cx - rx} ${top} V${top + h} A${rx} ${ry} 0 0 0 ${cx + rx} ${top + h} V${top} A${rx} ${ry} 0 0 0 ${cx - rx} ${top} Z`}
            fill={url('shell')}
          />
          {lugs}
          <path className="kp-rim" d={`M${cx - rx} ${top + h} A${rx} ${ry} 0 0 0 ${cx + rx} ${top + h}`} />
          <ellipse {...head} fill={url('head')} />
          <ellipse {...head} fill={url('mesh')} />
          <ellipse {...head} ref={reg(`${lane}:cue`)} className="kp-cue" />
          <ellipse ref={reg(`${lane}:ring`)} cx={cx} cy={top} rx={rx - 10} ry={ry - 5} className="kp-ring" />
          <ellipse {...head} ref={reg(`${lane}:flash`)} className="kp-flash" />
          <ellipse className="kp-rim" cx={cx} cy={top} rx={rx} ry={ry} />
        </g>
        <ellipse ref={reg(`${lane}:miss`)} className="kp-miss" cx={cx} cy={top} rx={rx + 4} ry={ry + 3} />
        {label(lane, cx, top - ry - (compact ? 12 : 11))}
      </>
    );
  };

  // a cymbal: thin bronze disc with an edge, lathe grooves and a bell
  const cymbal = (lane: Lane, c: { cx: number; cy: number; rx: number; ry: number }) => (
    <>
      <ellipse cx={c.cx} cy={c.cy + 2.6} rx={c.rx} ry={c.ry} fill="#383126" />
      <ellipse cx={c.cx} cy={c.cy} rx={c.rx} ry={c.ry} fill={url('bronze')} />
      <ellipse className="kp-groove" cx={c.cx} cy={c.cy} rx={c.rx * 0.74} ry={c.ry * 0.74} />
      <ellipse className="kp-groove" cx={c.cx} cy={c.cy} rx={c.rx * 0.47} ry={c.ry * 0.47} />
      <ellipse cx={c.cx} cy={c.cy - 1.4} rx={c.rx * 0.2} ry={c.ry * 0.5} fill={url('bell')} />
      <ellipse ref={reg(`${lane}:cue`)} className="kp-cue" cx={c.cx} cy={c.cy} rx={c.rx} ry={c.ry} />
      <ellipse ref={reg(`${lane}:ring`)} className="kp-ring" cx={c.cx} cy={c.cy} rx={c.rx - 7} ry={c.ry - 2.6} />
      <ellipse ref={reg(`${lane}:flash`)} className="kp-flash" cx={c.cx} cy={c.cy} rx={c.rx} ry={c.ry} />
    </>
  );

  const claws = Array.from({ length: 10 }, (_, i) => {
    const deg = i * 36 + 18;
    const a = (deg * Math.PI) / 180;
    const x = KK.cx + (KK.r - 3) * Math.cos(a);
    const y = KK.cy + (KK.r - 3) * Math.sin(a);
    return <rect key={i} className="kp-lug" x={x - 3.5} y={y - 6.5} width={7} height={13} rx={2} transform={`rotate(${deg + 90} ${x} ${y})`} />;
  });

  return (
    <svg
      className={`kit${compact ? ' compact' : ''}${className ? ` ${className}` : ''}`}
      viewBox="40 22 740 342"
      role="group"
      aria-label="Drum kit"
    >
      <defs>
        <linearGradient id={`${uid}-shell`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#0e1013" />
          <stop offset="0.2" stopColor="#262a30" />
          <stop offset="0.4" stopColor="#3b4048" />
          <stop offset="0.62" stopColor="#262a30" />
          <stop offset="1" stopColor="#0d0f12" />
        </linearGradient>
        <linearGradient id={`${uid}-chrome`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#a4abb5" />
          <stop offset="0.5" stopColor="#4c525b" />
          <stop offset="1" stopColor="#7e858f" />
        </linearGradient>
        <radialGradient id={`${uid}-head`} cx="0.5" cy="0.4" r="0.62">
          <stop offset="0" stopColor="#30343b" />
          <stop offset="1" stopColor="#191b1f" />
        </radialGradient>
        <radialGradient id={`${uid}-kickhead`} cx="0.44" cy="0.38" r="0.68">
          <stop offset="0" stopColor="#2c3036" />
          <stop offset="0.72" stopColor="#1a1d21" />
          <stop offset="1" stopColor="#121417" />
        </radialGradient>
        <radialGradient id={`${uid}-bronze`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#9c8c66" />
          <stop offset="0.5" stopColor="#6e6248" />
          <stop offset="1" stopColor="#463e2f" />
        </radialGradient>
        <radialGradient id={`${uid}-bell`} cx="0.5" cy="0.35" r="0.6">
          <stop offset="0" stopColor="#c2ae82" />
          <stop offset="1" stopColor="#8a7a56" />
        </radialGradient>
        <radialGradient id={`${uid}-floor`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.55" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <pattern id={`${uid}-mesh`} width="5" height="5" patternUnits="userSpaceOnUse">
          <path d="M0 0L5 5M5 0L0 5" stroke="#fff" strokeOpacity="0.06" strokeWidth="0.7" />
        </pattern>
        <filter id={`${uid}-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="11" />
        </filter>
      </defs>

      <ellipse cx="410" cy={FLOOR + 2} rx="370" ry="16" fill={url('floor')} />

      {/* hi-hat */}
      <g {...pieceProps('hh', 'cym')}>
        <path className="kp-leg" d={`M${HH.cx} 296 L${HH.cx - 32} ${FLOOR} M${HH.cx} 296 L${HH.cx + 32} ${FLOOR}`} />
        <rect className="kp-pole" x={HH.cx - 3.5} y={226} width={7} height={74} rx={2} />
        <rect className="kp-pole" x={HH.cx - 1.5} y={132} width={3} height={98} />
        <path className="kp-pole" d={`M${HH.cx - 16} ${FLOOR} L${HH.cx + 18} ${FLOOR} L${HH.cx + 13} ${FLOOR - 11} L${HH.cx - 12} ${FLOOR - 11} Z`} />
        <ellipse ref={reg('hh:halo')} className="kp-halo" filter={url('blur')} cx={HH.cx} cy={HH.cy + 4} rx={HH.rx + 22} ry={26} />
        <g ref={reg('hh:body')} className="kp-body">
          <ellipse cx={HH.cx} cy={HH.cy + 13} rx={HH.rx} ry={HH.ry} fill="#383126" />
          <ellipse cx={HH.cx} cy={HH.cy + 10.5} rx={HH.rx} ry={HH.ry} fill={url('bronze')} opacity="0.75" />
          {cymbal('hh', HH)}
          <rect className="kp-pole" x={HH.cx - 2.5} y={HH.cy - 12} width={5} height={8} rx={1} />
        </g>
        <ellipse ref={reg('hh:miss')} className="kp-miss" cx={HH.cx} cy={HH.cy + 4} rx={HH.rx + 5} ry={HH.ry + 9} />
        <ellipse className="kp-hit" cx={HH.cx} cy={HH.cy + 6} rx={HH.rx + 8} ry={30} />
        {label('hh', HH.cx, HH.cy - (compact ? 30 : 28))}
      </g>

      {/* crash on a boom stand */}
      <g {...pieceProps('crash', 'cym')}>
        <path className="kp-leg" d={`M736 300 L708 ${FLOOR} M736 300 L764 ${FLOOR}`} />
        <rect className="kp-pole" x={732.5} y={150} width={7} height={152} rx={2} />
        <path className="kp-leg" d={`M736 152 L${CR.cx + 4} ${CR.cy + 4}`} />
        <g transform={`rotate(${CR.tilt} ${CR.cx} ${CR.cy})`}>
          <ellipse ref={reg('crash:halo')} className="kp-halo" filter={url('blur')} cx={CR.cx} cy={CR.cy} rx={CR.rx + 26} ry={CR.ry + 20} />
          <g ref={reg('crash:body')} className="kp-body">
            {cymbal('crash', CR)}
          </g>
          <ellipse ref={reg('crash:miss')} className="kp-miss" cx={CR.cx} cy={CR.cy + 1} rx={CR.rx + 5} ry={CR.ry + 5} />
          <ellipse className="kp-hit" cx={CR.cx} cy={CR.cy + 4} rx={CR.rx + 10} ry={CR.ry + 22} />
        </g>
        {label('crash', CR.cx, CR.cy - (compact ? 34 : 32))}
      </g>

      {/* high tom, mounted behind the kick */}
      <g {...pieceProps('tomHi', 'drum')}>{drum('tomHi', TH)}</g>

      {/* kick: front head with the DrumLab mark */}
      <g {...pieceProps('kick', 'kick')}>
        <path className="kp-leg" d={`M${KK.cx - 62} ${KK.cy + 70} L${KK.cx - 88} ${FLOOR} M${KK.cx + 62} ${KK.cy + 70} L${KK.cx + 88} ${FLOOR}`} />
        <circle ref={reg('kick:halo')} className="kp-halo" filter={url('blur')} cx={KK.cx} cy={KK.cy} r={KK.r + 16} />
        <g ref={reg('kick:body')} className="kp-body">
          <circle cx={KK.cx} cy={KK.cy} r={KK.r} fill={url('chrome')} />
          <circle cx={KK.cx} cy={KK.cy} r={KK.r - 6} fill="#15171a" />
          <circle cx={KK.cx} cy={KK.cy} r={KK.r - 9} fill={url('kickhead')} />
          {claws}
          <circle cx={KK.cx} cy={KK.cy - 12} r={27} fill="none" stroke="#8d939c" strokeWidth={3.5} />
          <circle cx={KK.cx + 9} cy={KK.cy - 21} r={9} fill="var(--accent)" />
          <circle ref={reg('kick:cue')} className="kp-cue" cx={KK.cx} cy={KK.cy} r={KK.r - 9} />
          <circle ref={reg('kick:ring')} className="kp-ring" cx={KK.cx} cy={KK.cy} r={KK.r - 16} />
          <circle ref={reg('kick:flash')} className="kp-flash" cx={KK.cx} cy={KK.cy} r={KK.r - 9} />
        </g>
        <circle ref={reg('kick:miss')} className="kp-miss" cx={KK.cx} cy={KK.cy} r={KK.r + 4} />
        {label('kick', KK.cx, KK.cy + (compact ? 58 : 56))}
      </g>

      {/* snare on its stand */}
      <g {...pieceProps('snare', 'drum')}>
        <path
          className="kp-leg"
          d={`M${SN.cx} ${SN.top + SN.h + SN.ry} V308 M${SN.cx} 306 L${SN.cx - 30} ${FLOOR} M${SN.cx} 306 L${SN.cx + 30} ${FLOOR}`}
        />
        {drum('snare', SN)}
      </g>

      {/* low (floor) tom on three legs */}
      <g {...pieceProps('tomLo', 'drum')}>
        <path
          className="kp-leg"
          d={`M${TL.cx - TL.rx - 5} ${TL.top + 36} L${TL.cx - TL.rx - 13} ${FLOOR} M${TL.cx + TL.rx + 5} ${TL.top + 36} L${TL.cx + TL.rx + 13} ${FLOOR}`}
        />
        {drum('tomLo', TL)}
        <rect className="kp-lug" x={TL.cx - TL.rx - 9} y={TL.top + 30} width={9} height={12} rx={2} />
        <rect className="kp-lug" x={TL.cx + TL.rx} y={TL.top + 30} width={9} height={12} rx={2} />
      </g>
    </svg>
  );
}
