/**
 * Visual Effects Module: Glitch Text Recreation & Page Intro Loader
 * Handles cyberpunk-style alphanumeric decryption effect on cards/headings
 * and the sleek page intro curtain reveal.
 */

// --- 1. Page Intro Loader Sequence ---

function run() {
  const intro = document.getElementById('page-intro');
  if (!intro) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    intro.remove();
    return;
  }

  // Hard timeout safety net ensures intro is removed after 2200ms regardless of transition events
  const hardTimeout = setTimeout(() => {
    if (intro && intro.parentNode) {
      intro.remove();
    }
  }, 2200);

  const finish = () => {
    clearTimeout(hardTimeout);
    intro.classList.add('is-done');
    setTimeout(() => {
      if (intro && intro.parentNode) intro.remove();
    }, 400);
  };

  const startReveal = () => {
    if (intro.classList.contains('is-leaving')) return;
    intro.style.pointerEvents = 'none';
    intro.classList.add('is-leaving');
    setTimeout(finish, 780);
  };

  // Brief sleek black blink (~420ms) then smoothly part curtains to reveal portfolio
  setTimeout(startReveal, 420);
}

export function runPageIntro() {
  run();
}

export const PageIntro = Object.freeze({
  run: runPageIntro,
});

// --- 2. Text Recreation / Glitch Engine ---

const UPPER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER_CHARS = 'abcdefghijklmnopqrstuvwxyz';
const DIGIT_CHARS = '0123456789';

function runTextRecreate(targetText, onFrame, durationMs = 1100) {
  let animId = null;
  const startTime = performance.now();
  let lastScrambleTime = 0;
  const scrambleIntervalMs = 28; // ~36 FPS glyph flicker for high-fidelity alphanumeric decryption

  function tick(now) {
    const elapsed = now - startTime;
    const rawProgress = Math.min(1, Math.max(0, elapsed / durationMs));
    // Butter-smooth ease-out power curve: rapid initial decrypt, fluidly settling into final letters
    const easedProgress = Math.pow(rawProgress, 0.78);
    const revealCount = Math.floor(easedProgress * targetText.length);

    if (now - lastScrambleTime >= scrambleIntervalMs || rawProgress >= 1) {
      lastScrambleTime = now;
      const textLen = targetText.length;
      let result = '';

      for (let idx = 0; idx < textLen; idx++) {
        const char = targetText[idx];
        if (idx < revealCount || rawProgress >= 1) {
          result += char;
        } else {
          if (/[A-Z]/.test(char)) {
            result += UPPER_CHARS[Math.floor(Math.random() * UPPER_CHARS.length)];
          } else if (/[a-z]/.test(char)) {
            result += LOWER_CHARS[Math.floor(Math.random() * LOWER_CHARS.length)];
          } else if (/[0-9]/.test(char)) {
            result += DIGIT_CHARS[Math.floor(Math.random() * DIGIT_CHARS.length)];
          } else {
            result += char;
          }
        }
      }
      onFrame(result);
    }

    if (rawProgress < 1) {
      animId = requestAnimationFrame(tick);
    } else {
      onFrame(targetText);
      animId = null;
    }
  }

  animId = requestAnimationFrame(tick);

  return () => {
    if (animId !== null) {
      cancelAnimationFrame(animId);
      animId = null;
    }
  };
}

function restartClass(node, className) {
  if (!node) return;
  node.classList.remove(className);
  requestAnimationFrame(() => {
    node.classList.add(className);
  });
}

/**
 * Programmatically triggers text recreation / scramble on an element
 */
export function triggerTextRecreate(el, durationMs) {
  if (!el) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;

  const original = el.dataset.originalText || (el._liveNode ? el._liveNode.textContent : el.textContent) || '';
  if (!original) return;

  // Initialize liveNode wrapper if not already done
  if (!el._liveNode) {
    setupRecreateTextEl(el);
  }

  const live = el._liveNode;
  if (!live) return;

  if (typeof el._stopTimer === 'function') {
    el._stopTimer();
    el._stopTimer = null;
  }

  restartClass(live, 'recreate-glow');
  const duration = durationMs || Number(el.dataset.duration) || 1100;
  el._stopTimer = runTextRecreate(
    original,
    (next) => {
      live.textContent = next;
    },
    duration
  );
}

/**
 * Sets up accessibility wrapper (.sr-only + .rewrite-wrap) for a data-recreate-text node
 */
