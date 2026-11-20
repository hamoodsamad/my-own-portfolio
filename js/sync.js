/**
 * Sync Status & Clipboard Module
 * Handles clipboard copying for phone/email with toast feedback,
 * and live cloud data synchronization with Supabase.
 */

import { showToast } from './contact.js';
import { applyProfileHydration } from './profile.js';
import { renderProjects } from './carousel.js';


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
          // B7 Fix: Read phone number dynamically from DOM, store, or tel link without hardcoding
          const phoneValEl = phoneCard.querySelector('[data-profile="phone"]');
          let rawPhone = phoneValEl ? phoneValEl.textContent.trim() : '';

          if (!rawPhone && store && typeof store.getProfile === 'function') {
            const profile = store.getProfile();
            rawPhone = profile && profile.phone ? String(profile.phone).trim() : '';
          }

          if (!rawPhone) {
            const telHref = phoneCard.getAttribute('href');
            if (telHref && telHref.startsWith('tel:')) {
              rawPhone = telHref.replace('tel:', '').trim();
            }
          }

          if (!rawPhone) {
            showToast('Phone number could not be copied.');
            return;
          }

          const notifySuccess = () => {
            showToast(`Phone number copied to clipboard: ${rawPhone}`);
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
    let lastCloudSyncTime = 0;
    let lastCachedProfileHash = '';
    let lastCachedProjectsHash = '';

    // B8 Fix: 15-second debounce and data-hash change comparison before re-rendering
    async function syncFromCloud() {
      if (!store || cloudSyncInFlight) return;
      const now = performance.now();
      if (now - lastCloudSyncTime < 15000) return;
      cloudSyncInFlight = true;
      lastCloudSyncTime = now;

      try {
        const fetchProf = typeof store.fetchProfile === 'function' ? store.fetchProfile() : Promise.resolve({});
        const fetchProj = typeof store.fetchProjects === 'function' ? store.fetchProjects() : Promise.resolve({});
        const [profileRes, projectsRes] = await Promise.all([fetchProf, fetchProj]);

        const profile = profileRes && profileRes.profile ? profileRes.profile : null;
        const projects = projectsRes && Array.isArray(projectsRes.projects) ? projectsRes.projects : null;

        if (profile) {
          const profHash = JSON.stringify(profile);
          if (profHash !== lastCachedProfileHash) {
            lastCachedProfileHash = profHash;
            applyProfileHydration(profile);
          }
        }

        if (projects) {
          const projHash = JSON.stringify(projects);
          if (projHash !== lastCachedProjectsHash) {
            lastCachedProjectsHash = projHash;
            renderProjects(projects);
          }
        }
      } catch (err) {
        console.warn('[SyncAndClipboard] Cloud sync skipped or failed:', err);
      } finally {
        cloudSyncInFlight = false;
      }
    }

    function initSync() {
      if (store && typeof store.subscribeToLiveUpdates === 'function') {
        store.subscribeToLiveUpdates(() => {
          applyProfileHydration();
          renderProjects(store.getProjects ? store.getProjects() : []);
          syncFromCloud();
        });
      }

      window.addEventListener('focus', syncFromCloud);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') syncFromCloud();
      });
    }


export function init() {
  initClipboard();
  initSync();
}

export {
  syncFromCloud,
};

export const SyncAndClipboard = Object.freeze({
  init,
  syncFromCloud,
});
