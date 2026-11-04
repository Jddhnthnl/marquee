import { resourceUrl, supports, homeCatalogs, searchCatalogs, streamTarget, redactUrl } from './protocol.js';
import { PLAYBACK_DEFAULTS, LANGS, SUB_COLORS, SUB_FONTS, RULES, NEXT_WHEN, chooseStream, fromIntroDB, fromAniSkip } from './playback.js';
import { push, drop, watch, signIn, resetPassword, signOutAndForget } from './sync.js';
import { LOOK_DEFAULTS, ACCENTS, AVATARS, PROFILE_COLORS, POSTER_SIZES, RADII, DETAIL_SECTIONS, orderRows, removeProfile, resetSection, newProfileId,
  accentFromHex, isUnreleased, needsMeta, continueRows } from './look.js';

const DEFAULT_ADDONS = ['https://v3-cinemeta.strem.io/manifest.json']; // catalogs + meta, no keys
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`); // addon data is untrusted
const app = $('#app');
const calm = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- storage: same key scheme as Nuvio's .properties files (`<name>_<profileId>`) ----------
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { const raw = JSON.stringify(v); localStorage.setItem(k, raw); push(k, raw); };
const profiles = () => load('profiles', { active: '1', list: [{ id: '1', name: 'Main', color: '#3E7C8C' }] });
const pid = () => profiles().active;
const pk = (name) => `${name}_${pid()}`;
const addonUrls = () => load(pk('installed_addon_urls'), DEFAULT_ADDONS);
const enabledStates = () => load(pk('addon_enabled_states'), {});
const library = () => load(pk('library'), []);
const progress = () => load(pk('watch_progress'), {});
const settings = () => ({ ...PLAYBACK_DEFAULTS, ...LOOK_DEFAULTS, ...load(pk('settings'), {}) });
const setSetting = (k, v) => save(pk('settings'), { ...load(pk('settings'), {}), [k]: v });

// ---------- addon fetch ----------
const manifests = new Map(); // url -> manifest | Error
async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function loadManifests() {
  await Promise.all(addonUrls().filter((u) => !manifests.has(u)).map(async (u) => {
    manifests.set(u, await getJson(u).catch((e) => e));
  }));
}
const activeAddons = () => addonUrls()
  .filter((u) => enabledStates()[u] !== false && manifests.get(u) && !(manifests.get(u) instanceof Error))
  .map((url) => ({ url, manifest: manifests.get(url) }));

// ---------- shared pieces ----------
const TYPE_NAMES = { movie: 'movies', series: 'series', channel: 'channels', tv: 'TV' };
const RESOURCE_NAMES = { catalog: 'catalogs', meta: 'details', stream: 'streams', subtitles: 'subtitles', addon_catalog: 'addon lists' };
const epLabel = (s, e) => `S${s} E${e}`;
const year = (m) => (m.releaseInfo || m.year || '').toString().slice(0, 4);
const state = (text, cls = '') => `<p class="note ${cls}">${text}</p>`;

// A profile's face: uploaded photo, a drawing from AVATARS, or the first letter of the name.
const avatar = (p, cls = '', attrs = '') => {
  const a = p?.avatar ?? '';
  const face = a.startsWith('data:image/') ? `<img src="${esc(a)}" alt="">`
    : AVATARS[a] ? `<svg viewBox="0 0 48 48" aria-hidden="true">${AVATARS[a][1]}</svg>` : esc(p?.name?.[0] ?? '');
  return `<span class="avatar ${cls}" ${attrs} style="--c:${esc(p?.color)}">${face}</span>`;
};
// The Look settings are attributes on <html> (a custom accent sets the color variables); index.html applies the same before the first paint.
function applyLook(set = settings()) {
  const h = document.documentElement, d = h.dataset;
  d.accent = set.accent; d.poster = set.posterSize; d.intro = set.intro ? 'on' : 'off';
  d.amoled = set.amoled ? 'on' : 'off'; d.radius = set.posterRadius; d.labels = set.posterLabels ? 'on' : 'off'; d.landscape = set.landscape ? 'on' : 'off';
  const rgb = set.accent === 'custom' && accentFromHex(set.accentHex);
  if (rgb) { h.style.setProperty('--tungsten', set.accentHex); h.style.setProperty('--glow', rgb); }
  else { h.style.removeProperty('--tungsten'); h.style.removeProperty('--glow'); }
}

const art = (src, extra = '') => `<span class="art" data-tilt><img loading="lazy" src="${esc(src)}" alt="">${extra}</span>`;
const seen = new Map(); // id -> catalog meta, so hover cards need no extra fetch
const wideCards = () => document.documentElement.dataset.landscape === 'on';
const poster = (m) => (seen.set(m.id, m), `<a class="poster" href="#/meta/${esc(m.type)}/${encodeURIComponent(m.id)}">
  ${wideCards() ? art(m.background || m.poster, m.logo ? `<img class="card-logo" src="${esc(m.logo)}" alt="">` : '') : art(m.poster)}
  <span class="poster-title">${esc(m.name)}</span>${year(m) ? `<span class="poster-year">${esc(year(m))}</span>` : ''}</a>`);

const row = (title, source, body, id = '') => `<section class="shelf">
  <header><h2>${esc(title)}</h2>${source ? `<p>from ${esc(source)}</p>` : ''}</header>
  <div class="row"${id ? ` id="${id}"` : ''}>${body}</div></section>`;

const factList = (meta) => [year(meta), meta.runtime, meta.imdbRating && `IMDb ${meta.imdbRating}`, ...(meta.genres || []).slice(0, 3)].filter(Boolean);
function hero(meta, { kicker = '', actions = '', withPoster = false } = {}) {
  const facts = factList(meta);
  ambient(meta.background);
  return `${meta.background ? `<img class="hero-bg" src="${esc(meta.background)}" alt="">` : ''}
    <div class="hero-body">
      ${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ''}
      <h1 class="marquee"><span>${esc(meta.name)}</span></h1>
      ${facts.length ? `<ul class="facts">${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      ${meta.description ? `<p class="lede">${esc(meta.description)}</p>` : ''}
      ${actions ? `<div class="actions">${actions}</div>` : ''}
    </div>
    ${withPoster && meta.poster ? `<div class="hero-art">${art(meta.poster)}</div>` : ''}`;
}

// Ambilight: a huge blurred copy of the current backdrop tints the whole page.
function ambient(src) {
  const el = $('#ambient');
  if (!src) return void el.classList.remove('on');
  if (el.dataset.src === src) return void el.classList.add('on');
  el.dataset.src = src;
  const img = new Image();
  img.alt = '';
  img.onload = () => { if (el.dataset.src === src) { el.replaceChildren(img); el.classList.add('on'); } };
  img.src = src;
}

