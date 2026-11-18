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

    const isPortrait = height > width;

    // Device-tuned bitmap sizing:
    // Full 4K (3840x2160) for 4K / 32-inch desktop monitors (physical width >= 2560)
    // 2560x1440 for QHD desktop displays and large tablets
    // 1920x1080 for standard laptops and high-density mobile phones (ultra-sharp, zero stutter)
    // 1280x720 for compact mobile phones (instant, lightweight 60-120fps)
    if (!isPortrait && (physicalW >= 2560 || width >= 1920)) {
      decodeTargetW = 3840;
      decodeTargetH = 2160;
    } else if (!isPortrait && (physicalW >= 1440 || width >= 1200)) {
      decodeTargetW = 2560;
      decodeTargetH = 1440;
    } else if (width >= 768 || physicalW >= 720 || physicalH >= 1280) {
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
    const targetIdx = Math.round(clamped);
    if (!force && targetIdx === lastRenderedPos) return;

    const resolvedBase = findNearestFrame(targetIdx);
    if (resolvedBase === -1) return;

    const baseImg = frames[resolvedBase];
    const imgW = baseImg.naturalWidth || baseImg.width;
    const imgH = baseImg.naturalHeight || baseImg.height;
    if (!imgW || !imgH) return;

    const { offsetX, offsetY, drawW, drawH } = computeDrawRect(imgW, imgH, clamped);

    ctx.globalAlpha = 1;
    ctx.fillStyle = '#050308';
    ctx.fillRect(0, 0, width, height);
    // Draw 100% crisp single master 4K frame — zero ghosting, zero double-edge blur
    ctx.drawImage(baseImg, offsetX, offsetY, drawW, drawH);

    lastRenderedPos = targetIdx;
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
          // Decode full uncompressed 4K master bitmap directly — zero downsampling blur!
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
     4. Dynamic 3D Revolving Circular Projects Engine + Category Dropdown
     ========================================= */
  const categorySelectBtn = document.getElementById('category-select-btn');
  const categoryMenu = document.getElementById('category-menu');
  const catBtnLabel = document.getElementById('cat-btn-label');

  const carouselStage = document.getElementById('carousel-stage');
  const carouselCylinder = document.getElementById('carousel-cylinder');
  const carouselPrevBtn = document.getElementById('carousel-prev-btn');
  const carouselNextBtn = document.getElementById('carousel-next-btn');
  const carouselDots = document.getElementById('carousel-dots');

  let cachedProjects = store ? store.getProjects() : [];
  let activeCategory = 'ALL';

  // 3D Cylinder Carousel physics & animation state
  let carouselItems = [];
  let currentAngle = 0;
  let targetAngle = 0;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartAngle = 0;
  let isHovered = false;
  let autoSpinSpeed = 0.16; // Naturally brisk, smooth 360° spin
  let carouselRaf = null;
  let slotCount = 1;
  let slotAngleStep = 360;

  function formatCategoryTitle(cat) {
    if (cat === 'ALL') return 'All Categories';
    return cat
      .toLowerCase()
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  function renderCategoryDropdown(categories, projects) {
    if (!categoryMenu || !categorySelectBtn || !catBtnLabel) return;

    categoryMenu.innerHTML = '';
    categories.forEach((cat) => {
      const count =
        cat === 'ALL'
          ? projects.length
          : projects.filter(
              (p) => String(p.category || '').trim().toUpperCase() === cat,
            ).length;

      const itemBtn = document.createElement('button');
      itemBtn.type = 'button';
      itemBtn.className = `category-item${cat === activeCategory ? ' is-active' : ''}`;
      itemBtn.setAttribute('role', 'menuitem');

      const nameSpan = document.createElement('span');
      nameSpan.textContent = formatCategoryTitle(cat);

      const countBadge = document.createElement('span');
      countBadge.className = 'cat-count-badge';
      countBadge.textContent = String(count);

      itemBtn.appendChild(nameSpan);
      itemBtn.appendChild(countBadge);

      itemBtn.addEventListener('click', () => {
        activeCategory = cat;
        catBtnLabel.textContent = formatCategoryTitle(cat);
        closeCategoryMenu();
        renderProjects();
      });

      categoryMenu.appendChild(itemBtn);
    });

    catBtnLabel.textContent = formatCategoryTitle(activeCategory);
  }

  function toggleCategoryMenu() {
    if (!categoryMenu || !categorySelectBtn) return;
    const isExpanded = categorySelectBtn.getAttribute('aria-expanded') === 'true';
    if (isExpanded) {
      closeCategoryMenu();
    } else {
      openCategoryMenu();
    }
  }

  function openCategoryMenu() {
    if (!categoryMenu || !categorySelectBtn) return;
    categorySelectBtn.setAttribute('aria-expanded', 'true');
    categoryMenu.hidden = false;
  }

  function closeCategoryMenu() {
    if (!categoryMenu || !categorySelectBtn) return;
    categorySelectBtn.setAttribute('aria-expanded', 'false');
    categoryMenu.hidden = true;
  }

  if (categorySelectBtn) {
    categorySelectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCategoryMenu();
    });
  }

  document.addEventListener('click', (e) => {
    if (
      categoryMenu &&
      !categoryMenu.hidden &&
      !categoryMenu.contains(e.target) &&
      !categorySelectBtn.contains(e.target)
    ) {
      closeCategoryMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && categoryMenu && !categoryMenu.hidden) {
      closeCategoryMenu();
    }
  });

  function updateCarouselPhysics() {
    if (!carouselCylinder || carouselItems.length === 0) return;

    if (!isDragging && !isHovered && slotCount > 1) {
      targetAngle -= autoSpinSpeed;
    }

    // Smooth elastic lerp towards target angle
    const diff = targetAngle - currentAngle;
    currentAngle += diff * 0.14;

    carouselCylinder.style.transform = `rotateY(${currentAngle}deg)`;

    const halfStep = slotAngleStep / 2;
    let closestIndex = 0;
    let minAngularDist = 999;

    carouselItems.forEach((item, idx) => {
      // Calculate normalized angle relative to viewer (-180 to +180)
      const rawTheta = (item.baseAngle + currentAngle) % 360;
      const theta = ((rawTheta + 540) % 360) - 180;
      const absTheta = Math.abs(theta);

      const rad = (theta * Math.PI) / 180;
      const cosVal = Math.cos(rad);

      // Facing front: within half a step
      const isFront = absTheta <= halfStep;
      item.el.classList.toggle('is-active', isFront);

      if (absTheta < minAngularDist) {
        minAngularDist = absTheta;
        closestIndex = item.projectIndex;
      }

      // Smooth depth perspective: front card full opacity, back cards curve gracefully into depth
      const depthOpacity = Math.max(0.35, Math.min(1, 0.4 + 0.6 * cosVal));
      const depthBrightness = Math.max(0.42, Math.min(1, 0.45 + 0.55 * cosVal));

      item.el.style.opacity = String(depthOpacity);
      item.el.style.filter = `brightness(${depthBrightness.toFixed(2)})`;
      item.el.style.pointerEvents = isFront ? 'auto' : 'none';
    });

    // Update pagination dots
    if (carouselDots) {
      const dots = carouselDots.querySelectorAll('.carousel-dot');
      dots.forEach((dot, dIdx) => {
        dot.classList.toggle('is-active', dIdx === closestIndex);
      });
    }

    carouselRaf = requestAnimationFrame(updateCarouselPhysics);
  }

  function startCarouselLoop() {
    if (carouselRaf === null) {
      carouselRaf = requestAnimationFrame(updateCarouselPhysics);
    }
  }

  function stopCarouselLoop() {
    if (carouselRaf !== null) {
      cancelAnimationFrame(carouselRaf);
      carouselRaf = null;
    }
  }

  function rotateToProjectIndex(targetIdx) {
    if (slotCount <= 1) return;
    const item = carouselItems.find((it) => it.projectIndex === targetIdx);
    if (!item) return;

    const rawTheta = (item.baseAngle + targetAngle) % 360;
    const theta = ((rawTheta + 540) % 360) - 180;
    targetAngle -= theta;
  }

  function renderProjects(listOverride) {
    if (!store || !carouselCylinder) return;
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

    renderCategoryDropdown(categories, projects);

    const visible =
      activeCategory === 'ALL'
        ? projects
        : projects.filter(
            (p) => String(p.category || '').trim().toUpperCase() === activeCategory,
          );

    stopCarouselLoop();
    carouselCylinder.innerHTML = '';
    carouselItems = [];

    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'projects-empty';
      empty.textContent = 'No projects published in this category yet.';
      carouselCylinder.appendChild(empty);
      if (carouselDots) carouselDots.innerHTML = '';
      return;
    }

    // Determine circular slot repetition so the circle is rich and continuous (min 4 slots for 3D orbit)
    let slots = [];
    if (visible.length >= 4) {
      slots = visible.map((p, idx) => ({ project: p, projectIndex: idx }));
    } else if (visible.length === 3) {
      slots = [
        ...visible.map((p, idx) => ({ project: p, projectIndex: idx })),
        ...visible.map((p, idx) => ({ project: p, projectIndex: idx })),
      ];
    } else if (visible.length === 2) {
      slots = [
        ...visible.map((p, idx) => ({ project: p, projectIndex: idx })),
        ...visible.map((p, idx) => ({ project: p, projectIndex: idx })),
        ...visible.map((p, idx) => ({ project: p, projectIndex: idx })),
      ];
    } else {
      slots = [{ project: visible[0], projectIndex: 0 }];
    }

    slotCount = slots.length;
    slotAngleStep = 360 / slotCount;

    // Radius calculation for 3D cylinder (compact normal size)
    const isMobile = window.innerWidth <= 600;
    const isTablet = window.innerWidth <= 768;
    const cardWidth = isMobile ? 210 : isTablet ? 240 : 270;

    let radius = 0;
    if (slotCount >= 3) {
      const radPerSlot = (Math.PI / slotCount);
      const computedR = (cardWidth / 2) / Math.tan(radPerSlot);
      radius = Math.max(isMobile ? 180 : 220, Math.round(computedR + (isMobile ? 15 : 25)));
    }

    slots.forEach((slot, sIdx) => {
      const baseAngle = sIdx * slotAngleStep;
      const proj = slot.project;

      const card = document.createElement('article');
      card.className = 'carousel-card';
      card.style.transform = `rotateY(${baseAngle}deg) translateZ(${radius}px)`;

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
      num.textContent = `#${String(slot.projectIndex + 1).padStart(2, '0')}`;
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

      // Clicking a card rotates it directly to the front
      card.addEventListener('click', (e) => {
        if (card.classList.contains('is-active')) return;
        rotateToProjectIndex(slot.projectIndex);
      });

      carouselCylinder.appendChild(card);
      carouselItems.push({
        el: card,
        baseAngle,
        projectIndex: slot.projectIndex,
      });
    });

    // Render pagination dots for each unique visible project
    if (carouselDots) {
      carouselDots.innerHTML = '';
      visible.forEach((_, vIdx) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = `carousel-dot${vIdx === 0 ? ' is-active' : ''}`;
        dot.setAttribute('role', 'tab');
        dot.setAttribute('aria-label', `Go to project ${vIdx + 1}`);
        dot.addEventListener('click', () => {
          rotateToProjectIndex(vIdx);
        });
        carouselDots.appendChild(dot);
      });
    }

    startCarouselLoop();
    updateLayoutCaches();
    onNativeScroll();
  }

  // Prev / Next Button Controls
  if (carouselPrevBtn) {
    carouselPrevBtn.addEventListener('click', () => {
      targetAngle += slotAngleStep;
    });
  }

  if (carouselNextBtn) {
    carouselNextBtn.addEventListener('click', () => {
      targetAngle -= slotAngleStep;
    });
  }

  // Pointer Drag & Touch Swipe Controls for 360° Circular Rotation
  if (carouselStage) {
    carouselStage.addEventListener('pointerenter', () => {
      isHovered = true;
    });

    carouselStage.addEventListener('pointerleave', () => {
      isHovered = false;
      if (isDragging) {
        isDragging = false;
        carouselStage.classList.remove('is-dragging');
        targetAngle = Math.round(targetAngle / slotAngleStep) * slotAngleStep;
      }
    });

    carouselStage.addEventListener('pointerdown', (e) => {
      if (slotCount <= 1) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartAngle = targetAngle;
      carouselStage.classList.add('is-dragging');
    });

    window.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - dragStartX;
      targetAngle = dragStartAngle + deltaX * 0.42;
    });

    window.addEventListener('pointerup', () => {
      if (!isDragging) return;
      isDragging = false;
      if (carouselStage) carouselStage.classList.remove('is-dragging');
      // Snap to closest slot
      targetAngle = Math.round(targetAngle / slotAngleStep) * slotAngleStep;
    });

    window.addEventListener('pointercancel', () => {
      if (!isDragging) return;
      isDragging = false;
      if (carouselStage) carouselStage.classList.remove('is-dragging');
      targetAngle = Math.round(targetAngle / slotAngleStep) * slotAngleStep;
    });
  }

  /* =========================================
     5. Contact Inquiry Modal + Toasts + Admin Lock + Phone Copy
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

  // Desktop / Laptop Only: Phone Number Copy to Clipboard with Toast Feedback
  const phoneCard = document.querySelector('[data-profile-tel="phone"]');
  if (phoneCard) {
    phoneCard.addEventListener('click', (e) => {
      const isMobile =
        /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        ('ontouchstart' in window && window.innerWidth <= 768);

      if (!isMobile) {
        // Laptop / Desktop: copy phone number to clipboard instantly
        e.preventDefault();
        const phoneValEl = phoneCard.querySelector('[data-profile="phone"]');
        const rawPhone = phoneValEl ? phoneValEl.textContent.trim() : '+92 343 6956890';

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
      // On mobile / phones: Native tel: protocol opens the phone dialer naturally!
    });
  }

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
