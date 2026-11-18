// route every AudioContext through a zero-gain node so test runs are silent;
// window.__preBus keeps the full-volume mix so tests can listen to it
(() => {
  if (window.__muted) return 'already muted';
  const Orig = window.AudioContext;
  window.AudioContext = class extends Orig {
    constructor(o) {
      super(o);
      const real = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'destination').get.call(this);
      const pre = Orig.prototype.createGain.call(this);
      const post = Orig.prototype.createGain.call(this);
      post.gain.value = 0;
      pre.connect(post);
      post.connect(real);
      Object.defineProperty(this, 'destination', { get: () => pre });
      window.__preBus = pre;
      window.__silent = post;
      window.__ctx = this;
    }
  };
  window.webkitAudioContext = window.AudioContext;
  window.__muted = true;
  return 'muted';
})();
