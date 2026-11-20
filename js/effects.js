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

      // B11 Fix: Hard timeout safety net ensures intro is removed after 2200ms regardless of transition events
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
        // B11 Fix: Immediately allow pointer events to pass through once leaving
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
function textEngineScope() {

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
      // B10 Fix: Disable text scramble effect for prefers-reduced-motion and touch devices
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.innerWidth < 1024);
      if (reduceMotion || isTouch) return;

      const textEls = document.querySelectorAll('[data-recreate-text]');
      textEls.forEach((el) => {
        const original = el.textContent;
        el.dataset.originalText = original;

        // B10 Fix: Screen reader accessibility: static text in .sr-only span, scramble node aria-hidden
        const srOnly = document.createElement('span');
        srOnly.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';
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
      });

      document.querySelectorAll('[data-recreate-card]').forEach((card) => {
        card.addEventListener('mouseenter', () => {
          card.querySelectorAll('[data-recreate-text]').forEach((el) => {
            const original = el.dataset.originalText || '';
            const live = el._liveNode;
            if (!live || !original) return;
            // B10 Fix: Clean up existing timer before starting new one
            if (typeof el._stopTimer === 'function') {
              el._stopTimer();
              el._stopTimer = null;
            }

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

        // B10 Fix: Cleanup timers and restore stable text on fast mouseleave
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
    }

  return { init };
}

const _textEngine = textEngineScope();

export function initTextRecreation() {
  _textEngine.init();
}

export const TextRecreationEngine = Object.freeze({
  init: initTextRecreation,
});
