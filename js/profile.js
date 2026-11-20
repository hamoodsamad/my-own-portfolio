/**
 * Profile Hydration Module
 * Injects dynamic profile data (name, quote, bio, contact links) from PortfolioStore
 * into the DOM with XSS sanitization.
 */

import { Security } from './security.js';

export function applyProfileHydration(profileData) {
  const store = window.PortfolioStore;
  if (!store && !profileData) return;
  const profile = profileData || (store && typeof store.getProfile === 'function' ? store.getProfile() : {});
  if (!profile) return;

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
    const rawUrl = (store && typeof store.normalizeExternalUrl === 'function')
      ? store.normalizeExternalUrl(profile[key])
      : profile[key];
    const safeUrl = Security.sanitizeUrl(rawUrl);
    if (safeUrl) el.setAttribute('href', safeUrl);
  });

  document.querySelectorAll('[data-profile-mailto]').forEach((el) => {
    const key = el.dataset.profileMailto;
    const email = String(profile[key] || '').trim();
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      el.setAttribute('href', `mailto:${email}`);
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

export const ProfileHydration = Object.freeze({
  apply: applyProfileHydration,
});
