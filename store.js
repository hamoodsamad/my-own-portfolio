(() => {
  const KEYS = {
    projects: 'hs_portfolio_projects_v3',
    profile: 'hs_portfolio_profile_v3',
    inquiries: 'hs_portfolio_inquiries_v3',
    passHash: 'hs_portfolio_admin_hash_v3',
    session: 'hs_portfolio_admin_unlocked_v3',
  };

  const DEFAULT_SUPABASE_CONFIG = {
    supabaseUrl: 'https://xumshyrendehegrahaqa.supabase.co',
    supabaseKey: 'sb_publishable_zPjLotwp_0vsRRWjtzdNiA_KGXpFbrL',
    adminEmail: 'hamoodsamad0321@gmail.com',
  };

  const AUTH_SALT = 'hs-portfolio-vault-2026';
  const DEFAULT_LOCAL_PASSWORD = 'hamood123';

  const DEFAULT_PROFILE = {
    name: 'Hamood Samad',
    role: 'Web Designer & Developer',
    eyebrow: "Hey, I'm Hamood Samad",
    quote: 'Great design should\nfeel invisible.',
    subtext:
      'I build modern, high-converting web experiences with clean code that connect and convert.',
    aboutLead:
      "I'm Hamood Samad, a Web Designer & Developer based in Pakistan focused on building clean, 100% responsive interfaces and maintainable code that solve real-world problems.",
    email: 'hamoodsamad0321@gmail.com',
    phone: '+92 343 6956890',
    location: 'Pakistan • Worldwide',
    upwork: 'https://www.upwork.com/freelancers/~011602925b19deee69',
    fiverr: 'https://www.fiverr.com/hamood_x03/buying?source=avatar_menu_profile',
  };

  const DEFAULT_PROJECTS = [
    {
      id: 'proj-realtime-chats',
      title: 'Real Time Chats',
      category: 'REAL-TIME CHAT WEB APP',
      description:
        'A lightweight, real-time chat application that lets users exchange messages instantly, designed for smooth, responsive communication across devices.',
      image: './assets/project-realtime-chats.jpg',
      link: 'https://real-time-chats-3nydg9yij-hamoodsamad0321-6526.vercel.app/',
    },
    {
      id: 'proj-1',
      title: 'Luxora Watches',
      category: 'E-COMMERCE',
      description:
        'Ultra-luxury horology storefront engineered for crisp product presentation, smooth browsing, and high conversion.',
      image:
        'https://images.unsplash.com/photo-1523170335258-f5ed11844a49?auto=format&fit=crop&w=900&q=80',
      link: '',
    },
    {
      id: 'proj-2',
      title: 'Interior Studio',
      category: 'CORPORATE',
      description:
        'Quiet-luxury architectural archive showcasing spatial design work with editorial grids and fluid responsiveness.',
      image:
        'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=900&q=80',
      link: '',
    },
    {
      id: 'proj-3',
      title: 'FitZone Gym',
      category: 'FITNESS',
      description:
        'High-converting athletic funnel featuring interactive membership flows, dynamic visual hierarchy, and mobile-first speed.',
      image:
        'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=900&q=80',
      link: '',
    },
    {
      id: 'proj-4',
      title: 'Café Aurora',
      category: 'HOSPITALITY',
      description:
        'Artisan culinary digital menu and reservation experience crafted with warm visual storytelling and effortless navigation.',
      image:
        'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=900&q=80',
      link: '',
    },
  ];

  let supabaseClient = null;
  let activeAdminEmail = DEFAULT_SUPABASE_CONFIG.adminEmail;
  let initPromise = null;
  const syncChannel =
    typeof window.BroadcastChannel === 'function'
      ? new window.BroadcastChannel('hs_portfolio_sync')
      : null;

  function notifyCrossTab(type = 'refresh') {
    try {
      localStorage.setItem('hs_portfolio_sync_ping', `${type}:${Date.now()}`);
    } catch {
      // ignore
    }
    if (syncChannel) {
      try {
        syncChannel.postMessage({ type, ts: Date.now() });
      } catch {
        // ignore
      }
    }
  }

  async function initSupabase() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        return null;
      }

      let cfg = { ...DEFAULT_SUPABASE_CONFIG };

      if (window.location.protocol !== 'file:') {
        try {
          const res = await fetch('/api/config', { cache: 'no-store' });
          if (res.ok) {
            const remote = await res.json();
            if (remote?.supabaseUrl && remote?.supabaseKey) {
              cfg.supabaseUrl = remote.supabaseUrl;
              cfg.supabaseKey = remote.supabaseKey;
            }
            if (remote?.adminEmail) {
              cfg.adminEmail = remote.adminEmail;
            }
          }
        } catch {
          // Local static server without /api/config -> use default public config
        }
      }

      activeAdminEmail = cfg.adminEmail;
      if (cfg.supabaseUrl && cfg.supabaseKey) {
        try {
          supabaseClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
        } catch {
          supabaseClient = null;
        }
      }
      return supabaseClient;
    })();
    return initPromise;
  }

  function errMsg(err, fallback = 'Operation failed.') {
    if (typeof err === 'string') return err;
    if (err && typeof err.message === 'string') return err.message;
    return fallback;
  }

  function safeRead(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function safeWrite(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function fallbackHash(str) {
    let h1 = 0xdeadbeef ^ str.length;
    let h2 = 0x41c6ce57 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }

  async function hashPassword(plain) {
    const text = `${AUTH_SALT}:${String(plain || '')}`;
    if (window.crypto && window.crypto.subtle) {
      try {
        const bytes = new TextEncoder().encode(text);
        const digest = await window.crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      } catch {
        return `fb:${fallbackHash(text)}`;
      }
    }
    return `fb:${fallbackHash(text)}`;
  }

  async function getStoredLocalHash() {
    const existing = localStorage.getItem(KEYS.passHash);
    if (existing) return existing;
    const defaultHash = await hashPassword(DEFAULT_LOCAL_PASSWORD);
    try {
      localStorage.setItem(KEYS.passHash, defaultHash);
    } catch {
      // ignore
    }
    return defaultHash;
  }

  function isAdminUnlocked() {
    try {
      return sessionStorage.getItem(KEYS.session) === '1';
    } catch {
      return false;
    }
  }

  function setAdminUnlocked(unlocked) {
    try {
      if (unlocked) sessionStorage.setItem(KEYS.session, '1');
      else sessionStorage.removeItem(KEYS.session);
    } catch {
      // ignore
    }
  }

  async function hasActiveAdminSession() {
    const sb = await initSupabase();
    if (sb) {
      try {
        const { data } = await sb.auth.getSession();
        if (data?.session) {
          setAdminUnlocked(true);
          return true;
        }
        return false;
      } catch {
        return isAdminUnlocked();
      }
    }
    return isAdminUnlocked();
  }

  async function verifyAdminPassword(password) {
    const sb = await initSupabase();
    if (sb) {
      try {
        const { data, error } = await sb.auth.signInWithPassword({
          email: activeAdminEmail,
          password: String(password || ''),
        });
        if (!error && data?.session) {
          setAdminUnlocked(true);
          return { ok: true, engine: 'Supabase Cloud' };
        }
        return {
          ok: false,
          engine: 'Supabase Cloud',
          error: errMsg(error, 'Incorrect Supabase admin password.'),
        };
      } catch (err) {
        return {
          ok: false,
          engine: 'Supabase Cloud',
          error: errMsg(err, 'Unable to connect to Supabase Auth.'),
        };
      }
    }

    const expected = await getStoredLocalHash();
    const given = await hashPassword(password);
    if (given === expected) {
      setAdminUnlocked(true);
      return { ok: true, engine: 'Local Storage' };
    }
    return { ok: false, engine: 'Local Storage', error: 'Incorrect password.' };
  }

  async function logoutAdminSession() {
    const sb = await initSupabase();
    if (sb) {
      try {
        await sb.auth.signOut();
      } catch {
        // ignore
      }
    }
    setAdminUnlocked(false);
  }

  async function changeAdminPassword(currentPassword, newPassword) {
    if (String(newPassword || '').length < 6) {
      return { ok: false, error: 'New password must be at least 6 characters.' };
    }

    const sb = await initSupabase();
    if (sb) {
      try {
        const { error: signInErr } = await sb.auth.signInWithPassword({
          email: activeAdminEmail,
          password: String(currentPassword || ''),
        });
        if (signInErr) {
          return { ok: false, error: 'Current password is incorrect.' };
        }
        const { error: updErr } = await sb.auth.updateUser({
          password: String(newPassword),
        });
        if (updErr) {
          return { ok: false, error: errMsg(updErr, 'Could not update Supabase password.') };
        }
        return { ok: true, message: 'Admin password updated in Supabase Cloud.' };
      } catch (err) {
        return { ok: false, error: errMsg(err, 'Unable to update password.') };
      }
    }

    const expected = await getStoredLocalHash();
    const given = await hashPassword(currentPassword);
    if (given !== expected) {
      return { ok: false, error: 'Current password is incorrect.' };
    }
    const nextHash = await hashPassword(newPassword);
    localStorage.setItem(KEYS.passHash, nextHash);
    return { ok: true, message: 'Admin password updated locally.' };
  }

  /* =========================================
     Local Synchronous Helpers (Instant Boot)
     ========================================= */
  function getProfileLocal() {
    const stored = safeRead(KEYS.profile, null);
    if (!stored || typeof stored !== 'object') return { ...DEFAULT_PROFILE };
    return { ...DEFAULT_PROFILE, ...stored };
  }

  function getProjectsLocal() {
    const stored = safeRead(KEYS.projects, null);
    if (!Array.isArray(stored)) {
      const cloned = DEFAULT_PROJECTS.map((p) => ({ ...p }));
      safeWrite(KEYS.projects, cloned);
      return cloned;
    }
    return stored;
  }

  function getInquiriesLocal() {
    const stored = safeRead(KEYS.inquiries, []);
    return Array.isArray(stored) ? stored : [];
  }

  /* =========================================
     Supabase Cloud + Fallback Operations
     ========================================= */
  function mapDbProfile(row) {
    return {
      ...DEFAULT_PROFILE,
      name: row.name || DEFAULT_PROFILE.name,
      role: row.role || DEFAULT_PROFILE.role,
      eyebrow: row.eyebrow || DEFAULT_PROFILE.eyebrow,
      quote: row.quote || DEFAULT_PROFILE.quote,
      subtext: row.subtext || DEFAULT_PROFILE.subtext,
      aboutLead: row.about_lead || row.aboutLead || DEFAULT_PROFILE.aboutLead,
      email: row.email || DEFAULT_PROFILE.email,
      phone: row.phone || DEFAULT_PROFILE.phone,
      location: row.location || DEFAULT_PROFILE.location,
      upwork: row.upwork || DEFAULT_PROFILE.upwork,
      fiverr: row.fiverr || DEFAULT_PROFILE.fiverr,
    };
  }

  async function fetchProfile() {
    const sb = await initSupabase();
    if (sb) {
      try {
        const { data, error } = await sb
          .from('site_profile')
          .select('*')
          .eq('id', 'main')
          .maybeSingle();
        if (!error && data) {
          const mapped = mapDbProfile(data);
          safeWrite(KEYS.profile, mapped);
          return { profile: mapped, engine: 'Supabase Cloud' };
        }
      } catch {
        // Fallback below
      }
    }
    return { profile: getProfileLocal(), engine: sb ? 'Supabase Cloud (Local Profile)' : 'Local Storage' };
  }

  async function saveProfile(updates) {
    const merged = { ...getProfileLocal(), ...updates };
    safeWrite(KEYS.profile, merged);

    const sb = await initSupabase();
    if (sb) {
      const dbRow = {
        id: 'main',
        name: merged.name,
        role: merged.role,
        eyebrow: merged.eyebrow,
        quote: merged.quote,
        subtext: merged.subtext,
        about_lead: merged.aboutLead,
        email: merged.email,
        phone: merged.phone,
        location: merged.location,
        upwork: merged.upwork,
        fiverr: merged.fiverr,
        updated_at: new Date().toISOString(),
      };
      const { error } = await sb.from('site_profile').upsert([dbRow], { onConflict: 'id' });
      if (error) {
        throw new Error(
          errMsg(
            error,
            'Could not save profile to Supabase. Run supabase-setup.sql in Supabase SQL Editor first.',
          ),
        );
      }
      notifyCrossTab('profile');
      return { profile: merged, engine: 'Supabase Cloud' };
    }

    notifyCrossTab('profile');
    return { profile: merged, engine: 'Local Storage' };
  }

  async function fetchProjects() {
    const sb = await initSupabase();
    if (sb) {
      try {
        const { data, error } = await sb
          .from('projects')
          .select('id, title, category, description, image, link, created_at')
          .order('created_at', { ascending: false });

        if (!error && Array.isArray(data)) {
          // Always trust Supabase Cloud as the single source of truth (even when 0 rows)
          safeWrite(KEYS.projects, data);
          return { projects: data, engine: 'Supabase Cloud' };
        }
      } catch {
        // Offline fallback below
      }
    }
    return { projects: getProjectsLocal(), engine: 'Local Storage' };
  }

  async function addProject(data) {
    const project = {
      id: `proj-${Date.now()}`,
      title: String(data.title || '').trim(),
      category: String(data.category || 'WEB DESIGN').trim().toUpperCase(),
      description: String(data.description || '').trim(),
      image: String(data.image || '').trim(),
      link: String(data.link || '').trim(),
    };

    const sb = await initSupabase();
    if (sb) {
      const { data: inserted, error } = await sb
        .from('projects')
        .insert([project])
        .select('id');
      if (error) {
        throw new Error(errMsg(error, 'Failed to publish project to Supabase. Please re-login.'));
      }
      if (!inserted || inserted.length === 0) {
        throw new Error(
          'Supabase blocked adding this project (0 rows inserted). Please re-login in Admin Studio.',
        );
      }
      const res = await fetchProjects();
      notifyCrossTab('projects');
      return res;
    }

    const next = [project, ...getProjectsLocal()];
    safeWrite(KEYS.projects, next);
    notifyCrossTab('projects');
    return { projects: next, engine: 'Local Storage' };
  }

  async function updateProject(id, data) {
    const updates = {
      title: String(data.title || '').trim(),
      category: String(data.category || 'WEB DESIGN').trim().toUpperCase(),
      description: String(data.description || '').trim(),
      image: String(data.image || '').trim(),
      link: String(data.link || '').trim(),
    };

    const sb = await initSupabase();
    if (sb) {
      const { data: updated, error } = await sb
        .from('projects')
        .update(updates)
        .eq('id', id)
        .select('id');
      if (error) {
        throw new Error(errMsg(error, 'Failed to update project in Supabase.'));
      }
      if (!updated || updated.length === 0) {
        throw new Error(
          'Project was not updated in Supabase (0 rows matched or permission denied). Please re-login.',
        );
      }
      const res = await fetchProjects();
      notifyCrossTab('projects');
      return res;
    }

    const next = getProjectsLocal().map((item) =>
      item.id === id ? { ...item, ...updates } : item,
    );
    safeWrite(KEYS.projects, next);
    notifyCrossTab('projects');
    return { projects: next, engine: 'Local Storage' };
  }

  async function deleteProject(id) {
    const sb = await initSupabase();
    if (sb) {
      const { data: deleted, error } = await sb
        .from('projects')
        .delete()
        .eq('id', id)
        .select('id');
      if (error) {
        throw new Error(errMsg(error, 'Failed to delete project from Supabase.'));
      }
      if (!deleted || deleted.length === 0) {
        throw new Error(
          'Delete did not remove any row in Supabase (permission denied or already removed). Check RLS policies & re-login.',
        );
      }
      const res = await fetchProjects();
      notifyCrossTab('projects');
      return res;
    }

    const next = getProjectsLocal().filter((item) => item.id !== id);
    safeWrite(KEYS.projects, next);
    notifyCrossTab('projects');
    return { projects: next, engine: 'Local Storage' };
  }

  function subscribeToLiveUpdates(onChange) {
    const cleanups = [];

    if (syncChannel) {
      const onMsg = () => onChange();
      syncChannel.addEventListener('message', onMsg);
      cleanups.push(() => syncChannel.removeEventListener('message', onMsg));
    }

    const onStorage = (e) => {
      if (!e.key || e.key.startsWith('hs_portfolio_')) onChange();
    };
    window.addEventListener('storage', onStorage);
    cleanups.push(() => window.removeEventListener('storage', onStorage));

    initSupabase().then((sb) => {
      if (!sb || typeof sb.channel !== 'function') return;
      try {
        const ch = sb
          .channel('portfolio-live-sync')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'projects' },
            () => onChange(),
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'site_profile' },
            () => onChange(),
          )
          .subscribe();
        cleanups.push(() => {
          try {
            sb.removeChannel(ch);
          } catch {
            // ignore
          }
        });
      } catch {
        // Realtime optional
      }
    });

    return () => cleanups.forEach((fn) => fn());
  }

  async function fetchInquiries() {
    const sb = await initSupabase();
    if (sb) {
      try {
        const { data, error } = await sb
          .from('inquiries')
          .select('id, name, email, service, details, read, created_at')
          .order('created_at', { ascending: false });
        if (!error && Array.isArray(data)) {
          const normalized = data.map((r) => ({
            ...r,
            createdAt: r.created_at || r.createdAt,
          }));
          safeWrite(KEYS.inquiries, normalized);
          return { inquiries: normalized, engine: 'Supabase Cloud' };
        }
      } catch {
        // Fallback below
      }
    }
    return { inquiries: getInquiriesLocal(), engine: 'Local Storage' };
  }

  async function addInquiry(data) {
    const entry = {
      id: `inq-${Date.now()}`,
      name: String(data.name || '').trim(),
      email: String(data.email || '').trim(),
      service: String(data.service || 'Responsive Web Design').trim(),
      details: String(data.details || '').trim(),
      read: false,
      created_at: new Date().toISOString(),
    };

    const sb = await initSupabase();
    if (sb) {
      try {
        const { error } = await sb.from('inquiries').insert([entry]);
        if (!error) {
          const localCopy = [{ ...entry, createdAt: entry.created_at }, ...getInquiriesLocal()];
          safeWrite(KEYS.inquiries, localCopy);
          return { ok: true, engine: 'Supabase Cloud', entry };
        }
      } catch {
        // Fallback below
      }
    }

    const next = [{ ...entry, createdAt: entry.created_at }, ...getInquiriesLocal()];
    safeWrite(KEYS.inquiries, next);
    return { ok: true, engine: 'Local Storage', entry };
  }

  async function toggleInquiryRead(id, currentRead) {
    const nextRead = !currentRead;
    const sb = await initSupabase();
    if (sb) {
      try {
        const { error } = await sb.from('inquiries').update({ read: nextRead }).eq('id', id);
        if (!error) return await fetchInquiries();
      } catch {
        // Fallback below
      }
    }
    const next = getInquiriesLocal().map((inq) =>
      inq.id === id ? { ...inq, read: nextRead } : inq,
    );
    safeWrite(KEYS.inquiries, next);
    return { inquiries: next, engine: 'Local Storage' };
  }

  async function deleteInquiry(id) {
    const sb = await initSupabase();
    if (sb) {
      try {
        const { error } = await sb.from('inquiries').delete().eq('id', id);
        if (!error) return await fetchInquiries();
      } catch {
        // Fallback below
      }
    }
    const next = getInquiriesLocal().filter((inq) => inq.id !== id);
    safeWrite(KEYS.inquiries, next);
    return { inquiries: next, engine: 'Local Storage' };
  }

  async function resetAllData() {
    safeWrite(KEYS.projects, DEFAULT_PROJECTS.map((p) => ({ ...p })));
    safeWrite(KEYS.profile, { ...DEFAULT_PROFILE });
    try {
      await saveProfile({ ...DEFAULT_PROFILE });
    } catch {
      // ignore if profile table not yet created
    }
  }

  function compressImageFile(file, maxWidth = 900) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxWidth / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = reject;
        img.src = event.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function normalizeExternalUrl(raw) {
    const val = String(raw || '').trim();
    if (!val || val === '#') return '';
    if (/^(https?:\/\/|mailto:|tel:|\/|\.\/)/i.test(val)) return val;
    return `https://${val}`;
  }

  window.PortfolioStore = {
    DEFAULT_PROFILE,
    DEFAULT_PROJECTS,
    initSupabase,
    getAdminEmail: () => activeAdminEmail,
    getProfile: getProfileLocal,
    fetchProfile,
    saveProfile,
    getProjects: getProjectsLocal,
    fetchProjects,
    addProject,
    updateProject,
    deleteProject,
    getInquiries: getInquiriesLocal,
    fetchInquiries,
    addInquiry,
    toggleInquiryRead,
    deleteInquiry,
    hasActiveAdminSession,
    verifyAdminPassword,
    logoutAdminSession,
    changeAdminPassword,
    isAdminUnlocked,
    setAdminUnlocked,
    resetAllData,
    subscribeToLiveUpdates,
    compressImageFile,
    normalizeExternalUrl,
  };
})();