// ---------- trailers: YouTube embeds play on Windows' http://tauri.localhost origin (tauri:// on mac/linux would fail with error 153) ----------
const ytId = (m) => m?.trailerStreams?.[0]?.ytId ?? m?.trailers?.[0]?.source;
const SOUND_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M4 9h4l5-4v14l-5-4H4z"/><path class="wave" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
function trailer(id, { sound = false, mute = !sound, loop = false, start = 0, onPlay, onEnd, onFail } = {}) {
  const f = document.createElement('iframe');
  f.className = 'trailer';
  f.allow = 'autoplay; encrypted-media; fullscreen';
  if (!sound) { f.tabIndex = -1; f.setAttribute('aria-hidden', 'true'); }
  f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=${mute ? 1 : 0}&start=${start | 0}&controls=${sound ? 1 : 0}`
    + `&playsinline=1&rel=0&iv_load_policy=3&disablekb=${sound ? 0 : 1}&enablejsapi=1${loop ? `&loop=1&playlist=${encodeURIComponent(id)}` : ''}`;
  f.onload = () => f.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1 }), '*'); // asks the player to post its state changes
  f._h = { onPlay, onEnd, onFail };
  return f;
}
const ytCmd = (f, func) => f?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*');
addEventListener('message', (e) => {
  if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin)) return;
  const f = [...document.querySelectorAll('iframe.trailer')].find((x) => x.contentWindow === e.source);
  let d; try { d = JSON.parse(e.data); } catch { return; }
  if (!f || !d) return;
  const st = d.event === 'onStateChange' ? d.info : d.info?.playerState;
  if (st === 1 && !f.classList.contains('is-playing')) { f.classList.add('is-playing'); f._h.onPlay?.(); } // fade in only once frames flow
  if (st === 0) f._h.onEnd?.();
  if (d.event === 'onError') { f.remove(); f._h.onFail?.(); } // 101/150: owner blocks embedding; the backdrop stays
});
const soundBtn = (cls, on = false) => `<button class="btn quiet sound ${cls}" aria-pressed="${on}" aria-label="Sound">${SOUND_ICON}</button>`;
function wireSound(btn, frame) {
  btn.onclick = (e) => {
    e.stopPropagation();
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    ytCmd(frame(), on ? 'unMute' : 'mute');
  };
}

// ---------- home billboard: rotates the first catalog's titles; the bulbs are its pager ----------
let bill = null;
function billboard(el, metas) {
  const b = bill = { el, picks: metas.slice(0, 6), i: 0, t: 0, hold: false, frame: null };
  el.classList.add('billboard');
  el.onpointerenter = () => (b.hold = true);
  el.onpointerleave = () => (b.hold = false);
  showBill(b, 0);
}
function showBill(b, i) {
  b.i = i; b.t = 0; b.frame = null;
  const m = b.picks[i];
  b.el.innerHTML = hero(m, { kicker: 'Now showing', actions: `<a class="btn primary" href="#/meta/${esc(m.type)}/${encodeURIComponent(m.id)}">See episodes and streams</a>${ytId(m) && settings().bannerTrailer ? soundBtn('') : ''}` });
  if (b.picks.length > 1) {
    b.el.querySelector('.hero-body').insertAdjacentHTML('beforeend', `<div class="bulbs" role="group" aria-label="Featured titles">${b.picks.map((p, j) =>
      `<button style="--j:${j}" aria-label="${esc(p.name)}" ${j === i ? 'aria-current="true"' : ''} data-j="${j}"></button>`).join('')}</div>`);
    b.el.querySelectorAll('.bulbs button').forEach((x) => (x.onclick = () => showBill(b, +x.dataset.j)));
  }
  const s = b.el.querySelector('.sound');
  if (s) wireSound(s, () => b.frame);
}
const nextBill = (b) => showBill(b, (b.i + 1) % b.picks.length);
setInterval(() => { // one clock: trailer after 3 s, next title after 30 s (10 s without a trailer); held while hovered, hidden or peeking
  const b = bill;
  if (!b || !b.el.isConnected) return void (bill = null);
  if (b.hold || document.hidden || peek || calm.matches) return;
  const m = b.picks[b.i], id = ytId(m), sound = b.el.querySelector('.sound')?.getAttribute('aria-pressed') === 'true';
  b.t++;
  if (b.t === 3 && id && settings().bannerTrailer) {
    b.frame = trailer(id, { start: settings().trailerStart, onEnd: () => nextBill(b), onFail: () => (b.frame = null) });
    b.el.prepend(b.frame);
  }
  if (b.picks.length > 1 && !sound && b.t >= (b.frame ? 30 : 10)) nextBill(b); // someone listening keeps their trailer to the end
}, 1000);
document.addEventListener('visibilitychange', () => ytCmd(bill?.frame, document.hidden ? 'pauseVideo' : 'playVideo'));

// ---------- hover card: after 0.7 s over a poster, grow into backdrop + facts + muted trailer ----------
let peek = null, peekT = 0;
function closePeek() {
  clearTimeout(peekT);
  if (!peek) return;
  peek.remove(); peek = null;
  if (bill?.frame) ytCmd(bill.frame, 'playVideo');
}
function openPeek(a) {
  const m = seen.get(decodeURIComponent(a.getAttribute('href').split('/').pop()));
  if (!m || !a.isConnected) return;
  closePeek();
  const r = a.querySelector('.art').getBoundingClientRect();
  const w = Math.max(340, r.width * 2.2);
  const left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), innerWidth - w - 12);
  const p = document.createElement('div');
  p.className = 'peek';
  p.setAttribute('aria-hidden', 'true'); // pointer-only preview; the details page carries the same information for keyboard users
  p.style.cssText = `left:${left}px;width:${w}px;--ox:${r.left + r.width / 2 - left}px`;
  const facts = factList(m);
  p.innerHTML = `<span class="peek-media"><img src="${esc(m.background || m.poster)}" alt=""></span>
    <span class="peek-body"><b class="peek-title">${esc(m.name)}</b>
      ${facts.length ? `<ul class="facts">${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      ${m.description ? `<span class="peek-desc">${esc(m.description)}</span>` : ''}</span>`;
  document.body.append(p);
  const h = p.offsetHeight; // keep the card centred on the poster, inside the window
  p.style.top = `${Math.min(Math.max(12, r.top + r.height / 2 - h / 2), innerHeight - h - 12)}px`;
  p.onclick = () => { location.hash = a.getAttribute('href'); };
  p.onpointerleave = closePeek;
  peek = p;
  if (bill?.frame) ytCmd(bill.frame, 'pauseVideo'); // one trailer at a time
  const id = ytId(m);
  const set = settings();
  if (id && !calm.matches && set.hoverTrailer) {
    let f = null;
    p.querySelector('.peek-media').append(f = trailer(id, { loop: true, mute: !set.hoverSound, start: set.trailerStart }));
    p.querySelector('.peek-media').insertAdjacentHTML('beforeend', soundBtn('on-media', set.hoverSound));
    wireSound(p.querySelector('.sound'), () => f);
  }
}
app.addEventListener('pointerover', (e) => {
  const a = fine.matches && e.target.closest('.poster');
  if (!a) return;
  clearTimeout(peekT);
  peekT = setTimeout(() => openPeek(a), settings().hoverDelay);
});
app.addEventListener('pointerout', (e) => { const a = e.target.closest('.poster'); if (a && !a.contains(e.relatedTarget)) clearTimeout(peekT); });
addEventListener('scroll', closePeek, { passive: true, capture: true }); // fixed card would drift off its poster

// ---------- trailer with sound: a screening dialog over the page ----------
function screening(id, name) {
  const d = document.createElement('dialog');
  d.className = 'screening';
  d.setAttribute('aria-label', `Trailer: ${name}`);
  d.innerHTML = '<div class="screen"></div><form method="dialog"><button class="btn">Close</button></form>';
  d.querySelector('.screen').append(trailer(id, { sound: true }));
  d.onclose = () => d.remove(); // removing the iframe stops playback
  d.onclick = (e) => { if (e.target === d) d.close(); }; // click outside the screen
  document.body.append(d);
  d.showModal();
}

// ---------- views ----------
const rowKey = (c) => `${c.manifest.id}/${c.catalog.type}/${c.catalog.id}`;
const rowTitle = (c) => `${c.catalog.name || c.catalog.id} ${TYPE_NAMES[c.catalog.type] ?? c.catalog.type}`;
// Continue watching: shows whose last episode is finished need their meta for the next one, cached for the session.
const metaCache = new Map();
const finished = (p) => p?.durationMs > 0 && p.positionMs / p.durationMs >= 0.95;
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
function cwData(set) {
  const r = continueRows(progress(), Object.fromEntries(metaCache), set);
  if (set.cwSort === 'title') r.resume.sort((a, b) => a.name.localeCompare(b.name));
  return r;
}
function cwCard(p, set, upcoming = false) {
  const wide = set.cwStyle === 'wide' || set.landscape, pct = p.durationMs ? Math.min(100, (p.positionMs / p.durationMs) * 100) : 0;
  const href = `#/meta/${esc(p.type)}/${encodeURIComponent(p.metaId)}${p.season != null && !upcoming ? `/${encodeURIComponent(p.videoId)}` : ''}`;
  return `<a class="poster${wide ? ' wide' : ''}" href="${href}">
    <span class="art${p.next && set.cwBlur ? ' spoil' : ''}" data-tilt><img loading="lazy" src="${esc(wide ? p.thumbnail || p.background || p.poster : p.poster)}" alt="">
      ${pct ? `<span class="meter"><span style="width:${pct}%"></span></span>` : ''}${p.next && !upcoming ? '<span class="tag">Next</span>' : ''}</span>
    <span class="poster-title">${esc(p.name)}</span>${p.season ? `<span class="poster-year">${epLabel(p.season, p.episode)}${upcoming ? `, ${p.released ? fmtDate(p.released) : 'date not announced'}` : ''}</span>` : ''}</a>`;
}
function fillCw(set) {
  const { resume, upcoming } = cwData(set), cw = $('#cw-slot'), up = $('#up-slot');
  if (cw) cw.innerHTML = resume.length ? row(set.rowNames.cw || 'Continue watching', '', resume.slice(0, 20).map((p) => cwCard(p, set)).join('')) : '';
  if (up) up.innerHTML = upcoming.length ? row(set.rowNames.upcoming || 'Upcoming episodes', '', upcoming.map((p) => cwCard(p, set, true)).join('')) : '';
}
async function home() {
  const set = settings(), cats = homeCatalogs(activeAddons());
  const rows = { cw: set.cw ? '<div id="cw-slot"></div>' : '', upcoming: set.cw && set.cwUpcoming ? '<div id="up-slot"></div>' : '' };
  cats.forEach((c, i) => (rows[rowKey(c)] = row(set.rowNames[rowKey(c)] || rowTitle(c), c.manifest.name, '<div class="skeleton"></div>'.repeat(8), `row${i}`)));
  app.innerHTML = (set.hero || !cats.length ? `<section class="hero" id="hero">${cats.length ? '' : hero(
    { name: 'Nothing on the bill yet', description: 'Install an addon to fill your home screen with catalogs.' },
    { actions: '<a class="btn primary" href="#/addons">Install an addon</a>' })}</section>` : '<div class="hero-gap"></div>')
    + orderRows(Object.keys(rows), set.homeRows).filter((r) => r.shown).map((r) => rows[r.key]).join('');
  if (set.cw) {
    fillCw(set);
    const missing = needsMeta(progress(), set).filter((id) => !metaCache.has(id));
    if (missing.length) Promise.all(missing.map((id) => fetchMeta('series', id).then((m) => metaCache.set(id, m ?? {})))).then(() => fillCw(set));
  }
  let heroFilled = !cats.length || !set.hero;
  cats.forEach(async (c, i) => {
    const el = $(`#row${i}`);
    if (!el) return; // hidden in Settings
    try {
      const { metas: all = [] } = await getJson(resourceUrl(c.url, 'catalog', c.catalog.type, c.catalog.id));
      const metas = set.hideUnreleased ? all.filter((m) => !isUnreleased(m)) : all;
      if (!el) return;
      el.innerHTML = metas.slice(0, 30).map(poster).join('') || state('This catalog is empty right now.');
      const picks = heroFilled || (set.heroRows.length && !set.heroRows.includes(rowKey(c))) ? [] : metas.filter((m) => m.background && m.description);
      if (picks.length && $('#hero')) {
        heroFilled = true;
        billboard($('#hero'), picks);
      }
    } catch (e) { if (el) el.innerHTML = state(`${esc(c.manifest.name)} didn't respond (${esc(e.message)}). Reload to try again.`, 'error'); }
  });
}

async function search(q) {
  app.innerHTML = `<section class="page"><form id="sf" class="searchbar" role="search">
      <label for="q" class="sr-only">Search movies and series</label>
      <input id="q" name="q" value="${esc(q)}" placeholder="Search movies and series" autocomplete="off" autofocus>
    </form><div id="res">${q ? '' : state('Type a title and press Enter.')}</div></section>`;
  $('#sf').onsubmit = (e) => { e.preventDefault(); location.hash = `#/search/${encodeURIComponent(e.target.q.value.trim())}`; };
  if (!q) return;
  $('#res').innerHTML = row('Searching', '', '<div class="skeleton"></div>'.repeat(6));
  const results = await Promise.all(searchCatalogs(activeAddons()).map(async (c) => {
    const { metas = [] } = await getJson(resourceUrl(c.url, 'catalog', c.catalog.type, c.catalog.id, { search: q })).catch(() => ({}));
    return metas.length ? row(TYPE_NAMES[c.catalog.type] ? `Matching ${TYPE_NAMES[c.catalog.type]}` : c.catalog.name, c.manifest.name, metas.map(poster).join('')) : '';
  }));
  $('#res').innerHTML = results.join('') || state(`Nothing matches “${esc(q)}”. Check the spelling, or install an addon with a bigger catalog.`);
}

async function fetchMeta(type, id) {
  for (const a of activeAddons().filter((a) => supports(a.manifest, 'meta', type, id))) { // first addon that answers wins
    const r = await getJson(resourceUrl(a.url, 'meta', type, id)).catch(() => null);
    if (r?.meta) return r.meta;
  }
  return null;
}

async function details(type, id, pickVid) {
  app.innerHTML = '<section class="hero is-loading"></section>';
  const meta = await fetchMeta(type, id);
  if (!meta) { app.innerHTML = `<section class="page">${state('None of your addons has details for this title. Install one that covers it under Addons.', 'error')}</section>`; return; }
  const inLib = library().some((m) => m.id === meta.id);
  const eps = (meta.videos || []).filter((v) => v.season !== 0).sort((a, b) => a.season - b.season || (a.episode ?? a.number) - (b.episode ?? b.number));
  const seasons = [...new Set(eps.map((v) => v.season))];
  const isSeries = type !== 'movie' && eps.length;
  const tid = ytId(meta), set = settings();
  document.body.dataset.bg = set.detailBg === 'normal' ? '' : 'cinematic';
  if (set.detailBg === 'color' && meta.poster) tint(meta.poster, meta.id);
  app.innerHTML = `<section class="hero">${hero(meta, { withPoster: true, actions: `${type === 'movie' ? `<button class="btn primary" id="play">${progress()[meta.id] ? 'Resume' : 'Play'}</button>` : ''}${tid ? `<button class="btn${type === 'movie' ? '' : ' primary'}" id="trl"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7 4v16l13-8z"/></svg>Play trailer</button>` : ''}<button class="btn" id="lib" aria-pressed="${inLib}">${inLib ? 'Saved to library' : 'Save to library'}</button>` })}</section>
    <div class="detail-body">
      ${isSeries ? `<section class="episodes"><div class="seasons" role="tablist">${seasons.map((s) => `<button role="tab" data-s="${s}">Season ${s}</button>`).join('')}</div>
        <p class="season-tools"><button class="btn quiet" id="mark"></button><button class="btn quiet" id="shuffle">Play a random episode</button></p><ol class="ep-list" id="eps"></ol></section>` : ''}
      <section class="streams" id="streams"></section>
    </div><div id="extras"></div>`;
  extras(meta, type, set);
  const auto = autoStart && autoStart === (pickVid ?? meta.id);
  if (auto) autoStart = null;
  if (tid) $('#trl').onclick = () => screening(tid, meta.name);
  $('#lib').onclick = () => {
    save(pk('library'), inLib ? library().filter((m) => m.id !== meta.id)
      : [...library(), { id: meta.id, type, name: meta.name, poster: meta.poster, releaseInfo: meta.releaseInfo }]);
    details(type, id);
  };
  if ($('#play')) $('#play').onclick = () => streams(meta, type, meta.id, undefined, true);
  if (!isSeries) return void streams(meta, type, meta.id, undefined, auto);
  let watched = progress(), shown = null;
  const markSeason = () => { // all finished: clear them; otherwise mark every episode of the season finished
    const prog = progress(), list = eps.filter((v) => v.season === shown), all = list.every((v) => finished(prog[v.id]));
    for (const v of list) {
      if (all) delete prog[v.id];
      else if (!finished(prog[v.id])) prog[v.id] = { metaId: meta.id, type, name: meta.name, poster: meta.poster, background: meta.background, videoId: v.id,
        season: v.season, episode: v.episode ?? v.number, positionMs: 1, durationMs: 1, updatedAt: Date.now() };
    }
    save(pk('watch_progress'), prog);
    watched = prog;
    showSeason(shown);
    $('#mark').focus();
  };
  $('#mark').onclick = markSeason;
  $('#shuffle').onclick = () => {
    const out = eps.filter((v) => !v.released || Date.parse(v.released) <= Date.now());
    const v = out[Math.floor(Math.random() * out.length)];
    if (v) streams(meta, type, v.id, v, true);
  };
  const showSeason = (s) => {
    shown = s;
    $('#mark').textContent = eps.filter((v) => v.season === s).every((v) => finished(watched[v.id])) ? 'Mark season unwatched' : 'Mark season watched';
    app.querySelectorAll('.seasons button').forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.s === s)));
    $('#eps').innerHTML = eps.filter((v) => v.season === s).map((v, i) => {
      const p = watched[v.id];
      return `<li style="--i:${Math.min(i, 10)}"><button class="ep" data-vid="${esc(v.id)}">
        <span class="ep-thumb${set.blurUnwatched && !p ? ' spoil' : ''}">${v.thumbnail ? `<img loading="lazy" src="${esc(v.thumbnail)}" alt="">` : ''}${p ? `<span class="meter"><span style="width:${Math.min(100, (p.positionMs / p.durationMs) * 100)}%"></span></span>` : ''}</span>
        <span class="ep-num">${v.episode ?? v.number}</span>
        <span class="ep-text"><span class="ep-title">${esc(v.name || v.title || `Episode ${v.episode ?? v.number}`)}</span>
        ${v.released ? `<span class="ep-date">${esc(fmtDate(v.released))}</span>` : ''}</span></button></li>`;
    }).join('');
    app.querySelectorAll('.ep').forEach((b) => (b.onclick = () => {
      app.querySelectorAll('.ep').forEach((x) => x.removeAttribute('aria-current'));
      b.setAttribute('aria-current', 'true');
      streams(meta, type, b.dataset.vid, eps.find((e) => e.id === b.dataset.vid), true);
    }));
  };
  app.querySelectorAll('.seasons button').forEach((b) => (b.onclick = () => showSeason(+b.dataset.s)));
  const resume = Object.values(watched).filter((p) => p.metaId === meta.id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const picked = eps.find((e) => e.id === pickVid); // "Ask every time" sends the next episode here to choose its stream
  showSeason(picked?.season ?? resume?.season ?? seasons[0]);
  if (picked) return void streams(meta, type, picked.id, picked, auto);
  $('#streams').innerHTML = state('Pick an episode to see its streams.');
}

