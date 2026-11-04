import { resourceUrl, supports, homeCatalogs, searchCatalogs, streamTarget, redactUrl, pickAutoPlay } from './protocol.js';

const DEFAULT_ADDONS = ['https://v3-cinemeta.strem.io/manifest.json']; // catalogs + meta, no keys
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`); // addon data is untrusted
const app = $('#app');
const calm = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- storage: same key scheme as Nuvio's .properties files (`<name>_<profileId>`) ----------
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const profiles = () => load('profiles', { active: '1', list: [{ id: '1', name: 'Main', color: '#3E7C8C' }] });
const pid = () => profiles().active;
const pk = (name) => `${name}_${pid()}`;
const addonUrls = () => load(pk('installed_addon_urls'), DEFAULT_ADDONS);
const enabledStates = () => load(pk('addon_enabled_states'), {});
const library = () => load(pk('library'), []);
const progress = () => load(pk('watch_progress'), {});

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

const art = (src, extra = '') => `<span class="art" data-tilt><img loading="lazy" src="${esc(src)}" alt="">${extra}</span>`;
const seen = new Map(); // id -> catalog meta, so hover cards need no extra fetch
const poster = (m) => (seen.set(m.id, m), `<a class="poster" href="#/meta/${esc(m.type)}/${encodeURIComponent(m.id)}">
  ${art(m.poster)}
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
function trailer(id, { sound = false, loop = false, onPlay, onEnd, onFail } = {}) {
  const f = document.createElement('iframe');
  f.className = 'trailer';
  f.allow = 'autoplay; encrypted-media; fullscreen';
  if (!sound) { f.tabIndex = -1; f.setAttribute('aria-hidden', 'true'); }
  f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=${sound ? 0 : 1}&controls=${sound ? 1 : 0}`
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
const soundBtn = (cls) => `<button class="btn quiet sound ${cls}" aria-pressed="false" aria-label="Sound">${SOUND_ICON}</button>`;
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
  b.el.innerHTML = hero(m, { kicker: 'Now showing', actions: `<a class="btn primary" href="#/meta/${esc(m.type)}/${encodeURIComponent(m.id)}">See episodes and streams</a>${ytId(m) ? soundBtn('') : ''}` });
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
  if (b.t === 3 && id) {
    b.frame = trailer(id, { onEnd: () => nextBill(b), onFail: () => (b.frame = null) });
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
  if (id && !calm.matches) {
    let f = null;
    p.querySelector('.peek-media').append(f = trailer(id, { loop: true }));
    p.querySelector('.peek-media').insertAdjacentHTML('beforeend', soundBtn('on-media'));
    wireSound(p.querySelector('.sound'), () => f);
  }
}
app.addEventListener('pointerover', (e) => {
  const a = fine.matches && e.target.closest('.poster');
  if (!a) return;
  clearTimeout(peekT);
  peekT = setTimeout(() => openPeek(a), 700);
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
async function home() {
  const cats = homeCatalogs(activeAddons());
  const cw = Object.values(progress()).filter((p) => p.durationMs && p.positionMs / p.durationMs < 0.95)
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
  app.innerHTML = `<section class="hero" id="hero">${cats.length ? '' : hero(
    { name: 'Nothing on the bill yet', description: 'Install an addon to fill your home screen with catalogs.' },
    { actions: '<a class="btn primary" href="#/addons">Install an addon</a>' })}</section>`
    + (cw.length ? row('Continue watching', '', cw.map((p) => `<a class="poster" href="#/meta/${esc(p.type)}/${encodeURIComponent(p.metaId)}">
        ${art(p.poster, `<span class="meter"><span style="width:${(p.positionMs / p.durationMs) * 100}%"></span></span>`)}
        <span class="poster-title">${esc(p.name)}</span>${p.season ? `<span class="poster-year">${epLabel(p.season, p.episode)}</span>` : ''}</a>`).join('')) : '')
    + cats.map((c, i) => row(`${c.catalog.name || c.catalog.id} ${TYPE_NAMES[c.catalog.type] ?? c.catalog.type}`, c.manifest.name, '<div class="skeleton"></div>'.repeat(8), `row${i}`)).join('');
  let heroFilled = !cats.length;
  cats.forEach(async (c, i) => {
    const el = $(`#row${i}`);
    try {
      const { metas = [] } = await getJson(resourceUrl(c.url, 'catalog', c.catalog.type, c.catalog.id));
      if (!el) return;
      el.innerHTML = metas.slice(0, 30).map(poster).join('') || state('This catalog is empty right now.');
      const picks = heroFilled ? [] : metas.filter((m) => m.background && m.description);
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

async function details(type, id) {
  app.innerHTML = '<section class="hero is-loading"></section>';
  const meta = await fetchMeta(type, id);
  if (!meta) { app.innerHTML = `<section class="page">${state('None of your addons has details for this title. Install one that covers it under Addons.', 'error')}</section>`; return; }
  const inLib = library().some((m) => m.id === meta.id);
  const eps = (meta.videos || []).filter((v) => v.season !== 0).sort((a, b) => a.season - b.season || (a.episode ?? a.number) - (b.episode ?? b.number));
  const seasons = [...new Set(eps.map((v) => v.season))];
  const isSeries = type !== 'movie' && eps.length;
  const tid = ytId(meta);
  app.innerHTML = `<section class="hero">${hero(meta, { withPoster: true, actions: `${tid ? '<button class="btn primary" id="trl"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7 4v16l13-8z"/></svg>Play trailer</button>' : ''}<button class="btn" id="lib" aria-pressed="${inLib}">${inLib ? 'Saved to library' : 'Save to library'}</button>` })}</section>
    <div class="detail-body">
      ${isSeries ? `<section class="episodes"><div class="seasons" role="tablist">${seasons.map((s) => `<button role="tab" data-s="${s}">Season ${s}</button>`).join('')}</div><ol class="ep-list" id="eps"></ol></section>` : ''}
      <section class="streams" id="streams"></section>
    </div>`;
  if (tid) $('#trl').onclick = () => screening(tid, meta.name);
  $('#lib').onclick = () => {
    save(pk('library'), inLib ? library().filter((m) => m.id !== meta.id)
      : [...library(), { id: meta.id, type, name: meta.name, poster: meta.poster, releaseInfo: meta.releaseInfo }]);
    details(type, id);
  };
  if (!isSeries) return void streams(meta, type, meta.id);
  const watched = progress();
  const showSeason = (s) => {
    app.querySelectorAll('.seasons button').forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.s === s)));
    $('#eps').innerHTML = eps.filter((v) => v.season === s).map((v, i) => {
      const p = watched[v.id];
      return `<li style="--i:${Math.min(i, 10)}"><button class="ep" data-vid="${esc(v.id)}">
        <span class="ep-thumb">${v.thumbnail ? `<img loading="lazy" src="${esc(v.thumbnail)}" alt="">` : ''}${p ? `<span class="meter"><span style="width:${Math.min(100, (p.positionMs / p.durationMs) * 100)}%"></span></span>` : ''}</span>
        <span class="ep-num">${v.episode ?? v.number}</span>
        <span class="ep-text"><span class="ep-title">${esc(v.name || v.title || `Episode ${v.episode ?? v.number}`)}</span>
        ${v.released ? `<span class="ep-date">${esc(new Date(v.released).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }))}</span>` : ''}</span></button></li>`;
    }).join('');
    app.querySelectorAll('.ep').forEach((b) => (b.onclick = () => {
      app.querySelectorAll('.ep').forEach((x) => x.removeAttribute('aria-current'));
      b.setAttribute('aria-current', 'true');
      streams(meta, type, b.dataset.vid, eps.find((e) => e.id === b.dataset.vid));
    }));
  };
  app.querySelectorAll('.seasons button').forEach((b) => (b.onclick = () => showSeason(+b.dataset.s)));
  const resume = Object.values(watched).filter((p) => p.metaId === meta.id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  showSeason(resume?.season ?? seasons[0]);
  $('#streams').innerHTML = state('Pick an episode to see its streams.');
}

