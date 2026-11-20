/**
 * Unified Subject Framing Mathematics Module
 * Ensures the subject's face is naturally proportioned, fully visible, and perfectly placed
 * across mobile, tablet, laptop, and ultra-wide screens.
 */

import { FOCAL_CONFIG } from './config.js';

/**
 * Computes draw dimensions and coordinate offsets for a given sequence progress [0..1].
 * @param {number} progress Scroll progression [0..1]
 * @param {number} vpW Viewport width in CSS pixels
 * @param {number} vpH Viewport height in CSS pixels
 * @param {number} imgW Source image width
 * @param {number} imgH Source image height
 * @returns {object} Framing configuration
 */
export function computeFramingForProgress(progress, vpW, vpH, imgW, imgH) {
  const activeW = imgW || 1920;
  const activeH = imgH || 1080;

  const isPhonePortrait = vpW < 600 || (vpW < 768 && vpH > vpW * 1.15);
  const isTabletPortrait = !isPhonePortrait && (vpW < 1024 && vpH > vpW);

  // Normalized focal coordinate with subtle start-to-end drift across sequence
  const focalNormX = FOCAL_CONFIG.startX + progress * (FOCAL_CONFIG.endX - FOCAL_CONFIG.startX);
  const focalNormY = FOCAL_CONFIG.startY + progress * (FOCAL_CONFIG.endY - FOCAL_CONFIG.startY);

  let targetScreenX;
  let targetScreenY;
  let safeNavbarTop;
  let layoutMode;
  let scale;

  if (isPhonePortrait) {
    // Phone Portrait: Place subject gracefully on right (70% width) so hero copy stays clear on left.
    // Head sits comfortably under mobile navbar at natural human scale (~23% of viewport height).
    targetScreenX = 0.70;
    targetScreenY = 0.34;
    safeNavbarTop = Math.max(68, vpH * 0.08);
    layoutMode = 'phone-portrait';

    const desiredHeadH = vpH * 0.23;
    const srcHeadH = activeH * 0.36;
    scale = desiredHeadH / srcHeadH;
    // Ensure image width covers phone width with breathing room
    const minScaleW = (vpW * 1.08) / activeW;
    scale = Math.max(scale, minScaleW);
  } else if (isTabletPortrait) {
    // Tablet Portrait: Centered-right balance (60% width), head height ~28% of screen.
    targetScreenX = 0.60;
    targetScreenY = 0.34;
    safeNavbarTop = 72;
    layoutMode = 'tablet-portrait';

    const desiredHeadH = vpH * 0.28;
    const srcHeadH = activeH * 0.36;
    scale = desiredHeadH / srcHeadH;
    const minScaleW = (vpW * 1.05) / activeW;
    scale = Math.max(scale, minScaleW);
  } else {
    // Desktop / Laptop / Ultra-wide / 4K Displays:
    targetScreenX = 0.52;
    targetScreenY = 0.33;
    safeNavbarTop = 75;
    layoutMode = 'cover';
    scale = Math.max(vpW / activeW, vpH / activeH);
  }

  const drawW = Math.round(activeW * scale);
  const drawH = Math.round(activeH * scale);

  const focalPxX = activeW * focalNormX * scale;
  const focalPxY = activeH * focalNormY * scale;

  let desiredOffsetX = vpW * targetScreenX - focalPxX;
  let desiredOffsetY = vpH * targetScreenY - focalPxY;

  // Ensure top of head (focal - headRadius) never hides under navbar
  const headTopPx = desiredOffsetY + activeH * (focalNormY - FOCAL_CONFIG.headRadiusY) * scale;
  if (headTopPx < safeNavbarTop) {
    desiredOffsetY += (safeNavbarTop - headTopPx);
  }

  // Clamping: horizontally never reveal empty side edges
  const minOffsetX = vpW - drawW;
  const maxOffsetX = 0;
  const offsetX = Math.round(Math.min(maxOffsetX, Math.max(minOffsetX, desiredOffsetX)));

  let offsetY;
  if (isPhonePortrait || isTabletPortrait) {
    offsetY = Math.round(desiredOffsetY);
  } else {
    const minOffsetY = vpH - drawH;
    const maxOffsetY = 0;
    offsetY = Math.round(Math.min(maxOffsetY, Math.max(minOffsetY, desiredOffsetY)));
  }

  return {
    offsetX,
    offsetY,
    drawW,
    drawH,
    mode: layoutMode,
    focalScreenX: offsetX + focalPxX,
    focalScreenY: offsetY + focalPxY,
    safeNavbarTop,
  };
}

/**
 * Fast interpolation between cached start and end draw rectangles (zero layout recalculation cost per frame).
 * @param {number} position Frame position [0..FRAME_COUNT - 1]
 * @param {object} cachedStart Framing at frame 0
 * @param {object} cachedEnd Framing at frame 237
 * @param {number} totalFrames Total frame count
 * @returns {object} Interpolated framing rect
 */
export function getInterpolatedDrawRect(position, cachedStart, cachedEnd, totalFrames) {
  if (!cachedStart || !cachedEnd) {
    return { offsetX: 0, offsetY: 0, drawW: 1920, drawH: 1080, mode: 'cover' };
  }
  const t = Math.min(1, Math.max(0, position / (totalFrames - 1)));
  return {
    offsetX: Math.round(cachedStart.offsetX + t * (cachedEnd.offsetX - cachedStart.offsetX)),
    offsetY: Math.round(cachedStart.offsetY + t * (cachedEnd.offsetY - cachedStart.offsetY)),
    drawW: Math.round(cachedStart.drawW + t * (cachedEnd.drawW - cachedStart.drawW)),
    drawH: Math.round(cachedStart.drawH + t * (cachedEnd.drawH - cachedStart.drawH)),
    mode: cachedStart.mode,
    focalScreenX: Math.round(cachedStart.focalScreenX + t * (cachedEnd.focalScreenX - cachedStart.focalScreenX)),
    focalScreenY: Math.round(cachedStart.focalScreenY + t * (cachedEnd.focalScreenY - cachedStart.focalScreenY)),
    safeNavbarTop: cachedStart.safeNavbarTop,
  };
}