// Detail page: the background mode's tint, and the Cast / Trailers / More like this sections in the order Settings gives them.
function tint(src, id) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    if (location.hash.split('/')[3] !== encodeURIComponent(id)) return;
    try {
      const c = document.createElement('canvas'), x = c.getContext('2d');
      c.width = c.height = 1; x.drawImage(img, 0, 0, 1, 1);
      const [r, g, b] = x.getImageData(0, 0, 1, 1).data;
      document.body.style.setProperty('--tint', `${r} ${g} ${b}`);
      document.body.dataset.bg = 'color';
    } catch { /* the image server doesn't allow reading pixels: stays Cinematic */ }
  };
  img.src = src;
}
function extras(meta, type, set) {
  const box = $('#extras');
  const parts = {
    cast: () => { const names = meta.cast?.length ? meta.cast : (meta.links ?? []).filter((l) => l.category === 'Cast').map((l) => l.name);
      return names.length ? `<section class="extra"><h2>Cast</h2><ul class="cast">${names.slice(0, 24).map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>` : ''; },
    trailers: () => { const t = (meta.trailerStreams ?? []).filter((x) => x.ytId);
      return t.length ? `<section class="extra"><h2>Trailers</h2><div class="row">${t.slice(0, 12).map((x) => `<button class="clip" data-yt="${esc(x.ytId)}">
        <span class="art"><img loading="lazy" src="https://i.ytimg.com/vi/${encodeURIComponent(x.ytId)}/mqdefault.jpg" alt=""></span><span class="poster-title">${esc(x.title || 'Trailer')}</span></button>`).join('')}</div></section>` : ''; },
    more: () => (meta.genres?.length ? '<div id="more"></div>' : ''),
  };
  box.innerHTML = orderRows(Object.keys(DETAIL_SECTIONS), set.detailSections).filter((r) => r.shown).map((r) => parts[r.key]()).join('');
  box.querySelectorAll('[data-yt]').forEach((b) => (b.onclick = () => screening(b.dataset.yt, meta.name)));
  if (!$('#more')) return;
  const a = activeAddons().find((x) => (x.manifest.catalogs ?? []).some((c) => c.type === type && (c.extra ?? []).some((e) => e.name === 'genre')));
  const c = a?.manifest.catalogs.find((x) => x.type === type && (x.extra ?? []).some((e) => e.name === 'genre'));
  if (!c) return;
  getJson(resourceUrl(a.url, 'catalog', type, c.id, { genre: meta.genres[0] })).then(({ metas = [] }) => {
    const list = metas.filter((m) => m.id !== meta.id && !(set.hideUnreleased && isUnreleased(m))).slice(0, 20);
    if (list.length && $('#more')) $('#more').outerHTML = row('More like this', `${meta.genres[0]}, ${a.manifest.name}`, list.map(poster).join(''));
  }, () => {});
}

