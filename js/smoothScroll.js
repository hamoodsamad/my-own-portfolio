/**
 * Smooth Scrolling & GSAP ScrollTrigger Integration Module
 * Unifies Lenis virtual momentum scrolling with GSAP ScrollTrigger
 * and provides fluid 60/120Hz synchronized scrubbing across laptop/desktop and mobile.
 */

import { REDUCE_MOTION } from './config.js';

let lenisInstance = null;
let isInitialized = false;

/**
 * Updates top cybernetic scroll progress indicator with GPU acceleration
 * @param {number} scrollY Current vertical scroll position
 */
export function updateScrollProgress(scrollY) {
  const progressBar = document.getElementById('scroll-progress-bar');
  if (!progressBar) return;
  const currentY = scrollY !== undefined ? scrollY : (window.scrollY || window.pageYOffset || 0);
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const progress = maxScroll > 0 ? Math.min(1, Math.max(0, currentY / maxScroll)) : 0;
  progressBar.style.width = `${(progress * 100).toFixed(2)}%`;
}

// Auto-attach native scroll listener for immediate hardware-accelerated progress updates
if (typeof window !== 'undefined') {
  window.addEventListener('scroll', () => {
    updateScrollProgress();
  }, { passive: true });
}

/**
 * Initialize Lenis Smooth Scroll and connect with GSAP ticker & ScrollTrigger
 * @param {Function} onScrollCallback Synchronous scroll callback for canvas & nav updates
 * @returns {object|null} Lenis instance or null
 */
export function initSmoothScroll(onScrollCallback) {
  if (isInitialized && lenisInstance) return lenisInstance;
  if (REDUCE_MOTION) return null;

  const LenisClass = window.Lenis;
  if (typeof LenisClass !== 'function') {
    console.warn('[SmoothScroll] Lenis constructor not found on window. Falling back to native scroll.');
    return null;
  }

  // Configure Lenis with tuned momentum damping for butter-smooth gliding
  lenisInstance = new LenisClass({
    duration: 1.22,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    orientation: 'vertical',
    gestureOrientation: 'vertical',
    smoothWheel: true,
    wheelMultiplier: 1.0,
    touchMultiplier: 1.15,
    syncTouch: false,
    infinite: false,
  });

  window.__lenis = lenisInstance;

  // Integrate GSAP & ScrollTrigger if available
  if (window.gsap && window.ScrollTrigger) {
    window.gsap.registerPlugin(window.ScrollTrigger);

    // Update ScrollTrigger and fire callback on Lenis scroll tick
    lenisInstance.on('scroll', (e) => {
      window.ScrollTrigger.update();
      updateScrollProgress(e.scroll);
      if (typeof onScrollCallback === 'function') {
        onScrollCallback(e);
      }
    });

    // Synchronize Lenis execution to GSAP's central high-precision ticker
    window.gsap.ticker.add((time) => {
      lenisInstance.raf(time * 1000);
    });

    // Prevent ticker lag spikes when tab focus shifts
    window.gsap.ticker.lagSmoothing(0);
  } else {
    // Standalone rAF loop for Lenis
    function raf(time) {
      if (lenisInstance) {
        lenisInstance.raf(time);
        requestAnimationFrame(raf);
      }
    }
    requestAnimationFrame(raf);

    lenisInstance.on('scroll', (e) => {
      updateScrollProgress(e.scroll);
      if (typeof onScrollCallback === 'function') {
        onScrollCallback(e);
      }
    });
  }

  isInitialized = true;
  return lenisInstance;
}

export function getLenis() {
  return lenisInstance;
}

/**
 * Smoothly scroll to a DOM selector or coordinate using Lenis
 */
export function scrollToTarget(target, options = {}) {
  if (lenisInstance) {
    lenisInstance.scrollTo(target, {
      offset: options.offset !== undefined ? options.offset : -20,
      duration: options.duration || 1.15,
      easing: options.easing || ((t) => Math.min(1, 1.001 - Math.pow(2, -10 * t))),
      ...options,
    });
    return true;
  }

  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ behavior: 'smooth' });
    return true;
  }
  return false;
}

/**
 * Initialize GSAP ScrollTrigger visual entrance animations
 */
