// Robot drummer: presses the lane key at the instant each note's SOUND reaches
// the speakers (AudioContext.getOutputTimestamp), like a perfect human, then
// reports how the game judged those hits. Also measures clock granularity.
(() => {
  const KEY = { kick: 'KeyD', snare: 'KeyF', hh: 'KeyJ', hhOpen: 'KeyU', tomLo: 'KeyK', tomHi: 'KeyL', crash: 'Semicolon' };
  const e = window.__engine;
  const ctx = e.audio.context();

  // context time (render) → performance.now() when that frame is heard
  const heardAt = (ctxT) => {
    const ts = ctx.getOutputTimestamp();
    return ts.performanceTime + (ctxT - ts.contextTime) * 1000;
  };

  // render-clock time of note i
  const renderTime = (i) => {
    const note = e.notes[i];
    if (e.songMode) {
      const p = e.player;
      return p.anchorCtx + (note.t - p.posSec) / p.rate;
    }
    return e.startCtx + e.anchor.time + (note.t - e.anchor.beat) * e.spb;
  };

  const press = (lane, queueMs = 0) => {
    const code = KEY[lane];
    // the event is created (timestamped) on time, then held as if the page
    // were busy drawing a frame before the handler gets to run
    const ev = new KeyboardEvent('keydown', { code, key: code });
    const t = performance.now();
    while (performance.now() - t < queueMs) {}
    window.dispatchEvent(ev);
    setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code })), 30);
  };

  window.__robot = {
    clockSteps() {
      // how coarsely does each clock advance?
      const steps = [];
      let last = ctx.currentTime;
      const t0 = performance.now();
      while (performance.now() - t0 < 300) {
        const c = ctx.currentTime;
        if (c !== last) {
          steps.push((c - last) * 1000);
          last = c;
        }
      }
      steps.sort((a, b) => a - b);
      const ts = ctx.getOutputTimestamp();
      return {
        currentTimeStepMs: +steps[Math.floor(steps.length / 2)].toFixed(2),
        reportedLatencyMs: Math.round((ctx.outputLatency + ctx.baseLatency) * 1000),
        outputTimestampLagMs: Math.round((ctx.currentTime - ts.contextTime) * 1000),
      };
    },
    run(seconds = 12, queueMs = 0, lateEvery3rdMs = 0, skipEvery = 0, shiftMs = 0) {
      window.__robotResult = null;
      const now = performance.now();
      const plan = [];
      e.notes.forEach((n, i) => {
        if (e.judged[i] !== null) return;
        const at = heardAt(renderTime(i));
        if (skipEvery && i % skipEvery === 0) return;
        if (at > now + 300 && at < now + seconds * 1000) plan.push({ i, lane: n.lane, at: at + shiftMs + (plan.length % 3 === 2 ? lateEvery3rdMs : 0) });
      });
      const pend = e.notes.map((n, i) => i).filter((i) => e.judged[i] === null);
      const diag = { pending: pend.length, firstAt: pend.slice(0, 3).map((i) => Math.round(heardAt(renderTime(i)) - now)) };
      const firstIdx = plan.length ? plan[0].i : 0;
      const lastIdx = plan.length ? plan[plan.length - 1].i : 0;
      for (const p of plan) {
        setTimeout(() => {
          while (performance.now() < p.at) {
            /* busy-wait to the exact instant */
          }
          p.late = performance.now() - p.at;
          press(p.lane, queueMs);
        }, p.at - performance.now() - 6);
      }
      setTimeout(() => {
        const d = [];
        const corr = [];
        for (const p of plan) if (e.deltas[p.i] !== undefined) {
          d.push(e.deltas[p.i] * 1000);
          corr.push(e.deltas[p.i] * 1000 - p.late); // minus the robot's own lateness in creating the event
        }
        const cm = corr.reduce((a, b) => a + b, 0) / Math.max(1, corr.length);
        const csd = Math.sqrt(corr.reduce((a, b) => a + (b - cm) ** 2, 0) / Math.max(1, corr.length));
        const judged = plan.map((p) => e.judged[p.i]);
        const mean = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
        const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, d.length));
        const count = (j) => judged.filter((x) => x === j).length;
        window.__robotResult = JSON.stringify({
          mode: e.songMode ? 'song' : 'lesson',
          hitsPlanned: plan.length,
          judgedHits: d.length,
          meanMs: +mean.toFixed(1),
          sdMs: +sd.toFixed(1),
          minMs: +Math.min(...d).toFixed(1),
          maxMs: +Math.max(...d).toFixed(1),
          perfect: count('perfect'),
          great: count('great'),
          good: count('good'),
          miss: count('miss'),
          robotFireErrMs: +Math.max(...plan.map((p) => p.late ?? 0)).toFixed(2),
          vsEventTimeMeanMs: +cm.toFixed(1),
          vsEventTimeSdMs: +csd.toFixed(1),
          pendingAtStart: diag.pending,
          firstAtMs: diag.firstAt,
          notesRange: [firstIdx, lastIdx],
        });
      }, seconds * 1000 + 600);
      return `planned ${plan.length} hits`;
    },
  };
  return 'robot ready';
})();