const pickRules = (set) => ({ rules: set.rules, custom: set.customRule, sameGroup: set.sameGroup });
async function streams(meta, type, videoId, ep, autoplay = false) {
  const box = $('#streams');
  const targets = activeAddons().filter((a) => supports(a.manifest, 'stream', type, videoId));
  const epNo = ep && (ep.episode ?? ep.number);
  box.innerHTML = `<h2>${ep ? `Streams for ${epLabel(ep.season, epNo)}` : 'Streams'}</h2><div id="best-slot"></div>`
    + (targets.map((a, i) => `<div class="group"><h3>${esc(a.manifest.name)}</h3><div id="g${i}"><div class="skeleton line"></div><div class="skeleton line"></div></div></div>`).join('')
      || state('No installed addon provides streams for this title. Add a stream addon under Addons.'));
  box.scrollIntoView({ behavior: calm.matches ? 'auto' : 'smooth', block: 'start' });
  const ctx = { metaId: meta.id, type, name: meta.name, poster: meta.poster, background: meta.background, videoId, season: ep?.season, episode: epNo };
  const groups = [];
  shelf = { meta, type, groups }; // the player's Sources/Episodes/Info come from what this page loaded
  const set = settings(), saved = progress()[videoId];
  // Reuse: the saved link plays at once; if it no longer works, fall through to the pick below once the lists load
  const reused = autoplay && set.streamMode === 'reuse' && saved?.stream?.url ? play(ctx, saved.stream, true) : null;
  const loads = targets.map(async (a, i) => { // Nuvio fans out to every addon in parallel, grouped by addon in install order
    const el = $(`#g${i}`);
    try {
      const { streams: list = [] } = await getJson(resourceUrl(a.url, 'stream', type, videoId));
      groups[i] = { addonName: a.manifest.name, streams: list };
      el.innerHTML = list.length ? `<ul class="stream-list">${list.map((s, j) => {
        const t = streamTarget(s);
        return `<li style="--i:${Math.min(j, 10)}"><button class="stream" data-j="${j}"><span class="stream-name">${esc(s.name || a.manifest.name)}</span>
          <span class="stream-desc">${esc(s.title || s.description).replace(/\n/g, '<br>')}</span>
          <span class="stream-kind">${t?.kind === 'url' ? 'Plays here' : t?.kind === 'magnet' ? 'Torrent' : 'Opens elsewhere'}</span></button></li>`;
      }).join('')}</ul>` : state('No streams from this addon.');
      el.querySelectorAll('.stream').forEach((b) => (b.onclick = () => play(ctx, list[b.dataset.j])));
    } catch (e) { el.innerHTML = state(`${esc(a.manifest.name)} didn't respond (${esc(e.message)}).`, 'error'); }
  });
  const all = Promise.all(loads);
  if (autoplay && set.streamWait >= 0) { // wait limit: pick from what has arrived; slower addons keep filling the list
    const playable = () => groups.some((g) => g?.streams.some((s) => s.url));
    await Promise.race([all, new Promise((ok) => (set.streamWait ? setTimeout(ok, set.streamWait * 1000) : loads.forEach((p) => p.then(() => playable() && ok()))))]);
  } else await all;
  const last = Object.values(progress()).filter((p) => p.metaId === meta.id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const best = chooseStream({ mode: 'auto', quality: set.quality, groups: groups.filter(Boolean), bingeGroup: last?.bingeGroup ?? null, ...pickRules(set) });
  if (autoplay && set.streamMode !== 'ask' && best && !(reused && await reused)) return void play(ctx, best);
  if (best && $('#best-slot')) {
    $('#best-slot').innerHTML = '<button id="best" class="btn primary">Play best match</button>';
    $('#best').onclick = () => play(ctx, best);
  }
}

function play(ctx, stream, quiet = false) {
  const t = streamTarget(stream);
  if (!t) return alert('This stream has no link to play.');
  if (t.kind !== 'url') { // shortcut: no torrent engine / external player bridge in a browser; Nuvio uses a native engine + libmpv
    return void prompt(t.kind === 'magnet' ? 'This is a torrent. Copy the magnet link into a torrent client:' : 'This stream opens outside Marquee. Copy the link:', t.href);
  }
  const key = ctx.videoId;
  const saved = progress()[key];
  const how = settings().player;
  if (tauri && how === 'external') return tauri.core.invoke('open_external', { path: settings().externalPath, url: t.href }).then(() => true, (e) => (alert(e), false));
  if (tauri) return playMpv(ctx, stream, t.href, saved, how !== 'mpv', quiet);
  const ov = document.createElement('div');
  ov.className = 'player';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', `Playing ${ctx.name}`);
  ov.innerHTML = `<video controls autoplay src="${esc(t.href)}"></video><div class="player-bar">
    <button class="btn" id="close">Close</button><button class="btn" id="copy">Copy stream link</button>
    <p id="pstatus"><b>${esc(ctx.name)}</b>${ctx.season ? ` ${epLabel(ctx.season, ctx.episode)}` : ''}</p></div>`;
  document.body.append(ov);
  const v = ov.querySelector('video');
  let last = 0;
  const persist = () => { if (v.duration && isFinite(v.duration)) record(ctx, stream, v.currentTime, v.duration); };
  const close = () => { persist(); ov.remove(); removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', onKey);
  v.onloadedmetadata = () => { if (saved && saved.positionMs / saved.durationMs < 0.95) v.currentTime = saved.positionMs / 1000; };
  v.ontimeupdate = () => { if (Date.now() - last > 5000) { last = Date.now(); persist(); } };
  v.onpause = persist;
  v.onerror = () => ($('#pstatus').textContent = 'Your browser can’t play this file (usually MKV or HEVC). Copy the stream link and open it in mpv or VLC.');
  ov.querySelector('#copy').onclick = async (e) => { await navigator.clipboard.writeText(t.href); e.target.textContent = 'Link copied'; };
  ov.querySelector('#close').onclick = close;
  ov.querySelector('#close').focus();
  return true;
}

function record(ctx, stream, posSec, durSec) {
  save(pk('watch_progress'), { ...progress(), [ctx.videoId]: { ...ctx, positionMs: posSec * 1000, durationMs: durSec * 1000, bingeGroup: stream.behaviorHints?.bingeGroup ?? null, stream, updatedAt: Date.now() } });
}

// Desktop app (Tauri): mpv plays inside Marquee's window with player.html as the controls, like Nuvio; resume comes back when mpv closes.
let shelf = null;   // { meta, type, groups } from the last streams() call
let playing = null; // { meta, type, ctx, stream, groups } while mpv is open; ctx/stream change when you switch episode or source
const tauri = window.__TAURI__;
const resumeAt = (p) => (p && p.positionMs / p.durationMs < 0.95 ? p.positionMs / 1000 : 0);
const mediaTitle = (ctx) => ctx.name + (ctx.season ? ` ${epLabel(ctx.season, ctx.episode)}` : '');
const seriesEps = (meta) => (meta.videos || []).filter((v) => v.season !== 0)
  .sort((a, b) => a.season - b.season || (a.episode ?? a.number) - (b.episode ?? b.number));

async function playMpv(ctx, stream, href, saved, embed, quiet) {
  playing = { ...shelf, ctx, stream, segments: [], started: Math.floor(Date.now() / 1000) };
  const headers = Object.entries(stream.behaviorHints?.proxyHeaders?.request ?? {}).map(([k, v]) => `${k}: ${v}`);
  let ok = false;
  try {
    await sendPlayerInfo();
    loadSegments(ctx);
    const [pos, dur] = await tauri.core.invoke('play_mpv', { url: href, title: mediaTitle(ctx), start: resumeAt(saved), headers, embed });
    ok = dur > 0;
    if (ok) record(playing.ctx, playing.stream, pos, dur);
  } catch (e) { if (!quiet) alert(e); }
  const pick = playing.pickEpisode;
  playing = null;
  tauri.core.invoke('discord_clear').catch(() => {});
  if (pick) location.hash = `#/meta/${pick.type}/${encodeURIComponent(pick.metaId)}/${encodeURIComponent(pick.videoId)}`;
  else if (ok || !quiet) route();
  return ok;
}

// Intro/recap/credits times for the Skip button and next-episode card: IntroDB for IMDb shows, AniSkip for Kitsu anime ids.
async function loadSegments(ctx) {
  const [id, a, b] = ctx.videoId.split(':');
  let segs = [];
  try {
    if (/^tt\d+$/.test(id) && b) segs = fromIntroDB(await tauri.core.invoke('introdb', { imdb: id, season: +a, episode: +b }));
    else if (id === 'kitsu' && b) {
      const m = await getJson(`https://kitsu.io/api/edge/anime/${+a}/mappings?filter%5BexternalSite%5D=myanimelist/anime`);
      const mal = m.data?.[0]?.attributes?.externalId;
      if (mal) segs = fromAniSkip(await getJson(`https://api.aniskip.com/v2/skip-times/${+mal}/${+b}?types=op&types=ed&types=recap&episodeLength=0`));
    }
  } catch { /* no data: the player falls back to chapter names and the last 30 s */ }
  if (playing?.ctx.videoId === ctx.videoId) { playing.segments = segs; sendPlayerInfo(); }
}

function sendPlayerInfo() {
  const { meta, type, ctx, stream, groups = [] } = playing;
  const eps = type === 'movie' ? [] : seriesEps(meta);
  const ep = eps.find((v) => v.id === ctx.videoId);
  const at = eps.indexOf(ep);
  const seen = progress();
  const { player, externalPath, ...set } = settings();
  if (set.discord && set.discordId) tauri.core.invoke('discord_set', { appId: set.discordId, details: meta.name, status: ep ? epLabel(ep.season, ep.episode ?? ep.number) : 'Movie', start: playing.started }).catch(() => {});
  return tauri.core.invoke('set_player_info', { info: {
    settings: set, segments: playing.segments, videoId: ctx.videoId,
    name: meta.name, year: meta.releaseInfo ?? meta.year, runtime: meta.runtime, genres: meta.genres ?? meta.genre ?? [],
    rating: meta.imdbRating, description: meta.description, logo: meta.logo, poster: meta.poster,
    episode: ep && { label: epLabel(ep.season, ep.episode ?? ep.number), title: ep.name || ep.title, overview: ep.overview || ep.description },
    next: eps[at + 1]?.id ?? null,
    episodes: eps.map((v) => ({ id: v.id, season: v.season, number: v.episode ?? v.number, title: v.name || v.title || '', thumbnail: v.thumbnail,
      progress: seen[v.id] ? seen[v.id].positionMs / seen[v.id].durationMs : 0, current: v.id === ctx.videoId })),
    sources: groups.filter(Boolean).flatMap((g, gi) => g.streams.map((s, si) => ({ key: `${gi}:${si}`, addon: g.addonName,
      name: s.name || g.addonName, title: s.title || s.description || '', playable: streamTarget(s)?.kind === 'url', current: s === stream }))),
  } });
}

// Requests from the player's Episodes and Sources panels
tauri?.event.listen('player-request', async ({ payload: r }) => {
  if (!playing) return;
  const notify = (text) => tauri.event.emitTo('player', 'player-notice', text);
  if (r.type === 'settings') { // Style panel in the player: only subtitle keys, only the types the defaults have
    for (const [k, v] of Object.entries(r.patch ?? {})) if (k.startsWith('sub') && typeof v === typeof PLAYBACK_DEFAULTS[k]) setSetting(k, v);
    return sendPlayerInfo();
  }
  const snap = await tauri.core.invoke('mpv_state');
  if (snap.duration > 0) record(playing.ctx, playing.stream, snap['time-pos'] ?? 0, snap.duration);
  if (r.type === 'source') {
    const [gi, si] = r.key.split(':').map(Number);
    const s = playing.groups.filter(Boolean)[gi]?.streams[si];
    return s && swap(playing.ctx, s, playing.groups, snap['time-pos'] ?? 0);
  }
  if (r.type === 'episode') {
    const { meta, type } = playing;
    const ep = seriesEps(meta).find((v) => v.id === r.id);
    if (!ep) return;
    const ctx = { ...playing.ctx, videoId: ep.id, season: ep.season, episode: ep.episode ?? ep.number };
    const set = settings();
    if (set.streamMode === 'ask') { // you choose: close the player and open that episode's streams
      playing.pickEpisode = { type, metaId: meta.id, videoId: ep.id };
      return tauri.core.invoke('mpv_cmd', { args: ['quit'] });
    }
    notify(`Finding a stream for ${epLabel(ctx.season, ctx.episode)}`);
    const groups = (await Promise.all(activeAddons().filter((a) => supports(a.manifest, 'stream', type, ep.id))
      .map((a) => getJson(resourceUrl(a.url, 'stream', type, ep.id)).then((j) => ({ addonName: a.manifest.name, streams: j.streams || [] }), () => null))))
      .filter(Boolean);
    // shortcut: a reused link that has died isn't detected mid-player (mpv just ends); the details page path does fall back
    const s = chooseStream({ mode: set.streamMode, quality: set.quality, last: progress()[ep.id], groups, bingeGroup: playing.stream.behaviorHints?.bingeGroup ?? null, ...pickRules(set) })
      ?? groups.flatMap((g) => g.streams).find((x) => streamTarget(x)?.kind === 'url');
    if (!s) return notify(`No playable stream for ${epLabel(ctx.season, ctx.episode)}. Torrent-only results can't play here.`);
    swap(ctx, s, groups, resumeAt(progress()[ep.id]));
  }

  async function swap(ctx, s, groups, start) {
    const t = streamTarget(s);
    if (t?.kind !== 'url') return notify('That source is a torrent or external link, so it can’t play here.');
    const title = mediaTitle(ctx);
    // %bytes%text quoting so commas in the title can't break mpv's option list. shortcut: proxy headers aren't re-sent on a switch; add http-header-fields here if an addon needs them
    const opts = `start=${start},force-media-title=%${new TextEncoder().encode(title).length}%${title}`;
    await tauri.core.invoke('mpv_cmd', { args: ['loadfile', t.href, 'replace', -1, opts] });
    Object.assign(playing, { ctx, stream: s, groups, segments: [], started: Math.floor(Date.now() / 1000) });
    notify(`Playing ${title}`);
    sendPlayerInfo();
    loadSegments(ctx);
  }
});

async function addonsView() {
  const st = enabledStates();
  const urls = addonUrls();
  app.innerHTML = `<section class="page narrow"><h1 class="page-title">Addons</h1>
    <p class="lede">Addons supply your catalogs, title details and streams. Streams are listed in the order below.</p>
    <form id="af" class="install"><label for="u">Manifest link</label>
      <div class="install-row"><input id="u" name="u" type="url" placeholder="https://example.com/manifest.json" required><button class="btn primary">Install addon</button></div>
      <p class="hint">Configured addon links can contain account keys. Marquee only ever shows the site name.</p></form>
    <ol class="addon-list">${urls.map((u, i) => {
      const m = manifests.get(u);
      const ok = m && !(m instanceof Error);
      const provides = ok ? (m.resources || []).map((r) => RESOURCE_NAMES[r.name || r] ?? (r.name || r)).join(', ') : '';
      return `<li class="${st[u] === false ? 'is-off' : ''}">
        <span class="addon-logo">${ok && m.logo ? `<img src="${esc(m.logo)}" alt="">` : esc((ok ? m.name : '?')[0])}</span>
        <div class="addon-text"><h2>${esc(ok ? m.name : redactUrl(u))} ${ok ? `<span class="ver">v${esc(m.version)}</span>` : ''}</h2>
          ${ok ? `<p>${esc(m.description)}</p><p class="hint">Provides ${esc(provides)}. Hosted at ${esc(redactUrl(u))}.</p>`
          : `<p class="error">Couldn’t load this addon (${esc(m?.message ?? 'not loaded')}). Check the link or remove it.</p>`}</div>
        <div class="addon-actions">
          <label class="switch"><input type="checkbox" data-i="${i}" ${st[u] !== false ? 'checked' : ''}><span>On</span></label>
          <button class="btn quiet" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Move ${esc(ok ? m.name : 'addon')} up">Move up</button>
          <button class="btn quiet" data-rm="${i}">Remove</button></div></li>`;
    }).join('')}</ol></section>`;
  $('#af').onsubmit = async (e) => {
    e.preventDefault();
    const u = e.target.u.value.trim().replace(/^stremio:\/\//, 'https://');
    try {
      const m = await getJson(u);
      if (!m.id || !m.name || !Array.isArray(m.resources)) throw new Error('that link isn’t an addon manifest');
      manifests.set(u, m);
      if (!urls.includes(u)) save(pk('installed_addon_urls'), [...urls, u]);
      addonsView();
    } catch (err) { alert(`Couldn’t install: ${err.message}`); }
  };
  app.querySelectorAll('[data-i]').forEach((c) => (c.onchange = () => { save(pk('addon_enabled_states'), { ...enabledStates(), [urls[c.dataset.i]]: c.checked }); c.closest('li').classList.toggle('is-off', !c.checked); }));
  app.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { save(pk('installed_addon_urls'), urls.filter((_, i) => i != b.dataset.rm)); addonsView(); }));
  app.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => { // order = stream group order, like Nuvio
    const i = +b.dataset.up, next = [...urls];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    save(pk('installed_addon_urls'), next); addonsView();
  }));
}