export function initScrollAnimations() {
  if (!window.gsap || !window.ScrollTrigger) return;
  if (REDUCE_MOTION) return;

  const gsap = window.gsap;

  /**
   * Helper: Temporarily suspends CSS transitions on cards during GSAP transform tweens
   * so CSS `transition: transform` never clashes with or freezes GSAP `from` transforms,
   * and clears all inline styles after reveal so CSS hover effects work normally.
   */
  const revealCards = (targets, triggerEl, options = {}) => {
    const els = gsap.utils.toArray(targets);
    if (!els.length) return;
    gsap.from(els, {
      scrollTrigger: {
        trigger: triggerEl || els[0],
        start: options.start || 'top 90%',
        once: true,
      },
      opacity: 0,
      y: options.y ?? 22,
      scale: options.scale ?? 1,
      duration: options.duration ?? 0.72,
      stagger: options.stagger ?? 0,
      ease: options.ease || 'power2.out',
      clearProps: 'transform,opacity,translate,rotate,scale,transition',
      onStart: () => {
        els.forEach((el) => {
          el.style.transition = 'none';
        });
      },
    });
  };

  // 1. Subtle upward fade-in for section headers
  const headers = document.querySelectorAll('.about-title, .skills-head, .projects-head, .services-head, .contact-left');
  headers.forEach((el) => {
    gsap.from(el, {
      scrollTrigger: {
        trigger: el,
        start: 'top 90%',
        toggleActions: 'play none none none',
        once: true,
      },
      opacity: 0,
      y: 24,
      duration: 0.8,
      ease: 'power2.out',
      clearProps: 'transform,opacity',
    });
  });

  // 2. About section HUD card, Hologram core & Metrics entrance
  const aboutCard = document.querySelector('.about-hud-card');
  const visualCol = document.querySelector('.about-visual-col');
  if (aboutCard) {
    revealCards(aboutCard, aboutCard, { y: 26, duration: 0.85, ease: 'power3.out' });
  }
  if (visualCol) {
    revealCards(visualCol, visualCol, { y: 20, scale: 0.96, duration: 0.9, ease: 'power3.out' });
  }

  const aboutMetrics = document.querySelector('.about-metrics');
  const metricCards = document.querySelectorAll('.about-metrics .metric-card');
  if (aboutMetrics && metricCards.length > 0) {
    // Animate opacity cleanly with zero downward shift conflict on the metric pills
    gsap.from(metricCards, {
      scrollTrigger: {
        trigger: aboutMetrics,
        start: 'top 92%',
        once: true,
      },
      opacity: 0,
      duration: 0.65,
      stagger: 0.1,
      ease: 'power2.out',
      clearProps: 'opacity,transform',
    });
  }

  const pillarCards = document.querySelectorAll('.about-pillar-card');
  if (pillarCards.length > 0) {
    revealCards(pillarCards, '.about-pillars', { y: 22, stagger: 0.12 });
  }

  // 3. Technical Skills cards and animated skill progress bars
  const skillItems = document.querySelectorAll('.skill-item');
  if (skillItems.length > 0) {
    revealCards(skillItems, '.skills-strip', { y: 20, stagger: 0.08, duration: 0.68 });

    document.querySelectorAll('.skill-bar span').forEach((bar) => {
      const computedW = window.getComputedStyle(bar).width;
      gsap.fromTo(
        bar,
        { width: '0%' },
        {
          scrollTrigger: {
            trigger: bar,
            start: 'top 94%',
            once: true,
          },
          width: computedW,
          duration: 1.05,
          ease: 'power2.out',
          clearProps: 'width',
        }
      );
    });
  }

  // 4. Projects 3D carousel container entrance
  const carouselContainer = document.getElementById('projects-carousel-container');
  if (carouselContainer) {
    revealCards(carouselContainer, carouselContainer, { y: 26, scale: 0.96, duration: 0.85, ease: 'power3.out' });
  }

  // 5. Services cards staggered reveal
  const expCards = document.querySelectorAll('.exp-card');
  if (expCards.length > 0) {
    revealCards(expCards, expCards[0], { y: 24, stagger: 0.09, duration: 0.72 });
  }

  // 6. Contact right card stack reveal
  const contactRight = document.querySelector('.contact-right');
  if (contactRight) {
    revealCards(contactRight, contactRight, { y: 24, duration: 0.8 });
  }

  // 7. Multi-Plane Cinematic Scroll Parallax (Desktop Side-by-Side Only to Prevent Stacked Mobile Overlap)
  const mm = gsap.matchMedia();
  mm.add('(min-width: 901px)', () => {
    const aboutSection = document.getElementById('about');
    if (aboutSection) {
      if (visualCol) {
        gsap.to(visualCol, {
          scrollTrigger: {
            trigger: aboutSection,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 1.15,
          },
          y: -26,
          ease: 'none',
        });
      }

      if (aboutCard) {
        gsap.to(aboutCard, {
          scrollTrigger: {
            trigger: aboutSection,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 0.95,
          },
          y: 14,
          ease: 'none',
        });
      }
    }

    const projectsSection = document.getElementById('projects');
    if (projectsSection && carouselContainer) {
      gsap.to(carouselContainer, {
        scrollTrigger: {
          trigger: projectsSection,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 1.0,
        },
        y: -18,
        ease: 'none',
      });
    }
  });

  // Initial calculation refresh for all ScrollTriggers
  if (window.ScrollTrigger) {
    window.ScrollTrigger.refresh();
  }
}

export const SmoothScrollEngine = Object.freeze({
  init: initSmoothScroll,
  initAnimations: initScrollAnimations,
  updateProgress: updateScrollProgress,
  scrollTo: scrollToTarget,
  get instance() { return lenisInstance; },
});
