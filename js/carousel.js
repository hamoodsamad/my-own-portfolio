/**
 * 3D Cylinder Interactive Carousel Engine Module
 * Manages 3D cylinder revolving physics, pointer touch/drag momentum,
 * dynamic project card rendering, and performance suspension during scroll.
 */

import { Security } from './security.js';


    const store = window.PortfolioStore;
    const categoryMenu = document.getElementById('category-menu');
    const categorySelectBtn = document.getElementById('category-select-btn');
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
    let hasDragged = false;
    let activePointerId = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartAngle = 0;
    let isHovered = false;
    const autoSpinSpeed = 0.16; // 360° spin speed
    let carouselRaf = null;
    let lastCarouselTime = 0;
    let slotCount = 1;
    let slotAngleStep = 360;
    let lastCylinderCardW = -1;
    let cachedDotEls = [];
    let lastClosestIndex = -1;
    let isCarouselInView = false;
    let carouselObserver = null;
    let isScrollSuspended = false;

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
          currentAngle = 0;
          targetAngle = 0;
          lastClosestIndex = -1;
          if (carouselCylinder) {
            carouselCylinder.style.transform = 'rotateY(0deg)';
          }
          renderProjects();
        });

        categoryMenu.appendChild(itemBtn);
      });
    }

    function toggleCategoryMenu() {
      if (!categoryMenu || !categorySelectBtn) return;
      const isExpanded = categorySelectBtn.getAttribute('aria-expanded') === 'true';
      categorySelectBtn.setAttribute('aria-expanded', String(!isExpanded));
      categoryMenu.hidden = isExpanded;
    }

    function closeCategoryMenu() {
      if (!categoryMenu || !categorySelectBtn) return;
      categorySelectBtn.setAttribute('aria-expanded', 'false');
      categoryMenu.hidden = true;
    }

    function updateCarouselPhysics(timestamp) {
      if (isScrollSuspended || !isCarouselInView || !carouselCylinder || carouselItems.length === 0) {
        carouselRaf = null;
        lastCarouselTime = 0;
        return;
      }

      // If category contains only 1 project, keep it fixed front-and-center (0deg) with full visibility
      if (slotCount <= 1) {
        currentAngle = 0;
        targetAngle = 0;
        carouselCylinder.style.transform = 'rotateY(0deg)';
        if (carouselItems[0]) {
          const item = carouselItems[0];
          item.el.style.transform = 'rotateY(0deg) translateZ(0px)';
          item.el.style.visibility = 'visible';
          item.el.style.pointerEvents = 'auto';
          item.el.classList.add('is-active');
          item.el.style.opacity = '1';
          item.el.style.setProperty('--card-opacity', '1');
        }
        carouselRaf = null;
        lastCarouselTime = 0;
        return;
      }

      // Delta-time based calculation for identical speed on 60Hz and 120Hz displays
      const dt = lastCarouselTime ? Math.min((timestamp - lastCarouselTime) / 1000, 1 / 30) : 1 / 60;
      lastCarouselTime = timestamp;

      if (!isDragging && !isHovered && slotCount > 1) {
        targetAngle -= autoSpinSpeed * (dt * 60);
      }

      // Delta-time based exponential lerp: factor = 1 - exp(-rate * dt)
      const lerpFactor = 1 - Math.exp(-8.5 * dt);
      currentAngle += (targetAngle - currentAngle) * lerpFactor;

      carouselCylinder.style.transform = `rotateY(${currentAngle}deg)`;

      const halfStep = slotAngleStep / 2;
      let closestIndex = 0;
      let minAngularDist = 999;

      const itemCount = carouselItems.length;
      for (let i = 0; i < itemCount; i++) {
        const item = carouselItems[i];
        const rawTheta = (item.baseAngle + currentAngle) % 360;
        const theta = ((rawTheta + 540) % 360) - 180;
        const absTheta = Math.abs(theta);

        const rad = (theta * Math.PI) / 180;
        const cosVal = Math.cos(rad);

        // Backface Culling: Cull cards facing away from viewer (cosVal < -0.05)
        if (cosVal < -0.05) {
          if (item.isVisible) {
            item.el.style.visibility = 'hidden';
            item.el.style.pointerEvents = 'none';
            item.isVisible = false;
          }
          continue;
        }

        if (!item.isVisible) {
          item.el.style.visibility = '';
          item.isVisible = true;
        }

        const isFront = absTheta <= halfStep;
        if (item.isActive !== isFront) {
          item.isActive = isFront;
          item.el.classList.toggle('is-active', isFront);
          item.el.style.pointerEvents = isFront ? 'auto' : 'none';
        }

        if (absTheta < minAngularDist) {
          minAngularDist = absTheta;
          closestIndex = item.projectIndex;
        }

        // Depth opacity: quantized to reduce repaints, applied via CSS variable & style
        const depthOpacity = Math.round(Math.max(0.35, Math.min(1, 0.4 + 0.6 * cosVal)) * 100) / 100;
        if (Math.abs(item.lastOpacity - depthOpacity) >= 0.02) {
          item.lastOpacity = depthOpacity;
          const opStr = depthOpacity.toFixed(2);
          item.el.style.setProperty('--card-opacity', opStr);
          item.el.style.opacity = opStr;
        }
      }

      if (closestIndex !== lastClosestIndex && cachedDotEls.length > 0) {
        if (lastClosestIndex >= 0 && cachedDotEls[lastClosestIndex]) {
          cachedDotEls[lastClosestIndex].classList.remove('is-active');
        }
        if (cachedDotEls[closestIndex]) {
          cachedDotEls[closestIndex].classList.add('is-active');
        }
        lastClosestIndex = closestIndex;
      }

      carouselRaf = requestAnimationFrame(updateCarouselPhysics);
    }

    function startCarouselLoop() {
      if (isScrollSuspended) return;
      if (carouselRaf === null && isCarouselInView) {
        lastCarouselTime = 0;
        carouselRaf = requestAnimationFrame(updateCarouselPhysics);
      }
    }

    function stopCarouselLoop() {
      if (carouselRaf !== null) {
        cancelAnimationFrame(carouselRaf);
        carouselRaf = null;
        lastCarouselTime = 0;
      }
    }

    function setSuspended(suspended) {
      if (isScrollSuspended === suspended) return;
      isScrollSuspended = suspended;
      if (isScrollSuspended) {
        stopCarouselLoop();
      } else if (isCarouselInView) {
        startCarouselLoop();
      }
    }

    function initVisibilityObserver() {
      const container = document.getElementById('projects-carousel-container') || document.getElementById('projects');
      if (!container) {
        isCarouselInView = true;
        startCarouselLoop();
        return;
      }

      if ('IntersectionObserver' in window) {
        if (carouselObserver) {
          carouselObserver.disconnect();
        }
        carouselObserver = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              isCarouselInView = entry.isIntersecting;
              if (isCarouselInView) {
                startCarouselLoop();
              } else {
                stopCarouselLoop();
              }
            });
          },
          { threshold: 0.05 },
        );
        carouselObserver.observe(container);
      } else {
        isCarouselInView = true;
        startCarouselLoop();
      }
    }

    function getResponsiveCardDimensions() {
      const vpW = window.innerWidth;
      if (vpW <= 480) {
        return { cardWidth: Math.min(220, Math.round(vpW * 0.72)), cardHeight: 330, minRadius: 155 };
      } else if (vpW <= 768) {
        return { cardWidth: 235, cardHeight: 345, minRadius: 195 };
      } else if (vpW <= 1024) {
        return { cardWidth: 260, cardHeight: 365, minRadius: 235 };
      } else {
        return { cardWidth: 280, cardHeight: 380, minRadius: 265 };
      }
    }

    function rotateToProjectIndex(targetIdx) {
      const targetItem = carouselItems.find((item) => item.projectIndex === targetIdx);
      if (!targetItem) return;

      const rawTheta = (targetItem.baseAngle + currentAngle) % 360;
      const theta = ((rawTheta + 540) % 360) - 180;
      targetAngle = targetAngle - theta;
      if (isCarouselInView) startCarouselLoop();
    }

    function renderProjects(projectsToRender) {
      if (!carouselCylinder) return;

      if (projectsToRender && Array.isArray(projectsToRender)) {
        cachedProjects = projectsToRender;
      } else if (store && typeof store.getProjects === 'function') {
        cachedProjects = store.getProjects();
      }

      const allCategories = ['ALL'];
      cachedProjects.forEach((p) => {
        const cat = String(p.category || '').trim().toUpperCase();
        if (cat && !allCategories.includes(cat)) {
          allCategories.push(cat);
        }
      });
      renderCategoryDropdown(allCategories, cachedProjects);

      const visible =
        activeCategory === 'ALL'
          ? cachedProjects
          : cachedProjects.filter(
              (p) => String(p.category || '').trim().toUpperCase() === activeCategory,
            );

      carouselCylinder.innerHTML = '';
      carouselItems = [];
      // B3 Fix: Reset lastClosestIndex on project/category change to keep dots synchronized
      lastClosestIndex = -1;
      currentAngle = 0;
      targetAngle = 0;
      if (carouselCylinder) {
        carouselCylinder.style.transform = 'rotateY(0deg)';
      }

      if (!visible || visible.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'carousel-empty';
        emptyMsg.textContent = 'No projects found in this category.';
        carouselCylinder.appendChild(emptyMsg);
        if (carouselDots) carouselDots.innerHTML = '';
        cachedDotEls = [];
        return;
      }

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

      const { cardWidth, cardHeight, minRadius } = getResponsiveCardDimensions();
      carouselCylinder.style.width = `${cardWidth}px`;
      carouselCylinder.style.height = `${cardHeight}px`;

      let radius = 0;
      if (slotCount >= 3) {
        const radPerSlot = Math.PI / slotCount;
        const computedR = (cardWidth / 2) / Math.tan(radPerSlot);
        radius = Math.max(minRadius, Math.round(computedR + 15));
      }

      slots.forEach((slot, sIdx) => {
        const baseAngle = sIdx * slotAngleStep;
        const proj = slot.project || {};

        const card = document.createElement('article');
        card.className = `carousel-card${slotCount <= 1 ? ' is-active' : ''}`;
        card.style.width = `${cardWidth}px`;
        card.style.height = `${cardHeight}px`;
        card.style.transform = slotCount <= 1
          ? 'rotateY(0deg) translateZ(0px)'
          : `rotateY(${baseAngle}deg) translateZ(${radius}px)`;
        card.style.setProperty('--card-opacity', '1');
        card.style.opacity = '1';
        card.style.visibility = 'visible';
        if (slotCount <= 1) {
          card.style.pointerEvents = 'auto';
        }

        const imgSrc = Security.sanitizeImageUrl(proj.image);
        const imgAlt = proj.title || 'Project preview';
        const categoryText = proj.category || 'PROJECT';
        const indexNum = `#${String(slot.projectIndex + 1).padStart(2, '0')}`;
        const titleText = proj.title || 'Untitled Project';
        const descText = proj.description || '';

        // Build card DOM with createElement & textContent (zero XSS risk, valid markup)
        const thumb = document.createElement('div');
        thumb.className = 'project-thumb';

        const img = document.createElement('img');
        img.src = imgSrc;
        img.alt = imgAlt;
        img.loading = 'lazy';
        img.decoding = 'async';
        thumb.appendChild(img);

        const badge = document.createElement('span');
        badge.className = 'project-badge';
        badge.textContent = categoryText;
        thumb.appendChild(badge);

        const idxSpan = document.createElement('span');
        idxSpan.className = 'project-index';
        idxSpan.textContent = indexNum;
        thumb.appendChild(idxSpan);

        const body = document.createElement('div');
        body.className = 'project-body';

        const title = document.createElement('h3');
        title.className = 'project-title';
        title.textContent = titleText;
        body.appendChild(title);

        const desc = document.createElement('p');
        desc.className = 'project-desc';
        desc.textContent = descText;
        body.appendChild(desc);

        if (Array.isArray(proj.tags) && proj.tags.length > 0) {
          const tagsDiv = document.createElement('div');
          tagsDiv.className = 'project-tags';
          proj.tags.slice(0, 3).forEach((t) => {
            const tagSpan = document.createElement('span');
            tagSpan.className = 'project-tag';
            tagSpan.textContent = String(t);
            tagsDiv.appendChild(tagSpan);
          });
          body.appendChild(tagsDiv);
        }

        const footer = document.createElement('div');
        footer.className = 'project-footer';

        const projectUrl = proj.link || proj.liveUrl || 'https://real-time-chats-3nydg9yij-hamoodsamad0321-6526.vercel.app/';
        const safeUrl = Security.sanitizeUrl(projectUrl);

        if (safeUrl) {
          const viewBtn = document.createElement('a');
          viewBtn.href = safeUrl;
          viewBtn.target = '_blank';
          viewBtn.rel = 'noopener noreferrer';
          viewBtn.className = 'project-view-btn';
          viewBtn.setAttribute('aria-label', `Open project: ${titleText}`);

          const textSpan = document.createElement('span');
          textSpan.textContent = 'View Project';
          const arrowSpan = document.createElement('span');
          arrowSpan.className = 'project-arrow';
          arrowSpan.setAttribute('aria-hidden', 'true');
          arrowSpan.textContent = '↗';

          viewBtn.appendChild(textSpan);
          viewBtn.appendChild(arrowSpan);

          viewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (safeUrl) {
              window.open(safeUrl, '_blank', 'noopener,noreferrer');
            }
          });

          footer.appendChild(viewBtn);
        }

        if (proj.githubUrl) {
          const ghSafe = Security.sanitizeUrl(proj.githubUrl);
          if (ghSafe) {
            const a = document.createElement('a');
            a.href = ghSafe;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.className = 'project-link project-link--muted';
            a.setAttribute('aria-label', `View source code on GitHub for ${titleText}`);
            a.textContent = 'Source ↗';
            footer.appendChild(a);
          }
        }
        body.appendChild(footer);

        card.appendChild(thumb);
        card.appendChild(body);

        // Click on background card rotates it to front; click on active front card opens project
        card.addEventListener('click', (e) => {
          if (hasDragged) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (e.target.closest('a')) return;
          const rawTheta = (baseAngle + currentAngle) % 360;
          const theta = ((rawTheta + 540) % 360) - 180;
          if (Math.abs(theta) > 1 && slotCount > 1) {
            targetAngle -= theta;
            if (isCarouselInView) startCarouselLoop();
          } else {
            if (safeUrl) {
              window.open(safeUrl, '_blank', 'noopener,noreferrer');
            }
          }
        }, true);

        carouselCylinder.appendChild(card);
        carouselItems.push({
          el: card,
          baseAngle,
          projectIndex: slot.projectIndex,
          isVisible: true,
          isActive: false,
          lastOpacity: 1,
        });
      });

      if (carouselDots && visible.length > 1) {
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
        cachedDotEls = Array.from(carouselDots.querySelectorAll('.carousel-dot'));
      } else {
        cachedDotEls = [];
      }
      lastClosestIndex = -1;

      if (isCarouselInView) {
        startCarouselLoop();
      }
      if (typeof ScrollCanvasEngine !== 'undefined' && ScrollCanvasEngine) {
        ScrollCanvasEngine.updateLayoutCaches();
        ScrollCanvasEngine.onNativeScroll();
      }
    }

    function handleBreakpointResize(newCardW) {
      if (lastCylinderCardW !== -1 && lastCylinderCardW !== newCardW) {
        lastCylinderCardW = newCardW;
        renderProjects();
      } else {
        lastCylinderCardW = newCardW;
      }
    }

    function init() {
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
          categorySelectBtn &&
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

      if (carouselPrevBtn) {
        carouselPrevBtn.addEventListener('click', () => {
          targetAngle += slotAngleStep;
          if (isCarouselInView) startCarouselLoop();
        });
      }

      if (carouselNextBtn) {
        carouselNextBtn.addEventListener('click', () => {
          targetAngle -= slotAngleStep;
          if (isCarouselInView) startCarouselLoop();
        });
      }

      if (carouselStage) {
        carouselStage.style.touchAction = 'pan-y';

        carouselStage.addEventListener('pointerenter', () => {
          isHovered = true;
        });

        carouselStage.addEventListener('pointerleave', () => {
          isHovered = false;
        });

        carouselStage.addEventListener('pointerdown', (e) => {
          if (slotCount <= 1) return;
          if (e.target.closest('a') || e.target.closest('button')) return;
          isDragging = true;
          hasDragged = false;
          activePointerId = e.pointerId;
          dragStartX = e.clientX;
          dragStartY = e.clientY;
          dragStartAngle = targetAngle;
          try {
            carouselStage.setPointerCapture(e.pointerId);
          } catch (_) {}
          carouselStage.classList.add('is-dragging');
        });

        window.addEventListener('pointermove', (e) => {
          if (!isDragging) return;
          const deltaX = e.clientX - dragStartX;
          const deltaY = e.clientY - dragStartY;
          if (Math.hypot(deltaX, deltaY) > 6) {
            hasDragged = true;
          }
          targetAngle = dragStartAngle + deltaX * 0.42;
        });

        function endDrag() {
          if (!isDragging) return;
          isDragging = false;
          if (activePointerId !== null) {
            try {
              carouselStage.releasePointerCapture(activePointerId);
            } catch (_) {}
            activePointerId = null;
          }
          if (carouselStage) carouselStage.classList.remove('is-dragging');
          targetAngle = Math.round(targetAngle / slotAngleStep) * slotAngleStep;
          setTimeout(() => {
            hasDragged = false;
          }, 80);
        }

        window.addEventListener('pointerup', endDrag);
        window.addEventListener('pointercancel', endDrag);
        carouselStage.addEventListener('lostpointercapture', endDrag);
      }

      initVisibilityObserver();
    }


export {
  init,
  renderProjects,
  handleBreakpointResize,
  initVisibilityObserver,
  setSuspended,
};

export const CarouselEngine = Object.freeze({
  init,
  renderProjects,
  handleBreakpointResize,
  initVisibilityObserver,
  setSuspended,
});