async function streams(meta, type, videoId, ep) {
  const box = $('#streams');
  const targets = activeAddons().filter((a) => supports(a.manifest, 'stream', type, videoId));
  const epNo = ep && (ep.episode ?? ep.number);
  box.innerHTML = `<h2>${ep ? `Streams for ${epLabel(ep.season, epNo)}` : 'Streams'}</h2><div id="best-slot"></div>`
    + (targets.map((a, i) => `<div class="group"><h3>${esc(a.manifest.name)}</h3><div id="g${i}"><div class="skeleton line"></div><div class="skeleton line"></div></div></div>`).join('')
      || state('No installed addon provides streams for this title. Add a stream addon under Addons.'));
  box.scrollIntoView({ behavior: calm.matches ? 'auto' : 'smooth', block: 'start' });
  const ctx = { metaId: meta.id, type, name: meta.name, poster: meta.poster, videoId, season: ep?.season, episode: epNo };
  const groups = [];
  shelf = { meta, type, groups }; // the player's Sources/Episodes/Info come from what this page loaded
  await Promise.all(targets.map(async (a, i) => { // Nuvio fans out to every addon in parallel, grouped by addon in install order
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
  }));
  const last = Object.values(progress()).filter((p) => p.metaId === meta.id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const prefs = load('autoplay_prefs', { mode: 'regex', regex: '1080p|WEB-?DL' });
  const best = pickAutoPlay(groups.filter(Boolean), { ...prefs, bingeGroup: last?.bingeGroup ?? null });
  if (best && $('#best-slot')) {
    $('#best-slot').innerHTML = '<button id="best" class="btn primary">Play best match</button>';
    $('#best').onclick = () => play(ctx, best);
  }
}

function play(ctx, stream) {
  const t = streamTarget(stream);
  if (!t) return alert('This stream has no link to play.');
  if (t.kind !== 'url') { // shortcut: no torrent engine / external player bridge in a browser; Nuvio uses a native engine + libmpv
    return void prompt(t.kind === 'magnet' ? 'This is a torrent. Copy the magnet link into a torrent client:' : 'This stream opens outside Marquee. Copy the link:', t.href);
  }
  const key = ctx.videoId;
  const saved = progress()[key];
  if (window.__TAURI__) return playMpv(ctx, stream, t.href, saved);
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
}

function record(ctx, stream, posSec, durSec) {
  save(pk('watch_progress'), { ...progress(), [ctx.videoId]: { ...ctx, positionMs: posSec * 1000, durationMs: durSec * 1000, bingeGroup: stream.behaviorHints?.bingeGroup ?? null, updatedAt: Date.now() } });
}

// Desktop app (Tauri): mpv plays inside Marquee's window with player.html as the controls, like Nuvio; resume comes back when mpv closes.
let shelf = null;   // { meta, type, groups } from the last streams() call
let playing = null; // { meta, type, ctx, stream, groups } while mpv is open; ctx/stream change when you switch episode or source
const tauri = window.__TAURI__;
const resumeAt = (p) => (p && p.positionMs / p.durationMs < 0.95 ? p.positionMs / 1000 : 0);
const mediaTitle = (ctx) => ctx.name + (ctx.season ? ` ${epLabel(ctx.season, ctx.episode)}` : '');
const seriesEps = (meta) => (meta.videos || []).filter((v) => v.season !== 0)
  .sort((a, b) => a.season - b.season || (a.episode ?? a.number) - (b.episode ?? b.number));

async function playMpv(ctx, stream, href, saved) {
  playing = { ...shelf, ctx, stream };
  const headers = Object.entries(stream.behaviorHints?.proxyHeaders?.request ?? {}).map(([k, v]) => `${k}: ${v}`);
  try {
    await sendPlayerInfo();
    const [pos, dur] = await tauri.core.invoke('play_mpv', { url: href, title: mediaTitle(ctx), start: resumeAt(saved), headers });
    if (dur > 0) record(playing.ctx, playing.stream, pos, dur);
  } catch (e) { alert(e); }
  playing = null;
  route();
}

function sendPlayerInfo() {
  const { meta, type, ctx, stream, groups = [] } = playing;
  const eps = type === 'movie' ? [] : seriesEps(meta);
  const ep = eps.find((v) => v.id === ctx.videoId);
  const at = eps.indexOf(ep);
  const seen = progress();
  return tauri.core.invoke('set_player_info', { info: {
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
    notify(`Finding a stream for ${epLabel(ctx.season, ctx.episode)}`);
    const groups = (await Promise.all(activeAddons().filter((a) => supports(a.manifest, 'stream', type, ep.id))
      .map((a) => getJson(resourceUrl(a.url, 'stream', type, ep.id)).then((j) => ({ addonName: a.manifest.name, streams: j.streams || [] }), () => null))))
      .filter(Boolean);
    const prefs = load('autoplay_prefs', { mode: 'regex', regex: '1080p|WEB-?DL' });
    const s = pickAutoPlay(groups, { ...prefs, mode: prefs.mode === 'manual' ? 'first' : prefs.mode, bingeGroup: playing.stream.behaviorHints?.bingeGroup ?? null })
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
    Object.assign(playing, { ctx, stream: s, groups });
    notify(`Playing ${title}`);
    sendPlayerInfo();
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

function libraryView() {
  const items = library();
  app.innerHTML = `<section class="page"><h1 class="page-title">Library</h1>
    ${items.length ? `<div class="grid">${items.map(poster).join('')}</div>` : state('Titles you save show up here. Open any title and choose Save to library.')}</section>`;
}

function profilesView() {
  const p = profiles();
  app.innerHTML = `<section class="page who"><h1 class="marquee">Who’s watching?</h1>
    <ul class="profiles">${p.list.map((x) => `<li><button data-id="${esc(x.id)}" ${x.id === p.active ? 'aria-current="true"' : ''}>
      <span class="avatar" data-tilt style="--c:${esc(x.color)}">${esc(x.name[0])}</span><span>${esc(x.name)}</span></button></li>`).join('')}
      <li><button id="new"><span class="avatar add">+</span><span>Add profile</span></button></li></ul>
    <p class="hint">Each profile keeps its own addons, library and progress.</p></section>`;
  app.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => { save('profiles', { ...p, active: b.dataset.id }); manifests.clear(); location.hash = '#/'; }));
  $('#new').onclick = () => {
    const name = prompt('Name for the new profile')?.trim();
    if (!name) return;
    const id = String(Math.max(...p.list.map((x) => +x.id)) + 1);
    save('profiles', { ...p, list: [...p.list, { id, name, color: `hsl(${(+id * 67) % 360} 38% 42%)` }] });
    profilesView();
  };
}

// ---------- router ----------
let routeSeq = 0;
async function route() {
  const seq = ++routeSeq;
  bill = null; closePeek();
  const [, view, a, b] = location.hash.split('/');
  const me = profiles().list.find((x) => x.id === pid());
  $('#who').innerHTML = me ? `<span class="avatar sm" style="--c:${esc(me.color)}">${esc(me.name[0])}</span>${esc(me.name)}` : '';
  document.querySelectorAll('nav [data-nav]').forEach((l) => l.dataset.nav === (view || '') ? l.setAttribute('aria-current', 'page') : l.removeAttribute('aria-current'));
  if (view && view !== 'meta') ambient(null);
  // A slow addon manifest (15 s timeout) used to leave the window blank; show placeholders while they load.
  if (addonUrls().some((u) => !manifests.has(u))) app.innerHTML = `<section class="hero"></section>${row('Loading', '', '<div class="skeleton"></div>'.repeat(8))}`;
  await loadManifests();
  if (seq !== routeSeq) return; // user navigated again while manifests loaded
  const go = () => {
    scrollTo(0, 0);
    if (view === 'search') return search(decodeURIComponent(a || ''));
    if (view === 'meta') return details(a, decodeURIComponent(b));
    if (view === 'addons') return addonsView();
    if (view === 'library') return libraryView();
    if (view === 'profiles') return profilesView();
    return home();
  };
  // The callback must not return the view's promise: the transition would freeze the screen until the network answers.
  if (document.startViewTransition && !calm.matches) document.startViewTransition(() => { go(); });
  else go();
}
addEventListener('hashchange', route);
route();
{ // launch intro: plays over the loading app, removes itself; any click or key skips it
  const intro = $('#intro');
  const done = () => intro?.remove();
  if (calm.matches) done();
  else {
    intro?.querySelector('.curtain + .curtain').addEventListener('animationend', done);
    intro?.addEventListener('click', done);
    addEventListener('keydown', done, { once: true });
    setTimeout(done, 2500); // never let a stalled animation hide the app
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