function setupRecreateTextEl(el) {
  if (el._liveNode) return;
  const original = el.dataset.originalText || el.textContent.trim();
  el.dataset.originalText = original;

  const srOnly = document.createElement('span');
  srOnly.style.cssText =
    'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';
  srOnly.textContent = original;

  const wrap = document.createElement('span');
  wrap.className = 'rewrite-wrap';
  wrap.setAttribute('aria-hidden', 'true');

  const sizer = document.createElement('span');
  sizer.className = 'rewrite-sizer';
  sizer.textContent = original;

  const live = document.createElement('span');
  live.className = 'rewrite-live';
  live.textContent = original;

  wrap.append(sizer, live);
  el.textContent = '';
  el.append(srOnly, wrap);
  el._liveNode = live;
  el._stopTimer = null;
}

/**
 * Triggers futuristic hologram glitch/scanline and full character reconstruction on the portrait
 */
export function triggerHoloGlitch(holoFrame) {
  if (!holoFrame) return;
  restartClass(holoFrame, 'is-reconstructing');
  restartClass(holoFrame, 'is-glitching');
  const wipe = holoFrame.querySelector('[data-recreate-wipe]');
  if (wipe) restartClass(wipe, 'recreate-wipe');
  holoFrame.querySelectorAll('[data-recreate-text]').forEach((el) => {
    triggerTextRecreate(el, 1100);
  });
}

export function initTextRecreation() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;

  const textEls = document.querySelectorAll('[data-recreate-text]');
  textEls.forEach((el) => {
    setupRecreateTextEl(el);

    // Allow direct hovering on any text element that has data-recreate-text
    el.addEventListener('mouseenter', () => {
      triggerTextRecreate(el);
    });
  });

  // Hero eyebrow click trigger for "Hey, I'm Hamood Samad"
  const heroEyebrow = document.querySelector('.hero-eyebrow[data-recreate-text]');
  if (heroEyebrow) {
    heroEyebrow.style.cursor = 'pointer';
    heroEyebrow.addEventListener('click', () => {
      triggerTextRecreate(heroEyebrow, 1200);
    });
  }

  // Hover and click triggers for cards containing recreate text or wipe elements
  document.querySelectorAll('[data-recreate-card]').forEach((card) => {
    card.addEventListener('mouseenter', () => {
      card.querySelectorAll('[data-recreate-text]').forEach((el) => {
        triggerTextRecreate(el);
      });

      card.querySelectorAll('[data-recreate-wipe]').forEach((el) => {
        restartClass(el, 'recreate-wipe');
      });

      if (card.classList.contains('holo-frame')) {
        triggerHoloGlitch(card);
      }
    });

    card.addEventListener('mouseleave', () => {
      card.querySelectorAll('[data-recreate-text]').forEach((el) => {
        if (typeof el._stopTimer === 'function') {
          el._stopTimer();
          el._stopTimer = null;
        }
        if (el._liveNode && el.dataset.originalText) {
          el._liveNode.textContent = el.dataset.originalText;
        }
      });
    });
  });

  // Holographic Frame click, hover, and viewport trigger for full person recreation
  const holoFrame = document.querySelector('.holo-frame');
  if (holoFrame) {
    const triggerHoloFullRecreate = () => {
      triggerHoloGlitch(holoFrame);
    };

    holoFrame.addEventListener('mouseenter', triggerHoloFullRecreate);
    holoFrame.addEventListener('click', triggerHoloFullRecreate);

    const holoBadge = holoFrame.querySelector('.holo-badge');
    if (holoBadge) {
      holoBadge.style.cursor = 'pointer';
      holoBadge.addEventListener('mouseenter', triggerHoloFullRecreate);
      holoBadge.addEventListener('click', triggerHoloFullRecreate);
    }

    const badgeText = holoFrame.querySelector('.holo-badge-text');
    if (badgeText) {
      badgeText.addEventListener('mouseenter', triggerHoloFullRecreate);
      badgeText.addEventListener('click', triggerHoloFullRecreate);
    }

    if ('IntersectionObserver' in window) {
      const holoObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              triggerHoloGlitch(holoFrame);
              holoObserver.unobserve(holoFrame);
            }
          });
        },
        { threshold: 0.35 }
      );
      holoObserver.observe(holoFrame);
    }
  }
}

export const TextRecreationEngine = Object.freeze({
  init: initTextRecreation,
  trigger: triggerTextRecreate,
  triggerHolo: triggerHoloGlitch,
});
