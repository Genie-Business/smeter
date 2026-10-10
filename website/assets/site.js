/* smeter website — shared behaviour (vanilla JS, no dependencies). */
(() => {
  const html = document.documentElement;
  const isLanding = html.classList.contains('landing');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const API = (window.SMETER_API || '').replace(/\/$/, '');

  // ───────────── Responsive mode: CSS decides (--mode), JS mirrors as classes ─────────────
  const MODES = ['desk', 'mob', 'mob-l', 'tab', 'tab-l', 'tab-p'];
  function readMode() {
    return getComputedStyle(html).getPropertyValue('--mode').trim() || 'mob';
  }
  function fit() {
    const mode = readMode();
    html.classList.remove(...MODES, 'tall', 'ex1', 'ex2', 'ex3');
    html.classList.add(mode);
    if (mode.startsWith('tab')) html.classList.add('tab');
    if (mode.startsWith('mob')) html.classList.add('mob');
    if (mode !== 'desk' || !isLanding) return;
    // Desktop landing: a 1280×800 composition scaled to cover the viewport.
    const vw = innerWidth;
    const vh = innerHeight;
    const s = vw / vh > 1280 / 800 ? vh / 800 : vw / 1280;
    html.style.setProperty('--s', s);
    html.style.setProperty('--W', vw / s);
    html.style.setProperty('--H', vh / s);
    if (vh / s > 845) html.classList.add('tall');
    const extra = Math.max(0, Math.min(3, Math.floor((vw / s - 1294) / 218.33)));
    if (extra) html.classList.add(`ex${extra}`);
  }
  fit();
  addEventListener('resize', fit, { passive: true });
  addEventListener('orientationchange', fit);

  // ───────────── Marquee: duplicate each column's tiles once for a seamless loop ─────────────
  document.querySelectorAll('.grid .col').forEach((col) => {
    [...col.children].forEach((cell) => col.appendChild(cell.cloneNode(true)));
  });

  // ───────────── Menu (mobile / tablet) ─────────────
  const hdr = document.querySelector('.hdr');
  const menuBtn = document.querySelector('.menu-btn');
  function setMenu(open) {
    if (!hdr || !menuBtn) return;
    if (open) hdr.setAttribute('data-open', '');
    else hdr.removeAttribute('data-open');
    menuBtn.setAttribute('aria-expanded', String(open));
    if (open) hdr.querySelector('.panel nav a')?.focus({ preventScroll: true });
  }
  menuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    setMenu(!hdr.hasAttribute('data-open'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (hdr?.hasAttribute('data-open')) {
        setMenu(false);
        menuBtn.focus();
      }
      closeSheet();
    }
  });
  document.addEventListener('click', (e) => {
    if (hdr?.hasAttribute('data-open') && !hdr.contains(e.target)) setMenu(false);
  });
  hdr?.querySelectorAll('.panel a').forEach((a) => a.addEventListener('click', () => setMenu(false)));

  // ───────────── Load entrance (landing) ─────────────
  if (isLanding && html.classList.contains('intro')) runIntro();

  function runIntro() {
    const EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)';
    const QUART = 'cubic-bezier(0.25, 1, 0.5, 1)';
    const QUINT = 'cubic-bezier(0.22, 1, 0.36, 1)';
    const HANDOFF = 2100; // ms: grid entrance hands over to the CSS marquee
    const CRUISE = 3.42; // % of column height per second (matches 14.6s / 50%)
    const EXTRA = 8; // % extra drift during the entrance
    const h1 = document.querySelector('.hero h1');
    h1?.classList.add('masking');
    const anims = [];
    const a = (el, frames, opts) => {
      if (!el) return;
      const an = el.animate(frames, { fill: 'both', ...opts });
      anims.push(an);
    };
    html.classList.remove('intro');

    a(hdr, [{ transform: 'translateY(calc(-100% - 48px))' }, { transform: 'none' }], { duration: 950, easing: EXPO });
    document.querySelectorAll('.util > *').forEach((el, i) =>
      a(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 600, delay: 320 + i * 60, easing: QUART }),
    );
    a(document.querySelector('.logo'), [{ opacity: 0, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 800, delay: 380, easing: EXPO });
    document.querySelectorAll('.mnav > *').forEach((el, i) =>
      a(el, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: 440 + i * 50, easing: EXPO }),
    );
    a(document.querySelector('.hdr .cta'), [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: 560, easing: EXPO });
    document.querySelectorAll('.hero h1 .ln > span').forEach((el, i) =>
      a(el, [{ transform: 'translateY(110%)' }, { transform: 'none' }], { duration: 1000, delay: 300 + i * 85, easing: EXPO }),
    );
    a(document.querySelector('.hero p'), [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 900, delay: 720, easing: QUINT });
    document.querySelectorAll('.hero .acts > *').forEach((el, i) =>
      a(el, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 800, delay: 820 + i * 70, easing: QUINT }),
    );
    a(document.querySelector('.hero .stores'), [{ opacity: 0 }, { opacity: 1 }], { duration: 800, delay: 1000 });

    // Visible columns: glide in, decelerating into the marquee's cruise speed,
    // then hand over to the CSS animation at HANDOFF without a jump.
    const T0 = performance.now();
    document.querySelectorAll('.grid .col').forEach((col, i) => {
      if (getComputedStyle(col).display === 'none') {
        col.style.opacity = '';
        return;
      }
      const up = col.classList.contains('c2') || col.classList.contains('x1') || col.classList.contains('x3');
      col.style.animationPlayState = 'paused';
      const startPct = up ? -50 : 0; // where the CSS loop begins
      const drift = (CRUISE * HANDOFF) / 1000 + EXTRA;
      const from = up ? startPct - drift : startPct + drift;
      a(col, [
        { opacity: 0, transform: `translate3d(0, ${from}%, 0)` },
        { opacity: 1, offset: 0.35 },
        { opacity: 1, transform: `translate3d(0, ${startPct}%, 0)` },
      ], { duration: HANDOFF, delay: i * 40, easing: QUINT, fill: 'backwards' });
      setTimeout(() => (col.style.animationPlayState = ''), Math.max(0, HANDOFF + i * 40 - (performance.now() - T0)));
    });

    Promise.all(anims.map((x) => x.finished.catch(() => {}))).then(() => {
      h1?.classList.remove('masking');
      html.dataset.entrance = 'done';
      anims.forEach((x) => x.cancel());
    });
  }

  // ───────────── Reveal on scroll (inner pages) ─────────────
  const io = 'IntersectionObserver' in window && !reduceMotion
    ? new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))), { rootMargin: '0px 0px -8% 0px' })
    : null;
  document.querySelectorAll('.rv').forEach((el) => (io ? io.observe(el) : el.classList.add('in')));

  // ───────────── Editable content from the admin dashboard ─────────────
  let content = null;
  const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Absolute URLs: a relative url() set inline on a custom property would be
  // resolved against the stylesheet that uses it (assets/), not the page.
  const asset = (u) => {
    if (!u) return u;
    const base = u.startsWith('/uploads/') && API ? API + '/' : document.baseURI;
    return new URL(u, base).href;
  };

  function applyContent(c) {
    content = c;
    document.querySelectorAll('[data-c]').forEach((el) => {
      const v = get(c, el.dataset.c);
      if (typeof v === 'string' || typeof v === 'number') {
        if (el.hasAttribute('data-rich')) el.innerHTML = rich(v);
        else el.textContent = v;
      }
    });
    document.querySelectorAll('[data-c-lines]').forEach((el) => {
      const lines = get(c, el.dataset.cLines);
      if (!Array.isArray(lines) || !lines.length) return;
      el.innerHTML = lines.map((l) => `<span class="ln"><span>${esc(l)}</span></span>`).join('');
      el.setAttribute('aria-label', lines.join(' '));
    });
    document.querySelectorAll('[data-c-list]').forEach((el) => {
      const items = get(c, el.dataset.cList);
      const tpl = el.querySelector('template');
      if (!Array.isArray(items) || !tpl) return;
      el.querySelectorAll('[data-item]').forEach((n) => n.remove());
      const tones = (el.dataset.tones || '').split(/\s+/).filter(Boolean);
      items.forEach((item, i) => {
        const node = tpl.content.firstElementChild.cloneNode(true);
        node.setAttribute('data-item', '');
        if (tones.length) node.classList.add(tones[i % tones.length]);
        node.querySelectorAll('[data-f]').forEach((f) => {
          const v = f.dataset.f === '#' ? String(i + 1).padStart(2, '0') : item[f.dataset.f];
          if (v == null) return;
          if (f.hasAttribute('data-rich')) f.innerHTML = rich(v);
          else f.textContent = v;
        });
        el.appendChild(node);
      });
    });
    const imgs = c.images || {};
    const vars = { tenant: '--img-tenant', owner: '--img-owner', keypad: '--img-keypad', installer: '--img-installer', family: '--img-family', city: '--img-city', renderHallway: '--img-hallway', renderMacro: '--img-macro', device: '--img-device' };
    for (const [k, v] of Object.entries(vars)) if (imgs[k]) html.style.setProperty(v, `url("${asset(imgs[k])}")`);
    document.querySelectorAll('[data-c-src]').forEach((el) => {
      const v = get(c, el.dataset.cSrc);
      if (v) el.src = asset(v);
    });
    document.querySelectorAll('[data-c-tel]').forEach((el) => {
      const v = get(c, el.dataset.cTel);
      if (v) el.href = `tel:${v.replace(/[^\d+]/g, '')}`;
    });
    document.querySelectorAll('[data-c-mail]').forEach((el) => {
      const v = get(c, el.dataset.cMail);
      if (v) el.href = `mailto:${v}`;
    });
    document.querySelectorAll('[data-c-wa]').forEach((el) => {
      const v = get(c, el.dataset.cWa);
      if (v) el.href = `https://wa.me/${v.replace(/\D/g, '')}`;
    });
  }

  // Headline lines never wrap (the composition depends on line count); if an
  // edited line is too long for the column, shrink the whole headline to fit.
  function fitHeadlines() {
    document.querySelectorAll('.hero h1, .phero .display').forEach((h) => {
      h.style.fontSize = '';
      const avail = h.clientWidth;
      const widest = Math.max(0, ...[...h.querySelectorAll('.ln > span')].map((s) => s.scrollWidth));
      if (avail && widest > avail) {
        const base = parseFloat(getComputedStyle(h).fontSize);
        h.style.fontSize = `${Math.floor(base * (avail / widest) * 0.98)}px`;
      }
    });
  }

  fetch(`${API}/v1/public/content/site`, { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => j?.data && applyContent(j.data))
    .catch(() => {})
    .finally(() => document.fonts.ready.then(fitHeadlines));
  addEventListener('resize', () => requestAnimationFrame(fitHeadlines), { passive: true });

  // ───────────── Download sheet ─────────────
  const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.6 2.3 13.5 12l-9.9 9.7c-.4-.2-.6-.6-.6-1.1V3.4c0-.5.2-.9.6-1.1Zm11.1 10.9 2.6 2.6-11.6 6.6 9-9.2Zm0-2.4-9-9.2 11.6 6.6-2.6 2.6Zm3.6-1.2 2.9 1.7c.8.5.8 1.6 0 2.1l-2.9 1.7-2.8-2.8 2.8-2.7Z"/></svg>';
  const ICON_APPLE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-1.9-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.8-1-2.9-4.3ZM13.9 5.4c.7-.8 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4Z"/></svg>';
  let sheet;
  let lastFocus;

  function buildSheet() {
    sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.hidden = true;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'sheet-title');
    sheet.innerHTML = `
      <div class="scrim" data-close></div>
      <div class="box">
        <button class="x" type="button" data-close aria-label="Close"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3 3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        <span class="eyebrow">Get the app</span>
        <h2 class="display" id="sheet-title" style="margin-top:12px"><span class="ln">Power in</span><span class="ln">your pocket</span></h2>
        <div class="badges"></div>
        <div class="sheet-notify"></div>
      </div>`;
    document.body.appendChild(sheet);
    sheet.addEventListener('click', (e) => e.target.closest('[data-close]') && closeSheet());
  }

  function openSheet() {
    if (!sheet) buildSheet();
    const d = content?.download || {};
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    const badge = (url, icon, small, big) =>
      url
        ? `<a class="badge" href="${esc(url)}" target="_blank" rel="noopener">${icon}<span><small>${small}</small><b>${big}</b></span></a>`
        : `<div class="badge soon" aria-disabled="true">${icon}<span><small>Coming soon to</small><b>${big}</b></span></div>`;
    const android = badge(d.androidUrl, ICON_PLAY, 'Get it on', 'Google Play');
    const ios = badge(d.iosUrl, ICON_APPLE, 'Download on the', 'App Store');
    sheet.querySelector('.badges').innerHTML = isIOS ? ios + android : android + ios;
    const soon = sheet.querySelector('.sheet-notify');
    const missing = (isIOS && !d.iosUrl) || (isAndroid && !d.androidUrl) || (!d.androidUrl && !d.iosUrl);
    soon.innerHTML = missing
      ? `<p class="note"><strong>${esc(d.comingSoonTitle || 'The app is almost here')}.</strong> ${esc(d.comingSoonBody || '')}</p>
         <form class="notify" novalidate>
           <div class="row">
             <label class="sr-only" for="n-contact">Phone or email</label>
             <input id="n-contact" name="contact" autocomplete="email" placeholder="Phone number or email" required>
             <label class="sr-only" for="n-platform">Phone type</label>
             <select id="n-platform" name="platform" style="flex:0 0 auto">
               <option value="android"${isIOS ? '' : ' selected'}>Android</option>
               <option value="ios"${isIOS ? ' selected' : ''}>iPhone</option>
             </select>
           </div>
           <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
           <button class="pill" type="submit">Notify me</button>
           <div class="form-msg" role="status"></div>
         </form>`
      : '';
    soon.querySelector('form')?.addEventListener('submit', submitNotify);
    lastFocus = document.activeElement;
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
    sheet.querySelector('.badge:not(.soon), input, .x')?.focus();
  }

  function closeSheet() {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    document.body.style.overflow = '';
    lastFocus?.focus?.();
  }

  async function submitNotify(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const msg = form.querySelector('.form-msg');
    const btn = form.querySelector('button');
    const data = Object.fromEntries(new FormData(form));
    if (!data.contact || data.contact.trim().length < 5) {
      msg.className = 'form-msg bad';
      msg.textContent = 'Enter your phone number or email.';
      return;
    }
    btn.disabled = true;
    try {
      const r = await fetch(`${API}/v1/public/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message || 'Something went wrong');
      msg.className = 'form-msg ok';
      msg.textContent = 'Done — we’ll message you as soon as the app is live.';
      form.querySelector('.row').remove();
      btn.remove();
    } catch (err) {
      msg.className = 'form-msg bad';
      msg.textContent = err.message === 'Failed to fetch' ? 'Can’t reach smeter right now. Please try again.' : err.message;
      btn.disabled = false;
    }
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-download]');
    if (!t) return;
    e.preventDefault();
    openSheet();
  });

  // ───────────── Property-owner lead form ─────────────
  document.querySelectorAll('form[data-lead]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = form.querySelector('.form-msg');
      const btn = form.querySelector('button[type=submit]');
      form.querySelectorAll('.err').forEach((x) => (x.textContent = ''));
      const data = Object.fromEntries(new FormData(form));
      if (!data.units) delete data.units;
      if (!data.propertyType) delete data.propertyType;
      let bad = false;
      if (!data.fullName || data.fullName.trim().length < 2) bad = fieldErr(form, 'fullName', 'Enter your name');
      if (!data.phone || data.phone.replace(/\D/g, '').length < 10) bad = fieldErr(form, 'phone', 'Enter a valid phone number');
      if (bad) return;
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        const r = await fetch(`${API}/v1/public/owner-leads`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          const details = j?.error?.details || {};
          Object.entries(details).forEach(([k, v]) => fieldErr(form, k, v));
          throw new Error(j?.error?.message || 'Something went wrong');
        }
        form.reset();
        msg.className = 'form-msg ok';
        msg.textContent = get(content || {}, 'owners.formSuccess') || form.dataset.success;
      } catch (err) {
        msg.className = 'form-msg bad';
        msg.textContent = err.message === 'Failed to fetch' ? 'Can’t reach smeter right now. Please call us instead.' : err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Book my survey';
      }
    });
  });

  function fieldErr(form, name, text) {
    const el = form.querySelector(`[data-err="${name}"]`);
    if (el) el.textContent = text;
    return true;
  }

  const y = document.querySelector('[data-year]');
  if (y) y.textContent = new Date().getFullYear();
})();
