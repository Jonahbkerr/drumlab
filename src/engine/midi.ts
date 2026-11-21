import type { Lane } from './types';

/** Keyboard fallback: D F J K L ; (left to right), U (above J) opens the hi-hat. */
export const KEY_TO_LANE: Record<string, Lane> = {
  KeyD: 'kick',
  KeyF: 'snare',
  KeyJ: 'hh',
  KeyU: 'hhOpen',
  KeyK: 'tomLo',
  KeyL: 'tomHi',
  Semicolon: 'crash',
};

/** the key that plays each lane, as printed on the keycap */
export const LANE_KEY = Object.fromEntries(
  Object.entries(KEY_TO_LANE).map(([code, lane]) => [lane, code === 'Semicolon' ? ';' : code.replace('Key', '')]),
) as Record<Lane, string>;

/** General MIDI percussion map — the fallback when no custom map entry exists. */
export const GM_TO_LANE: Record<number, Lane> = {
  35: 'kick',
  36: 'kick',
  37: 'snare',
  38: 'snare',
  40: 'snare',
  42: 'hh',
  44: 'hh',
  46: 'hhOpen',
  41: 'tomLo',
  43: 'tomLo',
  45: 'tomLo',
  47: 'tomHi',
  48: 'tomHi',
  50: 'tomHi',
  49: 'crash',
  51: 'crash',
  52: 'crash',
  55: 'crash',
  57: 'crash',
};

/** Web MIDI channels count from 0: this is channel 10, General MIDI's drum channel */
const DRUM_CHANNEL = 9;

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** MIDI note number to name, middle C (60) = C4 */
export const noteName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

/**
 * Piano keyboards play the same drum in every octave, C to B. It follows
 * General MIDI's drum octave (C kick, D snare, F#/G# hi-hat, A# open hi-hat,
 * C# crash, D# ride), with the floor toms on F and G and the rack toms on A and B.
 */
export const PIANO_LAYOUT: readonly Lane[] = [
  'kick',
  'crash',
  'snare',
  'crash',
  'snare',
  'tomLo',
  'hh',
  'tomLo',
  'hh',
  'tomHi',
  'hhOpen',
  'tomHi',
];

/** each drum's first key in the octave: the one printed on the drawn kit */
const PIANO_HOME: Record<Lane, number> = { kick: 0, crash: 1, snare: 2, tomLo: 5, hh: 6, tomHi: 9, hhOpen: 10 };

/** the key (0 = C .. 11 = B) to show for a drum: its usual key if it still plays it, else the first that does */
export function pianoKeyFor(lane: Lane, layout: readonly Lane[]): number | null {
  if (layout[PIANO_HOME[lane]] === lane) return PIANO_HOME[lane];
  const i = layout.indexOf(lane);
  return i >= 0 ? i : null;
}

/** where a hit came from: a drum kit (or drum pads), a piano keyboard, or the computer keyboard */
export type InputSource = 'kit' | 'piano' | 'keys';

/** the letters to print beside each drum, for computer keys or piano keys */
export function laneHints(source: InputSource, pianoLayout: readonly Lane[]): Record<Lane, string> {
  if (source !== 'piano') return { ...LANE_KEY };
  return Object.fromEntries(
    Object.keys(PIANO_HOME).map((lane) => {
      const pc = pianoKeyFor(lane as Lane, pianoLayout);
      return [lane, pc === null ? '' : NOTE_NAMES[pc]];
    }),
  ) as Record<Lane, string>;
}

export interface MidiDevice {
  id: string;
  name: string;
}

export interface MidiEvent {
  note: number;
  vel: number;
  device: string;
  lane: Lane | null;
  /** 1..16 */
  channel: number;
  /** read with the drum map or the piano layout */
  source: 'kit' | 'piano';
}

const MAP_KEY = 'drumlab:midimap:v1';
const PIANO_KEY = 'drumlab:pianomap:v1';
const AS_KIT_KEY = 'drumlab:midi-as-kit:v1';
const LABELS_KEY = 'drumlab:key-labels';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // ignore
  }
  return fallback;
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function loadCustomMap(): Record<number, Lane> {
  return load<Record<number, Lane>>(MAP_KEY, {});
}

/** the piano layout with your changes: one drum per key, C to B */
export function loadPianoLayout(): Lane[] {
  const changed = load<Record<number, Lane>>(PIANO_KEY, {});
  return PIANO_LAYOUT.map((lane, pc) => changed[pc] ?? lane);
}

/** which letters the drums show: the input you played with last */
export function loadLabelSource(): 'keys' | 'piano' {
  return load<string>(LABELS_KEY, 'keys') === 'piano' ? 'piano' : 'keys';
}

export function saveLabelSource(source: 'keys' | 'piano') {
  save(LABELS_KEY, source);
}

export class MidiManager {
  /** at = when the hit happened (performance.now() ms, from the input event) */
  private onNote: (lane: Lane, vel: number, at: number | undefined, source: InputSource) => void;
  private onEvent: (ev: MidiEvent) => void;
  private onDevices: (devs: MidiDevice[]) => void;
  private access: MIDIAccessLike | null = null;
  private devices: MidiDevice[] = [];
  private custom: Record<number, Lane> = loadCustomMap();
  /** piano keys you moved to another drum, by pitch class (0 = C) */
  private piano: Record<number, Lane> = load<Record<number, Lane>>(PIANO_KEY, {});
  /** devices read as drum kits even off channel 10 */
  private asKit = new Set<string>(load<string[]>(AS_KIT_KEY, []));
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  /** inputs this manager listens to, so detach() can let go of them */
  private attached = new Map<MIDIInputLike, (ev: MIDIMessageEventLike) => void>();
  private down = new Set<string>();

