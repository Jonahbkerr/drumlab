import { memo, useImperativeHandle, useRef } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, Ref } from 'react';
import { NOTE_NAMES } from '../engine/midi';
import { LANE_LABEL } from '../engine/types';
import type { Lane } from '../engine/types';

/**
 * One octave of a piano keyboard, each key tinted with the drum it plays.
 * Every octave of a real keyboard plays the same drums. Keys light up as
 * they are played (straight on the SVG nodes, no React state per hit).
 */

export interface PianoHandle {
  /** a key was played: 0 = C .. 11 = B, vel 0..1 */
  press(pc: number, vel?: number): void;
}

interface Props {
  ref?: Ref<PianoHandle>;
  /** the drum each key plays, C to B */
  layout: readonly Lane[];
  /** drum being assigned: its keys are outlined */
  selected?: Lane | null;
  onKey?: (pc: number) => void;
}

const LANE_VAR: Record<Lane, string> = {
  kick: 'var(--kick)',
  snare: 'var(--snare)',
  hh: 'var(--hh)',
  tomLo: 'var(--tomlo)',
  tomHi: 'var(--tomhi)',
  crash: 'var(--crash)',
};

const TOP = 26;
const WHITE = { w: 60, h: 150 };
const BLACK = { w: 34, h: 92 };
const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
/** black keys and the white-key boundary each sits on */
const BLACK_KEYS = [
  { pc: 1, x: 60 },
  { pc: 3, x: 120 },
  { pc: 6, x: 240 },
  { pc: 8, x: 300 },
  { pc: 10, x: 360 },
];

export default memo(PianoMap);

function PianoMap({ ref, layout, selected, onKey }: Props) {
  const flashes = useRef<(SVGRectElement | null)[]>([]);

  useImperativeHandle(
    ref,
    () => ({
      press(pc, vel = 1) {
        const v = 0.45 + 0.45 * Math.min(1, Math.max(0, vel));
        flashes.current[pc]?.animate([{ opacity: v }, { opacity: 0 }], {
          duration: 420,
          easing: 'cubic-bezier(0.15, 0.7, 0.3, 1)',
        });
      },
    }),
    [],
  );

  const keyProps = (pc: number, kind: 'white' | 'black') => {
    const lane = layout[pc];
    return {
      className: `pk pk-${kind}${selected === lane ? ' sel' : ''}`,
      style: { '--c': LANE_VAR[lane] } as CSSProperties,
      role: onKey ? 'button' : undefined,
      'aria-label': `${NOTE_NAMES[pc]}: ${LANE_LABEL[lane]}`,
      onPointerDown: onKey
        ? (e: ReactPointerEvent) => {
            e.preventDefault();
            onKey(pc);
          }
        : undefined,
    };
  };

  return (
    <svg className="piano" viewBox={`0 0 ${WHITE.w * 7} ${TOP + WHITE.h + 2}`} role="group" aria-label="Piano keys and their drums">
      {WHITE_PCS.map((pc, i) => {
        const x = i * WHITE.w + 1;
        const w = WHITE.w - 2;
        const bandY = TOP + WHITE.h - 36;
        return (
          <g key={pc} {...keyProps(pc, 'white')}>
            <rect className="pk-key" x={x} y={TOP} width={w} height={WHITE.h} rx={5} />
            <rect className="pk-band" x={x + 4} y={bandY} width={w - 8} height={30} rx={4} />
            <text className="pk-name" x={x + w / 2} y={bandY + 19.5}>
              {LANE_LABEL[layout[pc]]}
            </text>
            <text className="pk-note" x={x + w / 2} y={bandY - 10}>
              {NOTE_NAMES[pc]}
            </text>
            <rect
              ref={(el) => {
                flashes.current[pc] = el;
              }}
              className="pk-flash"
              x={x}
              y={TOP}
              width={w}
              height={WHITE.h}
              rx={5}
            />
            <rect className="pk-sel" x={x + 1.5} y={TOP + 1.5} width={w - 3} height={WHITE.h - 3} rx={4} />
          </g>
        );
      })}
      {BLACK_KEYS.map(({ pc, x: mid }) => {
        const x = mid - BLACK.w / 2;
        return (
          <g key={pc} {...keyProps(pc, 'black')}>
            <text className="pk-top" x={mid} y={TOP - 9}>
              {LANE_LABEL[layout[pc]]}
            </text>
            <rect className="pk-key" x={x} y={TOP - 1} width={BLACK.w} height={BLACK.h} rx={4} />
            <text className="pk-note" x={mid} y={TOP + BLACK.h - 24}>
              {NOTE_NAMES[pc]}
            </text>
            <rect className="pk-band" x={x + 5} y={TOP + BLACK.h - 15} width={BLACK.w - 10} height={8} rx={2} />
            <rect
              ref={(el) => {
                flashes.current[pc] = el;
              }}
              className="pk-flash"
              x={x}
              y={TOP - 1}
              width={BLACK.w}
              height={BLACK.h}
              rx={4}
            />
            <rect className="pk-sel" x={x + 1.5} y={TOP + 0.5} width={BLACK.w - 3} height={BLACK.h - 3} rx={3} />
          </g>
        );
      })}
    </svg>
  );
}
