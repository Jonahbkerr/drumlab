import type { Lane } from './types';

/**
 * The drum each chart row plays, drawn small in the row's label on the play
 * canvas, in the same style as the drawn kit (KitView): dark shells, chrome
 * rims, bronze cymbals. It lights up in the row's colour when hit, its ring
 * glows as the row's next note comes up, and it flashes red on a miss, so the
 * eye can stay on the rows instead of looking down at a separate kit.
 */
export interface DrumState {
  /** colour of the drum, or of the hat that was last hit */
  color: string;
  /** seconds since its last hit (Infinity: none yet) */
  hitAge: number;
  /** 0..1 strength of that hit */
  vel: number;
  /** 0..1 how close its next note is (1 = due now) */
  cue: number;
  /** colour of the drum whose note is coming (the open hat's, on the hi-hat row) */
  cueColor: string;
  /** seconds since a note on it went by unplayed */
  missAge: number;
  /** hi-hat only, 0..1: how far the top cymbal is lifted off the bottom one */
  lift: number;
  /** false under prefers-reduced-motion: light up, don't move */
  motion: boolean;
}

/** the drawing is 100 units wide and about 64 tall, centred on (0, 0) */
export const DRUM_ASPECT = 0.64;

const RIM = '#8a919b';
const LUG = '#7a818b';
const POLE = '#4a4f57';
const BAD = '#e5534b';

function rgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

const fade = (age: number, life: number) => (age >= 0 && age < life ? (1 - age / life) ** 2 : 0);

/** shell, head, rim, cue ring and flash of a drum seen from the front and a little above */
interface DrumGeo {
  rx: number;
  ry: number;
  /** y of the head */
  top: number;
  /** shell depth */
  h: number;
}
const DRUMS: Partial<Record<Lane, DrumGeo>> = {
  snare: { rx: 44, ry: 11, top: -10, h: 20 },
  tomHi: { rx: 34, ry: 10, top: -14, h: 27 },
  tomLo: { rx: 42, ry: 12, top: -18, h: 36 },
};

export function drawRowDrum(ctx: CanvasRenderingContext2D, lane: Lane, cx: number, cy: number, width: number, st: DrumState) {
  const k = width / 100;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  if (lane === 'kick') kick(ctx, st);
  else if (lane === 'hh' || lane === 'hhOpen') hihat(ctx, st);
  else if (lane === 'crash') crash(ctx, st);
  else drum(ctx, DRUMS[lane] ?? DRUMS.snare!, st);
  ctx.restore();
}

