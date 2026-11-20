/**
 * High-Throughput Frame Loading & Caching Engine
 * Manages parallel blob preloading, ImageBitmap hardware decoding, sliding-window cache,
 * urgent priority queues, and adaptive memory pruning.
 */

import {
  FRAME_COUNT,
  ANCHOR_STRIDE,
  PRUNE_THROTTLE,
  USE_BITMAP,
  PERF_CONFIG,
} from './config.js';

// State variables
let currentFrameFolder = './frames-1080p';
let currentDecodeW = 1920;
let currentDecodeH = 1080;
let currentTier = '1080p';
let currentTierGeneration = 0;

const frames = new Array(FRAME_COUNT).fill(null);
const blobCache = new Array(FRAME_COUNT).fill(null);
const blobFetchingSet = new Set();
const loadingSet = new Set();

const urgentQueue = [];
const inUrgentSet = new Set();
let activeWorkers = 0;
let cachedCount = 0;
let cachedBlobCount = 0;
let lastPrunedCenter = -1;
let backgroundPreloadTimer = null;
let lastDrawnFallbackBitmap = null;
let consecutiveDecodeErrors = 0;
let mobileMemoryEmergency = false;

// Callbacks
let onFrameReadyCallback = null;

export function setOnFrameReady(cb) {
  onFrameReadyCallback = cb;
}

export function getFrame(index) {
  if (index < 0 || index >= FRAME_COUNT) return null;
  return frames[index];
}

export function getFallbackBitmap() {
  return lastDrawnFallbackBitmap;
}

export function setFallbackBitmap(bm) {
  lastDrawnFallbackBitmap = bm;
}

export function getFrameState() {
  return {
    currentTier,
    currentFrameFolder,
    currentDecodeW,
    currentDecodeH,
    cachedCount,
    cachedBlobCount,
    activeWorkers,
    frames,
  };
}

export function frameSrc(index) {
  return `${currentFrameFolder}/frame-${String(index + 1).padStart(3, '0')}.webp`;
}

/**
 * Detects optimal asset tier based on display capabilities.
 * Laptops and phones strictly use 1080p for butter-smooth 60fps rasterization.
 */
export function detectAssetTier() {
  const rawDpr = window.devicePixelRatio || 1;
  const vpW = window.visualViewport ? window.visualViewport.width : window.innerWidth;
  const physicalW = vpW * rawDpr;

  // Ultra-Performance Laptop Optimization:
  // Strictly block 4K on standard laptops (1080p, Retina MacBooks 1440x900) for butter-smooth 60fps.
  // 4K tier is strictly reserved for true external 2K/4K/Ultrawide displays (CSS width >= 2200px OR physicalW >= 3200px).
  if (vpW >= 2200 || physicalW >= 3200) {
    return '4k';
  }
  return '1080p';
}

export function updateAssetTier() {
  const tier = detectAssetTier();
  if (tier === currentTier) return false;
  currentTier = tier;
  if (tier === '4k') {
    currentFrameFolder = './frames';
    currentDecodeW = 3840;
    currentDecodeH = 2160;
  } else {
    currentFrameFolder = './frames-1080p';
    currentDecodeW = 1920;
    currentDecodeH = 1080;
  }
  currentTierGeneration++;
  clearAllFrames();
  return true;
}

export function clearAllFrames() {
  for (let i = 0; i < FRAME_COUNT; i++) {
    const bm = frames[i];
    if (bm && bm !== lastDrawnFallbackBitmap && typeof bm.close === 'function') {
      try { bm.close(); } catch (_) {}
    }
    frames[i] = null;
    blobCache[i] = null;
  }
  blobFetchingSet.clear();
  loadingSet.clear();
  urgentQueue.length = 0;
  inUrgentSet.clear();
  cachedCount = 0;
  cachedBlobCount = 0;
  lastPrunedCenter = -1;
}

export function releaseFrame(index) {
  if (index < 0 || index >= FRAME_COUNT) return;
  const bm = frames[index];
  if (bm) {
    if (bm !== lastDrawnFallbackBitmap && typeof bm.close === 'function') {
      try { bm.close(); } catch (_) {}
    }
    frames[index] = null;
    cachedCount = Math.max(0, cachedCount - 1);
  }
}

