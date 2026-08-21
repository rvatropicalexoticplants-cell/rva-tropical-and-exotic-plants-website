/* THE CANOPY marketing site — shared chrome + live-data behaviors.
   Deliberately NOT canopy.js: this site is static and backend-less by
   design (no session, no demo personas), so it only borrows the two
   self-contained visual signatures (scroll reveal, headline line-reveal)
   and re-implements nav-toggle wiring against static markup instead of
   canopy.js's JS-injected masthead/footer, which assumes session state
   this site doesn't have. */

/* ---- one place to point at the live Canopy app --------------------------
   Every [data-app-link] on every page picks this up automatically, nothing
   else to touch. Must also stay in sync with api/src/lib/cors.js's
   ALLOWED_ORIGIN on the API side (that one controls which origin the API
   answers, not which origin this links to). */
const CANOPY_APP_URL = 'https://canopy.rvatropicalandexoticplants.org';
const CANOPY_API_BASE = CANOPY_APP_URL;

document.querySelectorAll('[data-app-link]').forEach((a) => {
  const suffix = a.dataset.appLink || '';
  a.href = CANOPY_APP_URL + (suffix ? '/' + suffix : '/');
});

/* ---- nav toggle (mobile) — same behavior as canopy.js's masthead(),
   ported against this site's static <header> markup ---- */
(function initNav() {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('main-nav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) { nav.classList.remove('open'); toggle.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }
  });
})();

document.getElementById('foot-year')?.append(String(new Date().getFullYear()));

/* ---- scroll reveal — ported verbatim from app/js/canopy.js's reveals(),
   the same shared observer .draw-rule rides for its line-draw ---- */
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let revealIO;
function reveals() {
  const els = document.querySelectorAll('.reveal:not(.in), .reveal-left:not(.in), .reveal-right:not(.in), .draw-rule:not(.in)');
  if (!('IntersectionObserver' in window) || reducedMotion()) { els.forEach((e) => e.classList.add('in')); return; }
  revealIO ??= new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const el = en.target;
      const sibs = [...(el.parentElement?.children || [])]
        .filter((n) => n.classList?.contains('reveal') || n.classList?.contains('reveal-left') || n.classList?.contains('reveal-right'));
      el.style.setProperty('--reveal-i', String(Math.max(0, Math.min(sibs.indexOf(el), 7))));
      el.classList.add('in');
      revealIO.unobserve(el);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  els.forEach((e) => revealIO.observe(e));
}
/* content that arrives after fetch (events, gallery) creates fresh .reveal
   nodes nothing is watching yet — re-sweep whenever the DOM changes */
new MutationObserver(() => reveals()).observe(document.body, { childList: true, subtree: true });
reveals();

/* ---- headline line-reveal — ported verbatim from canopy.js ---- */
let lineIO;
function splitIntoLines(el) {
  const source = el.dataset.lineSource ?? el.textContent.trim().replace(/\s+/g, ' ');
  if (!source) return;
  el.dataset.lineSource = source;
  el.textContent = '';
  const wordSpans = source.split(' ').map((word) => {
    const s = document.createElement('span');
    s.textContent = word; s.style.display = 'inline-block';
    el.append(s, document.createTextNode(' '));
    return s;
  });
  const lines = [];
  let lineTop = null;
  for (const span of wordSpans) {
    if (lineTop === null || Math.abs(span.offsetTop - lineTop) > 2) { lines.push([]); lineTop = span.offsetTop; }
    lines[lines.length - 1].push(span.textContent);
  }
  el.textContent = '';
  lines.forEach((words, i) => {
    const band = document.createElement('span');
    band.className = 'line-reveal';
    band.style.setProperty('--reveal-i', String(i));
    const mover = document.createElement('span');
    mover.textContent = words.join(' ') + (i < lines.length - 1 ? ' ' : '');
    band.append(mover);
    el.append(band);
  });
  el.setAttribute('aria-label', source);
  if (el.classList.contains('lines-in')) el.querySelectorAll('.line-reveal').forEach((b) => b.classList.add('in'));
}
function lineReveals() {
  document.querySelectorAll('[data-reveal-lines]:not([data-lines-bound])').forEach((el) => {
    el.dataset.linesBound = '1';
    if (el.children.length && !el.querySelector('.line-reveal')) return;
    if (reducedMotion()) return;
    splitIntoLines(el);
    lineIO ??= new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add('lines-in');
        en.target.querySelectorAll('.line-reveal').forEach((b) => b.classList.add('in'));
        lineIO.unobserve(en.target);
      });
    }, { threshold: 0.2 });
    lineIO.observe(el);
  });
}
lineReveals();
let resplitTimer;
window.addEventListener('resize', () => {
  if (reducedMotion()) return;
  clearTimeout(resplitTimer);
  resplitTimer = setTimeout(() => document.querySelectorAll('[data-reveal-lines][data-lines-bound]').forEach(splitIntoLines), 180);
});

