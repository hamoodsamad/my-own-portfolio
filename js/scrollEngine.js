/**
 * Scroll Scrubbing & Physics Engine Module
 * Drives the high-performance rAF tick loop, timestamp velocity tracking,
 * adaptive responsive spring dynamics, and ResizeObserver layout caches.
 */

import { FRAME_COUNT, REDUCE_MOTION } from './config.js';
import { computeFramingForProgress } from './framing.js';
import {
  updateAssetTier,
  ensureNeighborhood,
  pruneDistantFrames,
  scheduleBackgroundPreload,
  preloadAnchorFrames,
  detectAssetTier,
  getFrameState,
  setOnFrameReady,
} from './frameLoader.js';
import {
  initRenderer,
  resizeRenderer,
  renderFrame,
  setDebugOverlay,
  getRendererStats,
} from './rendering.js';

let canvas = null;
let width = 0;
let height = 0;
let lastRebuiltW = 0;
let lastRebuiltH = 0;
let canvasScale = 1;
let targetCanvasW = 1920;
let targetCanvasH = 1080;
let maxScrollCache = 1;
let cachedSectionOffsets = [];

let cachedStartDrawRect = null;
let cachedEndDrawRect = null;

let targetFrame = 0;
let currentFrame = 0;
let rafId = null;
let lastTimestamp = 0;
let pendingScrollY = 0;
let scrollScheduled = false;
let lastScrollDirection = 1;
let lastNeighborhoodCenter = -1;
let lastNavScrollY = -999;
let needsRender = false;

// Velocity & Physics
let lastScrollEventTime = 0;
let lastScrollEventY = 0;
let filteredScrollVelocity = 0;
let isUserScrolling = false;
let userScrollStopTimer = null;
let docResizeObserver = null;
let resizeDebounceTimer = null;

// Telemetry & Debug
let isDebug = false;
let lastDebugReport = 0;

// Subsystem callbacks
let onScrollNavUpdate = null;
let onCarouselSuspend = null;
let onCarouselResume = null;

export function setSubsystemCallbacks(callbacks) {
  if (callbacks.onScrollNavUpdate) onScrollNavUpdate = callbacks.onScrollNavUpdate;
  if (callbacks.onCarouselSuspend) onCarouselSuspend = callbacks.onCarouselSuspend;
  if (callbacks.onCarouselResume) onCarouselResume = callbacks.onCarouselResume;
}

export function setDebug(enabled) {
  isDebug = Boolean(enabled);
}

export function scrollYToFrame(scrollY) {
  const progress = Math.min(1, Math.max(0, scrollY / (maxScrollCache || 1)));
  return progress * (FRAME_COUNT - 1);
}

export function updateLayoutCaches(trackedSections = []) {
  if (window.visualViewport) {
    width = Math.round(window.visualViewport.width);
    height = Math.round(window.visualViewport.height);
  } else {
    width = window.innerWidth;
    height = window.innerHeight;
  }

  maxScrollCache = Math.max(1, document.documentElement.scrollHeight - height);
  const scrollY = window.scrollY || window.pageYOffset || 0;

  if (trackedSections && trackedSections.length > 0) {
    cachedSectionOffsets = trackedSections.map((sec) => {
      const rect = sec.getBoundingClientRect();
      return {
        id: sec.id,
        top: rect.top + scrollY,
      };
    });
  }

  const { currentDecodeW, currentDecodeH } = getFrameState();
  cachedStartDrawRect = computeFramingForProgress(0, width, height, currentDecodeW, currentDecodeH);
  cachedEndDrawRect = computeFramingForProgress(1, width, height, currentDecodeW, currentDecodeH);
}

