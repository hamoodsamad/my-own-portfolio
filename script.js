(() => {
  /* =========================================
     1. Native-Speed 4K Ultra HD Scroll Canvas Engine
     ========================================= */
  const FRAME_COUNT = 238;
  const FRAME_EASE = 24;
  const SCROLL_ANIM_PACE = 2.1;
  const USE_BITMAP =
    window.location.protocol !== 'file:' && typeof window.createImageBitmap === 'function';

  const canvas = document.getElementById('scroll-canvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  // Permanently pinned device-matched ImageBitmaps — zero eviction, zero scroll decode
  const frames = new Array(FRAME_COUNT).fill(null);

  let width = 0;
  let height = 0;
  let canvasScale = 1;
  let decodeTargetW = 3840;
  let decodeTargetH = 2160;
  let maxScrollCache = 1;
  let cachedSectionOffsets = [];

  let targetFrame = 0;
  let currentFrame = 0;
  let lastRenderedPos = -1;
  let rafId = null;
  let lastTimestamp = 0;

  function frameSrc(index) {
    return `./frames/frame-${String(index + 1).padStart(3, '0')}.webp`;
  }

  function updateLayoutCaches() {
    maxScrollCache = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    cachedSectionOffsets = trackedSections.map((sec) => ({
      id: sec.id,
      top: sec.offsetTop,
    }));
  }

  function scrollYToFrame(scrollY) {
    const progress = Math.min(1, Math.max(0, (scrollY / maxScrollCache) * SCROLL_ANIM_PACE));
    return progress * (FRAME_COUNT - 1);
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    updateLayoutCaches();

    const rawDpr = window.devicePixelRatio || 1;
    // On 4K / 32-inch displays (and Retina displays), scale up to native 2x for razor-sharp pixel fidelity
    canvasScale = Math.min(rawDpr, 2);

    canvas.width = Math.max(1, Math.round(width * canvasScale));
    canvas.height = Math.max(1, Math.round(height * canvasScale));

    const physicalW = Math.round(width * canvasScale);
    const physicalH = Math.round(height * canvasScale);

    // Device-tuned bitmap sizing:
    // Full 4K (3840x2160) for 4K / 32-inch displays and large high-DPI screens
    // 2560x1440 for QHD / 1440p displays
    // 1920x1080 for standard 1080p laptops
    // 1280x720 / 960x540 for tablets & mobile phones
    if (physicalW >= 2560 || physicalH >= 1440) {
      decodeTargetW = 3840;
      decodeTargetH = 2160;
    } else if (physicalW >= 1440 || physicalH >= 900) {
      decodeTargetW = 2560;
      decodeTargetH = 1440;
    } else if (physicalW >= 960) {
      decodeTargetW = 1920;
      decodeTargetH = 1080;
    } else {
      decodeTargetW = 1280;
      decodeTargetH = 720;
    }

    ctx.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    lastRenderedPos = -1;
    renderFrame(currentFrame, true);
  }

  function computeDrawRect(imgW, imgH, framePos) {
    // Pure cover scaling: completely fills the viewport edge-to-edge with no distortion
    const coverScale = Math.max(width / imgW, height / imgH);
    const drawW = imgW * coverScale;
    const drawH = imgH * coverScale;

    // Horizontal centering: Subject is at 50% X in 3840x2160, so this perfectly centers on all devices
    const offsetX = (width - drawW) * 0.5;

    // Vertical positioning:
    // Subject face/eyes are at ~35% from the top of the 16:9 image
    const isPortrait = height > width;
    let offsetY;
    if (isPortrait) {
      // In portrait (mobile & tablet), drawH > height.
      // Align the subject naturally at ~32% of viewport height so the portrait is full life-size,
      // never shrunk, never squeezed, and never cropped into empty space.
      const targetOffsetY = height * 0.32 - drawH * 0.35;
      offsetY = Math.max(height - drawH, Math.min(0, targetOffsetY));
    } else {
      // Landscape (desktop, 32" monitor, laptop): center vertically
      offsetY = (height - drawH) * 0.5;
    }

    return { offsetX, offsetY, drawW, drawH };
  }

  function findNearestFrame(index) {
    if (frames[index]) return index;
    for (let offset = 1; offset < FRAME_COUNT; offset++) {
      if (index - offset >= 0 && frames[index - offset]) return index - offset;
      if (index + offset < FRAME_COUNT && frames[index + offset]) return index + offset;
    }
    return -1;
  }

  function renderFrame(position, force = false) {
    const clamped = Math.min(FRAME_COUNT - 1, Math.max(0, position));
    if (!force && Math.abs(clamped - lastRenderedPos) < 0.002) return;

    const baseIdx = Math.floor(clamped);
    const nextIdx = Math.min(FRAME_COUNT - 1, baseIdx + 1);
    const frac = clamped - baseIdx;

    const resolvedBase = findNearestFrame(baseIdx);
    if (resolvedBase === -1) return;

    const baseImg = frames[resolvedBase];
    const imgW = baseImg.naturalWidth || baseImg.width;
    const imgH = baseImg.naturalHeight || baseImg.height;
    if (!imgW || !imgH) return;

    const { offsetX, offsetY, drawW, drawH } = computeDrawRect(imgW, imgH, clamped);

    ctx.globalAlpha = 1;
    ctx.fillStyle = '#050308';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(baseImg, offsetX, offsetY, drawW, drawH);

    // Sub-frame continuous blending between pinned GPU frames -> silky 60/120fps motion
    if (
      resolvedBase === baseIdx &&
      nextIdx !== baseIdx &&
      frac > 0.02 &&
      frac < 0.98 &&
      frames[nextIdx]
    ) {
      ctx.globalAlpha = frac;
      ctx.drawImage(frames[nextIdx], offsetX, offsetY, drawW, drawH);
      ctx.globalAlpha = 1;
    }

    lastRenderedPos = clamped;
  }

  function tick(timestamp) {
    const dt = lastTimestamp ? Math.min((timestamp - lastTimestamp) / 1000, 0.05) : 1 / 60;
    lastTimestamp = timestamp;

    const frameDelta = targetFrame - currentFrame;
    if (Math.abs(frameDelta) < 0.008) {
      currentFrame = targetFrame;
      renderFrame(currentFrame);
      rafId = null;
      lastTimestamp = 0;
      return;
    }

    const factor = 1 - Math.exp(-FRAME_EASE * dt);
    currentFrame += frameDelta * factor;
    renderFrame(currentFrame);
    rafId = requestAnimationFrame(tick);
  }

  function scheduleLoop() {
    if (rafId === null) {
      lastTimestamp = 0;
      rafId = requestAnimationFrame(tick);
    }
  }

  function onNativeScroll() {
    const y = window.scrollY;
    targetFrame = scrollYToFrame(y);
    scheduleLoop();
    updateHeaderAndNav(y);
  }

  function decodeFrame(index) {
    if (USE_BITMAP) {
      return fetch(frameSrc(index))
        .then((res) => (res.ok ? res.blob() : null))
        .then((blob) => {
          if (!blob) return null;
          if (decodeTargetW < 3840) {
            return createImageBitmap(blob, {
              resizeWidth: decodeTargetW,
              resizeHeight: decodeTargetH,
              resizeQuality: 'high',
            }).catch(() => createImageBitmap(blob));
          }
          return createImageBitmap(blob);
        })
        .then((bm) => {
          if (!bm) return;
          frames[index] = bm;
          if (Math.abs(currentFrame - index) < 2 || lastRenderedPos === -1) {
            renderFrame(currentFrame, true);
          }
        })
        .catch(() => {});
    }

    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      const done = () => {
        frames[index] = img;
        if (Math.abs(currentFrame - index) < 2 || lastRenderedPos === -1) {
          renderFrame(currentFrame, true);
        }
        resolve();
      };
      img.onload = () => {
        if (typeof img.decode === 'function') img.decode().then(done, done);
        else done();
      };
      img.onerror = () => resolve();
      img.src = frameSrc(index);
    });
  }

  function preloadAllFrames() {
    const initialIndex = Math.round(currentFrame);
    const seen = new Set([initialIndex]);
    const queue = [];

    // Interleaved progressive order: 8 -> 4 -> 2 -> 1
    for (const step of [8, 4, 2, 1]) {
      for (let i = 0; i < FRAME_COUNT; i += step) {
        if (!seen.has(i)) {
          seen.add(i);
          queue.push(i);
        }
      }
    }

    decodeFrame(initialIndex).then(() => {
      const CONCURRENCY = 6;
      let cursor = 0;

      function worker() {
        if (cursor >= queue.length) return;
        const idx = queue[cursor++];
        decodeFrame(idx).then(worker);
      }

      for (let i = 0; i < CONCURRENCY; i++) {
        worker();
      }
    });
  }

  /* =========================================
     2. Sticky Header, Scroll Spy & Mobile Menu
     ========================================= */
  const header = document.getElementById('site-header');
  const navToggle = document.getElementById('nav-toggle');
  const mobileMenu = document.getElementById('mobile-menu');
  const navLinks = Array.from(document.querySelectorAll('#desktop-nav a[data-nav]'));
  const trackedSections = ['home', 'about', 'skills', 'projects', 'services', 'contact']
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  let lastHeaderScrolled = false;
  let lastActiveNavId = '';

  function updateHeaderAndNav(scrollPos = window.scrollY) {
    const scrolled = scrollPos > 24;
    if (header && scrolled !== lastHeaderScrolled) {
      lastHeaderScrolled = scrolled;
      header.classList.toggle('is-scrolled', scrolled);
    }

    const probe = scrollPos + height * 0.35;
    let activeId = 'home';
    for (let i = 0; i < cachedSectionOffsets.length; i++) {
      if (probe >= cachedSectionOffsets[i].top) {
        activeId = cachedSectionOffsets[i].id;
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

  if (navToggle && mobileMenu) {
    navToggle.addEventListener('click', () => {
      const willOpen = mobileMenu.hidden;
      mobileMenu.hidden = !willOpen;
      navToggle.setAttribute('aria-expanded', String(willOpen));
    });

    mobileMenu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeMobileMenu);
    });
  }

  /* =========================================
     3. Dynamic Profile Hydration (from Store / Supabase)
     ========================================= */
  const store = window.PortfolioStore;

  function applyProfile(profileData) {
    if (!store) return;
    const profile = profileData || store.getProfile();

    document.querySelectorAll('[data-profile]').forEach((el) => {
      const key = el.dataset.profile;
      if (profile[key]) el.textContent = profile[key];
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
      const url = store.normalizeExternalUrl(profile[key]);
      if (url) el.setAttribute('href', url);
    });

    document.querySelectorAll('[data-profile-mailto]').forEach((el) => {
      const key = el.dataset.profileMailto;
      if (profile[key]) el.setAttribute('href', `mailto:${profile[key]}`);
    });

    document.querySelectorAll('[data-profile-tel]').forEach((el) => {
      const key = el.dataset.profileTel;
      if (profile[key]) {
        const cleanPhone = String(profile[key]).replace(/[^+\d]/g, '');
        el.setAttribute('href', `tel:${cleanPhone}`);
      }
    });
  }

  /* =========================================
     4. Dynamic Projects Section + Filtering
     ========================================= */
  const projectsGrid = document.getElementById('projects-grid');
  const projectFilters = document.getElementById('project-filters');
  let cachedProjects = store ? store.getProjects() : [];
  let activeCategory = 'ALL';

  function renderProjects(listOverride) {
    if (!store || !projectsGrid || !projectFilters) return;
    if (Array.isArray(listOverride)) {
      cachedProjects = listOverride;
    }
    const projects = cachedProjects;

    const categories = ['ALL'];
    projects.forEach((p) => {
      const cat = String(p.category || 'PROJECT').trim().toUpperCase();
      if (cat && !categories.includes(cat)) categories.push(cat);
    });

    if (!categories.includes(activeCategory)) {
      activeCategory = 'ALL';
    }

    projectFilters.innerHTML = '';
    categories.forEach((cat) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `filter-pill${cat === activeCategory ? ' is-active' : ''}`;
      btn.textContent = cat === 'ALL' ? 'All' : cat;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(cat === activeCategory));
      btn.addEventListener('click', () => {
        activeCategory = cat;
        renderProjects();
      });
      projectFilters.appendChild(btn);
    });

    const visible =
      activeCategory === 'ALL'
        ? projects
        : projects.filter(
            (p) => String(p.category || '').trim().toUpperCase() === activeCategory,
          );

    projectsGrid.innerHTML = '';

    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'projects-empty';
      empty.textContent = 'No projects published in this category yet.';
      projectsGrid.appendChild(empty);
      return;
    }

    visible.forEach((proj, idx) => {
      const card = document.createElement('article');
      card.className = 'project-card';

      const thumb = document.createElement('div');
      thumb.className = 'project-thumb';

      const img = document.createElement('img');
      img.src =
        proj.image ||
        'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=900&q=80';
      img.alt = proj.title || 'Project preview';
      img.loading = 'lazy';
      thumb.appendChild(img);

      const badge = document.createElement('span');
      badge.className = 'project-badge';
      badge.textContent = proj.category || 'PROJECT';
      thumb.appendChild(badge);

      const num = document.createElement('span');
      num.className = 'project-index';
      num.textContent = `#${String(idx + 1).padStart(2, '0')}`;
      thumb.appendChild(num);

      const body = document.createElement('div');
      body.className = 'project-body';

      const title = document.createElement('h3');
      title.className = 'project-title';
      title.textContent = proj.title || 'Untitled Project';
      body.appendChild(title);

      const desc = document.createElement('p');
      desc.className = 'project-desc';
      desc.textContent = proj.description || '';
      body.appendChild(desc);

      const footer = document.createElement('div');
      footer.className = 'project-footer';

      const href = store.normalizeExternalUrl(proj.link);
      if (href) {
        const a = document.createElement('a');
        a.className = 'project-link';
        a.href = href;
        if (/^https?:\/\//i.test(href)) {
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        }
        a.innerHTML = '<span>View Project</span><span aria-hidden="true">↗</span>';
        footer.appendChild(a);
      } else {
        const span = document.createElement('span');
        span.className = 'project-link--muted';
        span.textContent = 'Case Study • Selected Work';
        footer.appendChild(span);
      }

      body.appendChild(footer);
      card.appendChild(thumb);
      card.appendChild(body);
      projectsGrid.appendChild(card);
    });

    updateLayoutCaches();
    onNativeScroll();
  }

  /* =========================================
     5. Contact Inquiry Modal + Toasts + Admin Lock
     ========================================= */
  const modal = document.getElementById('contact-modal');
  const modalClose = document.getElementById('modal-close');
  const inquiryForm = document.getElementById('inquiry-form');
  const serviceSelect = document.getElementById('inq-service');
  const toastStack = document.getElementById('toast-stack');

  function showToast(message) {
    if (!toastStack) return;
    const item = document.createElement('div');
    item.className = 'toast';
    item.textContent = message;
    toastStack.appendChild(item);
    setTimeout(() => item.remove(), 3600);
  }

  function openContactModal(serviceName) {
    closeMobileMenu();
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
      closeMobileMenu();
    }
  });

  if (inquiryForm) {
    inquiryForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('inq-name').value.trim();
      const email = document.getElementById('inq-email').value.trim();
      const service = document.getElementById('inq-service').value;
      const details = document.getElementById('inq-details').value.trim();

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

  // Hidden Admin Lock tucked behind HS logo (both Header and Footer)
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

  // Hidden Admin Lock tucked behind bottom (footer) HS logo only
  bindLogoAdminToggle('footer-logo-wrap', 'admin-lock-trigger', 'footer-admin-link');

  let cloudSyncInFlight = false;
  async function syncFromCloud() {
    if (!store || cloudSyncInFlight) return;
    cloudSyncInFlight = true;
    try {
      const [{ profile }, { projects }] = await Promise.all([
        store.fetchProfile(),
        store.fetchProjects(),
      ]);
      if (profile) applyProfile(profile);
      // Always render latest cloud projects (including when 0 projects remain after delete!)
      if (Array.isArray(projects)) {
        renderProjects(projects);
      }
    } catch {
      // Keep local fallback smoothly
    } finally {
      cloudSyncInFlight = false;
    }
  }

  // Real-time live sync: BroadcastChannel + storage + Supabase Realtime + tab focus
  if (store && typeof store.subscribeToLiveUpdates === 'function') {
    store.subscribeToLiveUpdates(() => {
      applyProfile();
      renderProjects(store.getProjects());
      syncFromCloud();
    });
  }

  window.addEventListener('focus', syncFromCloud);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncFromCloud();
  });

  /* =========================================
     6. Hover Text Recreate Engine (Zero Shift)
     ========================================= */
  const UPPER_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const LOWER_CHARS = 'abcdefghijkmnpqrstuvwxyz';
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

  function initTextRecreate() {
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

    function restartClass(node, className) {
      node.classList.remove(className);
      void node.offsetWidth;
      node.classList.add(className);
    }

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

        card.querySelectorAll('[data-recreate-wipe-tags]').forEach((el) => {
          restartClass(el, 'recreate-wipe-delay');
        });
      });
    });
  }

  /* =========================================
     7. Full-Screen Opening Curtain Trigger
     ========================================= */
  function runPageIntro() {
    const intro = document.getElementById('page-intro');
    if (!intro) return;

    const finish = () => {
      intro.classList.add('is-done');
    };

    const startReveal = () => {
      if (intro.classList.contains('is-leaving')) return;
      intro.classList.add('is-leaving');
      setTimeout(finish, 780);
    };

    // Brief sleek black blink (~420ms) then smoothly part curtains to reveal portfolio
    setTimeout(startReveal, 420);
  }

  /* =========================================
     8. Boot
     ========================================= */
  runPageIntro();
  applyProfile();
  renderProjects();
  initTextRecreate();
  syncFromCloud();

  targetFrame = scrollYToFrame(window.scrollY);
  currentFrame = targetFrame;

  resize();
  preloadAllFrames();
  updateHeaderAndNav();

  window.addEventListener('scroll', onNativeScroll, { passive: true });
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener(
    'load',
    () => {
      updateLayoutCaches();
      onNativeScroll();
    },
    { passive: true },
  );
})();