/* ---- escaping — admin-authored event/feed text lands as data, not markup,
   same stance app/js/canopy.js takes everywhere else ---- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* Media paths from the app's API (event/team/feed photos) come back as
   relative `/api/media/<name>` links meant to be served from the app's own
   origin — resolving them bare on this site's different origin 404s, so
   every one has to be rebased onto CANOPY_APP_URL before it hits an <img>. */
function mediaUrl(path) { return !path || /^https?:\/\//i.test(path) ? path : CANOPY_APP_URL + path; }

/* ---- RSVP social proof — a nudge for someone on the fence, not a promise
   of a headcount: rsvp_count is api/src/functions/rsvps.js's own summed
   party_size (how many people, not how many RSVP rows). Most real RSVPs
   still happen on Facebook, not this form, so this count runs well under
   true turnout, especially early on — a small number here reads as "barely
   anyone's coming," which is worse than saying nothing. Stays hidden below
   the admin-tunable rsvp_social_proof_min (Site panel → staff-settings.js,
   GET /api/events echoes it back for this exact reason), same as it
   already does at 0, so it only ever shows once it's a genuinely
   reassuring number. Defaults to 5 until the first /api/events response
   lands with the real configured value. */
let RSVP_SOCIAL_PROOF_MIN = 5;
function rsvpCountLabel(count) {
  if (!count || count < RSVP_SOCIAL_PROOF_MIN) return '';
  const n = Math.round(count);
  return `<p class="small" style="margin-top:.6rem; color:var(--teal)">${n} people are coming</p>`;
}

/* ---- JSON-LD injection — one <script type="application/ld+json"> per
   live event, built the moment it's rendered so a crawler or an AI answer
   engine reading this page sees real structured data for whatever's
   actually on the calendar, not just whatever was true at deploy time. ---- */
function injectEventJsonLd(events) {
  document.querySelectorAll('script[data-event-ld]').forEach((n) => n.remove());
  events.forEach((ev) => {
    if (ev.status === 'draft' || !ev.date_timestamp) return;
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.eventLd = ev.event_id;
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: ev.title,
      startDate: ev.date_timestamp,
      endDate: ev.end_timestamp || undefined,
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      eventStatus: ev.status === 'active' ? 'https://schema.org/EventScheduled' : 'https://schema.org/EventScheduled',
      description: ev.blurb || undefined,
      image: ev.img ? [ev.img] : undefined,
      location: {
        '@type': 'Place',
        name: ev.venue_name || 'RVA Tropical & Exotic Plants',
        address: ev.address || 'Richmond, VA',
      },
      organizer: {
        '@type': 'NGO',
        name: 'RVA Tropical & Exotic Plants',
        url: 'https://rvatropicalandexoticplants.org',
      },
    });
    document.head.appendChild(script);
  });
}

/* ---- the API runs on a serverless consumption plan (Azure cost
   constraint — no Always Ready plan to keep it warm), so it spins down
   after ~20min idle. The first fetch after that has to cold-boot the
   function host and can be slow enough to fail outright, which used to
   drop straight to the zero-state — looking broken until the visitor
   manually refreshed into an already-warm function. Retry a couple times
   with a short backoff before giving up so a cold start resolves on its
   own instead of needing a refresh. ---- */
