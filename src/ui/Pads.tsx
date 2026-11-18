import { LANES, LANE_LABEL } from '../engine/types';
import type { Lane } from '../engine/types';

const KEY_HINTS: Record<Lane, string> = {
  kick: 'D',
  snare: 'F',
  hh: 'J',
  tomLo: 'K',
  tomHi: 'L',
  crash: ';',
};

interface Props {
  /** at = pointer event timestamp (performance.now() ms) */
  onHit: (lane: Lane, at?: number) => void;
  flashKey: number;
  flashLane: Lane | null;
}

export default function Pads({ onHit, flashKey, flashLane }: Props) {
  return (
    <div className="pads-row">
      {LANES.map((lane) => (
        <button
          key={`${lane}-${flashLane === lane ? flashKey : 0}`}
          type="button"
          className={`pad${flashLane === lane && flashKey > 0 ? ' flash' : ''}`}
          data-lane={lane}
          onPointerDown={(e) => {
            e.preventDefault();
            onHit(lane, e.timeStamp);
          }}
        >
          <span className="key">{KEY_HINTS[lane]}</span>
          <span className="name">{LANE_LABEL[lane]}</span>
        </button>
      ))}
    </div>
  );
}
