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
 * Triggers futuristic hologram glitch/scanline animation on the robot portrait
 */
export function triggerHoloGlitch(holoFrame) {
  if (!holoFrame) return;
  restartClass(holoFrame, 'is-glitching');
  const wipe = holoFrame.querySelector('[data-recreate-wipe]');
  if (wipe) restartClass(wipe, 'recreate-wipe');
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

  // Hover triggers for cards containing recreate text or wipe elements
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

  // Holographic Frame trigger on view
  const holoFrame = document.querySelector('.holo-frame');
  if (holoFrame && 'IntersectionObserver' in window) {
    const holoObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            triggerHoloGlitch(holoFrame);
            holoFrame.querySelectorAll('[data-recreate-text]').forEach((el) => {
              triggerTextRecreate(el);
            });
            holoObserver.unobserve(holoFrame);
          }
        });
      },
      { threshold: 0.35 }
    );
    holoObserver.observe(holoFrame);
  }
}

export const TextRecreationEngine = Object.freeze({
  init: initTextRecreation,
  trigger: triggerTextRecreate,
  triggerHolo: triggerHoloGlitch,
});
