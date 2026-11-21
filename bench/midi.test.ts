/**
 * MIDI input: drum kits (channel 10) keep the General MIDI drum map; piano
 * keyboards (other channels) play the same drums in every octave.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANE_KEY, MidiManager, PIANO_LAYOUT, laneHints } from '../src/engine/midi';
import type { InputSource, MidiEvent } from '../src/engine/midi';
import { plays } from '../src/engine/types';
import type { Lane } from '../src/engine/types';
import { LESSONS } from '../src/content/lessons';

type Msg = (data: number[]) => void;

/** a MidiManager wired to one fake input; send([status, note, vel]) delivers a message */
async function rig(device = 'Keys') {
  const input: { id: string; name: string; onmidimessage: ((ev: { data: Uint8Array; timeStamp: number }) => void) | null } = {
    id: 'in-1',
    name: device,
    onmidimessage: null,
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { requestMIDIAccess: async () => ({ inputs: new Map([['in-1', input]]), onstatechange: null }) },
    configurable: true,
  });
  const hits: { lane: Lane; vel: number; source: InputSource }[] = [];
  const events: MidiEvent[] = [];
  const m = new MidiManager(
    (lane, vel, _at, source) => hits.push({ lane, vel, source }),
    (ev) => events.push(ev),
  );
  m.resetPiano();
  m.setKit(device, false);
  assert.equal(await m.init(), 'midi:1');
  const send: Msg = (data) => input.onmidimessage?.({ data: Uint8Array.from(data), timeStamp: 0 });
  return { m, send, hits, events };
}

test('channel 10 (drum kits, drum pads) keeps the General MIDI drum map', async () => {
  const { send, hits, events } = await rig('Test Kit');
  for (const note of [36, 38, 42, 46, 48, 49, 59]) send([0x99, note, 100]);
  assert.deepEqual(
    hits.map((h) => h.lane),
    ['kick', 'snare', 'hh', 'hhOpen', 'tomHi', 'crash'],
  );
  assert.ok(hits.every((h) => h.source === 'kit'));
  assert.equal(events.length, 7, 'unmapped notes still show in the monitor');
  assert.equal(events[6].lane, null);
  assert.equal(events[0].channel, 10);
});

test('a piano keyboard plays the same drums in every octave', async () => {
  const { send, hits, events } = await rig();
  for (const octave of [1, 3, 5, 7]) {
    for (let pc = 0; pc < 12; pc++) send([0x90, octave * 12 + pc, 64]);
  }
  assert.equal(hits.length, 48);
  for (let i = 0; i < hits.length; i++) assert.equal(hits[i].lane, PIANO_LAYOUT[i % 12], `note ${i}`);
  assert.ok(hits.every((h) => h.source === 'piano'));
  assert.ok(Math.abs(hits[0].vel - 64 / 127) < 1e-9, 'velocity comes through');
  assert.equal(events[0].channel, 1);
  // and it matches General MIDI where the two agree: C kick, D snare, F# hi-hat, A# open hat, C# crash
  assert.deepEqual([0, 2, 6, 10, 1].map((pc) => PIANO_LAYOUT[pc]), ['kick', 'snare', 'hh', 'hhOpen', 'crash']);
});

test('note offs and other messages are ignored', async () => {
  const { send, hits, events } = await rig();
  send([0x90, 60, 0]); // note on with velocity 0 = note off
  send([0x80, 60, 64]); // note off
  send([0xb0, 64, 127]); // sustain pedal
  send([0x90, 60]); // short message
  assert.equal(hits.length + events.length, 0);
});

test('moving a piano key moves it in every octave, and reset puts it back', async () => {
  const { m, send, hits } = await rig();
  m.assignPiano(64, 'crash'); // E
  send([0x90, 40, 90]);
  send([0x90, 76, 90]);
  send([0x90, 62, 90]); // D is still snare
  assert.deepEqual(
    hits.map((h) => h.lane),
    ['crash', 'crash', 'snare'],
  );
  assert.equal(m.pianoLayout[4], 'crash');
  m.assignPiano(4, 'snare'); // back to its usual drum: no override left
  assert.deepEqual(m.pianoLayout, [...PIANO_LAYOUT]);
  m.assignPiano(0, 'tomHi');
  m.resetPiano();
  assert.deepEqual(m.pianoLayout, [...PIANO_LAYOUT]);
});

test('a drum kit set to another channel can be read as a kit', async () => {
  const { m, send, hits } = await rig('Old Kit');
  send([0x90, 48, 100]); // read as piano: C = kick
  m.setKit('Old Kit', true);
  send([0x90, 48, 100]); // read as a kit: General MIDI tom
  assert.deepEqual(
    hits.map((h) => `${h.lane}/${h.source}`),
    ['kick/piano', 'tomHi/kit'],
  );
  assert.ok(m.isKit('Old Kit'));
  m.setKit('Old Kit', false);
  assert.ok(!m.isKit('Old Kit'));
});

test('the drums are labelled with computer keys or piano keys', () => {
  assert.deepEqual(laneHints('keys', PIANO_LAYOUT), LANE_KEY);
  assert.deepEqual(laneHints('piano', PIANO_LAYOUT), { kick: 'C', snare: 'D', hh: 'F#', hhOpen: 'A#', tomLo: 'F', tomHi: 'A', crash: 'C#' });
  assert.equal(LANE_KEY.hhOpen, 'U');
  // snare moved off D: it shows its other key, E
  const moved = PIANO_LAYOUT.map((l, pc) => (pc === 2 ? 'kick' : l));
  assert.equal(laneHints('piano', moved).snare, 'E');
  // a drum on no key shows nothing
  const noCrash = PIANO_LAYOUT.map((l) => (l === 'crash' ? 'hh' : l));
  assert.equal(laneHints('piano', noCrash).crash, '');
});

test('an open hat plays hi-hat notes; a closed hat does not play open-hat notes', () => {
  assert.ok(plays('hhOpen', 'hhOpen'));
  assert.ok(plays('hhOpen', 'hh'), 'songs only have one hi-hat: opening it still counts');
  assert.ok(plays('hh', 'hh'));
  assert.ok(!plays('hh', 'hhOpen'), 'an open-hat note needs the open hat');
  assert.ok(!plays('hhOpen', 'crash'));
  assert.ok(!plays('snare', 'kick'));
});

test('Disco Hats opens the hat on the off-beats, never on top of a closed one', () => {
  const disco = LESSONS.find((l) => l.id === 'grv-disco');
  assert.ok(disco);
  const open = disco.notes.filter((x) => x.lane === 'hhOpen');
  assert.equal(open.length, 16);
  assert.ok(open.every((x) => x.t % 1 === 0.5), 'open hats on the and');
  const closedAt = new Set(disco.notes.filter((x) => x.lane === 'hh').map((x) => x.t));
  assert.ok(open.every((x) => !closedAt.has(x.t)));
  assert.ok(disco.notes.every((x) => x.t < disco.totalBeats));
});
