import type { Lane } from './types';

/** Keyboard fallback: D F J K L ; (left to right). */
export const KEY_TO_LANE: Record<string, Lane> = {
  KeyD: 'kick',
  KeyF: 'snare',
  KeyJ: 'hh',
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
  46: 'hh',
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

export interface MidiDevice {
  id: string;
  name: string;
}

export interface MidiEvent {
  note: number;
  vel: number;
  device: string;
  lane: Lane | null;
}

const MAP_KEY = 'drumlab:midimap:v1';

export function loadCustomMap(): Record<number, Lane> {
  try {
    const raw = localStorage.getItem(MAP_KEY);
    if (raw) return JSON.parse(raw) as Record<number, Lane>;
  } catch {
    // ignore
  }
  return {};
}

function saveCustomMap(m: Record<number, Lane>) {
  try {
    localStorage.setItem(MAP_KEY, JSON.stringify(m));
  } catch {
    // ignore
  }
}

export class MidiManager {
  /** at = when the hit happened (performance.now() ms, from the input event) */
  private onNote: (lane: Lane, vel: number, at?: number) => void;
  private onEvent: (ev: MidiEvent) => void;
  private onDevices: (devs: MidiDevice[]) => void;
  private access: MIDIAccessLike | null = null;
  private devices: MidiDevice[] = [];
  private custom: Record<number, Lane> = loadCustomMap();
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  /** inputs this manager listens to, so detach() can let go of them */
  private attached = new Map<MIDIInputLike, (ev: MIDIMessageEventLike) => void>();
  private down = new Set<string>();

  constructor(
    onNote: (lane: Lane, vel: number, at?: number) => void,
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

  resolve(note: number): Lane | null {
    return this.custom[note] ?? GM_TO_LANE[note] ?? null;
  }

  assign(note: number, lane: Lane) {
    this.custom = { ...this.custom, [note]: lane };
    saveCustomMap(this.custom);
  }

  unassign(note: number) {
    const next = { ...this.custom };
    delete next[note];
    this.custom = next;
    saveCustomMap(next);
  }

  resetMap() {
    this.custom = {};
    saveCustomMap(this.custom);
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
      const status = data[0] & 0xf0;
      if ((status === 0x90 && data[2] > 0) || (status === 0x99 && data[2] > 0)) {
        const note = data[1];
        const vel = data[2] / 127;
        const lane = this.resolve(note);
        if (lane) this.onNote(lane, vel, ev.timeStamp);
        this.onEvent({ note, vel, device: name, lane });
      }
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
        this.onNote(lane, 1, e.timeStamp);
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
