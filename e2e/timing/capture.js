// grab canvas frames while hit effects are mid-animation
(() => {
  const e = window.__engine;
  const canvas = document.querySelector('.canvas-wrap canvas');
  window.__frames = [];
  const want = [0.04, 0.09, 0.16];
  let last = -1;
  const id = setInterval(() => {
    const now = e.now();
    const fx = e.effects.filter((x) => x.judge !== 'miss');
    if (fx.length < 2) return;
    const age = now - Math.max(...fx.map((x) => x.at));
    const target = want[window.__frames.length];
    if (target === undefined) { clearInterval(id); return; }
    if (age >= target && age < target + 0.02 && performance.now() - last > 900) {
      last = performance.now();
      window.__frames.push(canvas.toDataURL('image/png'));
    }
  }, 2);
  return 'capturing';
})();
