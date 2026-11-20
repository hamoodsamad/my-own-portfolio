/**
 * Canvas Rendering Engine Module
 * Manages 2D rasterization context, sub-pixel fractional crossfading, integer coordinate snapping,
 * atmospheric edge gradients, and debug overlay.
 */

import { FRAME_COUNT, PERF_CONFIG } from './config.js';
import {
  getFrame,
  getFallbackBitmap,
  setFallbackBitmap,
  findNearestFrame,
} from './frameLoader.js';
import { getInterpolatedDrawRect } from './framing.js';

let canvas = null;
let ctx = null;
let canvasScale = 1;
let targetCanvasW = 1920;
let targetCanvasH = 1080;
let width = 0;
let height = 0;
let isDebugOverlay = false;

// Cached render states to prevent redundant paints
let lastRenderedFloor = -1;
let lastRenderedCeil = -1;
let lastRenderedFrac = -1;
let lastRenderedPos = -1;

// Telemetry
const stats = {
  rendered: 0,
  exactHits: 0,
  neighborHits: 0,
  crossfades: 0,
  skipped: 0,
};

export function initRenderer(canvasElement) {
  canvas = canvasElement;
  if (!canvas) return null;

  try {
    ctx =
      canvas.getContext('2d', { alpha: false, desynchronized: true }) ||
      canvas.getContext('2d', { alpha: false });
  } catch (_) {
    ctx = canvas.getContext('2d', { alpha: false });
  }

  return ctx;
}

export function setDebugOverlay(enabled) {
  isDebugOverlay = Boolean(enabled);
}

export function getRendererStats() {
  return stats;
}

export function resizeRenderer(vpW, vpH, rawDpr) {
  width = vpW;
  height = vpH;

  // Cap canvasScale to 1.25 on standard laptops & mobile (halves pixel load with crisp retina detail)
  // Allow up to 1.5 only on true 4K desktop screens (width >= 2200)
  const maxScale = width >= 2200 ? PERF_CONFIG.maxDesktopDpr : PERF_CONFIG.maxLaptopDpr;
  canvasScale = Math.min(rawDpr, maxScale);

  targetCanvasW = Math.max(1, Math.round(width * canvasScale));
  targetCanvasH = Math.max(1, Math.round(height * canvasScale));

  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';

  if (canvas.width !== targetCanvasW || canvas.height !== targetCanvasH) {
    canvas.width = targetCanvasW;
    canvas.height = targetCanvasH;
  }

  ctx.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = PERF_CONFIG.smoothFilterQuality;

  return { canvasScale, targetCanvasW, targetCanvasH };
}

/**
 * Draws the debug overlay (focal point, safe area box, and coordinates).
 */
export function drawDebugOverlay(rect) {
  if (!ctx) return;
  ctx.save();
  // Safe navbar margin
  ctx.fillStyle = 'rgba(255, 87, 25, 0.12)';
  ctx.fillRect(0, 0, width, rect.safeNavbarTop);
  ctx.strokeStyle = '#ff5719';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, width, rect.safeNavbarTop);

  // Subject draw bounds
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.offsetX, rect.offsetY, rect.drawW, rect.drawH);

  // Focal point crosshair
  const fx = rect.focalScreenX;
  const fy = rect.focalScreenY;
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(fx, fy, 10, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(fx - 16, fy);
  ctx.lineTo(fx + 16, fy);
  ctx.moveTo(fx, fy - 16);
  ctx.lineTo(fx, fy + 16);
  ctx.stroke();

  // Mode badge
  ctx.fillStyle = 'rgba(5, 3, 8, 0.85)';
  ctx.fillRect(12, rect.safeNavbarTop + 12, 170, 48);
  ctx.fillStyle = '#00f0ff';
  ctx.font = '11px monospace';
  ctx.fillText(`MODE: ${rect.mode}`, 20, rect.safeNavbarTop + 30);
  ctx.fillText(`FOCAL: ${fx.toFixed(0)}, ${fy.toFixed(0)}`, 20, rect.safeNavbarTop + 46);
  ctx.restore();
}

/**
 * High-Performance Liquid-Smooth Frame Renderer
 * Renders base frame and sub-pixel fractional crossfade with integer coordinate snapping.
 * @param {number} position Scrubbed playhead position [0..FRAME_COUNT - 1]
 * @param {object} cachedStart Framing at frame 0
 * @param {object} cachedEnd Framing at frame 237
 * @param {number} scrollDir Current scroll direction (1 or -1)
 * @param {boolean} force Force repaint flag
 */