  constructor(
    onNote: (lane: Lane, vel: number, at: number | undefined, source: InputSource) => void,
    onEvent: (ev: MidiEvent) => void = () => {},
    onDevices: (devs: MidiDevice[]) => void = () => {},
  ) {
    this.onNote = onNote;
    this.onEvent = onEvent;
    this.onDevices = onDevices;
  }

  get deviceList(): MidiDevice[] {
    return this.devices;
  }

  get customMap(): Record<number, Lane> {
    return { ...this.custom };
  }

  /** the piano layout with your changes: one drum per key, C to B */
  get pianoLayout(): Lane[] {
    return PIANO_LAYOUT.map((lane, pc) => this.piano[pc] ?? lane);
  }

  /**
   * How a note is read. Channel 10 is the drum channel: drum kits and the
   * drum pads on keyboards send there, and keep the drum map. A piano
   * keyboard sends on channel 1 (any other channel): its keys get the piano
   * layout, unless the device is marked as a drum kit.
   */
  sourceOf(channel: number, device: string): 'kit' | 'piano' {
    return channel === DRUM_CHANNEL || this.asKit.has(device) ? 'kit' : 'piano';
  }

  resolve(note: number, source: 'kit' | 'piano' = 'kit'): Lane | null {
    if (source === 'piano') return this.pianoLayout[note % 12];
    return this.custom[note] ?? GM_TO_LANE[note] ?? null;
  }

  /** this key, in every octave, plays this drum */
  assignPiano(note: number, lane: Lane) {
    const pc = note % 12;
    const next = { ...this.piano };
    if (PIANO_LAYOUT[pc] === lane) delete next[pc];
    else next[pc] = lane;
    this.piano = next;
    save(PIANO_KEY, next);
  }

  resetPiano() {
    this.piano = {};
    save(PIANO_KEY, {});
  }

  isKit(device: string): boolean {
    return this.asKit.has(device);
  }

  /** read a device that sends off channel 10 as a drum kit (true) or a piano keyboard */
  setKit(device: string, kit: boolean) {
    if (kit) this.asKit.add(device);
    else this.asKit.delete(device);
    save(AS_KIT_KEY, [...this.asKit]);
  }

  assign(note: number, lane: Lane) {
    this.custom = { ...this.custom, [note]: lane };
    save(MAP_KEY, this.custom);
  }

  unassign(note: number) {
    const next = { ...this.custom };
    delete next[note];
    this.custom = next;
    save(MAP_KEY, next);
  }

  resetMap() {
    this.custom = {};
    save(MAP_KEY, this.custom);
  }

  async init(): Promise<string> {
    const nav = navigator as unknown as {
      requestMIDIAccess?: (opts?: { sysex?: boolean }) => Promise<MIDIAccessLike>;
    };
    if (!nav.requestMIDIAccess) return 'no-midi';
    try {
      const access = await nav.requestMIDIAccess({ sysex: false });
      this.access = access;
      access.onstatechange = () => {
        this.refreshDevices();
      };
      this.refreshDevices();
      return this.devices.length > 0 ? `midi:${this.devices.length}` : 'midi:none';
    } catch {
      return 'midi-denied';
    }
  }

  private refreshDevices() {
    if (!this.access) return;
    const devices: MidiDevice[] = [];
    let i = 0;
    for (const input of this.access.inputs.values()) {
      const id = input.id ?? `in-${i}`;
      const name = input.name ?? `MIDI input ${i}`;
      devices.push({ id, name });
      this.attachInput(input, name);
      i++;
    }
    this.devices = devices;
    this.onDevices(devices);
  }

  private attachInput(input: MIDIInputLike, name: string) {
    const handler = (ev: MIDIMessageEventLike) => {
      const data = ev.data;
      // note on, any channel; velocity 0 is a note off
      if (data.length < 3 || (data[0] & 0xf0) !== 0x90 || data[2] === 0) return;
      const channel = data[0] & 0x0f;
      const note = data[1];
      const vel = data[2] / 127;
      const source = this.sourceOf(channel, name);
      const lane = this.resolve(note, source);
      if (lane) this.onNote(lane, vel, ev.timeStamp, source);
      this.onEvent({ note, vel, device: name, lane, channel: channel + 1, source });
    };
    input.onmidimessage = handler;
    this.attached.set(input, handler);
  }

  attachKeyboard() {
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const lane = KEY_TO_LANE[e.code];
      if (!lane) return;
      if (e.type === 'keydown' && !this.down.has(e.code)) {
        this.down.add(e.code);
        this.onNote(lane, 1, e.timeStamp, 'keys');
      } else if (e.type === 'keyup') {
        this.down.delete(e.code);
      }
    };
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('keyup', this.keyHandler);
  }

  /** stop listening: keyboard, and any MIDI inputs no other screen has taken over */
  detach() {
    for (const [input, handler] of this.attached) if (input.onmidimessage === handler) input.onmidimessage = null;
    this.attached.clear();
    if (this.access) this.access.onstatechange = null;
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      window.removeEventListener('keyup', this.keyHandler);
      this.keyHandler = null;
    }
    this.down.clear();
  }
}

interface MIDIMessageEventLike {
  data: Uint8Array;
  /** receipt time on the performance.now() clock */
  timeStamp?: number;
}
interface MIDIInputLike {
  id?: string;
  name?: string;
  onmidimessage: ((ev: MIDIMessageEventLike) => void) | null;
}
interface MIDIInputMapLike {
  values(): IterableIterator<MIDIInputLike>;
}
interface MIDIAccessLike {
  inputs: MIDIInputMapLike;
  onstatechange: (() => void) | null;
}
