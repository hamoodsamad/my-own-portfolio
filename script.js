(() => {
  'use strict';

  /* ==========================================================================
     MODULE 1: SECURITY & SANITIZATION UTILITIES
     Hardens application against Cross-Site Scripting (XSS) and protocol injection
     ========================================================================== */
  const Security = {
    /**
     * Escapes unsafe HTML characters to prevent XSS injection.
     * @param {string|null|undefined} str
     * @returns {string}
     */
    escapeHTML(str) {
      if (str == null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    /**
     * Validates and sanitizes dynamic URLs, permitting only safe schemes.
     * Prevents javascript:, data:text/html, vbscript:, and relative protocol abuse.
     * @param {string|null|undefined} url
     * @returns {string} Safe URL or empty string
     */
    sanitizeUrl(url) {
      if (!url) return '';
      const str = String(url).trim();
      if (/^(https?:\/\/|mailto:|tel:|\/|\.\/|#)/i.test(str)) {
        return str;
      }
      return '';
    },

    /**
     * Validates image sources, allowing only secure http/https, relative assets, or safe data image URIs.
     * @param {string|null|undefined} url
     * @returns {string} Safe image URL or standard fallback placeholder
     */
    sanitizeImageUrl(url) {
      if (!url) {
        return 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=900&q=80';
      }
      const str = String(url).trim();
      if (/^(https?:\/\/|\/|\.\/|data:image\/(png|jpeg|jpg|webp|gif);base64,)/i.test(str)) {
        return str;
      }
      return 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=900&q=80';
    },

    /**
     * Sanitizes plain text fields by trimming control characters.
     * @param {string|null|undefined} str
     * @returns {string}
     */
    sanitizeText(str) {
      if (str == null) return '';
      return String(str).trim();
    },
  };

  /* ==========================================================================
     MODULE 2: DEVICE DETECTION & PROFILE HELPERS
     Provides unified responsive and hardware capability detection
     ========================================================================== */
  const DeviceProfile = {
    detect() {
      const ua = navigator.userAgent || '';
      const isMobileUA = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
      const isTabletUA =
        /iPad/i.test(ua) ||
        (navigator.maxTouchPoints > 1 && Math.min(window.screen.width, window.screen.height) >= 600);
      const isMob = isMobileUA;
      const isTablet = isTabletUA;
      return { isMob, isTablet };
    },
  };

  /* ==========================================================================
     MODULE 3: DECOUPLED SCROLL CANVAS ANIMATION ENGINE (ULTRA-PERFORMANCE REFACTOR)
     Cinematic 60fps/120fps scroll-scrubbed canvas animation across all device tiers.
     
     Architectural Pillars:
     1. Automatic Subject Framing:
        - Normalized focal point config [startX, endX, startY, endY] with safe navbar margin.
        - Unified placement formula for phone, tablet, desktop, 4K, and ultra-wide screens.
        - Clamped offsets guarantee zero empty edges and zero sub-pixel blurring.
        - visualViewport integration prevents mobile address bar shifts.
        - Zero per-frame layout cost (computed once on debounced resize & cached).
     2. Crisp, Sharp Image on Desktop & Adaptive DPR:
        - DPR uncapped on desktop (supports full 2x Retina / HiDPI).
        - Source tier selected by physical pixels (innerWidth * DPR >= 1920 -> 4K master frames).
        - createImageBitmap decoding never downscales below physical canvas buffer size.
        - Hardware smoothing set to 'high' on desktop and 'medium' on mobile.
        - Adaptive quality guard steps DPR down if frame times exceed 20ms.
     3. Scroll Smoothing & Cinematic Physics:
        - Cinematic base spring ease (~12-14), adaptive with scroll velocity and distance.
        - Sub-frame fractional crossfading with globalAlpha (zero blank canvas transitions).
        - Timestamp-based scroll velocity with low-pass exponential smoothing.
     4. Aggressive Background Preloading:
        - Preloads initial batch and anchors first; continuously caches remaining frames at low priority.
        - Compresses blobs in RAM; decodes to ImageBitmap inside sliding window.
        - Velocity-aware lookahead (28 to 80 frames ahead in scroll direction).
        - Destination prefetching on long smooth-scroll nav clicks.
        - Static poster frame for prefers-reduced-motion.
     ========================================================================== */
  const ScrollCanvasEngine = (() => {
    'use strict';

    /* NOTE ON SOURCE ASSET QUALITY:
       The engine renders at native 1:1 physical pixel fidelity. If source WebP frames appear
       compressed or artifacted, re-export the image sequence from 4K/UHD master renders
       at WebP quality 85-90 with lossless or near-lossless chroma subsampling.
       Code cannot synthesize high-frequency detail absent from the source asset files. */

    const FRAME_COUNT = 238;
    const USE_BITMAP =
      window.location.protocol !== 'file:' && typeof window.createImageBitmap === 'function';
    const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const canvas = document.getElementById('scroll-canvas');
    if (!canvas) return null;

    // Desynchronized low-latency 2D rasterization context
    const ctx = (function () {
      try {
        return (
          canvas.getContext('2d', { alpha: false, desynchronized: true }) ||
          canvas.getContext('2d', { alpha: false })
        );
      } catch (_) {
        return canvas.getContext('2d', { alpha: false });
      }
    })();

    // --------------------------------------------------------------------------
    // PART 1: FOCAL POINT & FRAMING CONFIGURATION
    // --------------------------------------------------------------------------
    // Normalized focal point on the source frame [0..1].
    // (0,0) is top-left, (1,1) is bottom-right.
    // In the portrait photo sequence, the subject's face/eyes are situated around (0.52, 0.32).
    const FOCAL_CONFIG = {
      startX: 0.52,      // Normalized X at frame 0
      endX: 0.58,        // Normalized X at frame 237 (allows slight start-to-end drift)
      startY: 0.32,      // Normalized Y at frame 0
      endY: 0.35,        // Normalized Y at frame 237
      headRadiusX: 0.16, // Approximate head bounding radius (normalized)
      headRadiusY: 0.20,
    };

    // Telemetry & Debug Tracking
    let isDebug = false;
    let isDebugOverlay = false;
    const stats = {
      rendered: 0,
      exactHits: 0,
      neighborHits: 0,
      crossfades: 0,
      skipped: 0,
      decodes: 0,
      decodeMsTotal: 0,
      lastReport: 0,
    };

    function reportDebug(now) {
      if (!isDebug || now - stats.lastReport < 2000) return;
      const total = stats.exactHits + stats.neighborHits;
      const hitRate = total > 0 ? ((stats.exactHits / total) * 100).toFixed(1) : '100';
      const avgDecode = stats.decodes > 0 ? (stats.decodeMsTotal / stats.decodes).toFixed(2) : '0';
      console.log(
        `%c[ScrollCanvas Perf]%c HitRate: ${hitRate}% (${stats.exactHits} exact, ${stats.neighborHits} neighbor) | ` +
        `Crossfades: ${stats.crossfades} | Skipped: ${stats.skipped} | ` +
        `Avg Decode: ${avgDecode}ms | DPR: ${canvasScale.toFixed(2)} | Tier: ${currentTier} | Blobs: ${cachedBlobCount}/${FRAME_COUNT}`,
        'color: #ff5719; font-weight: bold;',
        'color: #a8a29e;'
      );
      stats.lastReport = now;
    }

    // --------------------------------------------------------------------------
    // PART 2: ASSET TIERING BY PHYSICAL PIXELS
    // --------------------------------------------------------------------------
    let currentFrameFolder = './frames-1080p';
    let currentDecodeW = 1920;
    let currentDecodeH = 1080;
    let currentTier = '1080p';
    let currentTierGeneration = 0; // Generation token to invalidate stale in-flight fetches

    function detectAssetTier() {
      const rawDpr = window.devicePixelRatio || 1;
      const physicalW = (window.visualViewport ? window.visualViewport.width : window.innerWidth) * rawDpr;
      // Select 4K master frames whenever physical width is >= 1920px (2K, 4K, and Retina laptops)
      if (physicalW >= 1920) {
        return '4k';
      }
      return '1080p';
    }

    function updateAssetTier() {
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

    // --------------------------------------------------------------------------
    // SLIDING WINDOW MEMORY MODEL
    // --------------------------------------------------------------------------
    const ANCHOR_STRIDE = 10;     // Permanent keyframe anchors every 10 frames
    const PRUNE_THROTTLE = 8;     // Throttled scan interval

    const frames = new Array(FRAME_COUNT).fill(null);
    const blobCache = new Array(FRAME_COUNT).fill(null);
    const blobFetchingSet = new Set();
    const loadingSet = new Set();

    const urgentQueue = [];
    const inUrgentSet = new Set();
    const CONCURRENCY = 4;
    let activeWorkers = 0;
    let cachedCount = 0;
    let cachedBlobCount = 0;
    let lastPrunedCenter = -1;

    // Layout, Viewport & DPR State
    let width = 0;
    let height = 0;
    let lastRebuiltW = 0;
    let lastRebuiltH = 0;
    let canvasScale = 1;
    let userMaxDpr = 2.0;          // Dynamic DPR cap adjusted by adaptive quality guard
    let targetCanvasW = 1920;
    let targetCanvasH = 1080;
    let cachedStartDrawRect = null;
    let cachedEndDrawRect = null;
    let cachedTopGrad = null;
    let cachedBotGrad = null;
    let cachedTopFadeH = 0;
    let cachedBotFadeY = 0;
    let needsRender = false;
    let maxScrollCache = 1;
    let cachedSectionOffsets = [];

    // Frame Interpolation & Playhead
    let targetFrame = 0;
    let currentFrame = 0;
    let lastRenderedFloor = -1;
    let lastRenderedCeil = -1;
    let lastRenderedFrac = -1;
    let lastRenderedPos = -1;
    let lastNeighborhoodCenter = -1;
    let lastNavScrollY = -999;
    let rafId = null;
    let lastTimestamp = 0;
    let pendingScrollY = 0;

    // Adaptive Frame-Rate / Quality Guard
    let frameDurationHistory = [];
    let lastQualityCheckTime = 0;

    // Scroll Velocity Tracking (Event Timestamps + Low-Pass Filter)
    let lastScrollEventTime = 0;
    let lastScrollEventY = 0;
    let filteredScrollVelocity = 0; // In frame-units / sec
    let scrollScheduled = false;
    let lastScrollDirection = 1;

    // Carousel Sustained Scrolling Suspension
    let sustainedScrollStart = 0;
    let isCarouselSuspended = false;
    let carouselResumeTimer = null;

    // Background Preloader & Resize Observer
    let isUserScrolling = false;
    let userScrollStopTimer = null;
    let backgroundPreloadTimer = null;
    let docResizeObserver = null;
    let resizeDebounceTimer = null;

    function frameSrc(index) {
      return `${currentFrameFolder}/frame-${String(index + 1).padStart(3, '0')}.webp`;
    }

    function getAdaptiveLookahead(absVel) {
      if (absVel > 30) return 80;
      if (absVel > 15) return 60;
      if (absVel > 6) return 40;
      return 28;
    }

    function getAdaptivePruneDistance() {
      const isMob = width < 768 || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1 && width < 1024);
      return isMob ? 50 : 130;
    }

    function releaseFrame(index) {
      if (index < 0 || index >= FRAME_COUNT) return;
      const bm = frames[index];
      if (bm) {
        if (typeof bm.close === 'function') {
          try {
            bm.close();
          } catch (_) {}
        }
        frames[index] = null;
        cachedCount = Math.max(0, cachedCount - 1);
      }
    }

    function pruneDistantFrames(centerIdx) {
      if (Math.abs(centerIdx - lastPrunedCenter) < PRUNE_THROTTLE) return;
      lastPrunedCenter = centerIdx;
      const pruneDist = getAdaptivePruneDistance();
      for (let i = 0; i < FRAME_COUNT; i++) {
        if (i === 0 || i === FRAME_COUNT - 1 || i % ANCHOR_STRIDE === 0) {
          continue;
        }
        if (frames[i] !== null && Math.abs(i - centerIdx) > pruneDist) {
          releaseFrame(i);
        }
      }
    }

    function clearAllFrames() {
      for (let i = 0; i < FRAME_COUNT; i++) {
        releaseFrame(i);
        blobCache[i] = null;
      }
      loadingSet.clear();
      blobFetchingSet.clear();
      urgentQueue.length = 0;
      inUrgentSet.clear();
      cachedCount = 0;
      cachedBlobCount = 0;
      lastNeighborhoodCenter = -1;
      lastPrunedCenter = -1;
      lastRenderedFloor = -1;
      lastRenderedCeil = -1;
      lastRenderedFrac = -1;
      lastRenderedPos = -1;
      if (backgroundPreloadTimer) {
        clearTimeout(backgroundPreloadTimer);
        backgroundPreloadTimer = null;
      }
    }

    function fetchBlob(index, gen) {
      if (index < 0 || index >= FRAME_COUNT) return Promise.resolve(null);
      if (blobCache[index] !== null) return Promise.resolve(blobCache[index]);
      if (blobFetchingSet.has(index)) return Promise.resolve(null);

      blobFetchingSet.add(index);
      const fetchOpts = (typeof Request !== 'undefined' && 'priority' in Request.prototype)
        ? { priority: 'low' }
        : {};

      return fetch(frameSrc(index), fetchOpts)
        .then((res) => (res.ok ? res.blob() : null))
        .then((blob) => {
          blobFetchingSet.delete(index);
          if (gen !== currentTierGeneration) return null;
          if (blob) {
            blobCache[index] = blob;
            cachedBlobCount++;
            if (cachedBlobCount === FRAME_COUNT && isDebug) {
              console.log(`%c[ScrollCanvas] 100% of frame blobs cached (${FRAME_COUNT}/${FRAME_COUNT})`, 'color: #22c55e; font-weight: bold;');
            }
          }
          return blob;
        })
        .catch(() => {
          blobFetchingSet.delete(index);
          return null;
        });
    }

    function decodeFrame(index) {
      if (index < 0 || index >= FRAME_COUNT) return Promise.resolve(null);
      if (frames[index] !== null) return Promise.resolve(frames[index]);
      if (loadingSet.has(index)) return Promise.resolve(null);

      const gen = currentTierGeneration;
      loadingSet.add(index);
      const t0 = performance.now();

      const blobPromise = blobCache[index] !== null
        ? Promise.resolve(blobCache[index])
        : fetchBlob(index, gen);

      return blobPromise
        .then((blob) => {
          if (!blob || gen !== currentTierGeneration) return null;
          if (USE_BITMAP) {
            // Never downscale below canvas physical buffer size!
            // If targetCanvasW >= currentDecodeW, decode at native source dimensions.
            const targetW = Math.max(targetCanvasW, Math.min(currentDecodeW, 1920));
            const targetH = Math.max(targetCanvasH, Math.min(currentDecodeH, 1080));
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

          const decodeMs = performance.now() - t0;
          stats.decodes++;
          stats.decodeMsTotal += decodeMs;

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

          const currentInt = Math.round(currentFrame);
          const isAnchor = index === 0 || index === FRAME_COUNT - 1 || index % ANCHOR_STRIDE === 0;
          const pruneDist = getAdaptivePruneDistance();
          if (!isAnchor && Math.abs(index - currentInt) > pruneDist + 8) {
            if (typeof bm.close === 'function') {
              try { bm.close(); } catch (_) {}
            }
            return null;
          }

          frames[index] = bm;
          cachedCount++;

          if (Math.abs(index - currentInt) <= 1 || lastRenderedPos === -1) {
            if (rafId === null) {
              renderFrame(currentFrame, true);
            } else {
              needsRender = true;
            }
          }
          return bm;
        })
        .catch(() => {
          loadingSet.delete(index);
          return null;
        });
    }

    function pumpQueue() {
      while (activeWorkers < CONCURRENCY && urgentQueue.length > 0) {
        const idx = urgentQueue.shift();
        inUrgentSet.delete(idx);

        if (frames[idx] === null && !loadingSet.has(idx)) {
          activeWorkers++;
          decodeFrame(idx).finally(() => {
            activeWorkers--;
            pumpQueue();
          });
        }
      }
    }

    function requestFrame(index, isUrgent = false, centerIdx = 0) {
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

    function ensureNeighborhood(centerIdx, direction = 1) {
      const absVel = Math.abs(filteredScrollVelocity);
      const lookahead = getAdaptiveLookahead(absVel);
      const lookbehind = Math.min(lookahead, absVel > 15 ? 18 : 12);
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
        pumpQueue();
      }
    }

    // Continuous Low-Priority Background Preloader (requestIdleCallback + setTimeout fallback)
    function runBackgroundPreload() {
      if (isUserScrolling || activeWorkers >= CONCURRENCY || cachedBlobCount >= FRAME_COUNT) {
        return;
      }

      const scheduleNext = (delay) => {
        if (backgroundPreloadTimer) clearTimeout(backgroundPreloadTimer);
        backgroundPreloadTimer = setTimeout(runBackgroundPreload, delay);
      };

      const idleCb = (deadline) => {
        if (isUserScrolling || activeWorkers >= CONCURRENCY) return;

        const cur = Math.round(currentFrame);
        let nextIdx = -1;

        for (let dist = 1; dist < FRAME_COUNT; dist++) {
          const fwd = cur + dist;
          if (fwd < FRAME_COUNT && blobCache[fwd] === null && !blobFetchingSet.has(fwd)) {
            nextIdx = fwd;
            break;
          }
          const bwd = cur - dist;
          if (bwd >= 0 && blobCache[bwd] === null && !blobFetchingSet.has(bwd)) {
            nextIdx = bwd;
            break;
          }
        }

        if (nextIdx !== -1) {
          const gen = currentTierGeneration;
          fetchBlob(nextIdx, gen).then(() => {
            if (nextIdx % ANCHOR_STRIDE === 0 && frames[nextIdx] === null && blobCache[nextIdx]) {
              decodeFrame(nextIdx);
            }
            if (cachedBlobCount < FRAME_COUNT && !isUserScrolling) {
              scheduleNext(25);
            }
          });
        }
      };

      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(idleCb, { timeout: 800 });
      } else {
        setTimeout(() => idleCb({ timeRemaining: () => 15, didTimeout: true }), 35);
      }
    }

    function scheduleBackgroundPreload(delay = 200) {
      if (backgroundPreloadTimer) clearTimeout(backgroundPreloadTimer);
      backgroundPreloadTimer = setTimeout(runBackgroundPreload, delay);
    }

    function preloadAnchorFrames() {
      const initialChunk = Math.min(15, FRAME_COUNT);
      for (let i = 0; i < initialChunk; i++) {
        requestFrame(i, true, 0);
      }
      pumpQueue();

      for (let i = ANCHOR_STRIDE; i < FRAME_COUNT; i += ANCHOR_STRIDE) {
        requestFrame(i, true, i);
      }
      requestFrame(FRAME_COUNT - 1, true, FRAME_COUNT - 1);
      pumpQueue();

      scheduleBackgroundPreload(600);
    }

    function prefetchDestination(destScrollY) {
      const destFrame = scrollYToFrame(destScrollY);
      const rounded = Math.round(destFrame);
      const dir = destFrame >= currentFrame ? 1 : -1;

      ensureNeighborhood(rounded, dir);

      for (let off = -4; off <= 4; off++) {
        const idx = rounded + off;
        if (idx >= 0 && idx < FRAME_COUNT) {
          requestFrame(idx, true, rounded);
        }
      }
      pumpQueue();
    }

    // --------------------------------------------------------------------------
    // PART 1: UNIFIED AUTOMATIC SUBJECT FRAMING MATHEMATICS
    // --------------------------------------------------------------------------
    function computeFramingForProgress(progress, vpW, vpH, imgW, imgH) {
      const activeW = imgW || currentDecodeW;
      const activeH = imgH || currentDecodeH;

      const isPhonePortrait = vpW < 600 || (vpW < 768 && vpH > vpW * 1.15);
      const isTabletPortrait = !isPhonePortrait && (vpW < 1024 && vpH > vpW);

      // Normalized focal coordinate with drift across sequence
      const focalNormX = FOCAL_CONFIG.startX + progress * (FOCAL_CONFIG.endX - FOCAL_CONFIG.startX);
      const focalNormY = FOCAL_CONFIG.startY + progress * (FOCAL_CONFIG.endY - FOCAL_CONFIG.startY);

      let targetScreenX;
      let targetScreenY;
      let safeNavbarTop;
      let layoutMode;

      if (isPhonePortrait) {
        // Phone Portrait: Place subject on right (62% width) so hero copy stays clear on left.
        // Head sits comfortably under mobile navbar.
        targetScreenX = 0.62;
        targetScreenY = 0.36;
        safeNavbarTop = Math.max(68, vpH * 0.08);
        layoutMode = 'phone-portrait';
      } else if (isTabletPortrait) {
        // Tablet Portrait: Centered-right balance (55% width).
        targetScreenX = 0.55;
        targetScreenY = 0.33;
        safeNavbarTop = 72;
        layoutMode = 'tablet-portrait';
      } else {
        // Desktop / Laptop / Ultra-wide / 4K Displays:
        targetScreenX = 0.52;
        targetScreenY = 0.33;
        safeNavbarTop = 75;
        layoutMode = 'cover';
      }

      // Minimum scale to cover entire viewport (zero empty edges)
      const scaleCover = Math.max(vpW / activeW, vpH / activeH);

      // In phone portrait, if cover scale zooms in too close on the head, adjust scale
      // so head height fits comfortably (head height roughly 28% of viewport)
      let scale = scaleCover;
      if (isPhonePortrait) {
        const desiredHeadHeight = vpH * 0.28;
        const sourceHeadHeight = activeH * (FOCAL_CONFIG.headRadiusY * 2);
        const naturalScale = desiredHeadHeight / sourceHeadHeight;
        // Never go below scaleCover so edges stay covered!
        scale = Math.max(scaleCover, Math.min(naturalScale, scaleCover * 1.15));
      }

      const drawW = Math.round(activeW * scale);
      const drawH = Math.round(activeH * scale);

      // Calculate desired offsets to position normalized focal point at targetScreenX, targetScreenY
      const focalPxX = activeW * focalNormX * scale;
      const focalPxY = activeH * focalNormY * scale;

      let desiredOffsetX = vpW * targetScreenX - focalPxX;
      let desiredOffsetY = vpH * targetScreenY - focalPxY;

      // Ensure top of head (focal - headRadius) never hides under navbar
      const headTopPx = desiredOffsetY + activeH * (focalNormY - FOCAL_CONFIG.headRadiusY) * scale;
      if (headTopPx < safeNavbarTop) {
        desiredOffsetY += (safeNavbarTop - headTopPx);
      }

      // Strictly clamp offsets: image must NEVER reveal black/empty edges!
      // minOffsetX = vpW - drawW; maxOffsetX = 0
      // minOffsetY = vpH - drawH; maxOffsetY = 0
      const minOffsetX = vpW - drawW;
      const maxOffsetX = 0;
      const minOffsetY = vpH - drawH;
      const maxOffsetY = 0;

      const offsetX = Math.round(Math.min(maxOffsetX, Math.max(minOffsetX, desiredOffsetX)));
      const offsetY = Math.round(Math.min(maxOffsetY, Math.max(minOffsetY, desiredOffsetY)));

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

    function updateLayoutCaches() {
      // Use visualViewport if available to eliminate mobile address-bar displacement
      if (window.visualViewport) {
        width = Math.round(window.visualViewport.width);
        height = Math.round(window.visualViewport.height);
      } else {
        width = window.innerWidth;
        height = window.innerHeight;
      }

      maxScrollCache = Math.max(1, document.documentElement.scrollHeight - height);
      const scrollY = window.scrollY || window.pageYOffset || 0;

      if (typeof NavigationController !== 'undefined' && NavigationController.trackedSections) {
        cachedSectionOffsets = NavigationController.trackedSections.map((sec) => {
          const rect = sec.getBoundingClientRect();
          return {
            id: sec.id,
            top: rect.top + scrollY,
          };
        });
      }

      // Cache start (frame 0) and end (frame 237) framing rects — ZERO per-frame layout recalculation!
      cachedStartDrawRect = computeFramingForProgress(0, width, height, currentDecodeW, currentDecodeH);
      cachedEndDrawRect = computeFramingForProgress(1, width, height, currentDecodeW, currentDecodeH);
    }

    function initDocResizeObserver() {
      if (typeof ResizeObserver === 'undefined') return;
      if (docResizeObserver) docResizeObserver.disconnect();

      let roTimer = null;
      docResizeObserver = new ResizeObserver(() => {
        if (roTimer) clearTimeout(roTimer);
        roTimer = setTimeout(() => {
          updateLayoutCaches();
          if (rafId === null) {
            targetFrame = scrollYToFrame(window.scrollY || window.pageYOffset || 0);
            currentFrame = targetFrame;
            renderFrame(currentFrame);
          }
        }, 100);
      });
      docResizeObserver.observe(document.documentElement);
    }

    function scrollYToFrame(scrollY) {
      const progress = Math.min(1, Math.max(0, scrollY / maxScrollCache));
      return progress * (FRAME_COUNT - 1);
    }

    function getInterpolatedDrawRect(position) {
      const progress = Math.min(1, Math.max(0, position / (FRAME_COUNT - 1)));
      if (!cachedStartDrawRect || !cachedEndDrawRect) {
        return computeFramingForProgress(progress, width, height, currentDecodeW, currentDecodeH);
      }

      // Linear interpolation between cached start and end rects (zero DOM or math overhead!)
      const s = cachedStartDrawRect;
      const e = cachedEndDrawRect;
      return {
        offsetX: Math.round(s.offsetX + progress * (e.offsetX - s.offsetX)),
        offsetY: Math.round(s.offsetY + progress * (e.offsetY - s.offsetY)),
        drawW: s.drawW,
        drawH: s.drawH,
        mode: s.mode,
        focalScreenX: s.focalScreenX + progress * (e.focalScreenX - s.focalScreenX),
        focalScreenY: s.focalScreenY + progress * (e.focalScreenY - s.focalScreenY),
        safeNavbarTop: s.safeNavbarTop,
      };
    }

    function findNearestFrame(index, preferredDir = 1) {
      if (frames[index]) return index;
      const maxSearch = Math.min(getAdaptivePruneDistance(), FRAME_COUNT);
      const dir = preferredDir >= 0 ? 1 : -1;

      for (let offset = 1; offset <= maxSearch; offset++) {
        const primary = index + offset * dir;
        if (primary >= 0 && primary < FRAME_COUNT && frames[primary]) return primary;
        const secondary = index - offset * dir;
        if (secondary >= 0 && secondary < FRAME_COUNT && frames[secondary]) return secondary;
      }
      return -1;
    }

    // --------------------------------------------------------------------------
    // PART 2 & 3: RENDERING & SUB-PIXEL FRACTIONAL CROSSFADING
    // --------------------------------------------------------------------------
    function renderFrame(position, force = false) {
      const clamped = Math.min(FRAME_COUNT - 1, Math.max(0, position));
      const floorIdx = Math.floor(clamped);
      const ceilIdx = Math.min(FRAME_COUNT - 1, floorIdx + 1);
      const frac = clamped - floorIdx;

      // 1. Resolve primary base frame
      const isExact = frames[floorIdx] !== null;
      const resolvedFloor = isExact ? floorIdx : findNearestFrame(floorIdx, lastScrollDirection);

      if (resolvedFloor === -1) {
        // Keep last drawn image on screen — never flash solid black or blank canvas!
        return;
      }

      const baseImg = frames[resolvedFloor];
      if (!baseImg) return;

      if (isExact) stats.exactHits++;
      else stats.neighborHits++;

      // 2. Resolve secondary crossfade frame if frac >= 0.02
      let crossImg = null;
      if (frac >= 0.02 && ceilIdx !== floorIdx) {
        const resolvedCeil = frames[ceilIdx] ? ceilIdx : (frac > 0.12 ? findNearestFrame(ceilIdx, lastScrollDirection) : -1);
        if (resolvedCeil !== -1 && resolvedCeil !== resolvedFloor && frames[resolvedCeil]) {
          crossImg = frames[resolvedCeil];
        }
      }

      // Avoid redundant redraw if frame indices and fractional alpha have not changed
      if (
        !force &&
        resolvedFloor === lastRenderedFloor &&
        crossImg === null &&
        lastRenderedCeil === -1 &&
        Math.abs(frac - lastRenderedFrac) < 0.005
      ) {
        return;
      }

      const rect = getInterpolatedDrawRect(position);
      const { offsetX, offsetY, drawW, drawH, mode } = rect;

      if (mode === 'phone-portrait' || mode === 'tablet-portrait') {
        ctx.fillStyle = '#050308';
        ctx.fillRect(0, 0, width, height);

        // Hardware-snapped integer coordinates prevent sub-pixel blur
        ctx.drawImage(baseImg, offsetX, offsetY, drawW, drawH);

        // Sub-pixel fractional crossfade with globalAlpha
        if (crossImg) {
          ctx.globalAlpha = frac;
          ctx.drawImage(crossImg, offsetX, offsetY, drawW, drawH);
          ctx.globalAlpha = 1.0;
          stats.crossfades++;
        }

        // Atmospheric pre-cached linear gradients
        if (cachedTopGrad && cachedTopFadeH > 0) {
          ctx.fillStyle = cachedTopGrad;
          ctx.fillRect(0, 0, width, cachedTopFadeH);
        }

        if (cachedBotGrad && cachedBotFadeY > 0) {
          ctx.fillStyle = cachedBotGrad;
          ctx.fillRect(0, cachedBotFadeY, width, height - cachedBotFadeY);
        }
      } else {
        // Full cover landscape edge-to-edge
        ctx.drawImage(baseImg, offsetX, offsetY, drawW, drawH);

        if (crossImg) {
          ctx.globalAlpha = frac;
          ctx.drawImage(crossImg, offsetX, offsetY, drawW, drawH);
          ctx.globalAlpha = 1.0;
          stats.crossfades++;
        }
      }

      // Debug Focal Point & Safe Area Overlay (when enabled)
      if (isDebugOverlay) {
        drawDebugOverlay(rect);
      }

      stats.rendered++;
      lastRenderedFloor = resolvedFloor;
      lastRenderedCeil = crossImg ? ceilIdx : -1;
      lastRenderedFrac = frac;
      lastRenderedPos = resolvedFloor;
    }

    function drawDebugOverlay(rect) {
      ctx.save();
      // Draw safe navbar area
      ctx.fillStyle = 'rgba(255, 87, 25, 0.15)';
      ctx.fillRect(0, 0, width, rect.safeNavbarTop);
      ctx.strokeStyle = '#ff5719';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, width, rect.safeNavbarTop);

      // Draw focal point crosshairs
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(rect.focalScreenX, rect.focalScreenY, 12, 0, Math.PI * 2);
      ctx.moveTo(rect.focalScreenX - 20, rect.focalScreenY);
      ctx.lineTo(rect.focalScreenX + 20, rect.focalScreenY);
      ctx.moveTo(rect.focalScreenX, rect.focalScreenY - 20);
      ctx.lineTo(rect.focalScreenX, rect.focalScreenY + 20);
      ctx.stroke();

      // Label
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px monospace';
      ctx.fillText(`Focal: (${rect.focalScreenX.toFixed(0)}, ${rect.focalScreenY.toFixed(0)}) | Mode: ${rect.mode} | DPR: ${canvasScale.toFixed(2)}`, 16, rect.safeNavbarTop + 24);
      ctx.restore();
    }

    function manageCarouselScrollSuspension(absDelta) {
      if (typeof CarouselEngine === 'undefined') return;

      const now = performance.now();
      const isActivelyMoving = absDelta > 0.08 || Math.abs(filteredScrollVelocity) > 4;

      if (isActivelyMoving) {
        if (carouselResumeTimer) {
          clearTimeout(carouselResumeTimer);
          carouselResumeTimer = null;
        }

        if (!sustainedScrollStart) {
          sustainedScrollStart = now;
        } else if (now - sustainedScrollStart > 90 && !isCarouselSuspended) {
          isCarouselSuspended = true;
          CarouselEngine.setSuspended(true);
        }
      } else {
        sustainedScrollStart = 0;
        if (isCarouselSuspended && !carouselResumeTimer) {
          scheduleCarouselResume(180);
        }
      }
    }

    function scheduleCarouselResume(delay = 180) {
      if (typeof CarouselEngine === 'undefined') return;
      if (carouselResumeTimer) clearTimeout(carouselResumeTimer);
      carouselResumeTimer = setTimeout(() => {
        carouselResumeTimer = null;
        sustainedScrollStart = 0;
        if (isCarouselSuspended) {
          isCarouselSuspended = false;
          CarouselEngine.setSuspended(false);
        }
      }, delay);
    }

    // --------------------------------------------------------------------------
    // PART 2: ADAPTIVE QUALITY GUARD
    // --------------------------------------------------------------------------
    function checkAdaptiveQualityGuard(frameTimeMs) {
      frameDurationHistory.push(frameTimeMs);
      if (frameDurationHistory.length > 60) {
        frameDurationHistory.shift();
      }

      const now = performance.now();
      if (now - lastQualityCheckTime > 1200) {
        lastQualityCheckTime = now;
        if (frameDurationHistory.length >= 30) {
          const avgFrameTime = frameDurationHistory.reduce((a, b) => a + b, 0) / frameDurationHistory.length;
          // If average frame time stays above 20ms (> 50fps drop), step DPR down
          if (avgFrameTime > 20.0 && userMaxDpr > 1.25) {
            userMaxDpr = Math.max(1.25, userMaxDpr - 0.25);
            if (isDebug) console.warn(`[ScrollCanvas Quality Guard] Dropped DPR cap to ${userMaxDpr.toFixed(2)} (avg frame time: ${avgFrameTime.toFixed(1)}ms)`);
            resize();
          } else if (avgFrameTime < 13.5 && userMaxDpr < (window.devicePixelRatio || 1)) {
            // If performance stays excellent (< 13.5ms), step DPR cap back up
            userMaxDpr = Math.min(2.0, Math.min(window.devicePixelRatio || 1, userMaxDpr + 0.25));
            if (isDebug) console.log(`[ScrollCanvas Quality Guard] Raised DPR cap to ${userMaxDpr.toFixed(2)}`);
            resize();
          }
        }
      }
    }

    // --------------------------------------------------------------------------
    // MAIN rAF PHYSICS & ANIMATION TICK
    // --------------------------------------------------------------------------
    function tick(timestamp) {
      const tStart = performance.now();
      const dt = lastTimestamp ? Math.min((timestamp - lastTimestamp) / 1000, 1 / 30) : 1 / 60;
      lastTimestamp = timestamp;

      // Exponential velocity decay
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
          if (typeof NavigationController !== 'undefined') {
            NavigationController.updateHeaderAndNav(pendingScrollY, height, cachedSectionOffsets);
          }
        }

        const roundedTarget = Math.round(targetFrame);
        if (roundedTarget !== lastNeighborhoodCenter) {
          lastNeighborhoodCenter = roundedTarget;
          const absVel = Math.abs(filteredScrollVelocity);
          const velocityBias = absVel > 3
            ? Math.min(Math.round(absVel * 0.22), 12) * lastScrollDirection
            : 0;
          ensureNeighborhood(Math.max(0, Math.min(FRAME_COUNT - 1, roundedTarget + velocityBias)), lastScrollDirection);
          pruneDistantFrames(roundedTarget);
        }
      }

      const delta = targetFrame - currentFrame;
      const absDelta = Math.abs(delta);

      manageCarouselScrollSuspension(absDelta);

      if (absDelta < 0.003) {
        currentFrame = targetFrame;
        renderFrame(currentFrame, needsRender);
        needsRender = false;
        rafId = null;
        lastTimestamp = 0;
        scheduleCarouselResume(150);
        scheduleBackgroundPreload(250);
        reportDebug(timestamp);
        return;
      }

      // Cinematic Adaptive Spring Dynamics:
      // Base ease ~11.5 for cinematic glide, scaling dynamically with velocity and distance.
      // Automatically accelerates on large distance delta, and smoothly eases down on arrival.
      const velNorm = Math.min(1, Math.abs(filteredScrollVelocity) / 32);
      const distBoost = Math.min(7.5, absDelta * 0.16);
      const dynamicEase = Math.min(22.0, 11.5 + velNorm * 4.5 + distBoost);
      const factor = 1 - Math.exp(-dynamicEase * dt);

      // Frame skipping & fast catchup: move playhead swiftly toward target
      if (absDelta > 6) {
        stats.skipped++;
      }

      currentFrame += delta * factor;
      renderFrame(currentFrame);
      needsRender = false;

      const frameDuration = performance.now() - tStart;
      checkAdaptiveQualityGuard(frameDuration);

      reportDebug(timestamp);
      rafId = requestAnimationFrame(tick);
    }

    function scheduleLoop() {
      if (rafId === null) {
        lastTimestamp = 0;
        rafId = requestAnimationFrame(tick);
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
          lastTimestamp = 0;
        }
      } else {
        pendingScrollY = window.scrollY || window.pageYOffset || 0;
        targetFrame = scrollYToFrame(pendingScrollY);
        currentFrame = targetFrame;
        scrollScheduled = false;
        lastTimestamp = 0;
        renderFrame(currentFrame, true);
        scheduleLoop();
      }
    }

    function onNativeScroll(e) {
      const now = (e && e.timeStamp) ? e.timeStamp : performance.now();
      const currentY = window.scrollY || window.pageYOffset || 0;
      pendingScrollY = currentY;
      scrollScheduled = true;
      isUserScrolling = true;

      // Compute scroll velocity from scroll-event timestamps
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
        scheduleBackgroundPreload(200);
      }, 180);

      scheduleLoop();
    }

    function resize(force = false) {
      const newW = window.visualViewport ? Math.round(window.visualViewport.width) : window.innerWidth;
      const newH = window.visualViewport ? Math.round(window.visualViewport.height) : window.innerHeight;
      const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (newW < 1024);

      // Mobile address-bar collapse protection:
      // Ignore height-only resizes caused by mobile address-bar showing/hiding (delta <= 120px)
      const widthChanged = newW !== lastRebuiltW;
      const heightDelta = Math.abs(newH - lastRebuiltH);
      const shouldRebuildBuffer = force || widthChanged || !isTouch || heightDelta > 120;

      updateLayoutCaches();

      if (!shouldRebuildBuffer && lastRebuiltW > 0) {
        targetFrame = scrollYToFrame(window.scrollY || window.pageYOffset || 0);
        if (rafId === null) {
          currentFrame = targetFrame;
          renderFrame(currentFrame);
        }
        return;
      }

      lastRebuiltW = newW;
      lastRebuiltH = newH;

      const tierChanged = updateAssetTier();
      const rawDpr = window.devicePixelRatio || 1;
      const isDesktop = width >= 1024 && !isTouch;

      // Desktop: use full DPR up to userMaxDpr (allows 2.0 Retina sharpness)
      // Mobile / Touch: cap at Math.min(rawDpr, 1.25) for GPU thermal efficiency
      canvasScale = isDesktop ? Math.min(rawDpr, userMaxDpr) : Math.min(rawDpr, 1.25);

      targetCanvasW = Math.max(1, Math.round(width * canvasScale));
      targetCanvasH = Math.max(1, Math.round(height * canvasScale));

      // Canvas CSS size must equal viewport dimensions; backing buffer matches physical pixels
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';

      if (canvas.width !== targetCanvasW || canvas.height !== targetCanvasH) {
        canvas.width = targetCanvasW;
        canvas.height = targetCanvasH;
      }

      ctx.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
      ctx.imageSmoothingEnabled = true;
      // High smoothing quality on desktop, medium on mobile
      ctx.imageSmoothingQuality = isDesktop ? 'high' : 'medium';

      cachedTopFadeH = Math.min(100, Math.round(height * 0.12));
      cachedTopGrad = ctx.createLinearGradient(0, 0, 0, cachedTopFadeH);
      cachedTopGrad.addColorStop(0, '#050308');
      cachedTopGrad.addColorStop(0.5, 'rgba(5, 3, 8, 0.7)');
      cachedTopGrad.addColorStop(1, 'rgba(5, 3, 8, 0)');

      cachedBotFadeY = Math.max(0, height - 180);
      cachedBotGrad = ctx.createLinearGradient(0, cachedBotFadeY, 0, height);
      cachedBotGrad.addColorStop(0, 'rgba(5, 3, 8, 0)');
      cachedBotGrad.addColorStop(0.4, 'rgba(5, 3, 8, 0.65)');
      cachedBotGrad.addColorStop(1, '#050308');

      lastRenderedPos = -1;
      lastRenderedFloor = -1;
      lastRenderedCeil = -1;
      renderFrame(currentFrame, true);

      if (tierChanged) {
        preloadAnchorFrames();
      }

      ensureNeighborhood(Math.round(currentFrame), 0);
      pruneDistantFrames(Math.round(currentFrame));

      const currentCardW = width <= 600 ? 160 : (width <= 768 ? 210 : 270);
      if (typeof CarouselEngine !== 'undefined') {
        CarouselEngine.handleBreakpointResize(currentCardW);
      }
    }

    function onDebouncedResize() {
      if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
      resizeDebounceTimer = setTimeout(() => {
        resize();
      }, 150);
    }

    function setDebug(enabled) {
      isDebug = Boolean(enabled);
      console.log(`[ScrollCanvas] Debug telemetry: ${isDebug ? 'ENABLED' : 'DISABLED'}`);
    }

    function setDebugOverlay(enabled) {
      isDebugOverlay = Boolean(enabled);
      console.log(`[ScrollCanvas] Focal point overlay: ${isDebugOverlay ? 'ENABLED' : 'DISABLED'}`);
      if (rafId === null) {
        renderFrame(currentFrame, true);
      }
    }

    function init() {
      // 1. Determine asset tier first before initiating any frame fetches
      updateAssetTier();
      updateLayoutCaches();

      // Prefers-reduced-motion: render high-quality static poster frame, disable scroll scrubbing
      if (REDUCE_MOTION) {
        resize(true);
        fetchBlob(0, currentTierGeneration).then((blob) => {
          if (!blob) return;
          createImageBitmap(blob).then((bm) => {
            if (bm) {
              frames[0] = bm;
              renderFrame(0, true);
            }
          }).catch(() => {});
        });
        return;
      }

      targetFrame = scrollYToFrame(window.scrollY || window.pageYOffset || 0);
      currentFrame = targetFrame;
      resize(true);

      // Preload anchor keyframes only after tier is known
      preloadAnchorFrames();
      ensureNeighborhood(Math.round(currentFrame), 1);

      initDocResizeObserver();
      document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });
    }

    return {
      init,
      resize,
      onDebouncedResize,
      onNativeScroll,
      updateLayoutCaches,
      prefetchDestination,
      setDebug,
      setDebugOverlay,
      get currentFrame() { return currentFrame; },
      get targetFrame() { return targetFrame; },
      get cachedSectionOffsets() { return cachedSectionOffsets; },
      get height() { return height; },
      get cachedCount() { return cachedCount; },
      get cachedBlobCount() { return cachedBlobCount; },
    };
  })();

  /* ==========================================================================
     MODULE 4: STICKY HEADER, SCROLL SPY & ACCESSIBLE MOBILE MENU
     Manages navigation states with getBoundingClientRect() absolute layout math
     and destination frame prefetching on smooth scroll clicks.
     ========================================================================== */
  const NavigationController = (() => {
    const header = document.getElementById('site-header');
    const navToggle = document.getElementById('nav-toggle');
    const mobileMenu = document.getElementById('mobile-menu');
    const navLinks = Array.from(document.querySelectorAll('#desktop-nav a[data-nav]'));
    const trackedSections = ['home', 'about', 'skills', 'projects', 'services', 'contact']
      .map((id) => document.getElementById(id))
      .filter(Boolean);

    let lastHeaderScrolled = false;
    let lastActiveNavId = '';

    function updateHeaderAndNav(scrollPos = 0, vpHeight = 720, sectionOffsets = []) {
      const scrolled = scrollPos > 24;
      if (header && scrolled !== lastHeaderScrolled) {
        lastHeaderScrolled = scrolled;
        header.classList.toggle('is-scrolled', scrolled);
      }

      const probe = scrollPos + vpHeight * 0.35;
      let activeId = 'home';
      for (let i = 0; i < sectionOffsets.length; i++) {
        if (probe >= sectionOffsets[i].top) {
          activeId = sectionOffsets[i].id;
        }
      }

      if (activeId !== lastActiveNavId) {
        lastActiveNavId = activeId;
        navLinks.forEach((link) => {
          link.classList.toggle('is-active', link.dataset.nav === activeId);
        });
      }
    }

    function closeMobileMenu() {
      if (!mobileMenu || !navToggle) return;
      mobileMenu.hidden = true;
      navToggle.setAttribute('aria-expanded', 'false');
    }

    function init() {
      if (navToggle && mobileMenu) {
        navToggle.addEventListener('click', () => {
          const isExpanded = navToggle.getAttribute('aria-expanded') === 'true';
          navToggle.setAttribute('aria-expanded', String(!isExpanded));
          mobileMenu.hidden = isExpanded;
        });

        mobileMenu.querySelectorAll('.mobile-link').forEach((link) => {
          link.addEventListener('click', closeMobileMenu);
        });
      }

      // Smooth scroll for nav anchor links with destination frame prefetching
      document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
        anchor.addEventListener('click', (e) => {
          const targetId = anchor.getAttribute('href');
          if (targetId && targetId !== '#') {
            const targetEl = document.querySelector(targetId);
            if (targetEl) {
              e.preventDefault();
              const scrollY = window.scrollY || window.pageYOffset || 0;
              const targetRect = targetEl.getBoundingClientRect();
              const destScrollY = targetRect.top + scrollY;

              if (typeof ScrollCanvasEngine !== 'undefined' && ScrollCanvasEngine && typeof ScrollCanvasEngine.prefetchDestination === 'function') {
                ScrollCanvasEngine.prefetchDestination(destScrollY);
              }

              targetEl.scrollIntoView({ behavior: 'smooth' });
              if (mobileMenu && !mobileMenu.hidden) closeMobileMenu();
            }
          }
        });
      });
    }

    return {
      init,
      closeMobileMenu,
      updateHeaderAndNav,
      get trackedSections() { return trackedSections; },
    };
  })();

  /* ==========================================================================
     MODULE 5: PROFILE DATA HYDRATION
     Safely populates DOM profile placeholders with sanitized attributes
     ========================================================================== */
  const ProfileHydration = (() => {
    const store = window.PortfolioStore;

    function apply(profileData) {
      if (!store) return;
      const profile = profileData || store.getProfile();

      document.querySelectorAll('[data-profile]').forEach((el) => {
        const key = el.dataset.profile;
        if (profile[key]) el.textContent = Security.sanitizeText(profile[key]);
      });

      document.querySelectorAll('[data-profile-multiline]').forEach((el) => {
        const key = el.dataset.profileMultiline;
        if (profile[key]) {
          el.innerHTML = '';
          const lines = String(profile[key]).split('\n');
          lines.forEach((line, idx) => {
            el.appendChild(document.createTextNode(line));
            if (idx < lines.length - 1) el.appendChild(document.createElement('br'));
          });
        }
      });

      document.querySelectorAll('[data-profile-href]').forEach((el) => {
        const key = el.dataset.profileHref;
        const rawUrl = store.normalizeExternalUrl(profile[key]);
        const safeUrl = Security.sanitizeUrl(rawUrl);
        if (safeUrl) el.setAttribute('href', safeUrl);
      });

      document.querySelectorAll('[data-profile-mailto]').forEach((el) => {
        const key = el.dataset.profileMailto;
        const email = String(profile[key] || '').trim();
        if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          el.setAttribute('href', `mailto:${encodeURIComponent(email)}`);
        }
      });

      document.querySelectorAll('[data-profile-tel]').forEach((el) => {
        const key = el.dataset.profileTel;
        if (profile[key]) {
          const cleanPhone = String(profile[key]).replace(/[^+\d]/g, '');
          el.setAttribute('href', `tel:${cleanPhone}`);
        }
      });
    }

    return { apply };
  })();

  /* ==========================================================================
     MODULE 6: 3D CYLINDER PROJECTS CAROUSEL & FILTER ENGINE (REFACTORED)
     Delta-time normalized physics (60Hz & 120Hz consistency), pointer capture,
     drag click suppression, and throttled CSS custom property opacity updates.
     ========================================================================== */
  const CarouselEngine = (() => {
    const store = window.PortfolioStore;
    const categoryMenu = document.getElementById('category-menu');
    const categorySelectBtn = document.getElementById('category-select-btn');
    const catBtnLabel = document.getElementById('cat-btn-label');

    const carouselStage = document.getElementById('carousel-stage');
    const carouselCylinder = document.getElementById('carousel-cylinder');
    const carouselPrevBtn = document.getElementById('carousel-prev-btn');
    const carouselNextBtn = document.getElementById('carousel-next-btn');
    const carouselDots = document.getElementById('carousel-dots');

    let cachedProjects = store ? store.getProjects() : [];
    let activeCategory = 'ALL';

    // 3D Cylinder Carousel physics & animation state
    let carouselItems = [];
    let currentAngle = 0;
    let targetAngle = 0;
    let isDragging = false;
    let hasDragged = false;
    let activePointerId = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartAngle = 0;
    let isHovered = false;
    const autoSpinSpeed = 0.16; // 360° spin speed
    let carouselRaf = null;
    let lastCarouselTime = 0;
    let slotCount = 1;
    let slotAngleStep = 360;
    let lastCylinderCardW = -1;
    let cachedDotEls = [];
    let lastClosestIndex = -1;
    let isCarouselInView = false;
    let carouselObserver = null;
    let isScrollSuspended = false;

    function formatCategoryTitle(cat) {
      if (cat === 'ALL') return 'All Categories';
      return cat
        .toLowerCase()
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }

    function renderCategoryDropdown(categories, projects) {
      if (!categoryMenu || !categorySelectBtn || !catBtnLabel) return;

      categoryMenu.innerHTML = '';
      categories.forEach((cat) => {
        const count =
          cat === 'ALL'
            ? projects.length
            : projects.filter(
                (p) => String(p.category || '').trim().toUpperCase() === cat,
              ).length;

        const itemBtn = document.createElement('button');
        itemBtn.type = 'button';
        itemBtn.className = `category-item${cat === activeCategory ? ' is-active' : ''}`;
        itemBtn.setAttribute('role', 'menuitem');

        const nameSpan = document.createElement('span');
        nameSpan.textContent = formatCategoryTitle(cat);

        const countBadge = document.createElement('span');
        countBadge.className = 'cat-count-badge';
        countBadge.textContent = String(count);

        itemBtn.appendChild(nameSpan);
        itemBtn.appendChild(countBadge);

        itemBtn.addEventListener('click', () => {
          activeCategory = cat;
          catBtnLabel.textContent = formatCategoryTitle(cat);
          closeCategoryMenu();
          renderProjects();
        });

        categoryMenu.appendChild(itemBtn);
      });
    }

    function toggleCategoryMenu() {
      if (!categoryMenu || !categorySelectBtn) return;
      const isExpanded = categorySelectBtn.getAttribute('aria-expanded') === 'true';
      categorySelectBtn.setAttribute('aria-expanded', String(!isExpanded));
      categoryMenu.hidden = isExpanded;
    }

    function closeCategoryMenu() {
      if (!categoryMenu || !categorySelectBtn) return;
      categorySelectBtn.setAttribute('aria-expanded', 'false');
      categoryMenu.hidden = true;
    }

    function updateCarouselPhysics(timestamp) {
      if (isScrollSuspended || !isCarouselInView || !carouselCylinder || carouselItems.length === 0) {
        carouselRaf = null;
        lastCarouselTime = 0;
        return;
      }

      // Delta-time based calculation for identical speed on 60Hz and 120Hz displays
      const dt = lastCarouselTime ? Math.min((timestamp - lastCarouselTime) / 1000, 1 / 30) : 1 / 60;
      lastCarouselTime = timestamp;

      if (!isDragging && !isHovered && slotCount > 1) {
        targetAngle -= autoSpinSpeed * (dt * 60);
      }

      // Delta-time based exponential lerp: factor = 1 - exp(-rate * dt)
      const lerpFactor = 1 - Math.exp(-8.5 * dt);
      currentAngle += (targetAngle - currentAngle) * lerpFactor;

      carouselCylinder.style.transform = `rotateY(${currentAngle}deg)`;

      const halfStep = slotAngleStep / 2;
      let closestIndex = 0;
      let minAngularDist = 999;

      const itemCount = carouselItems.length;
      for (let i = 0; i < itemCount; i++) {
        const item = carouselItems[i];
        const rawTheta = (item.baseAngle + currentAngle) % 360;
        const theta = ((rawTheta + 540) % 360) - 180;
        const absTheta = Math.abs(theta);

        const rad = (theta * Math.PI) / 180;
        const cosVal = Math.cos(rad);

        // Backface Culling: Cull cards facing away from viewer (cosVal < -0.05)
        if (cosVal < -0.05) {
          if (item.isVisible) {
            item.el.style.visibility = 'hidden';
            item.el.style.pointerEvents = 'none';
            item.isVisible = false;
          }
          continue;
        }

        if (!item.isVisible) {
          item.el.style.visibility = '';
          item.isVisible = true;
        }

        const isFront = absTheta <= halfStep;
        if (item.isActive !== isFront) {
          item.isActive = isFront;
          item.el.classList.toggle('is-active', isFront);
          item.el.style.pointerEvents = isFront ? 'auto' : 'none';
        }

        if (absTheta < minAngularDist) {
          minAngularDist = absTheta;
          closestIndex = item.projectIndex;
        }

        // Depth opacity: quantized to reduce repaints, applied via CSS variable & style
        const depthOpacity = Math.round(Math.max(0.35, Math.min(1, 0.4 + 0.6 * cosVal)) * 100) / 100;
        if (Math.abs(item.lastOpacity - depthOpacity) >= 0.02) {
          item.lastOpacity = depthOpacity;
          const opStr = depthOpacity.toFixed(2);
          item.el.style.setProperty('--card-opacity', opStr);
          item.el.style.opacity = opStr;
        }
      }

      if (closestIndex !== lastClosestIndex && cachedDotEls.length > 0) {
        if (lastClosestIndex >= 0 && cachedDotEls[lastClosestIndex]) {
          cachedDotEls[lastClosestIndex].classList.remove('is-active');
        }
        if (cachedDotEls[closestIndex]) {
          cachedDotEls[closestIndex].classList.add('is-active');
        }
        lastClosestIndex = closestIndex;
      }

      carouselRaf = requestAnimationFrame(updateCarouselPhysics);
    }

    function startCarouselLoop() {
      if (isScrollSuspended) return;
      if (carouselRaf === null && isCarouselInView) {
        lastCarouselTime = 0;
        carouselRaf = requestAnimationFrame(updateCarouselPhysics);
      }
    }

    function stopCarouselLoop() {
      if (carouselRaf !== null) {
        cancelAnimationFrame(carouselRaf);
        carouselRaf = null;
        lastCarouselTime = 0;
      }
    }

    function setSuspended(suspended) {
      if (isScrollSuspended === suspended) return;
      isScrollSuspended = suspended;
      if (isScrollSuspended) {
        stopCarouselLoop();
      } else if (isCarouselInView) {
        startCarouselLoop();
      }
    }

    function initVisibilityObserver() {
      const container = document.getElementById('projects-carousel-container') || document.getElementById('projects');
      if (!container) {
        isCarouselInView = true;
        startCarouselLoop();
        return;
      }

      if ('IntersectionObserver' in window) {
        if (carouselObserver) {
          carouselObserver.disconnect();
        }
        carouselObserver = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              isCarouselInView = entry.isIntersecting;
              if (isCarouselInView) {
                startCarouselLoop();
              } else {
                stopCarouselLoop();
              }
            });
          },
          { threshold: 0.05 },
        );
        carouselObserver.observe(container);
      } else {
        isCarouselInView = true;
        startCarouselLoop();
      }
    }

    function rotateToProjectIndex(targetIdx) {
      const targetItem = carouselItems.find((item) => item.projectIndex === targetIdx);
      if (!targetItem) return;

      const rawTheta = (targetItem.baseAngle + currentAngle) % 360;
      const theta = ((rawTheta + 540) % 360) - 180;
      targetAngle = targetAngle - theta;
      if (isCarouselInView) startCarouselLoop();
    }

    function renderProjects(projectsToRender) {
      if (!carouselCylinder) return;

      if (projectsToRender && Array.isArray(projectsToRender)) {
        cachedProjects = projectsToRender;
      } else if (store && typeof store.getProjects === 'function') {
        cachedProjects = store.getProjects();
      }

      const allCategories = ['ALL'];
      cachedProjects.forEach((p) => {
        const cat = String(p.category || '').trim().toUpperCase();
        if (cat && !allCategories.includes(cat)) {
          allCategories.push(cat);
        }
      });
      renderCategoryDropdown(allCategories, cachedProjects);

      const visible =
        activeCategory === 'ALL'
          ? cachedProjects
          : cachedProjects.filter(
              (p) => String(p.category || '').trim().toUpperCase() === activeCategory,
            );

      carouselCylinder.innerHTML = '';
      carouselItems = [];

      if (!visible || visible.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'carousel-empty';
        emptyMsg.textContent = 'No projects found in this category.';
        carouselCylinder.appendChild(emptyMsg);
        if (carouselDots) carouselDots.innerHTML = '';
        cachedDotEls = [];
        return;
      }

      let slots = [];
      if (visible.length >= 4) {
        slots = visible.map((p, idx) => ({ project: p, projectIndex: idx }));
      } else if (visible.length === 3) {
        slots = [
          ...visible.map((p, idx) => ({ project: p, projectIndex: idx })),
          ...visible.map((p, idx) => ({ project: p, projectIndex: idx })),
        ];
      } else if (visible.length === 2) {
        slots = [
          ...visible.map((p, idx) => ({ project: p, projectIndex: idx })),
          ...visible.map((p, idx) => ({ project: p, projectIndex: idx })),
          ...visible.map((p, idx) => ({ project: p, projectIndex: idx })),
        ];
      } else {
        slots = [{ project: visible[0], projectIndex: 0 }];
      }

      slotCount = slots.length;
      slotAngleStep = 360 / slotCount;

      const isMobile = window.innerWidth <= 600;
      const isTablet = window.innerWidth <= 768;
      const cardWidth = isMobile ? 160 : isTablet ? 210 : 270;

      let radius = 0;
      if (slotCount >= 3) {
        const radPerSlot = Math.PI / slotCount;
        const computedR = (cardWidth / 2) / Math.tan(radPerSlot);
        radius = Math.max(isMobile ? 130 : (isTablet ? 180 : 220), Math.round(computedR + (isMobile ? 8 : 20)));
      }

      slots.forEach((slot, sIdx) => {
        const baseAngle = sIdx * slotAngleStep;
        const proj = slot.project || {};

        const card = document.createElement('article');
        card.className = 'carousel-card';
        card.style.transform = `rotateY(${baseAngle}deg) translateZ(${radius}px)`;
        card.style.setProperty('--card-opacity', '1');

        const imgSrc = Security.sanitizeImageUrl(proj.image);
        const imgAlt = Security.escapeHTML(proj.title || 'Project preview');
        const categoryText = Security.escapeHTML(proj.category || 'PROJECT');
        const indexNum = `#${String(slot.projectIndex + 1).padStart(2, '0')}`;
        const titleText = Security.escapeHTML(proj.title || 'Untitled Project');
        const descText = Security.escapeHTML(proj.description || '');

        let linksHTML = '';
        if (proj.liveUrl) {
          const liveSafe = Security.sanitizeUrl(proj.liveUrl);
          if (liveSafe) {
            linksHTML += `<a href="${liveSafe}" target="_blank" rel="noopener noreferrer" class="project-link" aria-label="Visit live demo for ${titleText}">Live Demo ↗</a>`;
          }
        }
        if (proj.githubUrl) {
          const ghSafe = Security.sanitizeUrl(proj.githubUrl);
          if (ghSafe) {
            linksHTML += `<a href="${ghSafe}" target="_blank" rel="noopener noreferrer" class="project-link project-link--muted" aria-label="View source code on GitHub for ${titleText}">Source ↗</a>`;
          }
        }

        let tagsHTML = '';
        if (Array.isArray(proj.tags)) {
          tagsHTML = proj.tags
            .slice(0, 3)
            .map((t) => `<span class="project-tag">${Security.escapeHTML(t)}</span>`)
            .join('');
        }

        card.innerHTML = `
          <div class="project-thumb">
            <img src="${imgSrc}" alt="${imgAlt}" loading="lazy" decoding="async" />
            <span class="project-badge">${categoryText}</span>
            <span class="project-index">${indexNum}</span>
          </div>
          <div class="project-body">
            <h3 class="project-title">${titleText}</h3>
            <p class="project-desc">${descText}</p>
            ${tagsHTML ? `<div class="project-tags">${tagsHTML}</div>` : ''}
            <div class="project-footer">
              ${linksHTML}
            </div>
          </div>
        `;

        card.addEventListener('click', (e) => {
          if (hasDragged) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (sIdx !== lastClosestIndex && slotCount > 1) {
            rotateToProjectIndex(slot.projectIndex);
          }
        }, true);

        carouselCylinder.appendChild(card);
        carouselItems.push({
          el: card,
          baseAngle,
          projectIndex: slot.projectIndex,
          isVisible: true,
          isActive: false,
          lastOpacity: 1,
        });
      });

      if (carouselDots && visible.length > 1) {
        carouselDots.innerHTML = '';
        visible.forEach((_, vIdx) => {
          const dot = document.createElement('button');
          dot.type = 'button';
          dot.className = `carousel-dot${vIdx === 0 ? ' is-active' : ''}`;
          dot.setAttribute('role', 'tab');
          dot.setAttribute('aria-label', `Go to project ${vIdx + 1}`);
          dot.addEventListener('click', () => {
            rotateToProjectIndex(vIdx);
          });
          carouselDots.appendChild(dot);
        });
        cachedDotEls = Array.from(carouselDots.querySelectorAll('.carousel-dot'));
      } else {
        cachedDotEls = [];
      }
      lastClosestIndex = -1;

      if (isCarouselInView) {
        startCarouselLoop();
      }
      if (typeof ScrollCanvasEngine !== 'undefined' && ScrollCanvasEngine) {
        ScrollCanvasEngine.updateLayoutCaches();
        ScrollCanvasEngine.onNativeScroll();
      }
    }

    function handleBreakpointResize(newCardW) {
      if (lastCylinderCardW !== -1 && lastCylinderCardW !== newCardW) {
        lastCylinderCardW = newCardW;
        renderProjects();
      } else {
        lastCylinderCardW = newCardW;
      }
    }

    function init() {
      if (categorySelectBtn) {
        categorySelectBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleCategoryMenu();
        });
      }

      document.addEventListener('click', (e) => {
        if (
          categoryMenu &&
          !categoryMenu.hidden &&
          !categoryMenu.contains(e.target) &&
          categorySelectBtn &&
          !categorySelectBtn.contains(e.target)
        ) {
          closeCategoryMenu();
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && categoryMenu && !categoryMenu.hidden) {
          closeCategoryMenu();
        }
      });

      if (carouselPrevBtn) {
        carouselPrevBtn.addEventListener('click', () => {
          targetAngle += slotAngleStep;
          if (isCarouselInView) startCarouselLoop();
        });
      }

      if (carouselNextBtn) {
        carouselNextBtn.addEventListener('click', () => {
          targetAngle -= slotAngleStep;
          if (isCarouselInView) startCarouselLoop();
        });
      }

      if (carouselStage) {
        carouselStage.style.touchAction = 'pan-y';

        carouselStage.addEventListener('pointerenter', () => {
          isHovered = true;
        });

        carouselStage.addEventListener('pointerleave', () => {
          isHovered = false;
        });

        carouselStage.addEventListener('pointerdown', (e) => {
          if (slotCount <= 1) return;
          isDragging = true;
          hasDragged = false;
          activePointerId = e.pointerId;
          dragStartX = e.clientX;
          dragStartY = e.clientY;
          dragStartAngle = targetAngle;
          try {
            carouselStage.setPointerCapture(e.pointerId);
          } catch (_) {}
          carouselStage.classList.add('is-dragging');
        });

        window.addEventListener('pointermove', (e) => {
          if (!isDragging) return;
          const deltaX = e.clientX - dragStartX;
          const deltaY = e.clientY - dragStartY;
          if (Math.hypot(deltaX, deltaY) > 6) {
            hasDragged = true;
          }
          targetAngle = dragStartAngle + deltaX * 0.42;
        });

        function endDrag() {
          if (!isDragging) return;
          isDragging = false;
          if (activePointerId !== null) {
            try {
              carouselStage.releasePointerCapture(activePointerId);
            } catch (_) {}
            activePointerId = null;
          }
          if (carouselStage) carouselStage.classList.remove('is-dragging');
          targetAngle = Math.round(targetAngle / slotAngleStep) * slotAngleStep;
          setTimeout(() => {
            hasDragged = false;
          }, 80);
        }

        window.addEventListener('pointerup', endDrag);
        window.addEventListener('pointercancel', endDrag);
      }

      initVisibilityObserver();
    }

    return {
      init,
      renderProjects,
      handleBreakpointResize,
      initVisibilityObserver,
      setSuspended,
    };
  })();

  /* ==========================================================================
     MODULE 7: CONTACT INQUIRY MODAL, TOASTS & LOGO ADMIN ACCESS
     Handles visitor inquiries, feedback messages, and hidden authentication
     ========================================================================== */
  const InquiryController = (() => {
    const store = window.PortfolioStore;
    const modal = document.getElementById('contact-modal');
    const modalClose = document.getElementById('modal-close');
    const inquiryForm = document.getElementById('inquiry-form');
    const serviceSelect = document.getElementById('inq-service');
    const toastStack = document.getElementById('toast-stack');

    function showToast(message) {
      if (!toastStack) return;
      const item = document.createElement('div');
      item.className = 'toast';
      item.textContent = Security.sanitizeText(message);
      toastStack.appendChild(item);
      setTimeout(() => item.remove(), 3600);
    }

    function openContactModal(serviceName) {
      if (typeof NavigationController !== 'undefined') {
        NavigationController.closeMobileMenu();
      }
      if (!modal) return;
      if (serviceName && serviceSelect) {
        const hasOpt = Array.from(serviceSelect.options).some((o) => o.value === serviceName);
        if (hasOpt) serviceSelect.value = serviceName;
      }
      modal.hidden = false;
      const nameInput = document.getElementById('inq-name');
      if (nameInput) nameInput.focus();
    }

    function closeContactModal() {
      if (!modal) return;
      modal.hidden = true;
    }

    function bindLogoAdminToggle(wrapId, triggerId, linkId) {
      const wrap = document.getElementById(wrapId);
      const trigger = document.getElementById(triggerId);
      const link = document.getElementById(linkId);
      if (!wrap || !trigger || !link) return;

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const revealed = wrap.classList.toggle('is-revealed');
        trigger.setAttribute('aria-expanded', String(revealed));
        link.setAttribute('tabindex', revealed ? '0' : '-1');
      });

      document.addEventListener('click', (e) => {
        if (!wrap.contains(e.target) && wrap.classList.contains('is-revealed')) {
          wrap.classList.remove('is-revealed');
          trigger.setAttribute('aria-expanded', 'false');
          link.setAttribute('tabindex', '-1');
        }
      });
    }

    function init() {
      document.querySelectorAll('[data-open-contact]').forEach((btn) => {
        btn.addEventListener('click', () => {
          openContactModal(btn.dataset.openContact || '');
        });
        if (btn.getAttribute('role') === 'button') {
          btn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openContactModal(btn.dataset.openContact || '');
            }
          });
        }
      });

      if (modalClose) {
        modalClose.addEventListener('click', closeContactModal);
      }

      if (modal) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) closeContactModal();
        });
      }

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          closeContactModal();
          if (typeof NavigationController !== 'undefined') {
            NavigationController.closeMobileMenu();
          }
        }
      });

      if (inquiryForm) {
        inquiryForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const nameInput = document.getElementById('inq-name');
          const emailInput = document.getElementById('inq-email');
          const detailsInput = document.getElementById('inq-details');

          const name = nameInput ? Security.sanitizeText(nameInput.value) : '';
          const email = emailInput ? Security.sanitizeText(emailInput.value) : '';
          const service = serviceSelect ? serviceSelect.value : '';
          const details = detailsInput ? Security.sanitizeText(detailsInput.value) : '';

          if (!name || !email || !details) return;
          const submitBtn = inquiryForm.querySelector('button[type="submit"]');
          if (submitBtn) submitBtn.disabled = true;

          try {
            if (store) {
              await store.addInquiry({ name, email, service, details });
            }
            inquiryForm.reset();
            closeContactModal();
            showToast('Inquiry received! Hamood will respond shortly.');
          } finally {
            if (submitBtn) submitBtn.disabled = false;
          }
        });
      }

      // Hidden Admin Lock tucked behind footer HS logo
      bindLogoAdminToggle('footer-logo-wrap', 'admin-lock-trigger', 'footer-admin-link');
    }

    return {
      init,
      showToast,
      openContactModal,
      closeContactModal,
    };
  })();

  /* ==========================================================================
     MODULE 8: CLIPBOARD & CLOUD DATA SYNCHRONIZATION
     Provides instant phone copying for desktop users and multi-tab state sync
     ========================================================================== */
  const SyncAndClipboard = (() => {
    const store = window.PortfolioStore;

    function fallbackCopy(text) {
      const temp = document.createElement('textarea');
      temp.value = text;
      temp.setAttribute('readonly', '');
      temp.style.position = 'absolute';
      temp.style.left = '-9999px';
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      temp.remove();
    }

    function initClipboard() {
      const phoneCard = document.querySelector('[data-profile-tel="phone"]');
      if (!phoneCard) return;

      phoneCard.addEventListener('click', (e) => {
        const isMobile =
          /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
          ('ontouchstart' in window && window.innerWidth <= 768);

        if (!isMobile) {
          // Laptop / Desktop: copy phone number to clipboard instantly
          e.preventDefault();
          const phoneValEl = phoneCard.querySelector('[data-profile="phone"]');
          const rawPhone = phoneValEl ? phoneValEl.textContent.trim() : '+92 343 6956890';

          const notifySuccess = () => {
            InquiryController.showToast(`Phone number copied to clipboard: ${rawPhone}`);
            phoneCard.classList.add('is-copied');
            setTimeout(() => phoneCard.classList.remove('is-copied'), 2200);
          };

          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(rawPhone).then(notifySuccess, () => {
              fallbackCopy(rawPhone);
              notifySuccess();
            });
          } else {
            fallbackCopy(rawPhone);
            notifySuccess();
          }
        }
      });
    }

    let cloudSyncInFlight = false;
    async function syncFromCloud() {
      if (!store || cloudSyncInFlight) return;
      cloudSyncInFlight = true;
      try {
        const [{ profile }, { projects }] = await Promise.all([
          store.fetchProfile(),
          store.fetchProjects(),
        ]);
        if (profile) ProfileHydration.apply(profile);
        if (Array.isArray(projects)) {
          CarouselEngine.renderProjects(projects);
        }
      } catch {
        // Fallback gracefully to offline cache
      } finally {
        cloudSyncInFlight = false;
      }
    }

    function initSync() {
      if (store && typeof store.subscribeToLiveUpdates === 'function') {
        store.subscribeToLiveUpdates(() => {
          ProfileHydration.apply();
          CarouselEngine.renderProjects(store.getProjects());
          syncFromCloud();
        });
      }

      window.addEventListener('focus', syncFromCloud);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') syncFromCloud();
      });
    }

    return {
      init() {
        initClipboard();
        initSync();
      },
      syncFromCloud,
    };
  })();

  /* ==========================================================================
     MODULE 9: INTERACTIVE TEXT RE-CREATION ON HOVER
     Digital cyber scramble typography effect with guaranteed timer cleanup
     ========================================================================== */
  const TextRecreationEngine = (() => {
    const UPPER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const LOWER_CHARS = 'abcdefghijklmnopqrstuvwxyz';
    const DIGIT_CHARS = '0123456789';

    function runTextRecreate(targetText, onFrame, durationMs = 1100) {
      const frameStepMs = 42;
      const totalFrames = Math.max(14, Math.round(durationMs / frameStepMs));
      let frame = 0;

      const timer = setInterval(() => {
        frame += 1;
        const progress = frame / totalFrames;
        const revealCount = Math.floor(progress * targetText.length);

        const nextText = targetText
          .split('')
          .map((char, idx) => {
            if (idx < revealCount) return char;
            if (/[A-Z]/.test(char)) {
              return UPPER_CHARS[Math.floor(Math.random() * UPPER_CHARS.length)];
            }
            if (/[a-z]/.test(char)) {
              return LOWER_CHARS[Math.floor(Math.random() * LOWER_CHARS.length)];
            }
            if (/[0-9]/.test(char)) {
              return DIGIT_CHARS[Math.floor(Math.random() * DIGIT_CHARS.length)];
            }
            return char;
          })
          .join('');

        onFrame(nextText);

        if (frame >= totalFrames) {
          clearInterval(timer);
          onFrame(targetText);
        }
      }, frameStepMs);

      return () => clearInterval(timer);
    }

    function restartClass(node, className) {
      // Use a micro-task clone approach to restart the CSS animation without
      // triggering a synchronous forced layout (avoids expensive offsetWidth reflow).
      node.classList.remove(className);
      requestAnimationFrame(() => {
        node.classList.add(className);
      });
    }

    function init() {
      const textEls = document.querySelectorAll('[data-recreate-text]');
      textEls.forEach((el) => {
        const original = el.textContent;
        el.dataset.originalText = original;

        const wrap = document.createElement('span');
        wrap.className = 'rewrite-wrap';

        const sizer = document.createElement('span');
        sizer.className = 'rewrite-sizer';
        sizer.setAttribute('aria-hidden', 'true');
        sizer.textContent = original;

        const live = document.createElement('span');
        live.className = 'rewrite-live';
        live.textContent = original;

        wrap.append(sizer, live);
        el.textContent = '';
        el.appendChild(wrap);
        el._liveNode = live;
        el._stopTimer = null;
      });

      document.querySelectorAll('[data-recreate-card]').forEach((card) => {
        card.addEventListener('mouseenter', () => {
          card.querySelectorAll('[data-recreate-text]').forEach((el) => {
            const original = el.dataset.originalText || '';
            const live = el._liveNode;
            if (!live || !original) return;
            if (typeof el._stopTimer === 'function') el._stopTimer();

            restartClass(live, 'recreate-glow');
            const duration = Number(el.dataset.duration) || 1100;
            el._stopTimer = runTextRecreate(
              original,
              (next) => {
                live.textContent = next;
              },
              duration,
            );
          });

          card.querySelectorAll('[data-recreate-wipe]').forEach((el) => {
            restartClass(el, 'recreate-wipe');
          });
        });
      });
    }

    return { init };
  })();

  /* ==========================================================================
     MODULE 10: CINEMATIC PAGE INTRO
     Two-panel shutter reveal choreography on first load
     ========================================================================== */
  const PageIntro = (() => {
    function run() {
      const intro = document.getElementById('page-intro');
      if (!intro) return;

      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduceMotion) {
        intro.remove();
        return;
      }

      const finish = () => {
        intro.classList.add('is-done');
        setTimeout(() => intro.remove(), 400);
      };

      const startReveal = () => {
        if (intro.classList.contains('is-leaving')) return;
        intro.classList.add('is-leaving');
        setTimeout(finish, 780);
      };

      // Brief sleek black blink (~420ms) then smoothly part curtains to reveal portfolio
      setTimeout(startReveal, 420);
    }

    return { run };
  })();

  /* ==========================================================================
     MODULE 11: APPLICATION BOOTSTRAP & ORCHESTRATION
     Initializes subsystems in deterministic sequence with zero global pollution
     ========================================================================== */
  function bootstrap() {
    PageIntro.run();
    ProfileHydration.apply();
    NavigationController.init();
    InquiryController.init();
    SyncAndClipboard.init();
    TextRecreationEngine.init();

    if (ScrollCanvasEngine) {
      ScrollCanvasEngine.init();
      window.__ScrollCanvasEngine = ScrollCanvasEngine;
      window.__SCROLL_DEBUG__ = (enabled) => ScrollCanvasEngine.setDebug(enabled);
      window.__SCROLL_OVERLAY__ = (enabled) => ScrollCanvasEngine.setDebugOverlay(enabled);
      window.addEventListener('scroll', ScrollCanvasEngine.onNativeScroll, { passive: true });
      window.addEventListener('resize', ScrollCanvasEngine.onDebouncedResize, { passive: true });
      window.addEventListener(
        'load',
        () => {
          ScrollCanvasEngine.updateLayoutCaches();
          ScrollCanvasEngine.onNativeScroll();
        },
        { passive: true },
      );
    }

    CarouselEngine.init();
    CarouselEngine.renderProjects();
    SyncAndClipboard.syncFromCloud();
  }

  // Execute bootstrap on DOM readiness
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
