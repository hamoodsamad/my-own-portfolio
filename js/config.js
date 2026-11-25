/**
 * Application Configuration & Constants Module
 * Centralized settings for scroll engine, subject framing, asset tiers, and performance tuning.
 */

export const FRAME_COUNT = 238;
export const ANCHOR_STRIDE = 10;
export const PRUNE_THROTTLE = 8;

export const USE_BITMAP =
  typeof window !== 'undefined' &&
  window.location.protocol !== 'file:' &&
  typeof window.createImageBitmap === 'function';

export const REDUCE_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Normalized focal point coordinates on the source frame [0..1].
 * (0,0) is top-left, (1,1) is bottom-right.
 * In the sequence, subject's face is centered around (0.52, 0.32).
 */
export const FOCAL_CONFIG = Object.freeze({
  startX: 0.52,      // Normalized X at frame 0
  endX: 0.58,        // Normalized X at frame 237 (subtle drift across scroll sequence)
  startY: 0.32,      // Normalized Y at frame 0
  endY: 0.35,        // Normalized Y at frame 237
  headRadiusX: 0.16, // Approximate head bounding radius
  headRadiusY: 0.20,
});

const isLowMemoryDevice =
  typeof navigator !== 'undefined' &&
  typeof navigator.deviceMemory === 'number' &&
  navigator.deviceMemory <= 2;

/**
 * Performance & Visual Fidelity tuning constants
 */
export const PERF_CONFIG = Object.freeze({
  maxDesktopDpr: isLowMemoryDevice ? 1.5 : 2.0,
  maxLaptopDpr: isLowMemoryDevice ? 1.35 : 1.75,
  maxMobileDpr: isLowMemoryDevice ? 1.35 : 1.75,
  maxConcurrency: 8,
  parallelBlobWorkers: 8,
  smoothFilterQuality: 'high', // High-precision filtering for sharp Retina rendering
});
