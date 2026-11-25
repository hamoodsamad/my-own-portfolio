/**
 * Contact Modal, Inquiries & Toast Notifications Module
 * Handles visitor inquiries, feedback messages, anti-spam rate limiting, and hidden admin auth.
 */

import { Security } from './security.js';
import { closeMobileMenu } from './navigation.js';
import { stopSmoothScroll, startSmoothScroll } from './smoothScroll.js';


    const store = window.PortfolioStore;
    const modal = document.getElementById('contact-modal');
    const modalClose = document.getElementById('modal-close');
    const inquiryForm = document.getElementById('inquiry-form');
    const serviceSelect = document.getElementById('inq-service');
    const toastStack = document.getElementById('toast-stack');

    let lastActiveElement = null; // B9 Fix: Stores element that triggered modal for focus restoration
    let isSubmitting = false;     // B1 Fix: Double-submission prevention flag

    function showToast(message) {
      if (!toastStack) return;
      const item = document.createElement('div');
      item.className = 'toast';
      item.textContent = Security.sanitizeText(message);
      toastStack.appendChild(item);
      setTimeout(() => item.remove(), 3600);
    }

    function openContactModal(serviceName, triggerEl) {
      closeMobileMenu();
      if (!modal) return;
      // B9 Fix: Store focus trigger and configure accessible modal dialog attributes
      lastActiveElement = triggerEl || document.activeElement;
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');

      if (serviceName && serviceSelect) {
        const hasOpt = Array.from(serviceSelect.options).some((o) => o.value === serviceName);
        if (hasOpt) serviceSelect.value = serviceName;
      }
      modal.hidden = false;
      document.body.style.overflow = 'hidden'; // B9 Fix: Lock body scroll while modal is active
      stopSmoothScroll();

      const nameInput = document.getElementById('inq-name');
      if (nameInput) nameInput.focus();
    }

    function closeContactModal() {
      if (!modal || modal.hidden) return;
      modal.hidden = true;
      document.body.style.overflow = ''; // B9 Fix: Restore body scroll
      startSmoothScroll();

      // B9 Fix: Return focus to trigger element that opened modal
      if (lastActiveElement && typeof lastActiveElement.focus === 'function') {
        try { lastActiveElement.focus(); } catch (_) {}
        lastActiveElement = null;
      }
    }

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

    function init() {
      document.querySelectorAll('[data-open-contact]').forEach((btn) => {
        btn.addEventListener('click', () => {
          openContactModal(btn.dataset.openContact || '', btn);
        });
        if (btn.getAttribute('role') === 'button') {
          btn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openContactModal(btn.dataset.openContact || '', btn);
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

        // B9 Fix: Accessible focus trap on Tab key
        modal.addEventListener('keydown', (e) => {
          if (modal.hidden) return;
          if (e.key === 'Tab') {
            const focusable = modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (e.shiftKey) {
              if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
              }
            } else {
              if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
            }
          }
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
          if (isSubmitting) return; // B1 Fix: Prevent double submits

          const nameInput = document.getElementById('inq-name');
          const emailInput = document.getElementById('inq-email');
          const detailsInput = document.getElementById('inq-details');

          const name = nameInput ? Security.sanitizeText(nameInput.value) : '';
          const email = emailInput ? Security.sanitizeText(emailInput.value) : '';
          const service = serviceSelect ? serviceSelect.value : '';
          const details = detailsInput ? Security.sanitizeText(detailsInput.value) : '';

          if (!name || !email || !details) {
            showToast('Please fill out all required fields.');
            return;
          }

          // B1 Fix: Client-side email validation with clear error feedback
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showToast('Please enter a valid email address.');
            if (emailInput) emailInput.focus();
            return;
          }

          const submitBtn = inquiryForm.querySelector('button[type="submit"]');
          if (submitBtn) submitBtn.disabled = true;
          isSubmitting = true;

          try {
            if (store && typeof store.addInquiry === 'function') {
              await store.addInquiry({ name, email, service, details });
            }
            // Reset and close only on success
            inquiryForm.reset();
            closeContactModal();
            showToast('Inquiry received! Hamood will respond shortly.');
          } catch (err) {
            // B1 Fix: Keep form values intact and notify user with error toast
            console.error('[InquiryController] Submission failed:', err);
            showToast('Something went wrong. Please try again or email me directly.');
          } finally {
            isSubmitting = false;
            if (submitBtn) submitBtn.disabled = false;
          }
        });
      }

      // Hidden Admin Lock tucked behind footer HS logo
      bindLogoAdminToggle('footer-logo-wrap', 'admin-lock-trigger', 'footer-admin-link');
    }


export {
  init,
  showToast,
  openContactModal,
  closeContactModal,
};

export const InquiryController = Object.freeze({
  init,
  showToast,
  openContactModal,
  closeContactModal,
});