const LIB_SORT = { title: (a, b) => a.name.localeCompare(b.name), released: (a, b) => (parseInt(b.releaseInfo, 10) || 0) - (parseInt(a.releaseInfo, 10) || 0) };
function libraryView() {
  const sort = LIB_SORT[settings().librarySort];
  const items = sort ? [...library()].sort(sort) : [...library()].reverse(); // added: newest first
  app.innerHTML = `<section class="page"><h1 class="page-title">Library</h1>
    ${items.length ? `<div class="grid">${items.map(poster).join('')}</div>` : state('Titles you save show up here. Open any title and choose Save to library.')}</section>`;
}

function profilesView() {
  const p = profiles();
  app.innerHTML = `<section class="page who"><h1 class="marquee">Who’s watching?</h1>
    <ul class="profiles">${p.list.map((x) => `<li><button data-id="${esc(x.id)}" ${x.id === p.active ? 'aria-current="true"' : ''}>
      ${avatar(x, '', 'data-tilt')}<span>${esc(x.name)}</span></button></li>`).join('')}
      <li><button id="new"><span class="avatar add">+</span><span>Add profile</span></button></li></ul>
    <p class="hint">Each profile keeps its own addons, library, progress and settings. <a class="link" href="#/settings">Edit ${esc(p.list.find((x) => x.id === p.active)?.name ?? 'profile')}</a></p>
    <p class="hint">Signed in as ${esc(account?.email)}. <button class="link" id="signout">Sign out</button></p></section>`;
  $('#signout').onclick = async () => { await signOutAndForget(); location.hash = '#/'; };
  app.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => { save('profiles', { ...p, active: b.dataset.id }); manifests.clear(); location.hash = '#/'; }));
  $('#new').onclick = () => {
    const name = prompt('Name for the new profile')?.trim();
    if (!name) return;
    save('profiles', { ...p, list: [...p.list, { id: newProfileId(), name: name.slice(0, 24), color: PROFILE_COLORS[p.list.length % PROFILE_COLORS.length][0] }] });
    profilesView();
  };
}

