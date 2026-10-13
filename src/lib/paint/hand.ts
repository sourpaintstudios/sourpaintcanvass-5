import type { PaintFrame } from "@/lib/paint/types";

type RGB = [number, number, number];
type Act = (dt: number) => boolean | void;

const SPECTRUM: RGB[] = [
  [229, 56, 59],
  [243, 114, 44],
  [249, 168, 37],
  [249, 199, 79],
  [144, 190, 46],
  [47, 174, 95],
  [26, 178, 168],
  [43, 163, 224],
  [58, 91, 217],
  [106, 63, 201],
  [176, 63, 191],
  [224, 69, 123],
];

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rnd = (a: number, b?: number) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const frac = (v: number) => v - Math.floor(v);

function gauss() {
  let s = 0;
  for (let i = 0; i < 4; i++) s += Math.random();
  return (s - 2) / 0.58;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function shade(c: RGB, t: number): RGB {
  return t >= 0 ? mix(c, [255, 250, 240], t) : mix(c, [24, 14, 22], -t);
}

function rgba(c: RGB, a: number) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

function rgb(c: RGB) {
  return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
}

/**
 * The live oil brush from the canvas that actually paints.
 * A hit lays one bristle stroke somewhere new on the sheet.
 * The stroke draws itself out. A drip happens at the end, not the whole time.
 * Silence adds nothing. What is already wet can finish.
 */
export class Hand {
  private acts: Act[] = [];
  private hi = 0;
  private last = 0;
  private lastSustain = 0;
  private readonly u: number;
  private readonly x0: number;
  private readonly y0: number;
  private readonly x1: number;
  private readonly y1: number;
  private readonly cx: number;
  private readonly cy: number;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly w: number,
    private readonly h: number,
  ) {
    this.u = this.w / 1000;
    this.x0 = this.w * 0.04;
    this.y0 = this.h * 0.04;
    this.x1 = this.w * 0.96;
    this.y1 = this.h * 0.96;
    this.cx = (this.x0 + this.x1) / 2;
    this.cy = (this.y0 + this.y1) / 2;
  }

  begin() {
    const ctx = this.ctx;
    ctx.fillStyle = "#f3efe6";
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.x0, this.y0, this.x1 - this.x0, this.y1 - this.y0);
    ctx.clip();
    const step = 3.2 * this.u;
    ctx.lineWidth = Math.max(1, 0.8 * this.u);
    for (let y = this.y0; y < this.y1; y += step) {
      ctx.strokeStyle = `rgba(70,58,44,${0.035 + Math.random() * 0.04})`;
      ctx.beginPath();
      ctx.moveTo(this.x0, y);
      ctx.lineTo(this.x1, y + (Math.random() - 0.5));
      ctx.stroke();
    }
    for (let x = this.x0; x < this.x1; x += step) {
      ctx.strokeStyle = `rgba(70,58,44,${0.035 + Math.random() * 0.04})`;
      ctx.beginPath();
      ctx.moveTo(x, this.y0);
      ctx.lineTo(x + (Math.random() - 0.5), this.y1);
      ctx.stroke();
    }
    ctx.restore();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }

  tick(now: number, frame: PaintFrame | null) {
    const dt = this.last ? Math.min(3, (now - this.last) / 16.67) : 1;
    this.last = now;
    if (frame && frame.sounding && frame.level >= 0.12) {
      if (frame.onset) this.onset(frame);
      else if (frame.level > 0.16 && now - this.lastSustain > 450) {
        this.lastSustain = now;
        this.sustain(frame);
      }
    }
    this.acts = this.acts.filter((act) => act(dt) !== false);
  }

  private add(act: Act) {
    if (this.acts.length < 70) this.acts.push(act);
  }

  private color(frame: PaintFrame, jit = 0.05, alt = false): RGB {
    const pc = frame.root >= 0 ? frame.root : frame.midi != null ? ((Math.round(frame.midi) % 12) + 12) % 12 : Math.floor(Math.random() * 12);
    const base = SPECTRUM[(pc + (alt ? 1 : 0)) % SPECTRUM.length] ?? SPECTRUM[0];
    const oct = clamp(((frame.midi ?? 64) - 55) / 30, -0.5, 0.8);
    return shade(base, oct * 0.16 + rnd(-jit, jit));
  }

  private spot(spread = 1) {
    this.hi += 1;
    const a = frac(0.5 + this.hi * 0.6180339);
    const b = frac(0.5 + this.hi * 0.7548776);
    const iw = this.x1 - this.x0;
    const ih = this.y1 - this.y0;
    const gx = this.cx + gauss() * 0.2 * iw * spread;
    const gy = this.cy + gauss() * 0.2 * ih * spread;
    const x = lerp(gx, this.x0 + a * iw, 0.55);
    const y = lerp(gy, this.y0 + b * ih, 0.55);
    return {
      x: clamp(x, this.x0 + iw * 0.07, this.x1 - iw * 0.07),
      y: clamp(y, this.y0 + ih * 0.07, this.y1 - ih * 0.07),
    };
  }

  private angle(frame: PaintFrame) {
    const dir = frame.lift > 0.12 ? 1 : frame.lift < -0.12 ? -1 : 0;
    const base = dir > 0 ? -0.5 : dir < 0 ? 0.5 : rnd(-0.35, 0.35);
    return base + (0.5 - frame.pitchNorm) * 0.9 + rnd(-0.3, 0.3);
  }

  private onset(frame: PaintFrame) {
    const s = this.spot(1);
    const u = this.u;
    const col = this.color(frame);
    const ang = this.angle(frame);
    const W = this.w;
    if (frame.strength > 0.3 || frame.speed > 0.4) {
      this.add(
        this.bloom(
          s.x + rnd(-40, 40) * u,
          s.y + rnd(-40, 40) * u,
          rnd(0.07, 0.16) * W * (0.6 + frame.strength),
          shade(this.color(frame, 0.08, true), -0.08),
          60,
        ),
      );
    }
    const len = rnd(0.16, 0.42) * W * (0.6 + frame.strength * 0.6);
    const wid = rnd(0.028, 0.06) * W * (0.6 + frame.strength * 0.7);
    const c0 = { x: s.x - Math.cos(ang) * len * 0.5, y: s.y - Math.sin(ang) * len * 0.5 };
    this.add(
      this.oil(c0.x, c0.y, ang, len, wid, col, 1 + frame.speed * 0.8, (end) => {
        if (Math.random() < 0.25 + frame.strength * 0.4) {
          this.add(this.drip(end.x + rnd(-wid, wid) * 0.4, end.y + wid * 0.4, col, rnd(3.2, 6.4) * u));
        }
      }),
    );
    this.add(() => {
      this.spatter(s.x, s.y, col, 10 + Math.floor(frame.strength * 26), 0.07 * W);
      return false;
    });
  }

  private sustain(frame: PaintFrame) {
    const s = this.spot(1.1);
    this.add(this.bloom(s.x, s.y, rnd(0.05, 0.1) * this.w, this.color(frame, 0.08), 50));
  }

  private quad(x: number, y: number, ang: number, len: number, bendK = 0.5) {
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const nx = -dy;
    const ny = dx;
    const bend = (Math.random() - 0.5) * bendK * len;
    const p1 = { x: x + dx * len * 0.5 + nx * bend, y: y + dy * len * 0.5 + ny * bend };
    const p2 = { x: x + dx * len, y: y + dy * len };
    const P = (t: number) => {
      const s = 1 - t;
      return { x: s * s * x + 2 * s * t * p1.x + t * t * p2.x, y: s * s * y + 2 * s * t * p1.y + t * t * p2.y };
    };
    const D = (t: number) => {
      const s = 1 - t;
      const a = 2 * s * (p1.x - x) + 2 * t * (p2.x - p1.x);
      const b = 2 * s * (p1.y - y) + 2 * t * (p2.y - p1.y);
      const l = Math.hypot(a, b) || 1;
      return { x: a / l, y: b / l };
    };
    return { P, D };
  }

  private oil(
    x: number,
    y: number,
    ang: number,
    len: number,
    wid: number,
    col: RGB,
    speed: number,
    done?: (end: { x: number; y: number }) => void,
  ): Act {
    const u = this.u;
    const ctx = this.ctx;
    const { P, D } = this.quad(x, y, ang, len, 0.5);
    const n = clamp(Math.round(wid / (1.45 * u)), 10, 48);
    const br: { off: number; w: number; c: RGB; start: number; life: number; ph: number; wf: number }[] = [];
    for (let i = 0; i < n; i++) {
      const off = (i / (n - 1)) * 2 - 1;
      const edge = Math.abs(off);
      const sh = rnd(-0.07, 0.07) + Math.sin(i * 1.7) * 0.04 + (edge > 0.82 ? -0.15 : 0) + -off * 0.05;
      br.push({ off, w: (wid / n) * 1.9, c: shade(col, sh), start: rnd(0, 0.07), life: rnd(0.8, 1.04), ph: rnd(6.28), wf: rnd(2, 5) });
    }
    let t = 0;
    const F = clamp(len / (u * 20), 9, 42) / speed;
    return (dt) => {
      const t1 = Math.min(1, t + dt / F);
      for (let s = 0; s < 2; s++) {
        const ta = lerp(t, t1, s / 2);
        const tb = lerp(t, t1, (s + 1) / 2);
        const a = P(ta);
        const b = P(tb);
        const d = D((ta + tb) / 2);
        const nx = -d.y;
        const ny = d.x;
        for (const q of br) {
          if (tb > q.life || tb < q.start) continue;
          const k = 1 + 0.012 * Math.sin(tb * q.wf * 2.2 + q.ph);
          const off = q.off * wid * 0.5 + Math.sin(tb * q.wf * 3.1 + q.ph) * 0.35 * u;
          ctx.strokeStyle = rgb([q.c[0] * k, q.c[1] * k, q.c[2] * k]);
          ctx.lineWidth = q.w;
          ctx.beginPath();
          ctx.moveTo(a.x + nx * off - d.x * q.w * 0.8, a.y + ny * off - d.y * q.w * 0.8);
          ctx.lineTo(b.x + nx * off, b.y + ny * off);
          ctx.stroke();
        }
      }
      t = t1;
      if (t >= 1) {
        done?.(P(1));
        return false;
      }
    };
  }

  private bloom(x: number, y: number, R: number, col: RGB, frames: number): Act {
    const ctx = this.ctx;
    const K = 28;
    const str = rnd(0.85, 1.3);
    const ph = Array.from({ length: 5 }, () => ({ a: rnd(0.07, 0.2), f: 2 + Math.floor(rnd(4)), p: rnd(6.28) }));
    const edge = shade(col, -0.22);
    let i = 0;
    return (dt) => {
      i += dt;
      const k = Math.min(1, i / frames);
      const r = lerp(R * 0.22, R, 1 - (1 - k) ** 2);
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.beginPath();
      for (let j = 0; j <= K; j++) {
        const th = (j / K) * 6.2832;
        let m = 1;
        for (const p of ph) m += p.a * Math.sin(p.f * th + p.p) * 0.5;
        const px = x + Math.cos(th) * r * m;
        const py = y + Math.sin(th) * r * m * str;
        if (j) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = rgba(col, 0.014);
      ctx.fill();
      if (k >= 1) {
        ctx.strokeStyle = rgba(edge, 0.11);
        ctx.lineWidth = 1.3 * this.u;
        ctx.stroke();
      }
      ctx.restore();
      return k < 1;
    };
  }

  private drip(x: number, y: number, col: RGB, wid: number): Act {
    const ctx = this.ctx;
    const u = this.u;
    let yy = y;
    let v = 0.5 * u;
    const lim = y + rnd(0.04, 0.2) * this.h;
    return (dt) => {
      const ny = Math.min(this.y1 - u, yy + v * dt);
      v = Math.min(5 * u, v * (1 + 0.03 * dt));
      ctx.strokeStyle = rgba(shade(col, -0.05), 0.95);
      ctx.lineWidth = wid;
      ctx.beginPath();
      ctx.moveTo(x, yy);
      ctx.lineTo(x, ny);
      ctx.stroke();
      ctx.strokeStyle = rgba(shade(col, 0.3), 0.25);
      ctx.lineWidth = wid * 0.3;
      ctx.beginPath();
      ctx.moveTo(x - wid * 0.22, yy);
      ctx.lineTo(x - wid * 0.22, ny);
      ctx.stroke();
      yy = ny;
      if (yy >= lim || yy >= this.y1 - 2 * u) {
        ctx.fillStyle = rgba(shade(col, -0.08), 0.97);
        ctx.beginPath();
        ctx.arc(x, yy, wid * 0.78, 0, 6.2832);
        ctx.fill();
        return false;
      }
    };
  }

  private spatter(x: number, y: number, col: RGB, n: number, R: number) {
    const ctx = this.ctx;
    const u = this.u;
    for (let i = 0; i < n; i++) {
      const a = rnd(6.28);
      const r = Math.abs(gauss()) * R;
      ctx.fillStyle = rgba(shade(col, rnd(-0.1, 0.1)), rnd(0.5, 0.9));
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, rnd(0.8, 3.4) * u, 0, 6.2832);
      ctx.fill();
    }
  }
}
