(() => {
  const store = window.PortfolioStore;
  if (!store) return;

  const vaultScreen = document.getElementById('vault-screen');
  const vaultCard = document.getElementById('vault-card');
  const studio = document.getElementById('studio');
  const loginForm = document.getElementById('login-form');
  const loginPassInput = document.getElementById('vault-password');
  const loginSubmitBtn = loginForm.querySelector('button[type="submit"]');
  const toggleLoginPass = document.getElementById('toggle-login-pass');
  const loginError = document.getElementById('login-error');

  const headerStats = document.getElementById('header-stats');
  const unreadBadge = document.getElementById('unread-badge');
  const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
  const panels = {
    projects: document.getElementById('panel-projects'),
    inquiries: document.getElementById('panel-inquiries'),
    profile: document.getElementById('panel-profile'),
  };

  // Project form elements
  const projectForm = document.getElementById('project-form');
  const projectFormHeading = document.getElementById('project-form-heading');
  const cancelEditBtn = document.getElementById('cancel-edit-btn');
  const saveProjectBtn = document.getElementById('save-project-btn');
  const projTitle = document.getElementById('proj-title');
  const projCategory = document.getElementById('proj-category');
  const projLink = document.getElementById('proj-link');
  const projDesc = document.getElementById('proj-desc');
  const projImage = document.getElementById('proj-image');
  const projFile = document.getElementById('proj-file');
  const projectSearch = document.getElementById('project-search');
  const projectsList = document.getElementById('projects-list');

  // Preview elements
  const previewImg = document.getElementById('preview-img');
  const previewCategory = document.getElementById('preview-category');
  const previewTitle = document.getElementById('preview-title');
  const previewDesc = document.getElementById('preview-desc');

  // Inquiries & Profile elements
  const inquiriesList = document.getElementById('inquiries-list');
  const inquiryCountPill = document.getElementById('inquiry-count-pill');
  const profileForm = document.getElementById('profile-form');
  const profileSubmitBtn = profileForm.querySelector('button[type="submit"]');
  const resetDefaultsBtn = document.getElementById('reset-defaults-btn');

  // Modals
  const passwordModal = document.getElementById('password-modal');
  const openPasswordModalBtn = document.getElementById('open-password-modal');
  const closePasswordModalBtn = document.getElementById('close-password-modal');
  const cancelPasswordModalBtn = document.getElementById('cancel-password-modal');
  const passwordForm = document.getElementById('password-form');
  const passwordError = document.getElementById('password-error');
  const lockBtn = document.getElementById('lock-btn');

  const deleteModal = document.getElementById('delete-modal');
  const deleteModalText = document.getElementById('delete-modal-text');
  const cancelDeleteBtn = document.getElementById('cancel-delete');
  const confirmDeleteBtn = document.getElementById('confirm-delete');

  const toastStack = document.getElementById('toast-stack');

  let currentProjects = [];
  let currentInquiries = [];
  let activeEngine = 'Connecting...';
  let editingProjectId = null;
  let pendingDeleteId = null;

  function showToast(msg, isError = false) {
    const el = document.createElement('div');
    el.className = `toast${isError ? ' is-error' : ''}`;
    el.textContent = msg;
    toastStack.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  function updateStats() {
    const unread = currentInquiries.filter((i) => !i.read).length;
    headerStats.textContent = `${activeEngine} • ${currentProjects.length} Projects • ${currentInquiries.length} Inquiries`;
    inquiryCountPill.textContent = `${currentInquiries.length} Total`;

    if (unread > 0) {
      unreadBadge.textContent = String(unread);
      unreadBadge.hidden = false;
    } else {
      unreadBadge.hidden = true;
    }
  }

  function syncPreview() {
    previewTitle.textContent = projTitle.value.trim() || 'Project Title';
    previewCategory.textContent = (projCategory.value.trim() || 'WEB DESIGN').toUpperCase();
    previewDesc.textContent =
      projDesc.value.trim() || 'Your project description will appear here.';
    previewImg.src =
      projImage.value.trim() ||
      'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=900&q=80';
  }

  function resetProjectForm() {
    editingProjectId = null;
    projectForm.reset();
    projectFormHeading.textContent = 'Add New Project';
    saveProjectBtn.textContent = '+ Publish Project';
    cancelEditBtn.hidden = true;
    syncPreview();
  }

  function renderProjectsList() {
    const query = projectSearch.value.trim().toLowerCase();
    const filtered = currentProjects.filter((p) => {
      if (!query) return true;
      return (
        String(p.title || '').toLowerCase().includes(query) ||
        String(p.category || '').toLowerCase().includes(query) ||
        String(p.description || '').toLowerCase().includes(query)
      );
    });

    projectsList.innerHTML = '';

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No projects found. Add your first project using the form.';
      projectsList.appendChild(empty);
      updateStats();
      return;
    }

    filtered.forEach((proj, idx) => {
      const row = document.createElement('div');
      row.className = 'project-row';

      const main = document.createElement('div');
      main.className = 'project-row-main';

      const img = document.createElement('img');
      img.className = 'project-row-thumb';
      img.src =
        proj.image ||
        'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=400&q=80';
      img.alt = proj.title || 'Project';
      main.appendChild(img);

      const info = document.createElement('div');
      info.className = 'project-row-info';

      const meta = document.createElement('div');
      meta.className = 'project-row-meta';

      const num = document.createElement('span');
      num.className = 'row-num';
      num.textContent = `#${String(idx + 1).padStart(2, '0')}`;
      meta.appendChild(num);

      const cat = document.createElement('span');
      cat.className = 'row-cat';
      cat.textContent = proj.category || 'PROJECT';
      meta.appendChild(cat);

      const h3 = document.createElement('h3');
      h3.textContent = proj.title || 'Untitled';

      const p = document.createElement('p');
      p.textContent = proj.description || '';

      info.append(meta, h3, p);
      main.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'project-row-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn--ghost btn--sm';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        editingProjectId = proj.id;
        projTitle.value = proj.title || '';
        projCategory.value = proj.category || '';
        projLink.value = proj.link || '';
        projDesc.value = proj.description || '';
        projImage.value = proj.image || '';
        projectFormHeading.textContent = 'Edit Project';
        saveProjectBtn.textContent = 'Save Changes';
        cancelEditBtn.hidden = false;
        syncPreview();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn--danger-soft btn--sm';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => {
        pendingDeleteId = proj.id;
        deleteModalText.textContent = `Are you sure you want to remove "${proj.title}" from your live portfolio?`;
        deleteModal.hidden = false;
      });

      actions.append(editBtn, delBtn);
      row.append(main, actions);
      projectsList.appendChild(row);
    });

    updateStats();
  }

  function renderInquiriesList() {
    inquiriesList.innerHTML = '';

    if (currentInquiries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No client inquiries yet. Messages from your portfolio will appear here.';
      inquiriesList.appendChild(empty);
      updateStats();
      return;
    }

    currentInquiries.forEach((inq) => {
      const card = document.createElement('article');
      card.className = `inquiry-card${inq.read ? '' : ' is-unread'}`;

      const top = document.createElement('div');
      top.className = 'inquiry-top';

      const who = document.createElement('div');
      who.className = 'inquiry-who';
      const h3 = document.createElement('h3');
      h3.textContent = inq.name || 'Visitor';
      const mail = document.createElement('a');
      mail.href = `mailto:${inq.email || ''}`;
      mail.textContent = inq.email || '';
      who.append(h3, mail);

      const badge = document.createElement('span');
      badge.className = 'row-cat';
      badge.textContent = inq.service || 'General Inquiry';

      top.append(who, badge);

      const details = document.createElement('p');
      details.className = 'inquiry-details';
      details.textContent = inq.details || '';

      const bottom = document.createElement('div');
      bottom.className = 'inquiry-bottom';

      const date = document.createElement('span');
      date.textContent = inq.createdAt ? new Date(inq.createdAt).toLocaleString() : '';

      const actions = document.createElement('div');
      actions.className = 'project-row-actions';

      const readBtn = document.createElement('button');
      readBtn.type = 'button';
      readBtn.className = 'btn btn--ghost btn--sm';
      readBtn.textContent = inq.read ? 'Mark Unread' : 'Mark Read';
      readBtn.addEventListener('click', async () => {
        const res = await store.toggleInquiryRead(inq.id, inq.read);
        currentInquiries = res.inquiries || [];
        renderInquiriesList();
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn--danger-soft btn--sm';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async () => {
        const res = await store.deleteInquiry(inq.id);
        currentInquiries = res.inquiries || [];
        renderInquiriesList();
        showToast('Inquiry deleted.');
      });

      actions.append(readBtn, delBtn);
      bottom.append(date, actions);
      card.append(top, details, bottom);
      inquiriesList.appendChild(card);
    });

    updateStats();
  }

  function hydrateProfileForm(profile) {
    const p = profile || store.getProfile();
    document.getElementById('prof-name').value = p.name || '';
    document.getElementById('prof-eyebrow').value = p.eyebrow || '';
    document.getElementById('prof-email').value = p.email || '';
    document.getElementById('prof-phone').value = p.phone || '';
    document.getElementById('prof-upwork').value = p.upwork || '';
    document.getElementById('prof-fiverr').value = p.fiverr || '';
    document.getElementById('prof-location').value = p.location || '';
    document.getElementById('prof-subtext').value = p.subtext || '';
    document.getElementById('prof-about').value = p.aboutLead || '';
  }

  async function refreshAllData() {
    const [projRes, inqRes, profRes] = await Promise.all([
      store.fetchProjects(),
      store.fetchInquiries(),
      store.fetchProfile(),
    ]);
    currentProjects = Array.isArray(projRes.projects) ? projRes.projects : [];
    currentInquiries = Array.isArray(inqRes.inquiries) ? inqRes.inquiries : [];
    activeEngine = projRes.engine || 'Supabase Cloud';

    renderProjectsList();
    renderInquiriesList();
    hydrateProfileForm(profRes.profile);
    syncPreview();
  }

  async function showStudio() {
    vaultScreen.hidden = true;
    studio.hidden = false;
    await refreshAllData();
  }

  function showVault() {
    studio.hidden = true;
    vaultScreen.hidden = false;
    loginPassInput.value = '';
    loginError.hidden = true;
    loginPassInput.focus();
  }

  // Auth Events
  toggleLoginPass.addEventListener('click', () => {
    const isPass = loginPassInput.type === 'password';
    loginPassInput.type = isPass ? 'text' : 'password';
    toggleLoginPass.textContent = isPass ? 'Hide' : 'Show';
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    loginSubmitBtn.disabled = true;
    loginSubmitBtn.textContent = 'Verifying...';

    try {
      const res = await store.verifyAdminPassword(loginPassInput.value);
      if (res.ok) {
        activeEngine = res.engine || 'Supabase Cloud';
        await showStudio();
        showToast(`Admin Studio unlocked (${activeEngine}).`);
      } else {
        loginError.textContent = res.error || 'Incorrect password. Please try again.';
        loginError.hidden = false;
        vaultCard.classList.remove('is-shaking');
        void vaultCard.offsetWidth;
        vaultCard.classList.add('is-shaking');
      }
    } finally {
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.textContent = 'Unlock Admin Studio';
    }
  });

  lockBtn.addEventListener('click', async () => {
    await store.logoutAdminSession();
    showVault();
  });

  // Tab Navigation
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      tabButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
      Object.entries(panels).forEach(([name, panel]) => {
        if (panel) panel.hidden = name !== target;
      });
    });
  });

  // Project Form Events
  [projTitle, projCategory, projDesc, projImage].forEach((input) => {
    input.addEventListener('input', syncPreview);
  });

  projFile.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await store.compressImageFile(file, 900);
      projImage.value = compressed;
      syncPreview();
      showToast('Image compressed and loaded into preview.');
    } catch {
      showToast('Could not process that image file.', true);
    }
  });

  projectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      title: projTitle.value.trim(),
      category: projCategory.value.trim(),
      link: projLink.value.trim(),
      description: projDesc.value.trim(),
      image: projImage.value.trim(),
    };

    if (!payload.title || !payload.description || !payload.image) {
      showToast('Title, description, and image are required.', true);
      return;
    }

    saveProjectBtn.disabled = true;
    saveProjectBtn.textContent = 'Saving...';

    try {
      const res = editingProjectId
        ? await store.updateProject(editingProjectId, payload)
        : await store.addProject(payload);
      currentProjects = res.projects || [];
      activeEngine = res.engine || activeEngine;
      showToast(
        editingProjectId
          ? `Updated "${payload.title}" (${activeEngine}).`
          : `Published "${payload.title}" (${activeEngine}).`,
      );
      resetProjectForm();
      renderProjectsList();
    } catch (err) {
      showToast(err?.message || 'Could not save project.', true);
    } finally {
      saveProjectBtn.disabled = false;
      saveProjectBtn.textContent = editingProjectId ? 'Save Changes' : '+ Publish Project';
    }
  });

  cancelEditBtn.addEventListener('click', resetProjectForm);
  projectSearch.addEventListener('input', renderProjectsList);

  // Delete Modal
  cancelDeleteBtn.addEventListener('click', () => {
    pendingDeleteId = null;
    deleteModal.hidden = true;
  });

  confirmDeleteBtn.addEventListener('click', async () => {
    if (!pendingDeleteId) return;
    confirmDeleteBtn.disabled = true;
    try {
      const res = await store.deleteProject(pendingDeleteId);
      currentProjects = res.projects || [];
      activeEngine = res.engine || activeEngine;
      if (editingProjectId === pendingDeleteId) resetProjectForm();
      renderProjectsList();
      showToast(`Project removed (${activeEngine}).`);
    } catch (err) {
      showToast(err?.message || 'Failed to delete project.', true);
    } finally {
      confirmDeleteBtn.disabled = false;
      pendingDeleteId = null;
      deleteModal.hidden = true;
    }
  });

  // Profile Form
  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    profileSubmitBtn.disabled = true;
    profileSubmitBtn.textContent = 'Saving...';

    try {
      const res = await store.saveProfile({
        name: document.getElementById('prof-name').value.trim(),
        eyebrow: document.getElementById('prof-eyebrow').value.trim(),
        email: document.getElementById('prof-email').value.trim(),
        phone: document.getElementById('prof-phone').value.trim(),
        upwork: document.getElementById('prof-upwork').value.trim(),
        fiverr: document.getElementById('prof-fiverr').value.trim(),
        location: document.getElementById('prof-location').value.trim(),
        subtext: document.getElementById('prof-subtext').value.trim(),
        aboutLead: document.getElementById('prof-about').value.trim(),
      });
      showToast(`Profile & links saved (${res.engine}).`);
    } catch (err) {
      showToast(err?.message || 'Saved locally. Run supabase-setup.sql to sync profile to Supabase.', true);
    } finally {
      profileSubmitBtn.disabled = false;
      profileSubmitBtn.textContent = 'Save Profile Changes';
    }
  });

  resetDefaultsBtn.addEventListener('click', async () => {
    await store.resetAllData();
    await refreshAllData();
    showToast('Restored default portfolio data.');
  });

  // Password Change Modal
  function closePwModal() {
    passwordModal.hidden = true;
    passwordForm.reset();
    passwordError.hidden = true;
  }

  openPasswordModalBtn.addEventListener('click', () => {
    passwordError.hidden = true;
    passwordModal.hidden = false;
  });

  closePasswordModalBtn.addEventListener('click', closePwModal);
  cancelPasswordModalBtn.addEventListener('click', closePwModal);

  passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    passwordError.hidden = true;

    const current = document.getElementById('pw-current').value;
    const next = document.getElementById('pw-new').value;
    const confirm = document.getElementById('pw-confirm').value;

    if (next !== confirm) {
      passwordError.textContent = 'New password and confirmation do not match.';
      passwordError.hidden = false;
      return;
    }

    const res = await store.changeAdminPassword(current, next);
    if (res.ok) {
      closePwModal();
      showToast(res.message);
    } else {
      passwordError.textContent = res.error;
      passwordError.hidden = false;
    }
  });

  // Initial Boot
  store.hasActiveAdminSession().then((valid) => {
    if (valid) {
      showStudio();
    } else {
      showVault();
    }
  });
})();