// ---------- settings: one page, per profile, synced (volume stays on this PC inside mpv) ----------
const pills = (k, opts, cur) => `<div class="pills">${opts.map(([v, t]) => `<label><input type="radio" name="${k}" value="${v}" ${cur === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>`;
const checks = (k, opts, cur = []) => `<div class="pills chips" data-multi="${k}">${opts.map(([v, t]) => `<label><input type="checkbox" name="${k}" value="${esc(v)}" ${cur.includes(v) ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div>`;
const setRow = (label, control, hint = '') => `<fieldset class="set-row"><legend>${label}</legend>${control}${hint ? `<p class="hint">${hint}</p>` : ''}</fieldset>`;
const sw = (k, on) => `<label class="switch"><input type="checkbox" name="${k}" ${on ? 'checked' : ''}><span>${on ? 'On' : 'Off'}</span></label>`;
const switchRow = (k, label, on, hint) => setRow(label, sw(k, on), hint);
const signed = (v) => (v > 0 ? `+${v}` : `${v}`);
const FMT = { subSize: (v) => `${v}%`, subLift: (v) => (v ? `${v}% up` : 'Bottom'), brightness: signed, contrast: signed, saturation: signed, gamma: signed,
  trailerStart: (v) => (v ? `${v} s in` : 'From the start') };
const slider = (k, min, max, step, cur, label = '') => `<div class="slide"><input type="range" name="${k}" min="${min}" max="${max}" step="${step}" value="${cur}" aria-describedby="${k}-v" ${label ? `aria-label="${label}"` : ''}><output id="${k}-v">${FMT[k](cur)}</output></div>`;
const field = (k, cur, ph, label) => `<input class="lang text" name="${k}" value="${esc(cur)}" placeholder="${esc(ph)}" aria-label="${esc(label)}" spellcheck="false" autocomplete="off">`;
const langPick = (k, cur, none) => `<select name="${k}" class="lang"><option value="">${none}</option>${Object.entries(LANGS)
  .sort((a, b) => a[1].at(-1).localeCompare(b[1].at(-1))).map(([c, n]) => `<option value="${c}" ${cur === c ? 'selected' : ''}>${n.at(-1)}</option>`).join('')}</select>`;
// The preview uses mpv's own proportions: 38 px text on a 720 px tall picture, scaled with the frame.
const paintSample = (el, set) => {
  el.style.setProperty('--scale', set.subSize / 100);
  el.style.setProperty('--sub', set.subColor);
  el.style.setProperty('--lift', set.subLift);
  el.style.fontFamily = set.subFont ? `${set.subFont}, sans-serif` : '';
  el.style.fontWeight = set.subBold ? 700 : '';
  el.dataset.edge = set.subEdge;
};
const PIN_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M15 3l6 6-2 1-3 3 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 3-3z"/></svg>';

const SECTIONS = [['profile', 'Profile'], ['streams', 'Streams'], ['playback', 'Playback'], ['player', 'Player'], ['subtitles', 'Subtitles'],
  ['look', 'Look'], ['home', 'Home'], ['detail', 'Detail page'], ['cw', 'Continue watching'], ['system', 'System']];
const sec = (key, body) => `<section aria-labelledby="s-${key}" data-sec="${key}"><div class="set-head"><h2 id="s-${key}">${SECTIONS.find((s) => s[0] === key)[1]}</h2>
  ${key === 'profile' ? '' : `<button class="btn quiet" data-reset="${key}">Reset to defaults</button>`}</div>${body}</section>`;

const homeTitles = () => {
  const titles = { cw: 'Continue watching', upcoming: 'Upcoming episodes' };
  homeCatalogs(activeAddons()).forEach((c) => (titles[rowKey(c)] = `${rowTitle(c)}, from ${c.manifest.name}`));
  return titles;
};
// Order + show/hide list; Home rows can also be pinned and renamed.
function orderList(name, titles, saved, { pin = false, names = null } = {}) {
  const list = orderRows(Object.keys(titles), saved), pinned = saved.pinned ?? [];
  return `<ol class="home-rows" data-list="${name}">${list.map((r, i) => { const t = titles[r.key]; return `<li data-key="${esc(r.key)}" ${r.shown ? '' : 'class="off"'}>
    <label class="switch"><input type="checkbox" ${r.shown ? 'checked' : ''} aria-label="Show ${esc(t)}"></label>
    ${names ? `<input class="row-name" value="${esc(names[r.key] ?? '')}" placeholder="${esc(t)}" aria-label="Name for ${esc(t)}" spellcheck="false" autocomplete="off">` : `<span>${esc(t)}</span>`}
    ${pin ? `<button class="btn quiet icon pin" data-pin aria-pressed="${pinned.includes(r.key)}" aria-label="Pin ${esc(t)} to the top">${PIN_ICON}</button>` : ''}
    <button class="btn quiet icon" data-move="-1" ${i ? '' : 'disabled'} aria-label="Move ${esc(t)} up">↑</button>
    <button class="btn quiet icon" data-move="1" ${i < list.length - 1 ? '' : 'disabled'} aria-label="Move ${esc(t)} down">↓</button></li>`; }).join('')}</ol>`;
}

const QUALITIES = [['2160p', '4K'], ['1080p', '1080p'], ['720p', '720p']];
const DELAYS = [[400, 'Quick'], [700, 'Normal'], [1200, 'Slow']];
const sections = (set) => [
  sec('profile', profileSection()),
  sec('streams', setRow('When you press play', pills('streamMode', [['reuse', 'Reuse last stream'], ['auto', 'Pick for me'], ['ask', 'Let me choose']], set.streamMode),
      'Reuse plays the link that worked last time for that title, and picks a new one if it has stopped working.')
    + setRow('Preferred quality', pills('quality', QUALITIES, set.quality), 'Used when Marquee picks for you, among the streams that pass your rules.')
    + setRow('Only pick streams that are', checks('rules', Object.entries(RULES).map(([k, [t]]) => [k, t]), set.rules),
      'Every rule you tick has to match. When no stream passes them all, Marquee ignores the rules instead of playing nothing.')
    + setRow('Custom rule', `${field('customRule', set.customRule, 'remux|atmos', 'Custom rule')}<p class="hint error" id="rule-msg" role="status"></p>`,
      'A regular expression matched against each stream’s name and description, ignoring case. It has to match too.')
    + setRow('Wait for addons', pills('streamWait', [[0, 'Instant'], [5, '5 s'], [10, '10 s'], [-1, 'No limit']], set.streamWait),
      'Instant plays the first good stream that arrives. Slower addons still fill the list so you can switch.')
    + switchRow('sameGroup', 'Stay with the same release', set.sameGroup, 'The next episode plays from the same source and release group as the last one when it’s there.')),
  sec('playback', setRow('Next episode', pills('nextDelay', [[0, 'Off'], [5, '5 s'], [10, '10 s'], [15, '15 s']], set.nextDelay), 'A card counts down, then plays the next episode.')
    + setRow('Show the card', pills('nextWhen', NEXT_WHEN, set.nextWhen), 'Credits times come from IntroDB, AniSkip or the file’s chapters. Without them the card shows 30 s before the end.')
    + setRow('Ask “Still watching?”', pills('stillWatching', [[0, 'Never'], [3, 'After 3 episodes']], set.stillWatching), 'Pauses autoplay when you haven’t touched anything for a few episodes in a row.')
    + setRow('Intros and recaps', pills('skip', [['off', 'Leave them'], ['button', 'Show Skip button'], ['auto', 'Skip automatically']], set.skip),
      'Uses IntroDB, AniSkip and chapter names in the file. Auto-skip shows an Undo for 5 seconds.')),
  sec('player', setRow('Play videos in', pills('player', [['marquee', 'Marquee'], ['mpv', 'mpv window'], ['external', 'Another app']], set.player)
      + (set.player === 'external' ? `<p class="hint">${set.externalPath ? `Opens in ${esc(set.externalPath.split(/[\\/]/).pop())}.` : 'No app chosen yet.'} <button class="link" id="exe">${set.externalPath ? 'Change app' : 'Choose app'}</button></p>` : ''),
      'Another app opens the link and Marquee can’t track how far you got.')
    + setRow('Picture size', pills('fit', [['fit', 'Fit'], ['fill', 'Fill'], ['zoom', 'Zoom'], ['stretch', 'Stretch']], set.fit),
      'Fill crops the edges to cover the screen; Zoom crops more, for letterboxed films. The player’s menu changes it for one video.')
    + setRow('Hold → to speed up', pills('holdSpeed', [[1.5, '1.5×'], [2, '2×'], [3, '3×']], set.holdSpeed), 'A tap on → still jumps 10 s ahead.')
    + switchRow('showRemaining', 'Show time left', set.showRemaining, 'The clock counts down to the end instead of showing the length. Click it in the player to switch.')
    + setRow('Audio language', langPick('audioLang', set.audioLang, 'Whatever the file picks'), 'Marquee switches to this language when the video has it.')
    + setRow('Picture', `<div class="tune">${['brightness', 'contrast', 'saturation', 'gamma'].map((k) => `<div><span>${k[0].toUpperCase() + k.slice(1)}</span>${slider(k, -50, 50, 5, set[k], k)}</div>`).join('')}</div>`,
      'Starting values for every video. The player’s Picture panel changes them for one session.')
    + switchRow('deband', 'Smooth banding', set.deband, 'Removes stepped bands in skies and dark gradients. Uses more graphics power.')),
  sec('subtitles', `<figure class="sub-frame" aria-label="Subtitle preview"><figcaption class="sub-sample"><span>Keep the change. Meet me in the lobby<br>before the second reel starts.</span></figcaption></figure>
    ${setRow('Size', slider('subSize', 50, 200, 10, set.subSize, 'Size'))}
    ${setRow('Color', `<div class="pills swatches">${SUB_COLORS.map(([v, t]) => `<label><input type="radio" name="subColor" value="${v}" ${set.subColor === v ? 'checked' : ''}><span><i style="background:${v}"></i>${t}</span></label>`).join('')}</div>`)}
    ${setRow('Font', pills('subFont', SUB_FONTS, set.subFont))}
    ${switchRow('subBold', 'Bold', set.subBold)}
    ${setRow('Edge', pills('subEdge', [['none', 'None'], ['shadow', 'Shadow'], ['outline', 'Outline'], ['box', 'Box']], set.subEdge), 'Box puts a dark band behind each line, the easiest to read on bright scenes.')}
    ${setRow('Height', slider('subLift', 0, 30, 1, set.subLift, 'Height'), 'Raise them if they cover burned-in text or your TV crops the edge.')}
    ${setRow('Languages', `<div class="langs"><label>First choice ${langPick('subLang1', set.subLang1, 'Whatever the file picks')}</label><label>Then ${langPick('subLang2', set.subLang2, 'None')}</label></div>`,
      'Marquee turns on the first language the video has. Styled anime subtitles keep their own look and only follow the size.')}
    ${switchRow('subOnlyMine', 'Only my languages', set.subOnlyMine, 'Turns subtitles off when the video has none of your languages.')}
    ${switchRow('subForced', 'Forced subtitles', set.subForced, 'When none of your languages is there, shows the signs-and-songs track in the audio’s language.')}
    ${switchRow('subSdh', 'Hide sound descriptions', set.subSdh, 'Removes [door creaks] and speaker names from hearing-impaired subtitles.')}`),
  sec('look', setRow('Accent', `<div class="pills swatches">${Object.entries(ACCENTS).map(([k, [n, c]]) => `<label><input type="radio" name="accent" value="${k}" ${set.accent === k ? 'checked' : ''}><span><i style="background:${c}"></i>${n}</span></label>`).join('')}
      <label><input type="radio" name="accent" value="custom" ${set.accent === 'custom' ? 'checked' : ''}><span><i id="own-dot" style="background:${esc(set.accentHex)}"></i>Your color</span></label>
      <input type="color" name="accentHex" value="${esc(set.accentHex)}" aria-label="Pick your color"></div>`, 'Buttons, progress bars, the marquee bulbs and this page’s highlights.')
    + switchRow('amoled', 'Pure black', set.amoled, 'Black instead of petrol behind everything. Saves power on OLED screens.')
    + setRow('Poster size', pills('posterSize', POSTER_SIZES, set.posterSize))
    + setRow('Poster corners', pills('posterRadius', RADII, set.posterRadius))
    + switchRow('posterLabels', 'Titles under posters', set.posterLabels, 'Off leaves only the artwork.')
    + switchRow('landscape', 'Wide cards', set.landscape, 'Rows show the backdrop and title logo instead of the poster.')
    + switchRow('intro', 'Launch intro', set.intro, 'The bulbs and curtain when Marquee opens.')),
  sec('home', switchRow('hero', 'Banner', set.hero, 'The big rotating banner at the top of Home.')
    + setRow('Banner shows titles from', checks('heroRows', Object.entries(homeTitles()).filter(([k]) => k.includes('/')).map(([k, t]) => [k, t.split(', from')[0]]), set.heroRows),
      'Nothing ticked: the first row that has backdrops.')
    + setRow('Rows', orderList('homeRows', homeTitles(), set.homeRows, { pin: true, names: set.rowNames }), 'Turn rows off, pin them to the top, move or rename them. Rows from new addons show up at the bottom.')
    + switchRow('hideUnreleased', 'Hide unreleased titles', set.hideUnreleased, 'Leaves out films and shows that haven’t come out yet.')
    + switchRow('bannerTrailer', 'Trailer in the banner', set.bannerTrailer, 'The banner plays a muted trailer after a few seconds.')
    + switchRow('hoverTrailer', 'Trailer on hover', set.hoverTrailer, 'Resting on a poster opens a preview card that plays a trailer.')
    + switchRow('hoverSound', 'Sound on hover', set.hoverSound, 'Hover trailers start with sound instead of muted.')
    + setRow('Preview card opens', pills('hoverDelay', DELAYS, set.hoverDelay), 'How long you rest on a poster before its card opens.')
    + setRow('Trailers start', slider('trailerStart', 0, 60, 5, set.trailerStart, 'Trailers start'), 'Skips the studio logos at the start of most trailers.')),
  sec('detail', setRow('Sections', orderList('detailSections', DETAIL_SECTIONS, set.detailSections), 'Below the episodes and streams. Turn sections off or move them.')
    + setRow('Background', pills('detailBg', [['normal', 'Normal'], ['cinematic', 'Cinematic'], ['color', 'Poster color']], set.detailBg),
      'Cinematic spreads the blurred backdrop behind the whole page. Poster color tints it with the title’s main color.')
    + switchRow('blurUnwatched', 'Hide spoilers', set.blurUnwatched, 'Blurs the stills of episodes you haven’t watched.')),
  sec('cw', switchRow('cw', 'Show the row', set.cw)
    + setRow('Style', pills('cwStyle', [['poster', 'Posters'], ['wide', 'Wide stills']], set.cwStyle))
    + setRow('Order', pills('cwSort', [['recent', 'Last watched'], ['title', 'Title']], set.cwSort))
    + switchRow('cwNextUp', 'Next episode up', set.cwNextUp, 'When you finish an episode, the next one takes its place.')
    + switchRow('cwUpcoming', 'Upcoming row', set.cwUpcoming, 'Next episodes that haven’t aired yet get their own row on Home.')
    + switchRow('cwBlur', 'Blur next-up stills', set.cwBlur, 'Keeps the next episode’s picture from spoiling it.')
    + switchRow('resumePrompt', 'Offer to resume at launch', set.resumePrompt, 'When Marquee opens, it asks whether to carry on with what you watched last.')),
  sec('system', setRow('Updates', `${pills('updateChannel', [['stable', 'Stable'], ['beta', 'Beta']], set.updateChannel)}<p class="hint"><button class="btn quiet" id="upd">Check for updates</button> <span id="upd-msg" role="status"></span></p>`,
      'Beta gets new features first and can have rough edges.')
    + switchRow('rememberProfile', 'Skip “Who’s watching?”', set.rememberProfile, 'Opens straight into the profile you used last.')
    + setRow('Discord status', sw('discord', set.discord) + (set.discord ? field('discordId', set.discordId, 'Application ID', 'Discord application ID') : ''),
      'Shows what you’re watching on your Discord profile. Needs the Discord app running and an application ID from discord.com/developers.')
    + setRow('New episode alerts', `${sw('alerts', set.alerts)}<button class="btn quiet" id="alert-test">Send a test</button>`,
      'While Marquee is open it checks the series in your library every 3 hours and tells you when a new episode is out.')
    + setRow('Sort library by', pills('librarySort', [['added', 'Recently added'], ['title', 'Title'], ['released', 'Release year']], set.librarySort))),
];

let spy = null;
function settingsView() {
  const set = settings();
  app.innerHTML = `<section class="page settings"><h1 class="page-title">Settings</h1>
    <p class="lede">These settings belong to ${esc(profiles().list.find((x) => x.id === pid())?.name ?? 'this profile')} and follow you to every PC you sign in on.</p>
    <div class="set-layout"><nav class="set-index" aria-label="Settings sections"><ol>${SECTIONS.map(([k, t]) => `<li><button data-jump="s-${k}">${t}</button></li>`).join('')}</ol></nav>
    <div class="set-main">${sections(set).join('')}</div></div></section>`;
  const sample = $('.sub-sample');
  paintSample(sample, set);
  const typed = (name, value) => (typeof { ...PLAYBACK_DEFAULTS, ...LOOK_DEFAULTS }[name] === 'number' ? +value : value);
  const value = (r) => (r.closest('[data-multi]') ? [...r.closest('[data-multi]').querySelectorAll('input:checked')].map((i) => i.value)
    : r.type === 'checkbox' ? r.checked : typed(r.name, r.value));
  wireProfile(); wireLists();
  app.querySelectorAll('[data-sec]:not([data-sec=profile]) :is(input, select)[name]').forEach((r) => {
    r.oninput = () => { // preview and readouts follow the slider; the profile is saved once you let go
      if (FMT[r.name]) $(`#${r.name}-v`).textContent = FMT[r.name](+r.value);
      if (r.closest('[data-sec=subtitles]')) paintSample(sample, { ...settings(), [r.name]: value(r) });
      if (r.name === 'accentHex') { applyLook({ ...settings(), accent: 'custom', accentHex: r.value }); $('#own-dot').style.background = r.value; }
    };
    r.onchange = async () => {
      const v = value(r);
      if (r.type === 'checkbox' && r.closest('.switch')) r.nextElementSibling.textContent = v ? 'On' : 'Off';
      if (r.name === 'customRule') {
        let bad = false; try { new RegExp(v); } catch { bad = true; }
        r.setAttribute('aria-invalid', String(bad));
        $('#rule-msg').textContent = bad ? 'That isn’t a valid regular expression, so Marquee ignores it. Check the brackets.' : '';
      }
      setSetting(r.name, v);
      if (r.name === 'accentHex') { setSetting('accent', 'custom'); $('[name=accent][value=custom]').checked = true; }
      if (r.name in LOOK_DEFAULTS) applyLook();
      if (r.name === 'player' && v === 'external' && !set.externalPath) await chooseExe();
      if (r.name === 'discord' && !v) tauri?.core.invoke('discord_clear').catch(() => {});
      if (r.name === 'alerts' && v) checkAlerts();
      if (r.name === 'player' || r.name === 'discord') { settingsView(); $(`[name=${r.name}]${r.type === 'radio' ? `[value="${v}"]` : ''}`)?.focus(); } // shows or hides the extra field
    };
  });
  if ($('#exe')) $('#exe').onclick = chooseExe;
  $('#upd').onclick = async () => {
    const msg = $('#upd-msg');
    msg.textContent = 'Checking…';
    if (!tauri) return void (msg.textContent = 'Updates come with the desktop app.');
    try { const v = await tauri.core.invoke('check_update', { channel: settings().updateChannel }); msg.textContent = v ? `Marquee ${v} is out. Choose Update now in the prompt to install it.` : 'You have the latest version.'; }
    catch (e) { msg.textContent = `Couldn’t check (${e}). Try again later.`; }
  };
  $('#alert-test').onclick = () => notify('New episode alerts are on', 'Marquee tells you here when a series in your library gets a new episode.');
  app.querySelectorAll('[data-jump]').forEach((b) => (b.onclick = () => document.getElementById(b.dataset.jump).scrollIntoView({ behavior: calm.matches ? 'auto' : 'smooth' })));
  // the index lights the bulb of the section you're reading
  spy?.disconnect();
  spy = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    app.querySelectorAll('[data-jump]').forEach((b) => (b.dataset.jump === e.target.querySelector('h2').id ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
  }), { rootMargin: '-25% 0px -65% 0px' });
  app.querySelectorAll('.set-main > section').forEach((s) => spy.observe(s));
  app.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = () => { // each section resets only its own keys
    save(pk('settings'), resetSection(load(pk('settings'), {}), b.dataset.reset));
    applyLook();
    settingsView();
    $(`[data-sec=${b.dataset.reset}] [data-reset]`).focus();
  }));
}
// ---------- settings: Profile (the one in use) ----------
const me = () => profiles().list.find((x) => x.id === pid());
const editMe = (patch) => { const p = profiles(); save('profiles', { ...p, list: p.list.map((x) => (x.id === p.active ? { ...x, ...patch } : x)) }); };
function profileSection() {
  const m = me(), only = profiles().list.length < 2;
  const photo = m.avatar?.startsWith('data:image/');
  const pic = (value, label, face) => `<label title="${esc(label)}"><input type="radio" name="avatar" value="${esc(value)}" ${(m.avatar ?? '') === value ? 'checked' : ''}><span class="sr-only">${esc(label)}</span>${face}</label>`;
  return `<div class="me-card">${avatar(m, 'lg')}<label class="name-field"><span>Name</span><input id="pname" value="${esc(m.name)}" maxlength="24" autocomplete="off" spellcheck="false"></label></div>
    ${setRow('Color', `<div class="pills dots">${PROFILE_COLORS.map(([c, n]) => `<label title="${n}"><input type="radio" name="color" value="${c}" ${m.color === c ? 'checked' : ''}><span style="--c:${c}"><span class="sr-only">${n}</span></span></label>`).join('')}</div>`)}
    ${setRow('Picture', `<div class="pics">${pic('', 'First letter', avatar({ ...m, avatar: '' }))}${Object.entries(AVATARS).map(([k, [n]]) => pic(k, n, avatar({ ...m, avatar: k }))).join('')}${photo ? pic(m.avatar, 'Your photo', avatar(m)) : ''}</div>
      <p class="hint"><button class="btn quiet" id="upload">${photo ? 'Change photo' : 'Upload a photo'}</button><input type="file" id="photo" accept="image/*" hidden></p>`,
      'Photos are cropped to a circle and shrunk to a small file before they sync.')}
    ${setRow('Delete', `<div id="del-zone"><button class="btn quiet danger" id="pdel" ${only ? 'disabled' : ''}>Delete ${esc(m.name)}</button></div>`,
      only ? 'Marquee needs at least one profile. Add another on the profile screen first.' : 'Removes this profile’s library, progress, addons and settings from every PC.')}`;
}
// Center square, 160 px, JPEG: about 10 KB, small enough to ride along in the synced profile list.
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height), c = document.createElement('canvas');
      c.width = c.height = 160;
      c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 160, 160);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('not an image'));
    img.src = URL.createObjectURL(file);
  });
}
function wireProfile() {
  const sec = $('[data-sec=profile]');
  const refresh = (focus) => { $('#who').innerHTML = `${avatar(me(), 'sm')}${esc(me().name)}`; settingsView(); if (focus) $(focus)?.focus(); };
  $('#pname').onchange = (e) => { const name = e.target.value.trim().slice(0, 24); if (name) editMe({ name }); else e.target.value = me().name; refresh('#pname'); };
  sec.querySelectorAll('[name=color], [name=avatar]').forEach((r) => (r.onchange = () => { editMe({ [r.name]: r.value }); refresh(`[name=${r.name}][value="${CSS.escape(r.value)}"]`); }));
  $('#upload').onclick = () => $('#photo').click();
  $('#photo').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { editMe({ avatar: await shrinkPhoto(f) }); refresh('#upload'); }
    catch { $('#upload').insertAdjacentHTML('afterend', ' <span class="error">That file isn’t a picture Marquee can read. Try a JPEG or PNG.</span>'); }
  };
  $('#pdel').onclick = () => {
    $('#del-zone').innerHTML = `<p class="confirm" role="alert">Delete ${esc(me().name)} and everything in it? This can’t be undone.</p>
      <button class="btn danger" id="pdel-yes">Delete profile</button> <button class="btn quiet" id="pdel-no">Keep it</button>`;
    $('#pdel-no').focus();
    $('#pdel-no').onclick = () => settingsView();
    $('#pdel-yes').onclick = () => {
      const p = profiles(), gone = p.active;
      Object.keys(localStorage).filter((k) => k.endsWith(`_${gone}`)).forEach(drop);
      save('profiles', removeProfile(p, gone));
      manifests.clear();
      location.hash = '#/profiles';
    };
  };
}

