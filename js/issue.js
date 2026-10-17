/* THE WEB EDITION of one newsletter issue (newsletter-issue.html?i=<slug>).

   The page is static; the app's API feeds it. GET /api/newsletter/issue returns the issue already
   rendered by the very same code that built the email (so the two cannot disagree), plus the
   things this page needs around it: the opening, the contents, the polls. Everything below is what
   a mail client cannot do: a headline that reveals itself, a rail that follows the reader, polls that
   fill in live, a quiz that says whether you were right, a checklist to tick, a countdown, a vendor
   search, a share button.

   Depends on site.js (CANOPY_API_BASE, fetchJSON-style helpers, esc, lineReveals, the scroll-reveal
   observer). Nothing here is required to READ the issue: if this script fails, the HTML is still there. */
(function () {
  'use strict';

  const API = `${CANOPY_API_BASE}/api/newsletter`;
  const params = new URLSearchParams(location.search);
  const slug = (params.get('i') || '').trim();
  const $ = (id) => document.getElementById(id);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pad2 = (n) => String(n).padStart(2, '0');
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  /* ------------------------------------------------------------- colour */
  const rgb = (hex) => { const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '')); return m ? [0, 2, 4].map((i) => parseInt(m[1].substr(i, 2), 16)) : null; };
  const lum = (hex) => { const c = rgb(hex); if (!c) return 0; const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const rgba = (hex, a) => { const c = rgb(hex); return c ? `rgba(${c[0]},${c[1]},${c[2]},${a})` : hex; };

  /** The issue's own look becomes the page's: the ground, the paper, the ink, the accent. */
  function applyTheme(c) {
    c = c || {};
    const s = document.body.style;
    const page = c.page || '#2C3E50', card = c.card || '#F0E5D8', ink = c.ink || '#2C3E50', accent = c.accent || '#008080';
    const onPage = contrast(page, ink) >= contrast(page, card) ? ink : card;
    const set = (k, v) => s.setProperty(k, v);
    set('--nl-page', page); set('--nl-card', card); set('--nl-ink', ink);
    set('--nl-ink-soft', c.inkSoft || ink); set('--nl-ink-dim', c.inkDim || ink); set('--nl-panel', c.panel || card);
    set('--nl-rule', c.rule || rgba(ink, .18)); set('--nl-accent', accent); set('--nl-on-accent', c.onAccent || card); set('--nl-link', c.link || accent);
    set('--nl-on-page', onPage); set('--nl-on-page-dim', rgba(onPage, .74)); set('--nl-line', rgba(onPage, .26));
    /* the accent as TEXT on the ground: only if it can be read there, otherwise the ground's own ink */
    set('--nl-accent-on-page', contrast(accent, page) >= 3 ? accent : onPage);
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', page);
  }

  /* ------------------------------------------------------------ helpers */
  const monthName = (ym) => { const [y, m] = String(ym || '').split('-'); return MONTHS[Number(m) - 1] ? `${MONTHS[Number(m) - 1]} ${y}` : ''; };
  const sentOn = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `Sent ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`; };
  const issueLink = (s) => `newsletter-issue.html?i=${encodeURIComponent(s)}`;
  const shareUrl = () => `${location.origin}${location.pathname}?i=${encodeURIComponent(slug)}`;

  let toastTimer = 0;
  function toast(text) {
    const el = $('nl-toast'); if (!el) return;
    el.textContent = text; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  /** Like fetchJSON in site.js, except that a 404 is an answer ("that issue is not here"), not a reason to retry. */
  async function getJSON(url, { retries = 2, delayMs = 900 } = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.status === 404) { const e = new Error('not found'); e.notFound = true; throw e; }
        if (!res.ok) throw new Error('bad response');
        return await res.json();
      } catch (err) {
        if (err.notFound || attempt >= retries) throw err;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  function showMessage(title, text, actionsHtml) {
    document.body.dataset.state = 'message';
    $('nl-hero').hidden = true; $('nl-body').hidden = true; $('nl-after').hidden = true;
    const box = $('nl-message');
    box.innerHTML = `<div class="shell"><p class="nl-kicker">The newsletter</p><h1>${esc(title)}</h1><p>${esc(text)}</p><div class="nl-actions">${actionsHtml || '<a class="nl-btn nl-btn--solid" href="newsletter.html">Read every issue</a>'}</div></div>`;
    box.hidden = false;
  }

  /* ------------------------------------------------------ who is voting */
  const rand = (n) => { const a = new Uint8Array(n); (window.crypto || window.msCrypto).getRandomValues(a); return Array.from(a, (v) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'[v & 63]).join(''); };
  let memoryDevice = '';
  function deviceId() {
    try { let d = localStorage.getItem('nl:device'); if (!d || !/^[A-Za-z0-9_-]{16,64}$/.test(d)) { d = rand(24); localStorage.setItem('nl:device', d); } return d; }
    catch (_) { return memoryDevice || (memoryDevice = rand(24)); }
  }
  /* the reader's own link from the email carries a signed token in ?v=; it is kept for this visit and then taken
     out of the address bar, so sharing the page never shares somebody's vote */
  let voteToken = '';
  try { voteToken = params.get('v') || sessionStorage.getItem('nl:v:' + slug) || ''; if (params.get('v')) sessionStorage.setItem('nl:v:' + slug, params.get('v')); } catch (_) { voteToken = params.get('v') || ''; }
  const emailVote = { poll: params.get('p') || '', option: params.has('o') ? Number(params.get('o')) : -1 };
  function cleanAddress() {
    if (!params.has('v') && !params.has('p') && !params.has('o')) return;
    const u = new URL(location.href);
    ['v', 'p', 'o'].forEach((k) => u.searchParams.delete(k));
    try { history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (_) { /* a tidy address is a nicety */ }
  }

  /* ------------------------------------------------------ the opening */
  function renderHero(issue) {
    const label = issue.label || monthName(issue.month);
    const first = String(label).split(/\s+/)[0] || '';
    const ghost = MONTHS.some((m) => m.toLowerCase() === first.toLowerCase()) ? first.slice(0, 3).toUpperCase() : String(issue.month || '').slice(0, 4);
    const meta = [label, issue.read_min ? `${issue.read_min} min read` : '', issue.sent_at ? sentOn(issue.sent_at) : '', (issue.polls || []).length ? `${issue.polls.length} ${issue.polls.length === 1 ? 'poll' : 'polls'}, live results` : ''].filter(Boolean);
    const hero = $('nl-hero');
    hero.innerHTML = `<span class="nl-ghost" aria-hidden="true">${esc(ghost)}</span><div class="shell">`
      + `<p class="nl-kicker">${esc(issue.kicker || 'The newsletter')}</p>`
      + `<h1 class="nl-title" data-reveal-lines>${esc(issue.title)}</h1>`
      + (issue.deck ? `<p class="nl-deck">${esc(issue.deck)}</p>` : '')
      + `<span class="nl-draw" id="nl-draw"></span>`
      + `<ul class="nl-meta">${meta.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`
      + `<div class="nl-actions"><button type="button" class="nl-btn nl-btn--solid" data-act="start">Start reading &darr;</button><button type="button" class="nl-btn" data-act="share">Share</button><a class="nl-btn" href="newsletter.html">All issues</a></div></div>`;
    hero.hidden = false;
    if (typeof lineReveals === 'function') lineReveals();
    requestAnimationFrame(() => requestAnimationFrame(() => $('nl-draw') && $('nl-draw').classList.add('in')));
  }

  /* ---------------------------------------------- the rail and progress */
  function renderRail(issue) {
    const rail = $('nl-rail');
    const items = issue.outline || [];
    if (!items.length) { rail.hidden = true; return; }
    rail.innerHTML = `<h2>In this issue</h2><div class="track"><div class="fill"></div></div><ol>${items.map((o) => `<li><a href="#sec-${o.n}" data-n="${o.n}"><span class="n">${pad2(o.n)}</span><span class="t">${esc(o.kicker || o.title)}</span></a></li>`).join('')}</ol>`;
    rail.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#sec-"]'); if (!a) return;
      const t = document.getElementById(a.getAttribute('href').slice(1)); if (!t) return;
      e.preventDefault(); t.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    });
  }
  function trackReading() {
    const bar = $('nl-progress'), paper = $('nl-paper'), rail = $('nl-rail');
    const anchors = () => [...document.querySelectorAll('#nl-content [id^="sec-"]')];
    let queued = false;
    const tick = () => {
      queued = false;
      const r = paper.getBoundingClientRect(), total = Math.max(1, r.height - innerHeight * 0.55);
      const p = Math.max(0, Math.min(1, (innerHeight * 0.25 - r.top) / total));
      bar.style.transform = `scaleX(${p})`;
      if (rail && !rail.hidden) {
        let on = -1; anchors().forEach((a, i) => { if (a.getBoundingClientRect().top <= 160) on = i; });
        rail.querySelectorAll('a').forEach((a, i) => a.classList.toggle('on', i === on));
        const f = rail.querySelector('.fill'); if (f) f.style.setProperty('--p', String(p));
      }
    };
    const ask = () => { if (!queued) { queued = true; requestAnimationFrame(tick); } };
    addEventListener('scroll', ask, { passive: true }); addEventListener('resize', ask); tick();
  }

  /* -------------------------------------------------------------- polls */
  async function pollApi(key) {
    const q = new URLSearchParams({ i: slug, p: key, d: deviceId() }); if (voteToken) q.set('v', voteToken);
    return getJSON(`${API}/poll?${q}`, { retries: 1 });
  }
  async function castVote(key, option) {
    const send = async (token) => {
      const res = await fetch(`${API}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ i: slug, p: key, o: option, d: deviceId(), ...(token ? { v: token } : {}) }) });
      const data = await res.json().catch(() => ({}));
      return { res, data };
    };
    let out = await send(voteToken);
    /* a token that does not check out (an old link, a cut-off one) must not stop a reader voting: they vote as this device */
    if (out.res.status === 400 && voteToken) { voteToken = ''; try { sessionStorage.removeItem('nl:v:' + slug); } catch (_) { /* nothing to remove */ } out = await send(''); }
    if (!out.res.ok) throw new Error(out.data.error || "That didn't go through. Try again in a moment.");
    return out.data;
  }

  function confetti(from) {
    if (reduced()) return;
    const box = document.createElement('div'); box.className = 'nl-confetti'; box.setAttribute('aria-hidden', 'true');
    const r = from.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + Math.min(r.height / 2, 80);
    const colours = ['#FF6F61', '#008080', '#F5B7B1', '#FAF3E0', '#2C3E50'];
    for (let n = 0; n < 46; n++) {
      const i = document.createElement('i');
      i.style.cssText = `--x:${cx}px;--y:${cy}px;--c:${colours[n % colours.length]};--dx:${Math.round((Math.random() - 0.5) * 560)}px;--py:${-Math.round(60 + Math.random() * 200)}px;--fy:${Math.round(120 + Math.random() * 360)}px;--r:${Math.round((Math.random() - 0.5) * 900)}deg;animation-delay:${Math.round(Math.random() * 120)}ms`;
      box.appendChild(i);
    }
    document.body.appendChild(box); setTimeout(() => box.remove(), 2200);
  }

  function buildPoll(el, meta) {
    const cell = el.querySelector('td'); if (!cell) return;
    const optTables = [...cell.querySelectorAll('a[data-opt]')].map((a) => a.closest('table')).filter(Boolean);
    if (!optTables.length) return;
    const foot = cell.lastElementChild;
    const quiz = meta.answer >= 0;
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="nl-opts" role="group" aria-label="${esc(meta.title)}">${meta.options.map((o, i) => `<button type="button" class="nl-opt" data-i="${i}" aria-pressed="false"><span class="lbl">${esc(o)}</span><span class="pct" aria-hidden="true"></span></button>`).join('')}</div>`
      + `<p class="nl-pollnote" aria-live="polite"></p><div class="nl-verdict" hidden></div>`
      + `<div class="nl-polltools"><button type="button" class="nl-link" data-act="peek">${quiz ? 'Show me how everyone answered' : 'Show me the results first'}</button></div>`;
    optTables[0].before(wrap);
    optTables.forEach((t) => t.remove());
    if (foot && foot.tagName === 'P') foot.remove();

    const buttons = [...wrap.querySelectorAll('.nl-opt')], note = wrap.querySelector('.nl-pollnote'), verdict = wrap.querySelector('.nl-verdict'), peek = wrap.querySelector('[data-act="peek"]');
    let counts = meta.options.map(() => 0), total = 0, mine = -1, shown = false, busy = false;

    function paint() {
      buttons.forEach((b, i) => {
        const n = counts[i] || 0;
        b.style.setProperty('--w', shown && total ? String(n / total) : '0');
        b.querySelector('.pct').textContent = shown ? `${total ? Math.round((100 * n) / total) : 0}%` : '';
        b.classList.toggle('mine', i === mine);
        b.setAttribute('aria-pressed', i === mine ? 'true' : 'false');
        b.classList.toggle('right', quiz && shown && mine >= 0 && i === meta.answer);
        b.classList.toggle('wrong', quiz && shown && mine >= 0 && i === mine && i !== meta.answer);
      });
      if (quiz && mine >= 0) {
        const ok = mine === meta.answer;
        verdict.hidden = false; verdict.classList.toggle('no', !ok);
        verdict.innerHTML = `<b>${ok ? 'You got it.' : 'Not quite.'}</b>` + `<p>${ok ? '' : esc(`The answer is ${meta.options[meta.answer]}. `)}${esc(meta.reveal || '')}${total ? esc(` ${Math.round((100 * (counts[meta.answer] || 0)) / total)}% of readers got it right.`) : ''}</p>`;
      } else verdict.hidden = true;
      note.textContent = shown ? `${total} ${total === 1 ? 'vote' : 'votes'} so far${mine >= 0 ? '. Tap another to change yours.' : '.'}` : '';
      peek.hidden = shown;
    }
    const take = (d) => { counts = meta.options.map((_, i) => Number((d.counts || [])[i]) || 0); total = Number(d.total) || counts.reduce((a, b) => a + b, 0); if (typeof d.yours === 'number') mine = d.yours >= 0 && d.yours < meta.options.length ? d.yours : -1; };
    async function refresh(quiet) {
      try { take(await pollApi(meta.key)); if (mine >= 0) shown = true; paint(); } catch (_) { if (!quiet) note.textContent = 'The results are not loading just now.'; }
    }
    async function vote(i, fromEmail) {
      if (busy) return; busy = true;
      const first = mine < 0, before = mine;
      mine = i; shown = true; paint(); note.textContent = 'Counting your vote…';
      try {
        take(await castVote(meta.key, i)); mine = i; paint();
        if (before !== i) { const ok = quiz ? i === meta.answer : first; if (ok) confetti(buttons[i]); }
        if (fromEmail) toast('Your vote is in.');
      } catch (err) { mine = before; paint(); note.textContent = err.message; }
      busy = false;
    }
    buttons.forEach((b) => b.addEventListener('click', () => vote(Number(b.dataset.i), false)));
    peek.addEventListener('click', () => { shown = true; paint(); refresh(); });
    paint();
    refresh(true).then(() => {
      if (emailVote.poll === meta.key && emailVote.option >= 0 && emailVote.option < meta.options.length) {
        vote(emailVote.option, true); el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }); emailVote.poll = '';
        cleanAddress();
      }
    });
    /* live: while the results are on screen and the tab is in front, check again every so often */
    setInterval(() => { if (shown && !document.hidden && !busy) refresh(true); }, 25000);
  }

  /* ------------------------------------------------ the smaller delights */
  function buildChecklists() {
    const tables = [...document.querySelectorAll('#nl-content table[data-steps="checks"]')];
    tables.forEach((t, ti) => {
      const rows = [...t.querySelectorAll('tr[data-check]')]; if (!rows.length) return;
      const key = (i) => `nl:chk:${slug}:${ti}:${i}`;
      const count = document.createElement('p'); count.className = 'nl-gathered'; t.after(count);
      const update = () => { const n = rows.filter((r) => r.classList.contains('done')).length; count.textContent = n === rows.length ? 'Everything gathered. Time to start.' : `${n} of ${rows.length} gathered`; };
      rows.forEach((r, i) => {
        r.setAttribute('role', 'checkbox'); r.tabIndex = 0;
        try { if (localStorage.getItem(key(i)) === '1') r.classList.add('done'); } catch (_) { /* nothing remembered */ }
        r.setAttribute('aria-checked', r.classList.contains('done') ? 'true' : 'false');
        const flip = () => { const on = r.classList.toggle('done'); r.setAttribute('aria-checked', on ? 'true' : 'false'); try { on ? localStorage.setItem(key(i), '1') : localStorage.removeItem(key(i)); } catch (_) { /* fine */ } update(); };
        r.addEventListener('click', flip);
        r.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
      });
      update();
    });
  }
  function buildCountdowns() {
    const now = new Date(), today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    document.querySelectorAll('#nl-content [data-ticket]').forEach((t) => {
      const [y, m, d] = t.dataset.ticket.split('-').map(Number); if (!y) return;
      const days = Math.round((Date.UTC(y, m - 1, d) - today) / 864e5);
      const text = days > 1 ? `In ${days} days` : days === 1 ? 'Tomorrow' : days === 0 ? 'Today' : 'This one has happened';
      const cells = t.querySelectorAll(':scope > tbody > tr > td'), details = cells[1]; if (!details) return;
      const chip = document.createElement('span'); chip.className = 'nl-count'; chip.textContent = text; details.prepend(chip);
    });
  }
  function buildVendorSearch() {
    document.querySelectorAll('#nl-content table[data-vendor-grid]').forEach((grid) => {
      const cells = [...grid.querySelectorAll('[data-vname]')]; if (cells.length < 6) return;
      const box = document.createElement('div'); box.className = 'nl-find';
      box.innerHTML = '<input type="search" placeholder="Find a vendor" aria-label="Find a vendor"><small aria-live="polite"></small>';
      const found = document.createElement('div'); found.hidden = true; grid.before(box); grid.after(found);
      const input = box.querySelector('input'), count = box.querySelector('small');
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        if (!q) { grid.hidden = false; found.hidden = true; count.textContent = ''; return; }
        const hits = cells.filter((c) => c.dataset.vname.includes(q));
        grid.hidden = true; found.hidden = false;
        found.innerHTML = hits.length ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">${hits.map((c) => `<tr>${c.outerHTML.replace(/ width="50%"/, '').replace(/width:50%;/, '')}</tr>`).join('')}</table>` : '<p class="nl-none">No vendor with that in the name yet.</p>';
        count.textContent = `${hits.length} of ${cells.length}`;
      });
    });
  }

  /* ------------------------------------------------------- after it all */
  function renderAfter(issue) {
    const pn = (i, dir) => (i ? `<a class="${dir}" href="${issueLink(i.slug)}"><span>${dir === 'prev' ? 'The one before' : 'The next one'}</span><strong>${esc(i.title)}</strong></a>` : '<div></div>');
    const after = $('nl-after');
    after.innerHTML = `<div class="shell">${issue.prev || issue.next ? `<div class="nl-pn">${pn(issue.prev, 'prev')}${pn(issue.next, 'next')}</div>` : ''}`
      + `<div class="nl-cta"><div><h2>Get the next one first.</h2><p>One email a month: the next market, a story worth the time, a project, and a poll.</p></div><button type="button" class="nl-btn" data-act="join">Join the list</button></div></div>`;
    after.hidden = false;
  }

  async function share(issue) {
    const data = { title: issue.title, text: issue.deck || issue.subject || '', url: shareUrl() };
    if (navigator.share) { try { await navigator.share(data); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(data.url); toast('Link copied.'); } catch (_) { toast(data.url); }
  }

  /* --------------------------------------------------------------- go */
  let drawn = '';
  function render(issue) {
    const stamp = JSON.stringify([issue.slug, issue.sent_at, (issue.html || '').length, issue.title]);
    if (stamp === drawn) return;
    const first = !drawn; drawn = stamp;
    document.body.dataset.state = 'ready';
    applyTheme(issue.colors);
    document.title = `${issue.title} | RVA Tropical & Exotic Plants`;
    const desc = document.querySelector('meta[name="description"]'); if (desc && (issue.deck || issue.preheader)) desc.setAttribute('content', issue.deck || issue.preheader);
    const canon = document.querySelector('link[rel="canonical"]'); if (canon) canon.setAttribute('href', `https://rvatropicalandexoticplants.org/newsletter-issue.html?i=${encodeURIComponent(issue.slug)}`);
    $('nl-message').hidden = true;
    renderHero(issue);
    const content = $('nl-content');
    content.innerHTML = issue.html || '';
    [...content.children].forEach((c) => c.classList.add('reveal'));
    const toc = content.querySelector('a[href^="#sec-"]'); if (toc) { const t = toc.closest('table'); if (t) t.classList.add('nl-inline-toc'); }
    renderRail(issue);
    $('nl-body').hidden = false;
    if (issue.legacy) { $('nl-rail').hidden = true; }
    const polls = issue.polls || [];
    content.querySelectorAll('[data-poll]').forEach((el) => { const m = polls.find((p) => p.key === el.dataset.poll); if (m) buildPoll(el, m); });
    buildChecklists(); buildCountdowns(); buildVendorSearch();
    renderAfter(issue);
    if (first) trackReading();
    document.addEventListener('click', onClick);
    window.__issue = issue;
  }
  function onClick(e) {
    const a = e.target.closest('[data-act]'); if (!a) return;
    const issue = window.__issue; if (!issue) return;
    if (a.dataset.act === 'share') share(issue);
    else if (a.dataset.act === 'start') { const p = $('nl-paper'); if (p) p.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); }
    else if (a.dataset.act === 'join') { const f = $('newsletter-form'); if (f) { f.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }); const i = f.querySelector('input[type="email"]'); if (i) setTimeout(() => i.focus(), 450); } }
  }

  async function main() {
    if (!slug) { showMessage('Pick an issue.', 'Every issue we have sent is kept, month by month, and open to anyone.'); return; }
    if (slug === 'preview') {
      showMessage('This is where the issue will live.', 'You are looking at a test send. Once the issue goes out to the list, this link opens the full interactive edition: the story, the market, the project, and polls that fill in live.');
      return;
    }
    const cacheName = 'issue:' + slug;
    const cached = readApiCache(cacheName);
    if (cached && cached.html) render(cached);
    try {
      const { issue } = await getJSON(`${API}/issue?i=${encodeURIComponent(slug)}`);
      if (!issue) throw new Error('bad response');
      writeApiCache(cacheName, issue);
      render(issue);
    } catch (err) {
      if (cached && cached.html) return;
      if (err.notFound) showMessage("We can't find that issue.", 'It may have been taken down, or the link was cut short. Every issue we have kept is in the archive.');
      else showMessage("The issue isn't loading right now.", 'The page that holds it needs a moment to wake up. Give it a few seconds and try again.', '<button type="button" class="nl-btn nl-btn--solid" onclick="location.reload()">Try again</button><a class="nl-btn" href="newsletter.html">Read every issue</a>');
    }
  }
  main();
})();
