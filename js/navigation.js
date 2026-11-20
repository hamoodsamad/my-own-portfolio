/**
 * Navigation & Header Controller Module
 * Manages sticky navbar blur on scroll, scroll-spy active section highlighting,
 * smooth anchor link navigation with destination frame prefetching, and mobile drawer menu.
 */

let header = null;
let navToggle = null;
let mobileMenu = null;
let navLinks = [];
let trackedSections = [];

let lastHeaderScrolled = false;
let lastActiveNavId = '';

let prefetchCallback = null;

export function setPrefetchCallback(cb) {
  prefetchCallback = cb;
}

export function getTrackedSections() {
  if (trackedSections.length === 0) {
    trackedSections = ['home', 'about', 'skills', 'projects', 'services', 'contact']
      .map((id) => document.getElementById(id))
      .filter(Boolean);
  }
  return trackedSections;
}

export function updateHeaderAndNav(scrollPos = 0, vpHeight = 720, sectionOffsets = []) {
  if (!header) header = document.getElementById('site-header');
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
    if (navLinks.length === 0) {
      navLinks = Array.from(document.querySelectorAll('#desktop-nav a[data-nav]'));
    }
    navLinks.forEach((link) => {
      link.classList.toggle('is-active', link.dataset.nav === activeId);
    });
  }
}

export function closeMobileMenu() {
  if (!mobileMenu || !navToggle) return;
  mobileMenu.hidden = true;
  navToggle.setAttribute('aria-expanded', 'false');
}

export function initNavigation() {
  header = document.getElementById('site-header');
  navToggle = document.getElementById('nav-toggle');
  mobileMenu = document.getElementById('mobile-menu');
  navLinks = Array.from(document.querySelectorAll('#desktop-nav a[data-nav]'));
  getTrackedSections();

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

          if (typeof prefetchCallback === 'function') {
            prefetchCallback(destScrollY);
          } else if (typeof window.ScrollCanvasEngine !== 'undefined' && typeof window.ScrollCanvasEngine.prefetchDestination === 'function') {
            window.ScrollCanvasEngine.prefetchDestination(destScrollY);
          }

          targetEl.scrollIntoView({ behavior: 'smooth' });
          if (mobileMenu && !mobileMenu.hidden) closeMobileMenu();
        }
      }
    });
  });
}

export const NavigationController = Object.freeze({
  init: initNavigation,
  closeMobileMenu,
  updateHeaderAndNav,
  get trackedSections() { return getTrackedSections(); },
});