export function getAdaptiveLookahead(absVel) {
  if (absVel > 30) return 80;
  if (absVel > 15) return 60;
  if (absVel > 6) return 40;
  return 28;
}

export function getAdaptivePruneDistance(vpW) {
  if (mobileMemoryEmergency) return 25;
  const isMob = vpW < 768 || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1 && vpW < 1024);
  return isMob ? 50 : 130;
}

export function pruneDistantFrames(centerIdx, vpW) {
  if (Math.abs(centerIdx - lastPrunedCenter) < PRUNE_THROTTLE) return;
  lastPrunedCenter = centerIdx;
  const pruneDist = getAdaptivePruneDistance(vpW);
  for (let i = 0; i < FRAME_COUNT; i++) {
    if (i === 0 || i === FRAME_COUNT - 1 || i % ANCHOR_STRIDE === 0) {
      continue;
    }
    if (frames[i] !== null && Math.abs(i - centerIdx) > pruneDist) {
      releaseFrame(i);
    }
  }
}

/**
 * Fetches single frame blob with generation protection.
 */
export function fetchBlob(index, gen = currentTierGeneration) {
  if (blobCache[index] !== null) return Promise.resolve(blobCache[index]);
  if (blobFetchingSet.has(index)) return Promise.resolve(null);

  blobFetchingSet.add(index);
  const src = frameSrc(index);

  return fetch(src, { priority: 'low' })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      blobFetchingSet.delete(index);
      if (gen !== currentTierGeneration) return null;
      blobCache[index] = blob;
      cachedBlobCount++;
      return blob;
    })
    .catch(() => {
      blobFetchingSet.delete(index);
      return null;
    });
}

/**
 * Decodes WebP blob into high-performance ImageBitmap.
 */
export function decodeFrame(index, targetCanvasW = 1920, targetCanvasH = 1080, currentFramePos = 0, vpW = 1440) {
  if (index < 0 || index >= FRAME_COUNT) return Promise.resolve(null);
  if (frames[index] !== null) return Promise.resolve(frames[index]);
  if (loadingSet.has(index)) return Promise.resolve(null);

  const gen = currentTierGeneration;
  loadingSet.add(index);

  const blobPromise = blobCache[index] !== null
    ? Promise.resolve(blobCache[index])
    : fetchBlob(index, gen);

  return blobPromise
    .then((blob) => {
      if (!blob || gen !== currentTierGeneration) return null;
      if (USE_BITMAP) {
        const sourceAspect = currentDecodeW / currentDecodeH;
        const minCoverW = Math.max(targetCanvasW, Math.round(targetCanvasH * sourceAspect));
        const targetW = Math.min(currentDecodeW, Math.max(1, minCoverW));
        const targetH = Math.round(targetW / sourceAspect);
        return createImageBitmap(blob, {
          resizeWidth: targetW,
          resizeHeight: targetH,
          resizeQuality: 'medium',
        }).catch(() => createImageBitmap(blob));
      }
      return new Promise((resolve) => {
        const img = new Image();
        const objUrl = URL.createObjectURL(blob);
        img.onload = () => {
          URL.revokeObjectURL(objUrl);
          resolve(img);
        };
        img.onerror = () => {
          URL.revokeObjectURL(objUrl);
          resolve(null);
        };
        img.src = objUrl;
      });
    })
    .then((bm) => {
      loadingSet.delete(index);
      if (!bm) return null;

      consecutiveDecodeErrors = 0;

      if (gen !== currentTierGeneration) {
        if (typeof bm.close === 'function') {
          try { bm.close(); } catch (_) {}
        }
        return null;
      }

      if (frames[index] !== null) {
        if (typeof bm.close === 'function') {
          try { bm.close(); } catch (_) {}
        }
        return frames[index];
      }

      const currentInt = Math.round(currentFramePos);
      const isAnchor = index === 0 || index === FRAME_COUNT - 1 || index % ANCHOR_STRIDE === 0;
      const pruneDist = getAdaptivePruneDistance(vpW);
      if (!isAnchor && Math.abs(index - currentInt) > pruneDist + 8) {
        if (typeof bm.close === 'function') {
          try { bm.close(); } catch (_) {}
        }
        return null;
      }

      frames[index] = bm;
      cachedCount++;

      if (typeof onFrameReadyCallback === 'function') {
        onFrameReadyCallback(index);
      }
      return bm;
    })
    .catch(() => {
      loadingSet.delete(index);
      consecutiveDecodeErrors++;
      if (consecutiveDecodeErrors > 15 && !mobileMemoryEmergency) {
        mobileMemoryEmergency = true;
      }
      return null;
    });
}