// ---------- settings: ordered lists (Home rows, detail sections) ----------
function wireLists() {
  app.querySelectorAll('[data-list]').forEach((list) => {
    const name = list.dataset.list;
    const keys = (f) => [...list.children].filter(f).map((li) => li.dataset.key);
    const saveList = () => setSetting(name, { order: keys(() => true), hidden: keys((li) => !li.querySelector('.switch input').checked),
      pinned: keys((li) => li.querySelector('[data-pin]')?.getAttribute('aria-pressed') === 'true') });
    const redraw = (key, sel) => { settingsView(); $(`[data-list=${name}] [data-key="${CSS.escape(key)}"] ${sel}`)?.focus(); };
    list.querySelectorAll('.switch input').forEach((c) => (c.onchange = () => { c.closest('li').classList.toggle('off', !c.checked); saveList(); }));
    list.querySelectorAll('[data-pin]').forEach((b) => (b.onclick = () => { // pinned rows jump to the top
      b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
      saveList();
      redraw(b.closest('li').dataset.key, '[data-pin]');
    }));
    list.querySelectorAll('.row-name').forEach((inp) => (inp.onchange = () => {
      const names = { ...settings().rowNames }, k = inp.closest('li').dataset.key, v = inp.value.trim().slice(0, 40);
      if (v) names[k] = v; else delete names[k];
      setSetting('rowNames', names);
    }));
    list.querySelectorAll('[data-move]').forEach((b) => (b.onclick = () => {
      const li = b.closest('li'), to = +b.dataset.move;
      if (to < 0) li.previousElementSibling.before(li); else li.nextElementSibling.after(li);
      saveList();
      redraw(li.dataset.key, `[data-move="${to}"]:not(:disabled)`);
      if (!list.isConnected && !document.activeElement?.closest('[data-list]')) $(`[data-list=${name}] [data-key="${CSS.escape(li.dataset.key)}"] [data-move]:not(:disabled)`)?.focus();
    }));
  });
}
async function chooseExe() {
  const path = tauri && await tauri.core.invoke('pick_exe').catch(() => null);
  if (path) setSetting('externalPath', path);
  settingsView();
}

