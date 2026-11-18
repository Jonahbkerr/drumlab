// a fake USB kit: replaces Web MIDI with one input; window.__midiHit(note) sends a hit
(() => {
  const input = { id: 'fake-1', name: 'Test Kit', onmidimessage: null };
  navigator.requestMIDIAccess = async () => ({ inputs: new Map([['fake-1', input]]), onstatechange: null });
  window.__midiHit = (note, vel = 100) => {
    input.onmidimessage?.({ data: new Uint8Array([0x99, note, vel]), timeStamp: performance.now() });
    return `sent ${note}`;
  };
  return 'fake kit ready';
})();