/**
 * Schedules urgent frame decoding.
 */
export function requestFrame(index, isUrgent = false, centerIdx = 0) {
  if (index < 0 || index >= FRAME_COUNT) return;
  if (frames[index] !== null || loadingSet.has(index)) return;

  if (isUrgent && !inUrgentSet.has(index)) {
    inUrgentSet.add(index);
    const dist = Math.abs(index - centerIdx);
    let lo = 0, hi = urgentQueue.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (Math.abs(urgentQueue[mid] - centerIdx) <= dist) lo = mid + 1;
      else hi = mid;
    }
    urgentQueue.splice(lo, 0, index);
  }
}

export function pumpQueue(targetCanvasW, targetCanvasH, currentFramePos, vpW) {
  while (activeWorkers < PERF_CONFIG.maxConcurrency && urgentQueue.length > 0) {
    const idx = urgentQueue.shift();
    inUrgentSet.delete(idx);

    if (frames[idx] === null && !loadingSet.has(idx)) {
      activeWorkers++;
      decodeFrame(idx, targetCanvasW, targetCanvasH, currentFramePos, vpW).finally(() => {
        activeWorkers--;
        pumpQueue(targetCanvasW, targetCanvasH, currentFramePos, vpW);
      });
    }
  }
}

/**
 * Ensures neighborhood frames are decoded in sliding window.
 */
export function ensureNeighborhood(centerIdx, direction = 1, filteredScrollVelocity = 0, targetCanvasW = 1920, targetCanvasH = 1080, vpW = 1440) {
  const absVel = Math.abs(filteredScrollVelocity);
  const lookahead = getAdaptiveLookahead(absVel);
  const lookbehind = Math.min(lookahead, absVel > 15 ? 32 : 24);
  const primaryDir = direction >= 0 ? 1 : -1;

  for (let i = urgentQueue.length - 1; i >= 0; i--) {
    const item = urgentQueue[i];
    if (Math.abs(item - centerIdx) > lookahead + 10) {
      urgentQueue.splice(i, 1);
      inUrgentSet.delete(item);
    }
  }

  const immediateRange = [];
  for (let off = 0; off <= 2; off++) {
    const fwd = centerIdx + off * primaryDir;
    if (fwd >= 0 && fwd < FRAME_COUNT) immediateRange.push(fwd);
    const bwd = centerIdx - off * primaryDir;
    if (bwd >= 0 && bwd < FRAME_COUNT && bwd !== fwd) immediateRange.push(bwd);
  }

  for (let off = 3; off <= lookahead; off++) {
    const idx = centerIdx + off * primaryDir;
    if (idx >= 0 && idx < FRAME_COUNT) immediateRange.push(idx);
  }

  for (let off = 3; off <= lookbehind; off++) {
    const opp = centerIdx - off * primaryDir;
    if (opp >= 0 && opp < FRAME_COUNT) immediateRange.push(opp);
  }

  let addedAny = false;
  for (let i = 0; i < immediateRange.length; i++) {
    const idx = immediateRange[i];
    if (frames[idx] === null && !loadingSet.has(idx) && !inUrgentSet.has(idx)) {
      requestFrame(idx, true, centerIdx);
      addedAny = true;
    }
  }

  if (addedAny) {
    pumpQueue(targetCanvasW, targetCanvasH, centerIdx, vpW);
  }
}