let routeSeq = 0;
async function route() {
  const seq = ++routeSeq;
  bill = null; closePeek();
  document.body.dataset.bg = '';
  const [, view, a, b, c] = location.hash.split('/');
  const me = profiles().list.find((x) => x.id === pid());
  $('#who').innerHTML = me ? `${avatar(me, 'sm')}${esc(me.name)}` : '';
  applyLook();
  document.querySelectorAll('nav [data-nav]').forEach((l) => l.dataset.nav === (view || '') ? l.setAttribute('aria-current', 'page') : l.removeAttribute('aria-current'));
  if (view && view !== 'meta') ambient(null);
  // A slow addon manifest (15 s timeout) used to leave the window blank; show placeholders while they load.
  if (addonUrls().some((u) => !manifests.has(u))) app.innerHTML = `<section class="hero"></section>${setRow('Loading', '', '<div class="skeleton"></div>'.repeat(8))}`;
  await loadManifests();
  if (seq !== routeSeq) return; // user navigated again while manifests loaded
  const go = () => {
    scrollTo(0, 0);
    if (view === 'search') return search(decodeURIComponent(a || ''));
    if (view === 'meta') return details(a, decodeURIComponent(b), c && decodeURIComponent(c));
    if (view === 'addons') return addonsView();
    if (view === 'library') return libraryView();
    if (view === 'profiles') return profilesView();
    if (view === 'settings') return settingsView();
    return home();
  };
  // The callback must not return the view's promise: the transition would freeze the screen until the network answers.
  if (document.startViewTransition && !calm.matches) document.startViewTransition(() => { go(); });
  else go();
}
addEventListener('hashchange', () => account && route());

// ---------- sign-in: the marquee sign lights up bulb by bulb, the form sits in its glow ----------
let account = null, launched = false;
const LOGIN_ERRORS = {
  'auth/invalid-credential': 'That email and password don’t match. Check both and try again.',
  'auth/invalid-email': 'That doesn’t look like an email address.',
  'auth/missing-password': 'Enter your password.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes, then try again.',
  'auth/network-request-failed': 'Can’t reach the sign-in service. Check your internet connection.',
  'auth/user-disabled': 'This account is turned off. Ask whoever set up Marquee.',
  'permission-denied': 'This account isn’t on the invite list yet. Ask whoever set up Marquee to add your email.',
};
const loginError = (code) => LOGIN_ERRORS[code] || `Sign-in didn’t work (${code}). Try again.`;
function signBulbs(across = 15, down = 5) { // clockwise from the top-left corner, so the lighting runs around the frame
  const pts = [];
  for (let i = 0; i < across; i++) pts.push([i / (across - 1), 0]);
  for (let j = 1; j < down; j++) pts.push([1, j / down]);
  for (let i = 0; i < across; i++) pts.push([1 - i / (across - 1), 1]);
  for (let j = 1; j < down; j++) pts.push([0, 1 - j / down]);
  return pts.map(([x, y], i) => `<i style="left:${x * 100}%;top:${y * 100}%;--i:${i}"></i>`).join('');
}
function loginView(code) {
  document.body.classList.add('gated');
  // When the launch curtain is still up, wait for it to part before the bulbs come on.
  app.innerHTML = `<section class="gate" style="--lead:${$('#intro') ? 1300 : 0}ms">
    <div class="sign-board"><span class="sign-bulbs" aria-hidden="true">${signBulbs()}</span><h1>Marquee</h1></div>
    <form class="gate-form" id="login" novalidate>
      <label for="em">Email</label><input id="em" type="email" autocomplete="username">
      <label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password">
      <p class="gate-msg" id="msg" role="alert"></p>
      <button class="btn primary">Sign in</button>
      <button type="button" class="link" id="forgot">Forgot password?</button>
    </form>
    <p class="hint">Marquee is invite-only. Ask whoever set it up to add your email.</p></section>`;
  const say = (text, ok = false) => { $('#msg').textContent = text; $('#msg').classList.toggle('ok', ok); };
  if (code) say(loginError(code));
  $('#em').focus();
  $('#login').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('.primary');
    btn.disabled = true; btn.textContent = 'Signing in…'; say('');
    try { await signIn($('#em').value.trim(), $('#pw').value); } // watch() below takes over on success
    catch (err) { say(loginError(err.code)); btn.disabled = false; btn.textContent = 'Sign in'; }
  };
  $('#forgot').onclick = async () => {
    const email = $('#em').value.trim();
    if (!email) { $('#em').focus(); return say('Enter your email above, then choose Forgot password again.'); }
    try { await resetPassword(email); say(`If ${email} has an account, a reset link is on its way. Check spam too.`, true); }
    catch (err) { say(loginError(err.code)); }
  };
}
tauri?.core.invoke('check_update', { channel: settings().updateChannel }).catch(() => {}); // at launch, even signed out; offline etc: just skip
watch(
  (user) => {
    account = user; document.body.classList.remove('gated'); manifests.clear();
    const first = !launched;
    launched = true;
    if (first && profiles().list.length > 1 && !settings().rememberProfile && location.hash !== '#/profiles') location.hash = '#/profiles'; // hashchange routes
    else { route(); if (first) setTimeout(resumeOffer, settings().intro && !calm.matches ? 2600 : 600); }
    if (first) checkAlerts();
  },
  (code) => { account = null; loginView(code); },
);
{ // launch intro: plays over the loading app, removes itself; any click or key skips it
  const intro = $('#intro');
  const done = () => intro?.remove();
  if (calm.matches || !settings().intro) done();
  else {
    intro?.querySelector('.curtain + .curtain').addEventListener('animationend', done);
    intro?.addEventListener('click', done);
    addEventListener('keydown', done, { once: true });
    setTimeout(done, 2500); // never let a stalled animation hide the app
  }
}
// Launch: offer to carry on with what you watched last (Settings > Continue watching).
let autoStart = null; // videoId the details page should start playing on its own
function resumeOffer() {
  const set = settings(), p = set.resumePrompt && !playing && cwData(set).resume[0];
  if (!p) return;
  const d = document.createElement('dialog');
  d.className = 'resume';
  d.innerHTML = `<p>Carry on with <b>${esc(p.name)}</b>${p.season ? ` ${epLabel(p.season, p.episode)}` : ''}?</p>
    <form method="dialog"><button class="btn primary" value="yes">Resume</button> <button class="btn quiet" value="">Not now</button></form>`;
  d.onclose = () => {
    d.remove();
    if (d.returnValue !== 'yes') return;
    autoStart = p.videoId;
    location.hash = `#/meta/${p.type}/${encodeURIComponent(p.metaId)}${p.season != null ? `/${encodeURIComponent(p.videoId)}` : ''}`;
  };
  document.body.append(d);
  d.showModal();
}
// New episode alerts: only while Marquee is open, at launch and every 3 hours, for series in the library.
async function notify(title, body) {
  if (tauri) return tauri.core.invoke('notify', { title, body }).catch(() => {});
  if (await Notification.requestPermission() === 'granted') new Notification(title, { body });
}
let alertTimer = 0;
async function checkAlerts() {
  clearTimeout(alertTimer);
  if (!settings().alerts) return;
  alertTimer = setTimeout(checkAlerts, 3 * 3600e3);
  const key = `alerts_checked_${pid()}`, since = +localStorage.getItem(key) || 0, now = Date.now();
  localStorage.setItem(key, now); // this PC only: never synced
  if (!since) return; // first run: only episodes from now on
  await loadManifests();
  for (const m of library().filter((x) => x.type === 'series')) {
    const meta = await fetchMeta('series', m.id).catch(() => null);
    const fresh = (meta?.videos ?? []).filter((v) => v.season > 0 && v.released && Date.parse(v.released) > since && Date.parse(v.released) <= now);
    if (fresh.length) notify(`New episode of ${meta.name}`, fresh.length > 1 ? `${fresh.length} new episodes are out.`
      : `${epLabel(fresh[0].season, fresh[0].episode ?? fresh[0].number)}${fresh[0].name ? `, ${fresh[0].name},` : ''} is out.`);
  }
}
if (!window.__TAURI__) navigator.serviceWorker?.register('sw.js'); // makes Marquee installable and lets it open without the server

// ---------- depth: pointer tilt on [data-tilt] cards, three-layer parallax on the hero ----------
const fine = matchMedia('(hover: hover) and (pointer: fine)');
let tilted = null, frame = 0, ptr = null;
const untilt = () => {
  if (!tilted) return;
  ['--rx', '--ry', '--mx', '--my'].forEach((p) => tilted.style.removeProperty(p));
  tilted.classList.remove('is-tilting');
  tilted = null;
};
function depth() {
  frame = 0;
  if (calm.matches || !fine.matches) return;
  const el = ptr.target.closest?.('[data-tilt]');
  if (el !== tilted) untilt();
  if (el) {
    const r = el.getBoundingClientRect();
    const x = (ptr.clientX - r.left) / r.width, y = (ptr.clientY - r.top) / r.height;
    el.style.setProperty('--ry', `${((x - 0.5) * 18).toFixed(2)}deg`); // the side under the pointer presses away
    el.style.setProperty('--rx', `${((0.5 - y) * 14).toFixed(2)}deg`);
    el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    el.classList.add('is-tilting');
    tilted = el;
  }
  const h = $('.hero');
  if (h && ptr.clientY < h.getBoundingClientRect().bottom) {
    h.style.setProperty('--px', (ptr.clientX / innerWidth - 0.5).toFixed(3));
    h.style.setProperty('--py', (ptr.clientY / innerHeight - 0.5).toFixed(3));
  }
}
addEventListener('pointermove', (e) => { ptr = e; frame ||= requestAnimationFrame(depth); }, { passive: true });
document.documentElement.addEventListener('pointerleave', untilt);
