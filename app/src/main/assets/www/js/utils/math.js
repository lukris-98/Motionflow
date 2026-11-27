import { WasmBridge } from '../engine/wasmBridge.js';

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function formatTimecode(frame, fps = 30) {
  const safeFps = Math.max(1, fps);
  const f = Math.max(0, Math.floor(frame));
  const ff = f % safeFps;
  const totalSec = Math.floor(f / safeFps);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

export function formatDurationMs(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0)} ${sizes[i]}`;
}

/**
 * Evaluates a cubic-bezier easing curve P1(x1, y1), P2(x2, y2) at time t in [0, 1].
 */
export function evalCubicBezier(t, x1 = 0.42, y1 = 0, x2 = 0.58, y2 = 1) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const wasmVal = WasmBridge.evalCubicBezier(t, x1, y1, x2, y2);
  if (wasmVal !== null) return wasmVal;

  const sampleX = (u) => {
    const inv = 1 - u;
    return 3 * inv * inv * u * x1 + 3 * inv * u * u * x2 + u * u * u;
  };
  const sampleDerivX = (u) => {
    const inv = 1 - u;
    return 3 * inv * inv * x1 + 6 * inv * u * (x2 - x1) + 3 * u * u * (1 - x2);
  };
  const sampleY = (u) => {
    const inv = 1 - u;
    return 3 * inv * inv * u * y1 + 3 * inv * u * u * y2 + u * u * u;
  };

  let u = t;
  for (let i = 0; i < 6; i++) {
    const err = sampleX(u) - t;
    const d = sampleDerivX(u);
    if (Math.abs(err) < 1e-5) break;
    if (Math.abs(d) < 1e-6) break;
    u = clamp(u - err / d, 0, 1);
  }
  // Fallback binary refine if needed
  let lo = 0;
  let hi = 1;
  if (Math.abs(sampleX(u) - t) > 1e-4) {
    u = t;
    for (let i = 0; i < 12; i++) {
      const x = sampleX(u);
      if (Math.abs(x - t) < 1e-5) break;
      if (t > x) lo = u;
      else hi = u;
      u = (lo + hi) * 0.5;
    }
  }
  return sampleY(u);
}

export function applyEasing(t, easing = 'linear', bezier = [0.42, 0, 0.58, 1]) {
  const x = clamp(t, 0, 1);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  switch (easing) {
    case 'hold':
      return x >= 1 ? 1 : 0;
    case 'easeIn':
      return x * x * x;
    case 'easeOut':
      return 1 - Math.pow(1 - x, 3);
    case 'easeInOut':
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case 'easeOutBack': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }
    case 'anticipate': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return c3 * x * x * x - c1 * x * x;
    }
    case 'spring': {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      const freq = Math.PI * 3.5;
      return 1 - Math.exp(-6.0 * x) * Math.cos(freq * x);
    }
    case 'cubicBezier':
      return evalCubicBezier(x, bezier[0], bezier[1], bezier[2], bezier[3]);
    case 'linear':
    default:
      return x;
  }
}

export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function normalizeHexColor(val, fallback = '#ffffff') {
  if (typeof val !== 'string') return fallback;
  let hex = val.trim();
  if (!hex.startsWith('#')) hex = `#${hex}`;
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return hex.toLowerCase();
  }
  return fallback;
}

export function hexToRgbBytes(hex) {
  const norm = normalizeHexColor(hex, '#ffffff').slice(1);
  return [
    parseInt(norm.slice(0, 2), 16),
    parseInt(norm.slice(2, 4), 16),
    parseInt(norm.slice(4, 6), 16)
  ];
}

export function lerpColorHex(hexA, hexB, t) {
  const [r1, g1, b1] = hexToRgbBytes(hexA);
  const [r2, g2, b2] = hexToRgbBytes(hexB);
  const k = clamp(Number(t) || 0, 0, 1);
  const toHex = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(lerp(r1, r2, k))}${toHex(lerp(g1, g2, k))}${toHex(lerp(b1, b2, k))}`;
}