/**
 * High-Throughput Parallel Background Preloader
 * Caches all 238 compressed blobs rapidly in RAM using parallel workers.
 */
export function runBackgroundPreload(currentFramePos = 0, isUserScrolling = false) {
  // Pause preloading when tab is hidden to eliminate background CPU/network waste
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

  const navConn = typeof navigator !== 'undefined' && (navigator.connection || navigator.mozConnection || navigator.webkitConnection);
  const isSaveData = Boolean(navConn && (navConn.saveData || /2g|3g/.test(navConn.effectiveType || '')));
  if (isSaveData) return;

  if (cachedBlobCount >= FRAME_COUNT) return;

  const cur = Math.round(currentFramePos);
  const batch = [];

  for (let dist = 1; dist < FRAME_COUNT && batch.length < PERF_CONFIG.parallelBlobWorkers; dist++) {
    const fwd = cur + dist;
    if (fwd < FRAME_COUNT && blobCache[fwd] === null && !blobFetchingSet.has(fwd)) {
      batch.push(fwd);
    }
    const bwd = cur - dist;
    if (bwd >= 0 && blobCache[bwd] === null && !blobFetchingSet.has(bwd)) {
      batch.push(bwd);
    }
  }

  if (batch.length > 0) {
    const gen = currentTierGeneration;
    Promise.all(batch.map((idx) => fetchBlob(idx, gen))).then(() => {
      if (cachedBlobCount < FRAME_COUNT) {
        scheduleBackgroundPreload(isUserScrolling ? 100 : 25, currentFramePos, isUserScrolling);
      }
    });
  } else if (cachedBlobCount < FRAME_COUNT) {
    scheduleBackgroundPreload(200, currentFramePos, isUserScrolling);
  }
}

export function scheduleBackgroundPreload(delay = 200, currentFramePos = 0, isUserScrolling = false) {
  if (backgroundPreloadTimer) clearTimeout(backgroundPreloadTimer);
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  backgroundPreloadTimer = setTimeout(() => {
    runBackgroundPreload(currentFramePos, isUserScrolling);
  }, delay);
}

// Automatically resume background preloading when tab becomes visible
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && cachedBlobCount < FRAME_COUNT) {
      scheduleBackgroundPreload(100, 0, false);
    }
  });
}

export function preloadAnchorFrames(targetCanvasW, targetCanvasH, vpW) {
  const initialChunk = Math.min(15, FRAME_COUNT);
  for (let i = 0; i < initialChunk; i++) {
    requestFrame(i, true, 0);
  }
  pumpQueue(targetCanvasW, targetCanvasH, 0, vpW);

  for (let i = ANCHOR_STRIDE; i < FRAME_COUNT; i += ANCHOR_STRIDE) {
    requestFrame(i, true, i);
  }
  requestFrame(FRAME_COUNT - 1, true, FRAME_COUNT - 1);
  pumpQueue(targetCanvasW, targetCanvasH, 0, vpW);

  scheduleBackgroundPreload(300, 0, false);
}

export function findNearestFrame(targetIdx, preferredDirection = 1) {
  if (frames[targetIdx] !== null) return targetIdx;
  const dir = preferredDirection >= 0 ? 1 : -1;

  for (let dist = 1; dist < FRAME_COUNT; dist++) {
    const fwd = targetIdx + dist * dir;
    if (fwd >= 0 && fwd < FRAME_COUNT && frames[fwd] !== null) return fwd;
    const bwd = targetIdx - dist * dir;
    if (bwd >= 0 && bwd < FRAME_COUNT && frames[bwd] !== null) return bwd;
  }
  return -1;
}

export function prefetchDestination(destFrame, targetCanvasW, targetCanvasH, vpW) {
  const target = Math.max(0, Math.min(FRAME_COUNT - 1, Math.round(destFrame)));
  for (let off = -4; off <= 4; off++) {
    const idx = target + off;
    if (idx >= 0 && idx < FRAME_COUNT) {
      requestFrame(idx, true, target);
    }
  }
  pumpQueue(targetCanvasW, targetCanvasH, target, vpW);
}
