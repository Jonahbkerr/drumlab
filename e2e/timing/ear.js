// Sample-accurate ear: an AudioWorklet on the full-volume mix reports the render
// time of every sound onset (block start time + sample index). window.__ear.onsets
(async () => {
  const ctx = window.__ctx;
  if (window.__ear) return 'ear already on';
  const code = `
    class Ear extends AudioWorkletProcessor {
      constructor() { super(); this.quiet = 1e9; }
      process(inputs) {
        const x = inputs[0] && inputs[0][0];
        if (!x) { this.quiet += 128; return true; } // silent input arrives as no channels
        for (let i = 0; i < x.length; i++) {
          const a = Math.abs(x[i]);
          // onset = first sample above the quiet floor after 30 ms of quiet
          if (a >= 0.005 && this.quiet > sampleRate * 0.03) this.port.postMessage(currentTime + i / sampleRate);
          this.quiet = a < 0.005 ? this.quiet + 1 : 0;
        }
        return true;
      }
    }
    registerProcessor('ear', Ear);`;
  const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  const node = new AudioWorkletNode(ctx, 'ear', { numberOfOutputs: 1 });
  const ear = { onsets: [], listeners: [] };
  node.port.onmessage = (m) => {
    ear.onsets.push(m.data);
    for (const f of ear.listeners) f(m.data);
  };
  window.__preBus.connect(node);
  node.connect(window.__silent);
  window.__ear = ear;
  return 'ear on';
})();
