/**
 * Portfolio Application Entry Point (ES Module)
 * Orchestrates modular engines: Rendering, Physics, Navigation, Carousel, Contact, and Effects.
 */

import { Security } from './security.js';
import { FRAME_COUNT, FOCAL_CONFIG, PERF_CONFIG } from './config.js';
import { computeFramingForProgress } from './framing.js';
import {
  detectAssetTier,
  prefetchDestination,
  getFrameState,
} from './frameLoader.js';
import {
  setDebugOverlay,
  getRendererStats,
} from './rendering.js';
import {
  initScrollEngine,
  onNativeScroll,
  onLenisScroll,
  onDebouncedResize,
  resize,
  updateLayoutCaches,
  scrollYToFrame,
  setSubsystemCallbacks,
  setDebug,
  getEngineStats,
} from './scrollEngine.js';
import {
  initSmoothScroll,
  initScrollAnimations,
  scrollToTarget,
  SmoothScrollEngine,
} from './smoothScroll.js';
import {
  initNavigation,
  updateHeaderAndNav,
  closeMobileMenu,
  getTrackedSections,
  setPrefetchCallback,
  NavigationController,
} from './navigation.js';
import { applyProfileHydration, ProfileHydration } from './profile.js';
import { CarouselEngine } from './carousel.js';
import { InquiryController } from './contact.js';
import { SyncAndClipboard } from './sync.js';
import { runPageIntro, initTextRecreation, PageIntro, TextRecreationEngine } from './effects.js';

let hasBootstrapped = false;

export function bootstrap() {
  if (hasBootstrapped) return;
  hasBootstrapped = true;

  // 1. Initial visual sequence & data hydration
  runPageIntro();
  applyProfileHydration();
  initNavigation();
  InquiryController.init();
  SyncAndClipboard.init();
  initTextRecreation();

  // 2. Initialize 3D Cylinder Carousel
  CarouselEngine.init();
  CarouselEngine.renderProjects();

  // 3. Connect subsystems and wire high-performance scroll canvas engine
  setSubsystemCallbacks({
    onScrollNavUpdate: (scrollPos, vpHeight, sectionOffsets) => {
      updateHeaderAndNav(scrollPos, vpHeight, sectionOffsets);
    },
    onCarouselSuspend: () => {
      CarouselEngine.setSuspended(true);
    },
    onCarouselResume: () => {
      CarouselEngine.setSuspended(false);
    },
  });

  setPrefetchCallback((destScrollY) => {
    const destFrame = scrollYToFrame(destScrollY);
    const { targetCanvasW, targetCanvasH } = getFrameState();
    const vpW = window.innerWidth;
    prefetchDestination(destFrame, targetCanvasW, targetCanvasH, vpW);
  });

  const canvas = document.getElementById('scroll-canvas');
  if (canvas) {
    const tracked = getTrackedSections();
    initScrollEngine(canvas, tracked);

    // Global developer & debug tools
    window.__ScrollCanvasEngine = {
      getStats: getEngineStats,
      setDebug,
      setDebugOverlay,
      resize: (force = true) => resize(force, getTrackedSections()),
      updateLayoutCaches: () => updateLayoutCaches(getTrackedSections()),
      onNativeScroll,
      prefetchDestination: (destScrollY) => {
        const destFrame = scrollYToFrame(destScrollY);
        prefetchDestination(destFrame, 1920, 1080, window.innerWidth);
      },
    };
    window.__SCROLL_DEBUG__ = (enabled) => setDebug(enabled);
    window.__SCROLL_OVERLAY__ = (enabled) => setDebugOverlay(enabled);

    window.addEventListener('scroll', onNativeScroll, { passive: true });
    window.addEventListener('resize', onDebouncedResize, { passive: true });

    // Refresh layout cache once web fonts load to guarantee pixel-perfect section offsets
    if (document.fonts && typeof document.fonts.ready === 'object' && typeof document.fonts.ready.then === 'function') {
      document.fonts.ready.then(() => {
        setTimeout(() => {
          updateLayoutCaches(getTrackedSections());
          onNativeScroll();
        }, 60);
      });
    }

    window.addEventListener(
      'load',
      () => {
        setTimeout(() => {
          updateLayoutCaches(getTrackedSections());
          onNativeScroll();
        }, 60);
      },
      { passive: true },
    );

    // Initialize Lenis Smooth Momentum Scroll synchronized with GSAP ScrollTrigger
    initSmoothScroll((e) => {
      onLenisScroll(e);
    });

    // Initialize subtle GSAP scroll-triggered entrance reveals
    initScrollAnimations();
  }

  // 4. Initial cloud sync
  SyncAndClipboard.syncFromCloud();
}

// Global module registry for cross-compatibility
window.Security = Security;
window.NavigationController = NavigationController;
window.ProfileHydration = ProfileHydration;
window.CarouselEngine = CarouselEngine;
window.InquiryController = InquiryController;
window.SyncAndClipboard = SyncAndClipboard;
window.TextRecreationEngine = TextRecreationEngine;
window.PageIntro = PageIntro;
window.SmoothScrollEngine = SmoothScrollEngine;

// Auto-bootstrap on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