async function fetchJSON(url, { retries = 2, delayMs = 800 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('bad response');
      return await res.json();
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/* ---- upcoming events: shared by index.html's teaser and events.html's
   full calendar. `limit` caps the teaser; omit it for the full list.
   Same graceful-empty posture as app/js/data.js — a fetch failure or an
   empty calendar both render a designed zero-state, never a blank hole. ---- */
async function loadEvents({ hostId, limit, showPast = false } = {}) {
  const host = document.getElementById(hostId);
  if (!host) return;
  let events = [];
  try {
    let rsvpSocialProofMin;
    ({ events, rsvp_social_proof_min: rsvpSocialProofMin } = await fetchJSON(`${CANOPY_API_BASE}/api/events`));
    if (typeof rsvpSocialProofMin === 'number') RSVP_SOCIAL_PROOF_MIN = rsvpSocialProofMin;
  } catch (_) {
    host.innerHTML = `<div class="zero-state reveal">
      <p class="overline" style="margin-bottom:.6rem">between markets</p>
      <p style="font-family:var(--font-display); font-weight:600; font-size:1.3rem; color:var(--navy); margin-bottom:.5rem">The calendar's taking a moment.</p>
      <p class="small">Nothing loaded just now. The full lineup always lives on
        <a class="uline" style="color:var(--teal)" href="${CANOPY_APP_URL}/index.html#upcoming">the Canopy app</a>.</p>
    </div>`;
    return;
  }
  const now = new Date().toISOString().slice(0, 10);
  let shown = events.filter((e) => e.status !== 'draft' && (showPast || !e.date_timestamp || e.date_timestamp.slice(0, 10) >= now));
  injectEventJsonLd(shown);
  if (typeof limit === 'number') shown = shown.slice(0, limit);

  if (!shown.length) {
    host.innerHTML = `<div class="zero-state reveal">
      <p class="overline" style="margin-bottom:.6rem">between markets</p>
      <p style="font-family:var(--font-display); font-weight:600; font-size:1.3rem; color:var(--navy); margin-bottom:.5rem">The next one is being potted up.</p>
      <p class="small">Nothing on the calendar right now. The moment a market posts, it shows up here.</p>
    </div>`;
    return;
  }

  host.innerHTML = `<div class="ev-rail">${shown.map((ev, i) => {
    const d = ev.date_timestamp ? new Date(ev.date_timestamp) : null;
    const day = d ? d.getDate() : '';
    const moyr = d ? d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
    return `
    <article class="ev-row reveal" data-ev-row="${esc(ev.event_id)}" style="--reveal-i:${Math.min(i, 7)}">
      <div class="ev-head" style="cursor:default">
        <span class="ev-date"><span class="day">${day}</span><span class="mo">${esc(moyr)}</span></span>
        <span>
          <span class="ev-kind">${esc(ev.kind || 'market')}</span>
          <h3 class="ev-title" style="margin:0">${esc(ev.title)}</h3>
          <span class="ev-meta">${esc(ev.venue_name || '')}</span>
        </span>
      </div>
      <div class="ev-body${ev.img ? ' ev-body--photo' : ''}">
        <div>
          ${ev.blurb ? `<p>${esc(ev.blurb)}</p>` : ''}
          ${ev.address ? `<p class="small" style="margin-top:.5rem"><a class="uline" style="color:var(--teal)" href="https://maps.google.com/?q=${encodeURIComponent(ev.address)}" target="_blank" rel="noopener">get directions ↗</a></p>` : ''}
          ${rsvpCountLabel(ev.rsvp_count)}
          <p style="margin-top:.8rem"><a class="uline" style="color:var(--coral)" href="#rsvp-form" data-pick-event="${esc(ev.event_id)}">let us know you're coming ↓</a>
            &nbsp;·&nbsp; <a class="uline" style="color:var(--teal)" data-app-link="apply.html">bring a table instead ↗</a></p>
        </div>
        ${ev.img ? `<figure class="tl-photo tl-photo--event">
          <img src="${esc(mediaUrl(ev.img))}" alt="${esc(ev.title)}" loading="lazy" decoding="async">
          <span class="veil"></span>
          <figcaption class="veil-label">${esc(moyr)}</figcaption>
        </figure>` : ''}
      </div>
    </article>`;
  }).join('')}</div>`;

  document.querySelectorAll('[data-app-link]').forEach((a) => { a.href = CANOPY_APP_URL + '/' + (a.dataset.appLink || ''); });

  const picker = document.getElementById('rsvp-event');
  if (picker) {
    /* the title alone is ambiguous — several markets share the exact same
       name across different dates (multiple "RVA Plant Swap & Market"
       entries), so the date has to be in the option text itself, not just
       on the card someone already scrolled past. */
    picker.innerHTML = shown.map((e) => {
      const label = e.date_timestamp
        ? `${e.title} — ${new Date(e.date_timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
        : e.title;
      return `<option value="${esc(e.event_id)}">${esc(label)}</option>`;
    }).join('');
    host.querySelectorAll('[data-pick-event]').forEach((link) => {
      link.addEventListener('click', () => { picker.value = link.dataset.pickEvent; });
    });
  }
}

/* ---- photo gallery: live noticeboard photos/videos merged with the
   static archive file. This is the whole "easily updatable" mechanism —
   posting a photo through the Canopy admin's noticeboard is enough; the
   archive file only exists for older photos that predate that habit.

   Laid out as a mosaic rather than a uniform grid — every 5th photo runs
   big (2x2) so the wall has rhythm instead of reading like a spreadsheet —
   and every tile opens a full lightbox on click, reusing canopy.css's own
   .lightbox-* classes so it matches the rest of the design system exactly. ---- */
async function loadGallery(hostId) {
  const host = document.getElementById(hostId);
  if (!host) return;
  let live = [];
  try {
    const { posts } = await fetchJSON(`${CANOPY_API_BASE}/api/feed`);
    live = (posts || [])
      .filter((p) => p.kind === 'photo' && p.photo)
      .map((p) => ({ src: mediaUrl(p.photo), alt: p.title || 'A photo from a Canopy market', caption: p.title || '' }));
  } catch (_) { /* archive file still stands */ }

  let archive = [];
  try {
    const res = await fetch('data/gallery.json');
    if (res.ok) archive = await res.json();
  } catch (_) { /* nothing archived yet */ }

  const photos = [...live, ...archive].slice(0, 24);
  if (!photos.length) { host.innerHTML = `<p class="gallery-empty">Photos from the next market land here first.</p>`; return; }
  host.innerHTML = photos.map((p, i) => `
    <figure class="gallery-item reveal ${i % 5 === 0 ? 'gallery-item--big' : ''}" style="--reveal-i:${Math.min(i % 8, 7)}" data-gallery-open="${i}" tabindex="0" role="button" aria-label="View this photo larger">
      <img src="${esc(p.src)}" alt="${esc(p.alt || '')}" loading="lazy" decoding="async">
      ${p.caption ? `<figcaption class="gallery-cap">${esc(p.caption)}</figcaption>` : ''}
    </figure>`).join('');

  const open = (i) => {
    const p = photos[i];
    if (!p) return;
    const overlay = document.getElementById('gallery-lightbox');
    if (!overlay) return;
    overlay.querySelector('#lightbox-img').src = p.src;
    overlay.querySelector('#lightbox-img').alt = p.alt || '';
    overlay.querySelector('#lightbox-caption').textContent = p.caption || '';
    overlay.hidden = false;
  };
  host.querySelectorAll('[data-gallery-open]').forEach((el) => {
    el.addEventListener('click', () => open(Number(el.dataset.galleryOpen)));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(Number(el.dataset.galleryOpen)); } });
  });
}

/* ---- lightbox close (shared by whichever page has the overlay markup) ---- */
(function initLightbox() {
  const overlay = document.getElementById('gallery-lightbox');
  if (!overlay) return;
  const close = () => { overlay.hidden = true; overlay.querySelector('#lightbox-img').src = ''; };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.lightbox-close')?.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });
})();

/* ---- founder/team photos on About — pulled live from the Canopy app's
   own /api/team (the same source app/story.html renders), so a real photo
   shows up here automatically the moment an admin sets one on their own
   profile in the app, with no separate upload or step on this site. Stays
   hidden entirely rather than showing a placeholder avatar for someone who
   hasn't set a photo yet. ---- */
async function loadTeam() {
  const section = document.getElementById('team-section');
  if (!section) return;
  let team = [];
  try {
    ({ team } = await fetchJSON(`${CANOPY_API_BASE}/api/team`));
  } catch (_) { /* no live data yet — section stays hidden */ }
  if (!team || !team.length) return;
  section.hidden = false;
  document.getElementById('team-roster').innerHTML = team.map((p) => `
    <div class="reveal">
      <div style="width:100%; aspect-ratio:1; overflow:hidden; background:var(--canvas-sunk); margin-bottom:1rem; max-width:10rem">
        ${p.photo ? `<img src="${esc(mediaUrl(p.photo))}" alt="${esc(p.name)}" style="width:100%; height:100%; object-fit:cover" loading="lazy">`
          : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:2rem">🌿</div>`}
      </div>
      <p style="font-family:var(--font-display); font-weight:600; color:var(--navy); margin-bottom:.2rem">${esc(p.name)}</p>
      ${p.tagline ? `<p class="small" style="color:var(--coral); margin-bottom:.4rem">${esc(p.tagline)}</p>` : ''}
      ${p.intro ? `<p class="small" style="color:var(--navy-dim)">${esc(p.intro)}</p>` : ''}
    </div>`).join('');
}

/* ---- shared "voiced" submit-state helper for the three public forms ---- */
function formState(form, msgEl, state, text) {
  const btn = form.querySelector('button[type="submit"]');
  if (state === 'sending') { btn.disabled = true; btn.dataset.label ??= btn.textContent; btn.textContent = 'Sending…'; msgEl.hidden = true; return; }
  btn.disabled = false; btn.textContent = btn.dataset.label || btn.textContent;
  msgEl.hidden = false; msgEl.className = `form-note ${state}`; msgEl.textContent = text;
}
/* fetch() throws a bare TypeError ("Failed to fetch") for anything that
   never got a response at all — offline, a CORS block, the API being
   down — and that raw string is a browser implementation detail, not
   something to show a person. Any other error already carries the API's
   own voiced message (see rsvps.js/newsletter-subscribe.js/contact-submit.js). */
function formErrorText(err) {
  return err instanceof TypeError ? "That didn't go through. Give it a moment and try again." : err.message;
}

document.getElementById('rsvp-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = document.getElementById('rsvp-msg');
  const payload = {
    event_id: form.event.value, name: form.name.value, email: form.email.value,
    party_size: Number(form.party.value || 1), bringing_swap: !!form.swap?.checked,
  };
  if (!payload.event_id) { formState(form, msg, 'err', 'Pick which market first.'); return; }
  formState(form, msg, 'sending');
  try {
    const res = await fetch(`${CANOPY_API_BASE}/api/rsvps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "That didn't save. One more try?");
    formState(form, msg, 'ok', `You're on the list, ${payload.name.split(' ')[0]}. See you there.`);
    form.reset();
  } catch (err) { formState(form, msg, 'err', formErrorText(err)); }
});

document.getElementById('newsletter-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = document.getElementById('newsletter-msg');
  formState(form, msg, 'sending');
  try {
    const res = await fetch(`${CANOPY_API_BASE}/api/newsletter/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.email.value, name: form.subscriber_name?.value || '' }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "That didn't save. One more try?");
    formState(form, msg, 'ok', "You're on the list.");
    form.reset();
  } catch (err) { formState(form, msg, 'err', formErrorText(err)); }
});

document.getElementById('contact-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = document.getElementById('contact-msg');
  formState(form, msg, 'sending');
  try {
    const res = await fetch(`${CANOPY_API_BASE}/api/contact`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name.value, email: form.email.value, message: form.message.value, company: form.company.value }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "That didn't send. One more try?");
    formState(form, msg, 'ok', "Thanks — we'll get back to you.");
    form.reset();
  } catch (err) { formState(form, msg, 'err', formErrorText(err)); }
});

/* ---- FAQ accordion — one open row at a time, same as the events rail ---- */
document.querySelectorAll('.faq-row .faq-q').forEach((btn) => {
  btn.addEventListener('click', () => {
    const row = btn.closest('.faq-row');
    const wasOpen = row.classList.contains('open');
    row.parentElement.querySelectorAll('.faq-row.open').forEach((r) => r.classList.remove('open'));
    if (!wasOpen) row.classList.add('open');
  });
});
