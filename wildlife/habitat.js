(function () {
  'use strict';

  const API = 'https://loka.place/lokaApps/wildlife/api';
  const LOGO = 'https://loka.place/lokaApps/wildlife/loka-logo.png';

  const CATEGORY_DOT = {
    Birds: '#7A5CFF',
    Mammals: '#C46A2A',
    Reptiles: '#3F7A58',
    Amphibians: '#2E8C9B',
    Insects: '#B38A1C',
    Fish: '#1F6FB0',
    Plants: '#1A7048',
    Flora: '#1A7048',
    Fauna: '#4D6050',
  };
  const DEFAULT_DOT = '#4D6050';

  function loadFonts() {
    if (document.getElementById('loka-wildlife-fonts')) return;
    const link = document.createElement('link');
    link.id = 'loka-wildlife-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Sans:wght@400;500;600&display=swap';
    document.head.appendChild(link);
  }

  const CSS = `
  .lw-root {
    --lw-bg: #F2F0E9;
    --lw-surface: #FAF9F6;
    --lw-border: rgba(20, 30, 20, 0.10);
    --lw-text: #1A1F1A;
    --lw-muted: #5E6B5F;
    --lw-moss: #1A7048;
    --lw-radius: 14px;
    font-family: 'DM Sans', ui-sans-serif, system-ui, sans-serif;
    color: var(--lw-text);
    background: var(--lw-bg);
    border: 1px solid var(--lw-border);
    border-radius: var(--lw-radius);
    overflow: hidden;
  }
  .lw-intro {
    flex: 0 0 168px;
    display: flex; flex-direction: column;
    background: var(--lw-moss);
    color: #F2F0E9;
    padding: 14px 14px 12px;
    border-right: 1px solid rgba(0,0,0,0.15);
    scroll-snap-align: start;
    min-height: 232px;
    position: relative;
    overflow: hidden;
  }
  .lw-intro::after {
    content: ''; position: absolute; inset: auto -30px -30px auto;
    width: 110px; height: 110px; border-radius: 50%;
    background: rgba(242, 240, 233, 0.05);
    pointer-events: none;
  }
  .lw-intro-title {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 22px; font-weight: 400; line-height: 1.02;
    letter-spacing: -0.015em;
    color: inherit;
    margin: 0;
  }
  .lw-intro-where {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 13px; font-style: italic; opacity: 0.88;
    margin-top: 8px;
    line-height: 1.3;
  }
  .lw-intro-credit {
    margin-top: auto;
    padding-top: 10px;
    display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
    color: inherit; text-decoration: none;
    border-top: 1px solid rgba(242, 240, 233, 0.18);
    position: relative; z-index: 1;
  }
  .lw-intro-credit:hover { text-decoration: none; color: inherit; }
  .lw-intro-credit:hover .lw-intro-logo { opacity: 1; }
  .lw-intro-by {
    font-family: 'DM Sans', sans-serif;
    font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase;
    opacity: 0.65;
  }
  .lw-intro-logo {
    height: 16px; width: auto; display: block;
    filter: invert(1) brightness(1.1);
    opacity: 0.9;
    transition: opacity 120ms ease;
  }
  .lw-strip {
    display: flex; gap: 0; overflow-x: auto; scroll-snap-type: x mandatory;
    scroll-behavior: smooth; padding: 0;
  }
  .lw-strip::-webkit-scrollbar { height: 0; }
  .lw-card {
    flex: 0 0 240px; display: flex; flex-direction: column;
    background: var(--lw-surface); border-right: 1px solid var(--lw-border);
    scroll-snap-align: start; min-height: 232px;
  }
  .lw-card:last-child { border-right: 0; }
  .lw-img {
    width: 100%; aspect-ratio: 3 / 2;
    background: var(--lw-bg) center/cover no-repeat;
    border-bottom: 1px solid var(--lw-border); position: relative;
  }
  .lw-img.lw-img--loading::after {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);
    animation: lw-shimmer 1.4s infinite;
  }
  @keyframes lw-shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
  .lw-img.lw-img--empty {
    background: repeating-linear-gradient(45deg, var(--lw-bg), var(--lw-bg) 6px, var(--lw-surface) 6px, var(--lw-surface) 12px);
  }
  .lw-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 2px; }
  .lw-cat {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--lw-muted); margin-bottom: 2px;
  }
  .lw-dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; }
  .lw-name {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 16px; font-weight: 500; line-height: 1.2; letter-spacing: -0.01em;
    color: var(--lw-text);
  }
  .lw-sci {
    font-size: 12px; font-style: italic; color: var(--lw-muted); line-height: 1.3;
  }
  .lw-loc {
    margin-top: 4px; font-size: 11px; color: var(--lw-moss); line-height: 1.3;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .lw-status {
    padding: 32px 16px; text-align: center; color: var(--lw-muted); font-size: 13px;
  }
  .lw-status b { color: var(--lw-text); font-weight: 600; }
  .lw-root :focus-visible {
    outline: 2px solid var(--lw-moss); outline-offset: 2px; border-radius: 6px;
  }
  `;

  function ensureRoot() {
    let el = document.getElementById('habitat-widget-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'habitat-widget-root';
      const script = document.currentScript || document.querySelector('script[src*="habitat.js"]');
      if (script && script.parentNode) script.parentNode.insertBefore(el, script);
      else document.body.appendChild(el);
    }
    el.classList.add('lw-root');
    return el;
  }

  function injectStyles() {
    if (document.getElementById('loka-wildlife-style')) return;
    const s = document.createElement('style');
    s.id = 'loka-wildlife-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  async function detectCity() {
    try {
      const r = await fetch('https://ipapi.co/json/');
      if (!r.ok) throw new Error('geo failed');
      const j = await r.json();
      return j.city || j.region || j.country_name || 'Earth';
    } catch {
      return 'Earth';
    }
  }

  async function fetchWildlife(city) {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: city }),
    });
    if (!r.ok) throw new Error('api ' + r.status);
    return r.json();
  }

  const imgMemory = new Map();
  async function wikiImage(query) {
    if (!query) return null;
    if (imgMemory.has(query)) return imgMemory.get(query);
    const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1'
      + '&generator=search&gsrlimit=1&gsrsearch=' + encodeURIComponent(query)
      + '&prop=pageimages&piprop=thumbnail&pithumbsize=600';
    try {
      const r = await fetch(url);
      if (!r.ok) { imgMemory.set(query, null); return null; }
      const j = await r.json();
      const pages = (j && j.query && j.query.pages) || {};
      const first = Object.values(pages)[0];
      const src = (first && first.thumbnail && first.thumbnail.source) || null;
      imgMemory.set(query, src);
      return src;
    } catch {
      imgMemory.set(query, null);
      return null;
    }
  }

  function interleave(categories) {
    const lists = categories.map((c) =>
      (c.speciesList || []).map((s) => ({ ...s, category: c.name }))
    );
    const max = lists.reduce((m, l) => Math.max(m, l.length), 0);
    const out = [];
    for (let i = 0; i < max; i++) {
      for (const l of lists) if (l[i]) out.push(l[i]);
    }
    return out;
  }

  function cardHTML(species, idx) {
    const cat = species.category || 'Fauna';
    const color = CATEGORY_DOT[cat] || DEFAULT_DOT;
    const loc = species.spottingLocations && species.spottingLocations[0];
    const locHTML = loc
      ? `<div class="lw-loc" title="${escapeAttr(loc.name + (loc.address ? ', ' + loc.address : ''))}">${escapeHTML(loc.name)}${loc.address ? ' · ' + escapeHTML(loc.address) : ''}</div>`
      : '';
    return `
      <article class="lw-card" data-idx="${idx}" data-name="${escapeAttr(species.name)}" data-sci="${escapeAttr(species.scientificName || '')}">
        <div class="lw-img lw-img--loading" role="img" aria-label="${escapeAttr(species.name)}"></div>
        <div class="lw-body">
          <div class="lw-cat"><span class="lw-dot" style="background:${color}"></span>${escapeHTML(cat)}</div>
          <div class="lw-name">${escapeHTML(species.name)}</div>
          <div class="lw-sci">${escapeHTML(species.scientificName || '')}</div>
          ${locHTML}
        </div>
      </article>
    `;
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escapeAttr(s) { return escapeHTML(s); }

  function introHTML(cityName) {
    return `
      <article class="lw-intro" aria-label="Meet the Locals, a widget by LOKA">
        <h2 class="lw-intro-title">Meet<br>the Locals</h2>
        <span class="lw-intro-where">of ${escapeHTML(cityName)}</span>
        <a class="lw-intro-credit" href="https://discoverloka.org" target="_blank" rel="noopener">
          <span class="lw-intro-by">A widget by</span>
          <img class="lw-intro-logo" src="${LOGO}" alt="LOKA" loading="lazy" />
        </a>
      </article>
    `;
  }

  function render(root, state) {
    const species = interleave(state.data.categories || []);
    const cityName = state.data.locationName || state.city;

    root.innerHTML = `
      <div class="lw-strip" role="list">
        ${introHTML(cityName)}
        ${species.map((s, i) => cardHTML(s, i)).join('')}
      </div>
    `;

    root.querySelectorAll('.lw-card').forEach((card) => {
      const name = card.dataset.name;
      const sci = card.dataset.sci;
      const imgEl = card.querySelector('.lw-img');
      (async () => {
        let src = await wikiImage(name);
        if (!src && sci) src = await wikiImage(sci);
        imgEl.classList.remove('lw-img--loading');
        if (src) {
          imgEl.style.backgroundImage = `url("${src.replace(/"/g, '%22')}")`;
        } else {
          imgEl.classList.add('lw-img--empty');
        }
      })();
    });

    if (typeof state.onRender === 'function') state.onRender(state);
  }

  function renderStatus(root, html) {
    root.innerHTML = `<div class="lw-status">${html}</div>`;
  }

  async function init() {
    loadFonts();
    injectStyles();
    const root = ensureRoot();
    renderStatus(root, 'Finding your wild neighbours…');

    const city = await detectCity();
    let data;
    try {
      data = await fetchWildlife(city);
    } catch (e) {
      renderStatus(root, `Couldn't reach the wildlife service. <br><small>${escapeHTML(e.message || 'unknown error')}</small>`);
      return;
    }

    const state = { city, data };
    render(root, state);
    window.dispatchEvent(new CustomEvent('loka:wildlife:loaded', { detail: { city, data } }));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
