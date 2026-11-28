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
  const ct = Number.isFinite(Number(t)) ? clamp(Number(t), 0, 1) : 0;
  if (ct <= 0) return 0;
  if (ct >= 1) return 1;
  const cx1 = clamp(Number.isFinite(Number(x1)) ? Number(x1) : 0.42, 0, 1);
  const cy1 = clamp(Number.isFinite(Number(y1)) ? Number(y1) : 0, -2, 3);
  const cx2 = clamp(Number.isFinite(Number(x2)) ? Number(x2) : 0.58, 0, 1);
  const cy2 = clamp(Number.isFinite(Number(y2)) ? Number(y2) : 1, -2, 3);
  const wasmVal = WasmBridge.evalCubicBezier(ct, cx1, cy1, cx2, cy2);
  if (wasmVal !== null && Number.isFinite(wasmVal)) return wasmVal;

  const sampleX = (u) => {
    const inv = 1 - u;
    return 3 * inv * inv * u * cx1 + 3 * inv * u * u * cx2 + u * u * u;
  };
  const sampleDerivX = (u) => {
    const inv = 1 - u;
    return 3 * inv * inv * cx1 + 6 * inv * u * (cx2 - cx1) + 3 * u * u * (1 - cx2);
  };
  const sampleY = (u) => {
    const inv = 1 - u;
    return 3 * inv * inv * u * cy1 + 3 * inv * u * u * cy2 + u * u * u;
  };

  let u = ct;
  for (let i = 0; i < 6; i++) {
    const err = sampleX(u) - ct;
    const d = sampleDerivX(u);
    if (Math.abs(err) < 1e-5) break;
    if (Math.abs(d) < 1e-6) break;
    u = clamp(u - err / d, 0, 1);
  }
  // Fallback binary refine if needed
  let lo = 0;
  let hi = 1;
  if (Math.abs(sampleX(u) - ct) > 1e-4) {
    u = ct;
    for (let i = 0; i < 12; i++) {
      const x = sampleX(u);
      if (Math.abs(x - ct) < 1e-5) break;
      if (ct > x) lo = u;
      else hi = u;
      u = (lo + hi) * 0.5;
    }
  }
  const outY = sampleY(u);
  return Number.isFinite(outY) ? outY : ct;
}

export function applyEasing(t, easing = 'linear', bezier = [0.42, 0, 0.58, 1]) {
  const x = clamp(Number.isFinite(Number(t)) ? Number(t) : 0, 0, 1);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const safeBez = Array.isArray(bezier) && bezier.length >= 4 ? bezier : [0.42, 0, 0.58, 1];
  let out = x;
  switch (easing) {
    case 'hold':
      out = x >= 1 ? 1 : 0;
      break;
    case 'easeIn':
      out = x * x * x;
      break;
    case 'easeOut':
      out = 1 - Math.pow(1 - x, 3);
      break;
    case 'easeInOut':
      out = x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
      break;
    case 'easeOutBack': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      out = 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
      break;
    }
    case 'anticipate': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      out = c3 * x * x * x - c1 * x * x;
      break;
    }
    case 'spring': {
      const freq = Math.PI * 3.5;
      out = 1 - Math.exp(-6.0 * x) * Math.cos(freq * x);
      break;
    }
    case 'cubicBezier':
      out = evalCubicBezier(x, safeBez[0], safeBez[1], safeBez[2], safeBez[3]);
      break;
    case 'linear':
    default:
      out = x;
      break;
  }
  return Number.isFinite(out) ? out : x;
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