export function resize(force = false, trackedSections = []) {
  const newW = window.visualViewport ? Math.round(window.visualViewport.width) : window.innerWidth;
  const newH = window.visualViewport ? Math.round(window.visualViewport.height) : window.innerHeight;
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (newW < 1024);

  const widthChanged = newW !== lastRebuiltW;
  const heightDelta = Math.abs(newH - lastRebuiltH);
  const shouldRebuildBuffer = force || widthChanged || !isTouch || heightDelta > 120;

  updateLayoutCaches(trackedSections);

  if (!shouldRebuildBuffer && lastRebuiltW > 0) {
    targetFrame = scrollYToFrame(window.scrollY || window.pageYOffset || 0);
    if (rafId === null) {
      currentFrame = targetFrame;
      renderFrame(currentFrame, cachedStartDrawRect, cachedEndDrawRect, lastScrollDirection);
    }
    return;
  }

  lastRebuiltW = newW;
  lastRebuiltH = newH;

  const rawDpr = window.devicePixelRatio || 1;
  const rendererState = resizeRenderer(width, height, rawDpr);
  canvasScale = rendererState.canvasScale;
  targetCanvasW = rendererState.targetCanvasW;
  targetCanvasH = rendererState.targetCanvasH;

  const tierChanged = updateAssetTier();
  if (tierChanged) {
    preloadAnchorFrames(targetCanvasW, targetCanvasH, width);
  }

  targetFrame = scrollYToFrame(window.scrollY || window.pageYOffset || 0);
  currentFrame = targetFrame;
  ensureNeighborhood(Math.round(currentFrame), 0, 0, targetCanvasW, targetCanvasH, width);
  renderFrame(currentFrame, cachedStartDrawRect, cachedEndDrawRect, lastScrollDirection, true);
}

export function onDebouncedResize() {
  if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = setTimeout(() => {
    resize(false);
  }, 100);
}

export function scheduleLoop() {
  if (rafId === null) {
    lastTimestamp = 0;
    rafId = requestAnimationFrame(tick);
  }
}

/**
 * Scroll event handler with low-pass velocity calculation
 */
export function onNativeScroll(e) {
  const now = (e && e.timeStamp) ? e.timeStamp : performance.now();
  const currentY = window.scrollY || window.pageYOffset || 0;
  pendingScrollY = currentY;
  scrollScheduled = true;
  isUserScrolling = true;

  if (typeof onCarouselSuspend === 'function') {
    onCarouselSuspend();
  }

  if (REDUCE_MOTION) {
    if (typeof onScrollNavUpdate === 'function') {
      onScrollNavUpdate(currentY, height, cachedSectionOffsets);
    }
    return;
  }

  if (lastScrollEventTime > 0) {
    const dt = (now - lastScrollEventTime) / 1000;
    if (dt > 0.001 && dt < 0.5) {
      const rawVelPx = (currentY - lastScrollEventY) / dt;
      const rawVelFrames = (rawVelPx / (maxScrollCache || 1)) * (FRAME_COUNT - 1);
      filteredScrollVelocity = filteredScrollVelocity * 0.70 + rawVelFrames * 0.30;
    }
  }
  lastScrollEventTime = now;
  lastScrollEventY = currentY;

  if (userScrollStopTimer) clearTimeout(userScrollStopTimer);
  userScrollStopTimer = setTimeout(() => {
    isUserScrolling = false;
    scheduleBackgroundPreload(150, currentFrame, false);
    if (typeof onCarouselResume === 'function') {
      onCarouselResume();
    }
  }, 160);

  scheduleLoop();
}

/**
 * High-Performance rAF Physics Loop
 * Liquid-smooth responsiveness on laptop trackpads and precision wheels.
 */
