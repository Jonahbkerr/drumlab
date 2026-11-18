// Lesson robot with an ear: detects each metronome click in the rendered audio
// (sample-accurate), and hits every note on the beat grid those clicks define,
// at the moment that grid is HEARD. Pad sounds are silenced so only clicks are heard.
(() => {
  const KEY = { kick: 'KeyD', snare: 'KeyF', hh: 'KeyJ', tomLo: 'KeyK', tomHi: 'KeyL', crash: 'Semicolon' };
  const e = window.__engine;
  const ctx = e.audio.context();
  e.audio.hit = () => {}; // keep the stream to clicks only
  const heardAt = (ctxT) => {
    const ts = ctx.getOutputTimestamp();
    return ts.performanceTime + (ctxT - ts.contextTime) * 1000;
  };
  const press = (lane, stamp) => {
    const code = KEY[lane];
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code }));
    setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code })), 30);
  };
  const clicks = [];
  window.__ear.listeners.push((t) => clicks.push(t)); // sample-accurate AudioWorklet ear (local/ear.js)

  const used = new Set();
  const fired = [];
  const pump = setInterval(() => {
    // map each detected click to the beat the engine plays there, then hit notes in [beat, beat+1)
    while (clicks.length) {
      const R = clicks.shift();
      const ts = ctx.getOutputTimestamp();
      const heardPerf = heardAt(R);
      const engineAtHeard = e.now() + (heardPerf - performance.now()) / 1000;
      const beat = Math.round(e.anchor.beat + (engineAtHeard - e.anchor.time) / e.spb);
      e.notes.forEach((n, i) => {
        if (used.has(i) || n.t < beat - 0.01 || n.t >= beat + 0.99) return;
        used.add(i);
        const at = heardAt(R + (n.t - beat) * e.spb);
        
        const delay = at - performance.now() - 6;
        setTimeout(() => {
          while (performance.now() < at) {}
          fired.push({ i, late: performance.now() - at });
          press(n.lane);
        }, delay);
      });
      void ts;
    }
  }, 5);
  window.__robotLesson = {
    clicksHeard: () => used.size,
    stop() {
      clearInterval(pump);
      const d = fired.filter((f) => e.deltas[f.i] !== undefined).map((f) => e.deltas[f.i] * 1000);
      const judged = fired.map((f) => e.judged[f.i]);
      const mean = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
      const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, d.length));
      const count = (j) => judged.filter((x) => x === j).length;
      return JSON.stringify({
        mode: 'lesson',
        hitsFired: fired.length,
        judgedHits: d.length,
        meanMs: +mean.toFixed(1),
        sdMs: +sd.toFixed(1),
        minMs: d.length ? +Math.min(...d).toFixed(1) : null,
        maxMs: d.length ? +Math.max(...d).toFixed(1) : null,
        perfect: count('perfect'),
        great: count('great'),
        good: count('good'),
        miss: count('miss'),
        robotFireErrMs: fired.length ? +Math.max(...fired.map((f) => f.late)).toFixed(2) : null,
      });
    },
  };
  return 'lesson robot listening';
})();
