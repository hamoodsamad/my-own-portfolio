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
     MODULE 3: DECOUPLED SCROLL CANVAS ANIMATION ENGINE
     Decouples asynchronous frame decoding from the 60fps/120fps rAF render loop.
     Features sliding window memory management with 1080p capped decoding resolution,
     active VRAM pruning of distant frames, debounced resize, and layout-cached scroll math.
     ========================================================================== */
  const ScrollCanvasEngine = (() => {
    const FRAME_COUNT = 238;
    const USE_BITMAP =
      window.location.protocol !== 'file:' && typeof window.createImageBitmap === 'function';
    const REDUCE_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const canvas = document.getElementById('scroll-canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d', { alpha: false });

    // Dynamic multi-tier asset loader:
    // Tier 1 (4K / Ultra-wide / 32-inch displays): loads original 3840x2160 master frames from './frames'
    // Tier 2 (Laptops, Tablets, Phones): loads optimized 1920x1080 frames from './frames-1080p'
    let currentFrameFolder = './frames-1080p';
    let currentDecodeW = 1920;
    let currentDecodeH = 1080;
    let currentTier = '1080p';

    function detectAssetTier() {
      const rawDpr = window.devicePixelRatio || 1;
      // Strictly block 4K on standard laptops. Force fallback to 1080p unless absolute 2K/4K external display widths (>2200px) are detected
      if (window.innerWidth > 2200 || (window.innerWidth >= 2000 && rawDpr > 1.25)) {
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
      clearAllFrames();
      return true;
    }

    // Sliding window memory model configuration
    const WINDOW_RADIUS = 30;     // Immediate lookahead / lookbehind increased to 30 frames
    const PRUNE_DISTANCE = 130;   // Retain 130 frames resident in GPU VRAM to eliminate scroll-back decode latency
    const ANCHOR_STRIDE = 10;     // Retain 24 permanent anchor keyframes across sequence for instant jump fallback
    // Throttle prune to only fire when center moves ≥ this many frames — avoids 238-iter scan every rAF tick
    const PRUNE_THROTTLE = 8;

    const frames = new Array(FRAME_COUNT).fill(null);
    const blobCache = new Array(FRAME_COUNT).fill(null);
    const blobFetchingSet = new Set();
    const loadingSet = new Set();

    // urgentQueue is ordered by priority: closest to active focus is processed first
    const urgentQueue = [];
    const idleQueue = [];
    const inUrgentSet = new Set();
    const inIdleSet = new Set();
    // 4 concurrent fetches: stays smoothly ahead of scroll without network saturation
    const CONCURRENCY = 4;
    let activeWorkers = 0;
    let cachedCount = 0;
    let lastPrunedCenter = -1;

    let width = 0;
    let height = 0;
    let canvasScale = 1;
    let cachedDrawRect = null;
    let cachedTopGrad = null;
    let cachedBotGrad = null;
    let cachedTopFadeH = 0;
    let cachedBotFadeY = 0;
    let needsRender = false;
    let maxScrollCache = 1;
    let cachedSectionOffsets = [];

    let targetFrame = 0;
    let currentFrame = 0;
    let lastRenderedPos = -1;
    let lastNeighborhoodCenter = -1;
    let lastNavScrollY = -999;
    let rafId = null;
    let lastTimestamp = 0;
    let pendingScrollY = 0;
    let prevScrollY = 0;         // Previous scroll position for velocity tracking
    let scrollVelocity = 0;      // Frames-per-second scroll speed (signed)
    let scrollScheduled = false;
    let lastScrollDirection = 1; // 1 = scrolling down, -1 = scrolling up

    let idlePreloadTimer = null;
    let resizeDebounceTimer = null;

    function frameSrc(index) {
      return `${currentFrameFolder}/frame-${String(index + 1).padStart(3, '0')}.webp`;
    }

    /**
     * Safely closes and releases an ImageBitmap texture from GPU memory.
     * Retains the raw compressed WebP Blob in blobCache so scrolling back decodes in 1ms with ZERO network requests.
     */
    function releaseFrame(index) {
      if (index < 0 || index >= FRAME_COUNT) return;
      const bm = frames[index];
      if (bm) {
        if (typeof bm.close === 'function') {
          try {
            bm.close(); // Immediate GPU memory reclamation!
          } catch (_) {}
        }
        frames[index] = null;
        cachedCount = Math.max(0, cachedCount - 1);
      }
    }

    /**
     * Sliding Window Memory Model:
     * Actively prunes GPU textures of non-anchor frames whose distance from active scroll focus
     * exceeds PRUNE_DISTANCE, bounding GPU VRAM footprint to lean textures.
     * Throttled: only fires when center has moved ≥ PRUNE_THROTTLE frames.
     */
    function pruneDistantFrames(centerIdx) {
      if (Math.abs(centerIdx - lastPrunedCenter) < PRUNE_THROTTLE) return;
      lastPrunedCenter = centerIdx;
      for (let i = 0; i < FRAME_COUNT; i++) {
        // Retain anchor keyframes (first, last, and every 10th frame) for instant scroll jump fallback
        if (i === 0 || i === FRAME_COUNT - 1 || i % ANCHOR_STRIDE === 0) {
          continue;
        }
        if (frames[i] !== null && Math.abs(i - centerIdx) > PRUNE_DISTANCE) {
          releaseFrame(i);
        }
      }
    }

    /**
     * Purges all cached frames and blobs safely (e.g. on asset tier change).
     */
    function clearAllFrames() {
      for (let i = 0; i < FRAME_COUNT; i++) {
        releaseFrame(i);
        blobCache[i] = null;
      }
      loadingSet.clear();
      blobFetchingSet.clear();
      urgentQueue.length = 0;
      idleQueue.length = 0;
      inUrgentSet.clear();
      inIdleSet.clear();
      cachedCount = 0;
      lastNeighborhoodCenter = -1;
      lastPrunedCenter = -1;
      if (idlePreloadTimer) {
        clearTimeout(idlePreloadTimer);
        idlePreloadTimer = null;
      }
    }

    function fetchBlob(index) {
      if (index < 0 || index >= FRAME_COUNT) return Promise.resolve(null);
      if (blobCache[index] !== null) return Promise.resolve(blobCache[index]);
      if (blobFetchingSet.has(index)) return Promise.resolve(null);

      blobFetchingSet.add(index);
      return fetch(frameSrc(index))
        .then((res) => (res.ok ? res.blob() : null))
        .then((blob) => {
          blobFetchingSet.delete(index);
          if (blob) {
            blobCache[index] = blob;
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

      loadingSet.add(index);

      const blobPromise = blobCache[index] !== null
        ? Promise.resolve(blobCache[index])
        : fetchBlob(index);

      return blobPromise
        .then((blob) => {
          if (!blob) return null;
          if (USE_BITMAP) {
            return createImageBitmap(blob);
          }
          return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = URL.createObjectURL(blob);
          });
        })
        .then((bm) => {
          loadingSet.delete(index);
          if (!bm) return null;

          if (frames[index] !== null) {
            if (typeof bm.close === 'function') {
              try { bm.close(); } catch (_) {}
            }
            return frames[index];
          }

          // If scrolled far away during async operation, release GPU texture but keep Blob in blobCache!
          const currentInt = Math.round(currentFrame);
          const isAnchor = index === 0 || index === FRAME_COUNT - 1 || index % ANCHOR_STRIDE === 0;
          if (!isAnchor && Math.abs(index - currentInt) > PRUNE_DISTANCE + 5) {
            if (typeof bm.close === 'function') {
              try { bm.close(); } catch (_) {}
            }
            return null;
          }

          frames[index] = bm;
          cachedCount++;

          // If current frame or adjacent just became ready:
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
      while (activeWorkers < CONCURRENCY && (urgentQueue.length > 0 || idleQueue.length > 0)) {
        let idx;
        if (urgentQueue.length > 0) {
          idx = urgentQueue.shift();
          inUrgentSet.delete(idx);
        } else {
          idx = idleQueue.shift();
          if (!inIdleSet.has(idx)) continue;
          inIdleSet.delete(idx);
        }

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

      if (isUrgent) {
        if (inIdleSet.has(index)) {
          inIdleSet.delete(index);
        }
        if (!inUrgentSet.has(index)) {
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
      } else {
        if (!inUrgentSet.has(index) && !inIdleSet.has(index)) {
          idleQueue.push(index);
          inIdleSet.add(index);
        }
      }
    }

    function ensureNeighborhood(centerIdx, direction = 1) {
      // 1. Purge stale requests from urgentQueue that are far from new centerIdx (> WINDOW_RADIUS + 5)
      for (let i = urgentQueue.length - 1; i >= 0; i--) {
        const item = urgentQueue[i];
        if (Math.abs(item - centerIdx) > WINDOW_RADIUS + 5) {
          urgentQueue.splice(i, 1);
          inUrgentSet.delete(item);
        }
      }

      // 2. Prioritize immediate forward frames, then immediate backward frames
      const immediateRange = [];
      const primaryDir = direction >= 0 ? 1 : -1;

      // Nearest ±2 frames have absolute highest priority
      for (let off = 0; off <= 2; off++) {
        const idx = centerIdx + off * primaryDir;
        if (idx >= 0 && idx < FRAME_COUNT) immediateRange.push(idx);
        const opp = centerIdx - off * primaryDir;
        if (opp >= 0 && opp < FRAME_COUNT && opp !== idx) immediateRange.push(opp);
      }

      // Next lookahead frames in direction of scroll
      for (let off = 3; off <= WINDOW_RADIUS; off++) {
        const idx = centerIdx + off * primaryDir;
        if (idx >= 0 && idx < FRAME_COUNT) immediateRange.push(idx);
      }
      // Behind frames (buffer for instant scroll reversals)
      for (let off = 3; off <= 14; off++) {
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

    function runIdlePreload() {
      // If user is actively scrolling or workers busy, delay preload until quiet
      if (rafId !== null || activeWorkers >= CONCURRENCY) {
        scheduleIdlePreload(350);
        return;
      }

      // Find next uncached blob closest to current frame
      let found = -1;
      const cur = Math.round(currentFrame);
      for (let dist = 1; dist < FRAME_COUNT; dist++) {
        const forward = cur + dist;
        if (forward < FRAME_COUNT && blobCache[forward] === null && !blobFetchingSet.has(forward)) {
          found = forward;
          break;
        }
        const backward = cur - dist;
        if (backward >= 0 && blobCache[backward] === null && !blobFetchingSet.has(backward)) {
          found = backward;
          break;
        }
      }

      if (found !== -1) {
        fetchBlob(found).then(() => {
          // If anchor frame, decode into GPU texture immediately
          if (found % ANCHOR_STRIDE === 0 && frames[found] === null && blobCache[found]) {
            createImageBitmap(blobCache[found]).then((bm) => {
              if (bm && frames[found] === null) {
                frames[found] = bm;
                cachedCount++;
              }
            }).catch(() => {});
          }
          scheduleIdlePreload(35);
        });
      }
    }

    function scheduleIdlePreload(delay = 500) {
      if (idlePreloadTimer) clearTimeout(idlePreloadTimer);
      idlePreloadTimer = setTimeout(runIdlePreload, delay);
    }

    function preloadAnchorFrames() {
      // 1. Initial immediate window (frames 0 to 15) for instant initial response
      const initialChunk = Math.min(15, FRAME_COUNT);
      for (let i = 0; i < initialChunk; i++) {
        requestFrame(i, true);
      }
      pumpQueue();

      // 2. Coarse keyframe grid across full sequence (every 10th frame + end)
      for (let i = ANCHOR_STRIDE; i < FRAME_COUNT; i += ANCHOR_STRIDE) {
        requestFrame(i, false);
      }
      requestFrame(FRAME_COUNT - 1, false);
      pumpQueue();

      // Start gentle background preloading
      scheduleIdlePreload(800);
    }
    function updateLayoutCaches() {
      width = window.innerWidth;
      height = window.innerHeight;
      maxScrollCache = Math.max(1, document.documentElement.scrollHeight - height);
      if (typeof NavigationController !== 'undefined' && NavigationController.trackedSections) {
        cachedSectionOffsets = NavigationController.trackedSections.map((sec) => ({
          id: sec.id,
          top: sec.offsetTop,
        }));
      }
    }

    function scrollYToFrame(scrollY) {
      // Pure mathematical projection based on cached maxScroll — zero DOM layout reading!
      const progress = Math.min(1, Math.max(0, scrollY / maxScrollCache));
      return progress * (FRAME_COUNT - 1);
    }

    function computeDrawRect(imgW, imgH) {
      const activeW = imgW || currentDecodeW;
      const activeH = imgH || currentDecodeH;

      const isPhonePortrait = width < 600 || (width < 768 && height > width * 1.15);
      const isTabletPortrait = !isPhonePortrait && (width < 1024 && height > width);

      if (isPhonePortrait) {
        // TIER 1: Phone Portrait (iPhone, Pixel, Galaxy, etc.)
        // Balanced luxury framing:
        // - Subject placed gracefully on the right (anchor ~930 centered at 60% of viewport width)
        // - Left side stays dark and clear for the hero typography and badges
        // - Comfortable headroom (~70px) so hair never clips against mobile navbar
        const scale = Math.min(Math.max(width / 750, height / 1700), 0.52);
        const drawW = activeW * scale;
        const drawH = activeH * scale;

        const progress = Math.min(1, Math.max(0, currentFrame / (FRAME_COUNT - 1)));
        const subjectAnchorX = 930 + progress * 60;
        const offsetX = width * 0.60 - subjectAnchorX * scale;
        const targetHeadTop = Math.max(68, height * 0.08);
        const offsetY = targetHeadTop - 40 * scale;

        return { offsetX, offsetY, drawW, drawH, mode: 'phone-portrait' };
      }

      if (isTabletPortrait) {
        // TIER 2: Tablet Portrait (iPad, Galaxy Tab, Foldables)
        // Balanced framing with 12% headroom, subject centered in upper third
        const scale = Math.max((width / activeW) * 1.05, (height / activeH) * 0.88);
        const drawW = activeW * scale;
        const drawH = activeH * scale;

        const progress = Math.min(1, Math.max(0, currentFrame / (FRAME_COUNT - 1)));
        const subjectAnchorX = 860 + progress * 100;
        const offsetX = width * 0.50 - subjectAnchorX * scale;
        const offsetY = (height - drawH) * 0.14;

        return { offsetX, offsetY, drawW, drawH, mode: 'tablet-portrait' };
      }

      // TIER 3 & 4: Laptop, Desktop, Ultra-wide & 4K Displays
      // True full-bleed edge-to-edge cover framing with 20% vertical top-bias
      const scale = Math.max(width / activeW, height / activeH);
      const drawW = activeW * scale;
      const drawH = activeH * scale;
      const offsetX = (width - drawW) * 0.5;
      const offsetY = (height - drawH) * 0.20;

      return { offsetX, offsetY, drawW, drawH, mode: 'cover' };
    }

    function findNearestFrame(index) {
      if (frames[index]) return index;
      // Cap search to PRUNE_DISTANCE — anything further is definitely evicted.
      // This eliminates worst-case 238-iteration scan on every renderFrame call.
      const maxSearch = Math.min(PRUNE_DISTANCE, FRAME_COUNT);
      for (let offset = 1; offset <= maxSearch; offset++) {
        const prev = index - offset;
        const next = index + offset;
        if (prev >= 0 && frames[prev]) return prev;
        if (next < FRAME_COUNT && frames[next]) return next;
      }
      return -1;
    }

    function renderFrame(position, force = false) {
      const clamped = Math.min(FRAME_COUNT - 1, Math.max(0, position));
      const targetIdx = Math.round(clamped);
      if (!force && targetIdx === lastRenderedPos) return;

      const resolvedBase = findNearestFrame(targetIdx);
      if (resolvedBase === -1) return;

      // Avoid redundant redraw if resolved fallback frame is already rendered
      if (!force && resolvedBase === lastRenderedPos) return;

      const baseImg = frames[resolvedBase];
      if (!baseImg) return;

      // On portrait / mobile, recompute drawRect when currentFrame moves so subject stays centered
      const isPortrait = height > width * 1.15 || width <= 768;
      const rect = isPortrait ? computeDrawRect() : (cachedDrawRect || computeDrawRect());
      const { offsetX, offsetY, drawW, drawH, mode } = rect;

      if (mode === 'phone-portrait' || mode === 'tablet-portrait') {
        // Luxury deep background fill
        ctx.fillStyle = '#050308';
        ctx.fillRect(0, 0, width, height);

        // Draw crisp frame with hardware sub-pixel positioning
        ctx.drawImage(baseImg, offsetX, offsetY, drawW, drawH);

        // Pre-cached gradients (created once on resize, ZERO allocation in renderFrame!)
        if (cachedTopGrad && cachedTopFadeH > 0) {
          ctx.fillStyle = cachedTopGrad;
          ctx.fillRect(0, 0, width, cachedTopFadeH);
        }

        if (cachedBotGrad && cachedBotFadeY > 0) {
          ctx.fillStyle = cachedBotGrad;
          ctx.fillRect(0, cachedBotFadeY, width, height - cachedBotFadeY);
        }
      } else {
        // Landscape / Cover: edge-to-edge rasterization
        ctx.drawImage(baseImg, offsetX, offsetY, drawW, drawH);
      }

      lastRenderedPos = resolvedBase;
    }
    function tick(timestamp) {
      // Cap dt at 1/30s (33ms) — tighter than 50ms to prevent a large
      // position jump after a tab-resume or dropped frame that would look like a pop.
      const dt = lastTimestamp ? Math.min((timestamp - lastTimestamp) / 1000, 1 / 30) : 1 / 60;
      lastTimestamp = timestamp;

      if (scrollScheduled) {
        scrollScheduled = false;
        // Rely exclusively on cached layout math — zero layout thrashing!
        const newTarget = scrollYToFrame(pendingScrollY);
        const diff = newTarget - targetFrame;
        if (Math.abs(diff) > 0.01) {
          lastScrollDirection = diff >= 0 ? 1 : -1;
        }

        // Track scroll velocity in frame-units/sec for adaptive lookahead
        const rawFrameDelta = scrollYToFrame(pendingScrollY) - scrollYToFrame(prevScrollY);
        scrollVelocity = scrollVelocity * 0.6 + (rawFrameDelta / Math.max(dt, 1 / 120)) * 0.4;
        prevScrollY = pendingScrollY;

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
          const absVel = Math.abs(scrollVelocity);
          const velocityBias = absVel > 3
            ? Math.min(Math.round(absVel * 0.18), 8) * lastScrollDirection
            : 0;
          ensureNeighborhood(Math.max(0, Math.min(FRAME_COUNT - 1, roundedTarget + velocityBias)), lastScrollDirection);
          pruneDistantFrames(roundedTarget); // Active sliding window VRAM eviction!
        }
      }

      const delta = targetFrame - currentFrame;
      const absDelta = Math.abs(delta);

      // Compositor Thread Overlap Elimination:
      // When ScrollCanvasEngine detects active scrolling (Math.abs(targetFrame - currentFrame) > 0.05),
      // immediately halt or bypass the 3D cylinder carousel's requestAnimationFrame loop.
      const isScrolling = absDelta > 0.05;
      if (typeof CarouselEngine !== 'undefined') {
        CarouselEngine.setSuspended(isScrolling);
      }

      if (absDelta < 0.005) {
        currentFrame = targetFrame;
        renderFrame(Math.round(currentFrame), needsRender);
        needsRender = false;
        rafId = null;
        lastTimestamp = 0;
        if (typeof CarouselEngine !== 'undefined') {
          CarouselEngine.setSuspended(false);
        }
        scheduleIdlePreload(250);
        return;
      }

      // Responsive, critically-damped spring dynamics:
      // Tuned baseEase ~36 and dynamicEase scaling up to 46 for high-delta scrolls
      const baseEase = 36;
      const dynamicEase = absDelta > 10 ? 46 : (absDelta > 2 ? baseEase : 28);
      const factor = 1 - Math.exp(-dynamicEase * dt);

      currentFrame += delta * factor;
      // Math.round() prevents sub-pixel rasterization & layout jitter during render
      renderFrame(Math.round(currentFrame));
      needsRender = false;
      rafId = requestAnimationFrame(tick);
    }
    function scheduleLoop() {
      if (rafId === null) {
        lastTimestamp = 0;
        rafId = requestAnimationFrame(tick);
      }
    }

    // Pause rAF when tab is hidden to save CPU/GPU completely
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
          lastTimestamp = 0;
        }
      } else {
        // Instantaneous recovery from state restoration — zero jumping or lagging
        pendingScrollY = window.scrollY || window.pageYOffset || 0;
        targetFrame = scrollYToFrame(pendingScrollY);
        currentFrame = targetFrame;
        scrollScheduled = false;
        lastTimestamp = 0;
        renderFrame(Math.round(currentFrame), true);
        scheduleLoop();
      }
    }

    function onNativeScroll() {
      // Direct composited scroll offset read — zero layout reflow
      pendingScrollY = window.scrollY || window.pageYOffset || 0;
      scrollScheduled = true;
      scheduleLoop();
    }

    function resize() {
      updateLayoutCaches();
      const tierChanged = updateAssetTier();

      const rawDpr = window.devicePixelRatio || 1;
      const isMob = width < 768 || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1 && width < 1024);
      const is4K = currentTier === '4k';

      // On 4K external displays (>2200px): cap at 1.5 DPR up to 3840x2160 native buffer
      // On standard laptops and mobile: strictly cap canvasScale to Math.min(rawDpr, 1.25) to eliminate GPU fillrate bottlenecks
      canvasScale = is4K ? Math.min(rawDpr, 1.5) : Math.min(rawDpr, 1.25);

      const targetCanvasW = Math.min(currentDecodeW, Math.max(1, Math.round(width * canvasScale)));
      const targetCanvasH = Math.min(currentDecodeH, Math.max(1, Math.round(height * canvasScale)));

      // Resize canvas buffer only when physical dimensions change
      if (canvas.width !== targetCanvasW || canvas.height !== targetCanvasH) {
        canvas.width = targetCanvasW;
        canvas.height = targetCanvasH;
      }
      // Always re-apply transform and smoothing — canvas 2D context state resets on any size change
      ctx.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium'; // Halve bicubic filtering GPU rasterization overhead with zero visual degradation

      // Pre-compute and cache atmospheric gradients once on resize (zero overhead during 60fps render)
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

      cachedDrawRect = computeDrawRect();

      lastRenderedPos = -1;
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
      if (resizeDebounceTimer) {
        clearTimeout(resizeDebounceTimer);
      }
      resizeDebounceTimer = setTimeout(() => {
        resize();
      }, 150);
    }

    function init() {
      // Respect prefers-reduced-motion — disable the canvas animation entirely
      if (REDUCE_MOTION) {
        canvas.style.display = 'none';
        return;
      }
      updateLayoutCaches();
      targetFrame = scrollYToFrame(window.scrollY || window.pageYOffset || 0);
      currentFrame = targetFrame;
      resize();
      preloadAnchorFrames();
      ensureNeighborhood(Math.round(currentFrame), 1);
      // Pause rAF when tab is hidden to save CPU/GPU
      document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });
    }

    return {
      init,
      resize,
      onDebouncedResize,
      onNativeScroll,
      updateLayoutCaches,
      get currentFrame() { return currentFrame; },
      get targetFrame() { return targetFrame; },
      get cachedSectionOffsets() { return cachedSectionOffsets; },
      get height() { return height; },
      get cachedCount() { return cachedCount; },
    };
  })();

  /* ==========================================================================
     MODULE 4: STICKY HEADER, SCROLL SPY & ACCESSIBLE MOBILE MENU
     Manages navigation states with zero layout thrashing during scroll events
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

      // Smooth scroll for nav anchor links without lagging wheel scrolling
      document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
        anchor.addEventListener('click', (e) => {
          const targetId = anchor.getAttribute('href');
          if (targetId && targetId !== '#') {
            const targetEl = document.querySelector(targetId);
            if (targetEl) {
              e.preventDefault();
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
     MODULE 6: 3D CYLINDER PROJECTS CAROUSEL & FILTER ENGINE
     Features GPU-accelerated 3D mathematics, off-screen pausing, backface culling,
     and fully sanitized card rendering.
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
    let dragStartX = 0;
    let dragStartAngle = 0;
    let isHovered = false;
    const autoSpinSpeed = 0.16; // Naturally brisk, smooth 360° spin
    let carouselRaf = null;
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

    function updateCarouselPhysics() {
      if (isScrollSuspended || !isCarouselInView || !carouselCylinder || carouselItems.length === 0) {
        carouselRaf = null;
        return;
      }

      if (!isDragging && !isHovered && slotCount > 1) {
        targetAngle -= autoSpinSpeed;
      }

      // Smooth elastic lerp towards target angle
      const diff = targetAngle - currentAngle;
      currentAngle += diff * 0.14;

      carouselCylinder.style.transform = `rotateY(${currentAngle}deg)`;

      const halfStep = slotAngleStep / 2;
      let closestIndex = 0;
      let minAngularDist = 999;

      const itemCount = carouselItems.length;
      for (let i = 0; i < itemCount; i++) {
        const item = carouselItems[i];
        // Calculate normalized angle relative to viewer (-180 to +180)
        const rawTheta = (item.baseAngle + currentAngle) % 360;
        const theta = ((rawTheta + 540) % 360) - 180;
        const absTheta = Math.abs(theta);

        const rad = (theta * Math.PI) / 180;
        const cosVal = Math.cos(rad);

        // Backface Culling: Cull cards completely facing away from viewer (cosVal < -0.05)
        if (cosVal < -0.05) {
          if (item.isVisible) {
            item.el.style.visibility = 'hidden';
            item.el.style.pointerEvents = 'none';
            item.isVisible = false;
          }
          continue;
        }

        // Restore visibility if card was previously culled
        if (!item.isVisible) {
          item.el.style.visibility = '';
          item.isVisible = true;
        }

        // Facing front: within half a step
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

        // Smooth depth perspective: front card full opacity, back cards curve gracefully into depth
        const depthOpacity = Math.round(Math.max(0.35, Math.min(1, 0.4 + 0.6 * cosVal)) * 100) / 100;
        if (item.lastOpacity !== depthOpacity) {
          item.lastOpacity = depthOpacity;
          item.el.style.opacity = String(depthOpacity);
        }
      }

      // Update pagination dots only when closestIndex changes
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
        carouselRaf = requestAnimationFrame(updateCarouselPhysics);
      }
    }

    function stopCarouselLoop() {
      if (carouselRaf !== null) {
        cancelAnimationFrame(carouselRaf);
        carouselRaf = null;
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
            const entry = entries[0];
            const inView = !!(entry && (entry.isIntersecting || entry.intersectionRatio > 0));
            if (inView !== isCarouselInView) {
              isCarouselInView = inView;
              if (isCarouselInView) {
                startCarouselLoop();
              } else {
                stopCarouselLoop();
              }
            }
          },
          {
            root: null,
            rootMargin: '150px 0px 150px 0px',
            threshold: 0,
          }
        );
        carouselObserver.observe(container);
      } else {
        isCarouselInView = true;
        startCarouselLoop();
      }
    }

    function rotateToProjectIndex(targetIdx) {
      if (slotCount <= 1) return;
      const item = carouselItems.find((it) => it.projectIndex === targetIdx);
      if (!item) return;

      const rawTheta = (item.baseAngle + targetAngle) % 360;
      const theta = ((rawTheta + 540) % 360) - 180;
      targetAngle -= theta;
      if (isCarouselInView) {
        startCarouselLoop();
      }
    }

    function renderProjects(listOverride) {
      if (!store || !carouselCylinder) return;
      if (Array.isArray(listOverride)) {
        cachedProjects = listOverride;
      }

      const projects = cachedProjects;

      // Extract unique categories for filter menu
      const categories = ['ALL'];
      projects.forEach((p) => {
        const cat = String(p.category || '').trim().toUpperCase();
        if (cat && !categories.includes(cat)) categories.push(cat);
      });

      if (!categories.includes(activeCategory)) {
        activeCategory = 'ALL';
      }

      renderCategoryDropdown(categories, projects);

      const visible =
        activeCategory === 'ALL'
          ? projects
          : projects.filter(
              (p) => String(p.category || '').trim().toUpperCase() === activeCategory,
            );

      stopCarouselLoop();
      carouselCylinder.innerHTML = '';
      carouselItems = [];

      if (visible.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'projects-empty';
        empty.textContent = 'No projects published in this category yet.';
        carouselCylinder.appendChild(empty);
        if (carouselDots) carouselDots.innerHTML = '';
        return;
      }

      // Determine circular slot repetition so the circle is continuous (min 4 slots for 3D orbit)
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

      // Radius calculation for 3D cylinder (compact, proportional for all screen sizes)
      const isMobile = window.innerWidth <= 600;
      const isTablet = window.innerWidth <= 768;
      const cardWidth = isMobile ? 160 : isTablet ? 210 : 270;

      let radius = 0;
      if (slotCount >= 3) {
        const radPerSlot = (Math.PI / slotCount);
        const computedR = (cardWidth / 2) / Math.tan(radPerSlot);
        radius = Math.max(isMobile ? 130 : (isTablet ? 180 : 220), Math.round(computedR + (isMobile ? 8 : 20)));
      }

      slots.forEach((slot, sIdx) => {
        const baseAngle = sIdx * slotAngleStep;
        const proj = slot.project || {};

        const card = document.createElement('article');
        card.className = 'carousel-card';
        card.style.transform = `rotateY(${baseAngle}deg) translateZ(${radius}px)`;

        // Sanitize dynamic inputs strictly before injection
        const imgSrc = Security.sanitizeImageUrl(proj.image);
        const imgAlt = Security.escapeHTML(proj.title || 'Project preview');
        const categoryText = Security.escapeHTML(proj.category || 'PROJECT');
        const indexNum = `#${String(slot.projectIndex + 1).padStart(2, '0')}`;
        const titleText = Security.escapeHTML(proj.title || 'Untitled Project');
        const descText = Security.escapeHTML(proj.description || '');

        const rawHref = store.normalizeExternalUrl(proj.link);
        const safeHref = Security.sanitizeUrl(rawHref);

        const linkHtml = safeHref
          ? `<a class="project-link" href="${Security.escapeHTML(safeHref)}" ${/^https?:\/\//i.test(safeHref) ? 'target="_blank" rel="noopener noreferrer"' : ''}><span>View Project</span><span aria-hidden="true">↗</span></a>`
          : `<span class="project-link--muted">Case Study • Selected Work</span>`;

        card.innerHTML = `
          <div class="project-thumb">
            <img src="${Security.escapeHTML(imgSrc)}" alt="${imgAlt}" loading="lazy">
            <span class="project-badge">${categoryText}</span>
            <span class="project-index">${indexNum}</span>
          </div>
          <div class="project-body">
            <h3 class="project-title">${titleText}</h3>
            <p class="project-desc">${descText}</p>
            <div class="project-footer">
              ${linkHtml}
            </div>
          </div>
        `;

        card.addEventListener('click', () => {
          if (card.classList.contains('is-active')) return;
          rotateToProjectIndex(slot.projectIndex);
        });

        carouselCylinder.appendChild(card);
        carouselItems.push({
          el: card,
          baseAngle,
          projectIndex: slot.projectIndex,
          isActive: false,
          isVisible: true,
          lastOpacity: -1,
        });
      });

      // Render pagination dots for each unique visible project
      if (carouselDots) {
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
        carouselStage.addEventListener('pointerenter', () => {
          isHovered = true;
        });

        carouselStage.addEventListener('pointerleave', () => {
          isHovered = false;
          if (isDragging) {
            isDragging = false;
            carouselStage.classList.remove('is-dragging');
            targetAngle = Math.round(targetAngle / slotAngleStep) * slotAngleStep;
          }
        });

        carouselStage.addEventListener('pointerdown', (e) => {
          if (slotCount <= 1) return;
          isDragging = true;
          dragStartX = e.clientX;
          dragStartAngle = targetAngle;
          carouselStage.classList.add('is-dragging');
        });

        window.addEventListener('pointermove', (e) => {
          if (!isDragging) return;
          const deltaX = e.clientX - dragStartX;
          targetAngle = dragStartAngle + deltaX * 0.42;
        });

        window.addEventListener('pointerup', () => {
          if (!isDragging) return;
          isDragging = false;
          if (carouselStage) carouselStage.classList.remove('is-dragging');
          targetAngle = Math.round(targetAngle / slotAngleStep) * slotAngleStep;
        });

        window.addEventListener('pointercancel', () => {
          if (!isDragging) return;
          isDragging = false;
          if (carouselStage) carouselStage.classList.remove('is-dragging');
          targetAngle = Math.round(targetAngle / slotAngleStep) * slotAngleStep;
        });
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