/** a soft glow of the drum's colour behind it, just after a hit */
function halo(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, st: DrumState) {
  const a = 0.55 * (0.5 + 0.5 * st.vel) * fade(st.hitAge, 0.56);
  if (a <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, rx * 0.3, 0, 0, rx + 18);
  g.addColorStop(0, rgba(st.color, a));
  g.addColorStop(1, rgba(st.color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx + 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** cue fill + ring, hit flash and miss ring on a drum head or cymbal (an ellipse) */
function lights(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, ring: [number, number], st: DrumState) {
  const cue = st.cue ** 1.5;
  if (cue > 0) {
    ctx.fillStyle = rgba(st.cueColor, cue * 0.22);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = rgba(st.cueColor, 0.34 + cue * 0.66);
  ctx.lineWidth = 2 + cue * 3.5;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(1, rx - ring[0]), Math.max(1, ry - ring[1]), 0, 0, Math.PI * 2);
  ctx.stroke();
  const flash = 0.9 * (0.5 + 0.5 * st.vel) * fade(st.hitAge, 0.38);
  if (flash > 0) {
    ctx.fillStyle = rgba(st.color, flash);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function missRing(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, st: DrumState) {
  const a = 0.95 * fade(st.missAge, 0.62);
  if (a <= 0) return;
  ctx.strokeStyle = rgba(BAD, a);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drum(ctx: CanvasRenderingContext2D, d: DrumGeo, st: DrumState) {
  const { rx, ry, top, h } = d;
  halo(ctx, 0, top + h * 0.4, rx + 4, ry + h * 0.5, st);
  ctx.save();
  // a hit pushes the drum down a little and it springs back
  if (st.motion) ctx.translate(0, 3 * fade(st.hitAge, 0.18));

  // shell
  const shell = ctx.createLinearGradient(-rx, 0, rx, 0);
  shell.addColorStop(0, '#0e1013');
  shell.addColorStop(0.2, '#262a30');
  shell.addColorStop(0.4, '#3b4048');
  shell.addColorStop(0.62, '#262a30');
  shell.addColorStop(1, '#0d0f12');
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.moveTo(-rx, top);
  ctx.lineTo(-rx, top + h);
  ctx.ellipse(0, top + h, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(rx, top);
  ctx.ellipse(0, top, rx, ry, 0, 0, -Math.PI, true);
  ctx.closePath();
  ctx.fill();
  // lugs
  ctx.fillStyle = LUG;
  const lh = Math.max(7, h * 0.42);
  for (const deg of [-58, -20, 20, 58]) {
    const a = (deg * Math.PI) / 180;
    const x = rx * Math.sin(a);
    const y = top + ry * Math.cos(a) + h * 0.5;
    ctx.beginPath();
    ctx.roundRect(x - 2.2, y - lh / 2, 4.4, lh, 2);
    ctx.fill();
  }
  // bottom hoop
  ctx.strokeStyle = RIM;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, top + h, rx, ry, 0, Math.PI, 0, true);
  ctx.stroke();
  // head
  const head = ctx.createRadialGradient(0, top - ry * 0.2, 0, 0, top, rx);
  head.addColorStop(0, '#30343b');
  head.addColorStop(1, '#191b1f');
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.ellipse(0, top, rx - 2, ry - 1.5, 0, 0, Math.PI * 2);
  ctx.fill();
  lights(ctx, 0, top, rx - 2, ry - 1.5, [8, 4], st);
  // top hoop
  ctx.strokeStyle = RIM;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, top, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  missRing(ctx, 0, top, rx + 4, ry + 3, st);
}

/** the bass drum from the front: resonant head, hoop, claws */
function kick(ctx: CanvasRenderingContext2D, st: DrumState) {
  const r = 30;
  halo(ctx, 0, 0, r + 4, r + 4, st);
  ctx.save();
  if (st.motion) {
    const s = 1 - 0.035 * fade(st.hitAge, 0.23);
    ctx.scale(s, s);
  }
  // spurs
  ctx.strokeStyle = POLE;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-22, 18);
  ctx.lineTo(-31, 31);
  ctx.moveTo(22, 18);
  ctx.lineTo(31, 31);
  ctx.stroke();
  const head = ctx.createRadialGradient(-4, -6, 0, 0, 0, r);
  head.addColorStop(0, '#2c3036');
  head.addColorStop(0.72, '#1a1d21');
  head.addColorStop(1, '#121417');
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  // claws round the hoop
  ctx.fillStyle = LUG;
  for (let i = 0; i < 10; i++) {
    const a = ((i * 36 + 18) * Math.PI) / 180;
    ctx.save();
    ctx.translate((r - 1) * Math.cos(a), (r - 1) * Math.sin(a));
    ctx.rotate(a + Math.PI / 2);
    ctx.beginPath();
    ctx.roundRect(-2.2, -4, 4.4, 8, 1.5);
    ctx.fill();
    ctx.restore();
  }
  lights(ctx, 0, 0, r - 4, r - 4, [9, 9], st);
  // port
  ctx.strokeStyle = '#6c717a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = RIM;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  missRing(ctx, 0, 0, r + 4, r + 4, st);
}

/** a thin bronze disc with an edge, lathe grooves and a bell */
function cymbal(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.fillStyle = '#383126';
  ctx.beginPath();
  ctx.ellipse(x, y + 2.6, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const bronze = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  bronze.addColorStop(0, '#9c8c66');
  bronze.addColorStop(0.5, '#6e6248');
  bronze.addColorStop(1, '#463e2f');
  ctx.fillStyle = bronze;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 0.9;
  for (const f of [0.74, 0.47]) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx * f, ry * f, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#a8966b';
  ctx.beginPath();
  ctx.ellipse(x, y - 1.4, rx * 0.2, ry * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** two cymbals on a rod; the top one lifts when the hat is open */
function hihat(ctx: CanvasRenderingContext2D, st: DrumState) {
  const rx = 44;
  const ry = 6.5;
  const topY = 2 - st.lift * 11;
  halo(ctx, 0, topY, rx, ry + 6, st);
  ctx.save();
  if (st.motion) {
    const f = fade(st.hitAge, 0.26);
    ctx.translate(0, 3 * f);
    ctx.rotate(((1.4 * Math.PI) / 180) * f);
  }
  // rod and the stand's top tube
  ctx.fillStyle = POLE;
  ctx.fillRect(-1.5, -24, 3, 58);
  ctx.beginPath();
  ctx.roundRect(-3.5, 20, 7, 14, 2);
  ctx.fill();
  cymbal(ctx, 0, 9, rx, ry);
  cymbal(ctx, 0, topY, rx, ry);
  // clutch
  ctx.fillStyle = POLE;
  ctx.beginPath();
  ctx.roundRect(-2.5, topY - 11, 5, 8, 1);
  ctx.fill();
  lights(ctx, 0, topY, rx, ry, [7, 2.6], st);
  ctx.restore();
  missRing(ctx, 0, (topY + 9) / 2, rx + 5, ry + 8, st);
}

/** a crash on a boom stand, tilted; it swings when hit */
function crash(ctx: CanvasRenderingContext2D, st: DrumState) {
  const cx = -6;
  const cy = -8;
  const rx = 46;
  const ry = 8;
  // stand
  ctx.strokeStyle = POLE;
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(30, 34);
  ctx.lineTo(28, -2);
  ctx.lineTo(cx + 4, cy + 3);
  ctx.stroke();
  halo(ctx, cx, cy, rx, ry + 6, st);
  ctx.save();
  ctx.translate(cx, cy);
  let tilt = -9;
  if (st.motion && st.hitAge >= 0 && st.hitAge < 1) tilt += 6 * Math.exp(-st.hitAge * 4.5) * Math.sin(st.hitAge * 15);
  ctx.rotate((tilt * Math.PI) / 180);
  cymbal(ctx, 0, 0, rx, ry);
  lights(ctx, 0, 0, rx, ry, [7, 2.6], st);
  missRing(ctx, 0, 1, rx + 5, ry + 5, st);
  ctx.restore();
}