function tick(timestamp) {
  const dt = lastTimestamp ? Math.min((timestamp - lastTimestamp) / 1000, 1 / 30) : 1 / 60;
  lastTimestamp = timestamp;

  filteredScrollVelocity *= Math.exp(-3.5 * dt);

  if (scrollScheduled) {
    scrollScheduled = false;
    const newTarget = scrollYToFrame(pendingScrollY);
    const diff = newTarget - targetFrame;
    if (Math.abs(diff) > 0.01) {
      lastScrollDirection = diff >= 0 ? 1 : -1;
    }
    targetFrame = newTarget;

    if (Math.abs(pendingScrollY - lastNavScrollY) > 8) {
      lastNavScrollY = pendingScrollY;
      if (typeof onScrollNavUpdate === 'function') {
        onScrollNavUpdate(pendingScrollY, height, cachedSectionOffsets);
      }
    }

    const roundedTarget = Math.round(targetFrame);
    if (roundedTarget !== lastNeighborhoodCenter) {
      lastNeighborhoodCenter = roundedTarget;
      const absVel = Math.abs(filteredScrollVelocity);
      const velocityBias = absVel > 3
        ? Math.min(Math.round(absVel * 0.22), 12) * lastScrollDirection
        : 0;
      ensureNeighborhood(
        Math.max(0, Math.min(FRAME_COUNT - 1, roundedTarget + velocityBias)),
        lastScrollDirection,
        filteredScrollVelocity,
        targetCanvasW,
        targetCanvasH,
        width
      );
      pruneDistantFrames(roundedTarget, width);
    }
  }

  const delta = targetFrame - currentFrame;
  const absDelta = Math.abs(delta);

  if (absDelta < 0.003) {
    currentFrame = targetFrame;
    renderFrame(currentFrame, cachedStartDrawRect, cachedEndDrawRect, lastScrollDirection, needsRender);
    needsRender = false;
    rafId = null;
    lastTimestamp = 0;
    scheduleBackgroundPreload(200, currentFrame, false);
    return;
  }

  // Liquid-Smooth Responsive Spring Dynamics for Laptops & Mobile:
  // Snappy baseEase (~32) during active scrolling tracks hand movements instantaneously with ZERO sluggish lag;
  // Scales up to 54 on high-velocity flicks.
  const velNorm = Math.min(1, Math.abs(filteredScrollVelocity) / 28);
  const distBoost = Math.min(14.0, absDelta * 0.25);
  const baseEase = isUserScrolling ? 32.0 : 26.0;
  const dynamicEase = Math.min(54.0, baseEase + velNorm * 10.0 + distBoost);
  const factor = 1 - Math.exp(-dynamicEase * dt);

  if (absDelta > 50) {
    currentFrame += delta * Math.min(0.60, factor * 2.5);
  } else {
    currentFrame += delta * factor;
  }

  renderFrame(currentFrame, cachedStartDrawRect, cachedEndDrawRect, lastScrollDirection);
  needsRender = false;

  rafId = requestAnimationFrame(tick);
}

export function initScrollEngine(canvasElement, trackedSections = []) {
  canvas = canvasElement;
  if (!canvas) return false;

  initRenderer(canvas);
  updateAssetTier();

  setOnFrameReady((frameIndex) => {
    const cur = Math.round(currentFrame);
    if (Math.abs(frameIndex - cur) <= 1) {
      if (rafId === null) {
        renderFrame(currentFrame, cachedStartDrawRect, cachedEndDrawRect, lastScrollDirection, true);
      } else {
        needsRender = true;
      }
    }
  });

  updateLayoutCaches(trackedSections);
  resize(true, trackedSections);

  // Unconditionally preload anchor frames and start high-throughput background preloading on startup
  preloadAnchorFrames(targetCanvasW, targetCanvasH, width);
  ensureNeighborhood(Math.round(currentFrame), 1, 0, targetCanvasW, targetCanvasH, width);
  scheduleBackgroundPreload(50, 0, false);

  // Layout observer on documentElement
  if (typeof ResizeObserver === 'function') {
    docResizeObserver = new ResizeObserver(() => {
      updateLayoutCaches(trackedSections);
    });
    docResizeObserver.observe(document.documentElement);
  }

  // Tab visibility management: pause rAF loop when tab is hidden, wake up cleanly when visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
        lastTimestamp = 0;
      }
    } else {
      updateLayoutCaches(trackedSections);
      pendingScrollY = window.scrollY || window.pageYOffset || 0;
      targetFrame = scrollYToFrame(pendingScrollY);
      currentFrame = targetFrame;
      scrollScheduled = false;
      lastTimestamp = 0;
      ensureNeighborhood(Math.round(currentFrame), 0, 0, targetCanvasW, targetCanvasH, width);
      renderFrame(currentFrame, cachedStartDrawRect, cachedEndDrawRect, lastScrollDirection, true);
      scheduleLoop();
    }
  });

  return true;
}

export function getEngineStats() {
  const rendStats = getRendererStats();
  const frameState = getFrameState();
  return {
    ...rendStats,
    ...frameState,
    currentFrame,
    targetFrame,
    filteredScrollVelocity,
    canvasScale,
  };
}
