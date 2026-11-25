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

  // 1. Subtle upward fade-in for section headers
  const headers = document.querySelectorAll('.about-title, .skills-head, .projects-head, .services-head, .contact-left');
  headers.forEach((el) => {
    gsap.from(el, {
      scrollTrigger: {
        trigger: el,
        start: 'top 88%',
        toggleActions: 'play none none none',
        once: true,
      },
      opacity: 0,
      y: 28,
      duration: 0.85,
      ease: 'power2.out',
    });
  });

  // 2. About section HUD card, Hologram portrait & Metrics entrance
  const aboutCard = document.querySelector('.about-hud-card');
  const visualCol = document.querySelector('.about-visual-col');
  if (aboutCard) {
    gsap.from(aboutCard, {
      scrollTrigger: {
        trigger: aboutCard,
        start: 'top 85%',
        once: true,
      },
      opacity: 0,
      y: 32,
      duration: 0.95,
      ease: 'power3.out',
    });
  }
  if (visualCol) {
    gsap.from(visualCol, {
      scrollTrigger: {
        trigger: visualCol,
        start: 'top 85%',
        once: true,
      },
      opacity: 0,
      scale: 0.95,
      duration: 1.0,
      ease: 'power3.out',
    });
  }

  const metricCards = document.querySelectorAll('.about-metrics .metric-card');
  if (metricCards.length > 0) {
    gsap.from(metricCards, {
      scrollTrigger: {
        trigger: '.about-metrics',
        start: 'top 88%',
        once: true,
      },
      opacity: 0,
      scale: 0.92,
      y: 20,
      duration: 0.75,
      stagger: 0.12,
      ease: 'power2.out',
    });
  }

  const pillarCards = document.querySelectorAll('.about-pillar-card');
  if (pillarCards.length > 0) {
    gsap.from(pillarCards, {
      scrollTrigger: {
        trigger: '.about-pillars',
        start: 'top 88%',
        once: true,
      },
      opacity: 0,
      y: 26,
      duration: 0.8,
      stagger: 0.15,
      ease: 'power2.out',
    });
  }

  // 3. Technical Skills cards and animated skill progress bars
  const skillItems = document.querySelectorAll('.skill-item');
  if (skillItems.length > 0) {
    gsap.from(skillItems, {
      scrollTrigger: {
        trigger: '.skills-strip',
        start: 'top 85%',
        once: true,
      },
      opacity: 0,
      y: 22,
      duration: 0.7,
      stagger: 0.08,
      ease: 'power2.out',
    });

    document.querySelectorAll('.skill-bar span').forEach((bar) => {
      // Save target width class or style
      const computedW = window.getComputedStyle(bar).width;
      gsap.fromTo(
        bar,
        { width: '0%' },
        {
          scrollTrigger: {
            trigger: bar,
            start: 'top 92%',
            once: true,
          },
          width: computedW,
          duration: 1.1,
          ease: 'power2.out',
        }
      );
    });
  }

  // 4. Projects 3D carousel container entrance
  const carouselContainer = document.getElementById('projects-carousel-container');
  if (carouselContainer) {
    gsap.from(carouselContainer, {
      scrollTrigger: {
        trigger: carouselContainer,
        start: 'top 86%',
        once: true,
      },
      opacity: 0,
      scale: 0.94,
      y: 32,
      duration: 0.95,
      ease: 'power3.out',
    });
  }

  // 5. Services cards staggered reveal
  const expCards = document.querySelectorAll('.exp-card');
  if (expCards.length > 0) {
    gsap.from(expCards, {
      scrollTrigger: {
        trigger: expCards[0],
        start: 'top 86%',
        once: true,
      },
      opacity: 0,
      y: 28,
      duration: 0.75,
      stagger: 0.1,
      ease: 'power2.out',
    });
  }

  // 6. Contact right card stack reveal
  const contactRight = document.querySelector('.contact-right');
  if (contactRight) {
    gsap.from(contactRight, {
      scrollTrigger: {
        trigger: contactRight,
        start: 'top 86%',
        once: true,
      },
      opacity: 0,
      y: 28,
      duration: 0.85,
      ease: 'power2.out',
    });
  }

  // 7. Multi-Plane Cinematic Scroll Parallax for About & Visual Core
  const aboutSection = document.getElementById('about');
  const visualCol = document.querySelector('.about-visual-col');
  if (aboutSection) {
    if (visualCol) {
      gsap.to(visualCol, {
        scrollTrigger: {
          trigger: aboutSection,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 1.15,
        },
        y: -30,
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
        y: 16,
        ease: 'none',
      });
    }
  }

  // 8. Projects Carousel Parallax Gliding Scrub
  const projectsSection = document.getElementById('projects');
  if (projectsSection && carouselContainer) {
    gsap.to(carouselContainer, {
      scrollTrigger: {
        trigger: projectsSection,
        start: 'top bottom',
        end: 'bottom top',
        scrub: 1.0,
      },
      y: -22,
      ease: 'none',
    });
  }

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
