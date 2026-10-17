/* THE NEWSLETTER ARCHIVE (newsletter.html). Fed by GET /api/newsletter/archive: every issue that has gone
   out to the whole list, newest first. Each issue is drawn as a cover in its OWN colours (the look its
   author chose), the latest one large. An issue sent before the designed newsletter existed has only
   plain text, and is listed as a plain row.

   Painted from the last copy this browser saw while the API wakes up (see readApiCache in site.js), so a
   returning reader never waits on a cold start. Depends on site.js. */
(function () {
  'use strict';

  const API = `${CANOPY_API_BASE}/api/newsletter`;
  const $ = (id) => document.getElementById(id);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const rgb = (hex) => { const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '')); return m ? [0, 2, 4].map((i) => parseInt(m[1].substr(i, 2), 16)) : null; };
  const lum = (hex) => { const c = rgb(hex); if (!c) return 0; const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const dim = (hex) => { const c = rgb(hex); return c ? `rgba(${c[0]},${c[1]},${c[2]},.74)` : hex; };

  const monthName = (ym) => { const [y, m] = String(ym || '').split('-'); return MONTHS[Number(m) - 1] ? `${MONTHS[Number(m) - 1]} ${y}` : ''; };
  const href = (i) => `newsletter-issue.html?i=${encodeURIComponent(i.slug)}`;
  const deckOf = (i) => i.deck || (i.body ? String(i.body).replace(/\s+/g, ' ').trim().slice(0, 150) : '');

  /** The CSS variables that give a cover its issue's own look. */
  function coverStyle(c) {
    c = c || {};
    const page = c.page || '#2C3E50', ink = c.ink || '#2C3E50', card = c.card || '#F0E5D8', accent = c.accent || '#008080';
    const on = contrast(page, ink) >= contrast(page, card) ? ink : card;
    const accentOn = contrast(accent, page) >= 3 ? accent : on;
    return `--c-page:${page};--c-on:${on};--c-on-dim:${dim(on)};--c-accent:${accent};--c-accent-on:${accentOn}`;
  }
  function ghostOf(i) {
    const first = String(i.label || monthName(i.month)).split(/\s+/)[0] || '';
    return MONTHS.some((m) => m.toLowerCase() === first.toLowerCase()) ? first.slice(0, 3).toUpperCase() : String(i.month || '').slice(0, 4);
  }
  function metaOf(i) {
    return [i.label || monthName(i.month), i.read_min ? `${i.read_min} min read` : '', i.poll_count ? `${i.poll_count} ${i.poll_count === 1 ? 'poll' : 'polls'}` : ''].filter(Boolean);
  }
  const cover = (i, tag) => `<span class="na-cover" style="${esc(coverStyle(i.colors))}"><span class="na-ghost" aria-hidden="true">${esc(ghostOf(i))}</span>`
    + `<span><span class="k" style="display:block">${esc(tag)}</span><${tag === 'Latest issue' ? 'h2' : 'h3'}>${esc(i.title || i.subject)}</${tag === 'Latest issue' ? 'h2' : 'h3'}>`
    + (deckOf(i) ? `<span class="d" style="display:block">${esc(deckOf(i))}</span>` : '') + (tag === 'Latest issue' ? '<span class="go">Read the issue &rarr;</span>' : '') + `</span>`
    + `<ul class="m">${metaOf(i).map((m) => `<li>${esc(m)}</li>`).join('')}</ul></span>`;

  let all = [], year = '', query = '';

  function draw() {
    const list = $('na-list'), feat = $('na-feature'), tools = $('na-tools');
    if (!all.length) {
      feat.innerHTML = ''; tools.hidden = true;
      list.innerHTML = '<p class="na-empty">No issues yet. The first one is still being written, and it will be here the day it goes out.</p>';
      return;
    }
    const latest = all[0];
    feat.innerHTML = `<a class="na-feature reveal" href="${esc(href(latest))}" aria-label="Read the latest issue: ${esc(latest.title || latest.subject)}">${cover(latest, 'Latest issue')}</a>`;
    tools.hidden = all.length < 4;
    const years = [...new Set(all.map((i) => String(i.month || '').slice(0, 4)).filter(Boolean))];
    $('na-years').innerHTML = years.length > 1 ? ['', ...years].map((y) => `<button type="button" data-y="${y}" aria-pressed="${y === year}">${y || 'All'}</button>`).join('') : '';

    const q = query.trim().toLowerCase();
    const rest = all.slice(1).filter((i) => (!year || String(i.month || '').startsWith(year)) && (!q || `${i.title} ${i.subject} ${deckOf(i)} ${i.label || ''}`.toLowerCase().includes(q)));
    if (!rest.length) { list.innerHTML = `<p class="na-empty">${all.length === 1 ? 'That is the only issue so far. The next one will land here.' : 'Nothing matches that. Try a different word or year.'}</p>`; return; }
    const groups = new Map();
    rest.forEach((i) => { const y = String(i.month || '').slice(0, 4) || 'Earlier'; (groups.get(y) || groups.set(y, []).get(y)).push(i); });
    list.innerHTML = [...groups.entries()].map(([y, items]) => `<h2 class="overline na-year">${esc(y)}</h2><div class="na-cards">${items.map((i) => (i.legacy ? '' : `<a class="na-card reveal" href="${esc(href(i))}">${cover(i, monthName(i.month) || 'Issue')}</a>`)).join('')}</div>`).join('');
  }

  async function load() {
    const cached = readApiCache('archive');
    if (cached && Array.isArray(cached.issues)) { all = cached.issues; draw(); }
    try {
      const fresh = await fetchJSON(`${API}/archive`);
      if (!Array.isArray(fresh.issues)) throw new Error('bad response');
      if (JSON.stringify(fresh.issues) !== JSON.stringify(all)) { all = fresh.issues; draw(); }
      writeApiCache('archive', { issues: fresh.issues });
    } catch (_) {
      if (!all.length) $('na-list').innerHTML = '<p class="na-empty">The archive is not loading right now. The page that holds it needs a moment to wake up: give it a few seconds, then <a class="uline" style="color:var(--teal)" href="newsletter.html">try again</a>.</p>';
    }
  }

  $('na-q').addEventListener('input', (e) => { query = e.target.value; draw(); });
  $('na-years').addEventListener('click', (e) => { const b = e.target.closest('button[data-y]'); if (!b) return; year = b.dataset.y; draw(); });
  $('join-link').addEventListener('click', (e) => { e.preventDefault(); const f = $('newsletter-form'); f.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => f.querySelector('input[type="email"]').focus(), 450); });
  load();
})();