export function renderFrame(position, cachedStart, cachedEnd, scrollDir = 1, force = false) {
  if (!ctx) return;

  const clamped = Math.min(FRAME_COUNT - 1, Math.max(0, position));
  const floorIdx = Math.floor(clamped);
  const ceilIdx = Math.min(FRAME_COUNT - 1, floorIdx + 1);
  const frac = clamped - floorIdx;

  // 1. Resolve primary base frame
  const baseExact = getFrame(floorIdx) !== null;
  const resolvedFloor = baseExact ? floorIdx : findNearestFrame(floorIdx, scrollDir);

  if (resolvedFloor === -1) {
    const fallback = getFallbackBitmap();
    if (fallback) {
      const rect = getInterpolatedDrawRect(position, cachedStart, cachedEnd, FRAME_COUNT);
      const { offsetX, offsetY, drawW, drawH, mode } = rect;
      if (mode === 'phone-portrait' || mode === 'tablet-portrait') {
        ctx.fillStyle = '#050308';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(fallback, offsetX, offsetY, drawW, drawH);
      } else {
        ctx.drawImage(fallback, offsetX, offsetY, drawW, drawH);
      }
    }
    return;
  }

  const baseImg = getFrame(resolvedFloor);
  if (!baseImg) return;

  const fallback = getFallbackBitmap();
  if (fallback && fallback !== baseImg) {
    setFallbackBitmap(baseImg);
  } else if (!fallback) {
    setFallbackBitmap(baseImg);
  }

  if (baseExact) stats.exactHits++;
  else stats.neighborHits++;

  // 2. Resolve secondary crossfade frame for true, silky-smooth 60fps sub-frame blending
  // Only blend with exact adjacent frame (ceilIdx) to eliminate ghosting and distant-frame pop-in
  let crossImg = null;
  if (frac >= 0.03 && ceilIdx !== floorIdx) {
    if (getFrame(ceilIdx) !== null) {
      crossImg = getFrame(ceilIdx);
    }
  }

  // Avoid redundant redraw if frame index and fractional alpha have not meaningfully changed
  if (
    !force &&
    resolvedFloor === lastRenderedFloor &&
    crossImg === null &&
    lastRenderedCeil === -1 &&
    Math.abs(frac - lastRenderedFrac) < 0.005
  ) {
    return;
  }

  const rect = getInterpolatedDrawRect(position, cachedStart, cachedEnd, FRAME_COUNT);
  const { offsetX, offsetY, drawW, drawH, mode } = rect;

  if (mode === 'phone-portrait' || mode === 'tablet-portrait') {
    ctx.fillStyle = '#050308';
    ctx.fillRect(0, 0, width, height);

    // Hardware-snapped integer coordinates prevent sub-pixel blur
    ctx.drawImage(baseImg, offsetX, offsetY, drawW, drawH);

    // Liquid-smooth sub-pixel fractional crossfade
    if (crossImg) {
      ctx.globalAlpha = frac;
      ctx.drawImage(crossImg, offsetX, offsetY, drawW, drawH);
      ctx.globalAlpha = 1.0;
      stats.crossfades++;
    }

    // Soft atmospheric top fade
    const topFadeH = Math.min(60, Math.round(drawH * 0.12));
    if (topFadeH > 0 && offsetY > 0) {
      const topGrad = ctx.createLinearGradient(0, offsetY, 0, offsetY + topFadeH);
      topGrad.addColorStop(0, '#050308');
      topGrad.addColorStop(1, 'rgba(5, 3, 8, 0)');
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, offsetY, width, topFadeH);
    }

    // Soft atmospheric bottom fade merging into black background
    const botFadeH = Math.min(100, Math.round(drawH * 0.20));
    if (botFadeH > 0) {
      const botGrad = ctx.createLinearGradient(0, offsetY + drawH - botFadeH, 0, offsetY + drawH);
      botGrad.addColorStop(0, 'rgba(5, 3, 8, 0)');
      botGrad.addColorStop(0.5, 'rgba(5, 3, 8, 0.6)');
      botGrad.addColorStop(1, '#050308');
      ctx.fillStyle = botGrad;
      ctx.fillRect(0, offsetY + drawH - botFadeH, width, botFadeH + 4);
    }
  } else {
    // Desktop / Laptop: Full cover landscape edge-to-edge
    ctx.drawImage(baseImg, offsetX, offsetY, drawW, drawH);

    // Silky-smooth 60fps fractional crossfade eliminates micro-stepping on laptop trackpads
    if (crossImg) {
      ctx.globalAlpha = frac;
      ctx.drawImage(crossImg, offsetX, offsetY, drawW, drawH);
      ctx.globalAlpha = 1.0;
      stats.crossfades++;
    }
  }

  // Debug overlay
  if (isDebugOverlay) {
    drawDebugOverlay(rect);
  }

  stats.rendered++;
  lastRenderedFloor = resolvedFloor;
  lastRenderedCeil = crossImg ? ceilIdx : -1;
  lastRenderedFrac = frac;
  lastRenderedPos = position;
}
