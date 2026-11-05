// Look and profile rules: accents, poster size, home row order, avatars. Pure, so node can test them (look.test.mjs).

export const LOOK_DEFAULTS = { accent: 'tungsten', accentHex: '#4FB3C8', amoled: false, posterSize: 'M', posterRadius: 'classic', posterLabels: true, landscape: false, intro: true,
  // Home
  homeRows: { order: [], hidden: [], pinned: [] }, rowNames: {}, hero: true, heroRows: [], hideUnreleased: false,
  bannerTrailer: true, hoverTrailer: true, hoverDelay: 700, hoverSound: false, trailerStart: 0,
  // Detail page
  detailSections: { order: [], hidden: [] }, detailBg: 'normal', blurUnwatched: false,
  // Continue watching
  cw: true, cwStyle: 'poster', cwSort: 'recent', cwNextUp: true, cwUpcoming: true, cwBlur: false, resumePrompt: false,
  // System
  updateChannel: 'stable', rememberProfile: false, discord: false, discordId: '', alerts: false, librarySort: 'added' };

export const POSTER_SIZES = [['XS', 'Compact'], ['S', 'Dense'], ['M', 'Standard'], ['ML', 'Balanced'], ['L', 'Comfort'], ['XL', 'Large']];
export const RADII = [['sharp', 'Sharp'], ['subtle', 'Subtle'], ['classic', 'Classic'], ['rounded', 'Rounded'], ['pill', 'Soft']];
export const DETAIL_SECTIONS = { cast: 'Cast', trailers: 'Trailers', more: 'More like this' }; // below the episodes and sources, which stay put

// [name, color, the same color as "r g b" for glows]
export const ACCENTS = {
  tungsten: ['Tungsten gold', '#F0B35A', '240 179 90'],
  red: ['Marquee red', '#E8564A', '232 86 74'],
  plum: ['Velvet plum', '#C48FDC', '196 143 220'],
  green: ['Exit-sign green', '#5FD38A', '95 211 138'],
};

export const PROFILE_COLORS = [['#3E7C8C', 'Teal'], ['#2E5A8C', 'Blue'], ['#5A4E8C', 'Indigo'], ['#8C3E62', 'Rose'],
  ['#8C4A3E', 'Brick'], ['#8C6A2E', 'Brass'], ['#4E7A4A', 'Green'], ['#5A6670', 'Slate']];

// Line drawings on a 48 px grid, stroked in the text color over the profile color.
export const AVATARS = {
  popcorn: ['Popcorn', '<path d="M14 22l3 18h14l3-18zM20 22l1.5 18M28 22l-1.5 18"/><circle cx="17" cy="18" r="4"/><circle cx="24" cy="14" r="5"/><circle cx="31" cy="18" r="4"/>'],
  reel: ['Film reel', '<circle cx="24" cy="24" r="15"/><circle cx="24" cy="24" r="2.5"/><circle cx="24" cy="15" r="3.5"/><circle cx="32.5" cy="21" r="3.5"/><circle cx="29.3" cy="31.3" r="3.5"/><circle cx="18.7" cy="31.3" r="3.5"/><circle cx="15.5" cy="21" r="3.5"/>'],
  clapper: ['Clapperboard', '<path d="M10 22h28v17H10zM10 22l-1.5-6.5 27-6.5 1.5 6.5M17.5 14l4 6.5M26 12l4 6.5M10 29h28"/>'],
  ticket: ['Ticket', '<path d="M9 16h30v5.5a2.5 2.5 0 0 0 0 5V32H9v-5.5a2.5 2.5 0 0 0 0-5z"/><path d="M31 17v14" stroke-dasharray="2.5 3"/><path d="M15 21h10M15 26h7"/>'],
  projector: ['Projector', '<circle cx="17" cy="14" r="5"/><circle cx="28" cy="14" r="5"/><path d="M10 21h22v13H10zM32 25l6-3.5v12L32 30M14 34l-2 5M28 34l2 5"/>'],
  glasses: ['3D glasses', '<path d="M7 19h34M10 19l1.5 10.5a2 2 0 0 0 2 1.5h6.5a2 2 0 0 0 2-1.5l1-4.5h2l1 4.5a2 2 0 0 0 2 1.5h6.5a2 2 0 0 0 2-1.5L38 19"/>'],
  camera: ['Movie camera', '<path d="M8 20h24v16H8zM32 24l8-4v16l-8-4M13 20l3-8h8l3 8"/><circle cx="20" cy="28" r="3.5"/>'],
  chair: ['Director’s chair', '<path d="M15 10v30M33 10v30M15 13h18v7H15M13 27h22M15 27l18 13M33 27L15 40"/>'],
  megaphone: ['Megaphone', '<path d="M9 21v7l5 1 18 8V12l-18 8zM14 29l2.5 9h4.5l-1.5-8M36 19c2 2 2 9 0 11"/>'],
  star: ['Star', '<path d="M24 8.5l4.6 9.4 10.3 1.5-7.4 7.3 1.7 10.3L24 32.1l-9.2 4.9 1.7-10.3-7.4-7.3 10.3-1.5z"/>'],
  spotlight: ['Spotlight', '<path d="M13 15l10-5 5 10-10 5zM28 13l9-3M30 19l9 3M18 25l-3 14M18 25l7 14M11 39h18"/>'],
  strip: ['Film strip', '<path d="M14 8h20v32H14zM20 14h8v8h-8zM20 26h8v8h-8z"/><path d="M17 10v28M31 10v28" stroke-dasharray="1.5 4"/>'],
  soda: ['Soda', '<path d="M14 17h20l-2.5 23h-15zM12 17h24M26 17l3-9h5M16 27h16"/>'],
  curtain: ['Curtain', '<path d="M7 10h34M9 10c0 12 5 22 13 28M39 10c0 12-5 22-13 28M9 10v28h13M39 10v28H26M15 10c1 8 4 15 7 19M33 10c-1 8-4 15-7 19"/>'],
  trophy: ['Trophy', '<path d="M17 9h14v8a7 7 0 0 1-14 0zM17 12h-4a4 4 0 0 0 4 6M31 12h4a4 4 0 0 1-4 6M24 24v7M18 38h12M20 31h8v7h-8z"/>'],
  flashlight: ['Usher’s torch', '<path d="M9 32L22 19l7 7-13 13zM22 19l4-4 7 7-4 4M35 13l5-5M37 20l6 0M28 11V5"/>'],
};

// Home rows as the settings list shows them: the saved order first, rows never arranged keep their place after, rows that no longer exist drop out.
// Pinned rows go on top.
export function orderRows(keys, { order = [], hidden = [], pinned = [] } = {}) {
  const all = [...order.filter((k) => keys.includes(k)), ...keys.filter((k) => !order.includes(k))];
  const sorted = [...all.filter((k) => pinned.includes(k)), ...all.filter((k) => !pinned.includes(k))];
  return sorted.map((key) => ({ key, shown: !hidden.includes(key) }));
}

// The last profile can't go; when the one in use goes, the first one left takes over.
export function removeProfile(p, id) {
  if (p.list.length <= 1) return p;
  const list = p.list.filter((x) => x.id !== id);
  return { ...p, list, active: p.active === id ? list[0].id : p.active };
}

// Time-based so a deleted profile's id (and its synced data) never comes back.
let last = 0;
export const newProfileId = () => (last = Math.max(Date.now(), last + 1)).toString(36);

// Saved settings without the keys of one Settings section.
const SECTIONS = {
  streams: ['quality', 'streamMode', 'rules', 'customRule', 'streamWait', 'sameGroup'],
  player: ['player', 'externalPath', 'audioLang', 'holdSpeed', 'showRemaining', 'fit', 'brightness', 'contrast', 'saturation', 'gamma', 'deband'],
  look: ['accent', 'accentHex', 'amoled', 'posterSize', 'posterRadius', 'posterLabels', 'landscape', 'intro'],
  home: ['homeRows', 'rowNames', 'hero', 'heroRows', 'hideUnreleased', 'bannerTrailer', 'hoverTrailer', 'hoverDelay', 'hoverSound', 'trailerStart'],
  detail: ['detailSections', 'detailBg', 'blurUnwatched'],
  cw: ['cw', 'cwStyle', 'cwSort', 'cwNextUp', 'cwUpcoming', 'cwBlur', 'resumePrompt'],
  system: ['updateChannel', 'rememberProfile', 'discord', 'discordId', 'alerts', 'librarySort'],
};
export const sectionOf = (k) => Object.keys(SECTIONS).find((s) => SECTIONS[s].includes(k)) ?? (k.startsWith('sub') ? 'subtitles' : 'playback');
export const resetSection = (saved, section) => Object.fromEntries(Object.entries(saved).filter(([k]) => sectionOf(k) !== section));

// Custom accent '#rrggbb' as 'r g b' for the glow CSS variable; anything else is null.
export const accentFromHex = (hex) => (/^#[0-9a-f]{6}$/i.test(hex ?? '') ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ') : null);

// A catalog item that hasn't come out yet. No date: assume it's out.
export function isUnreleased(m, now = Date.now()) {
  if (m.released) return Date.parse(m.released) > now;
  const y = parseInt(m.releaseInfo, 10);
  return y > new Date(now).getUTCFullYear();
}

// Continue watching. Series: the furthest episode; once it's finished, the next one (fetched meta) or, if it hasn't aired, the Upcoming row.
const done = (p) => p.durationMs > 0 && p.positionMs / p.durationMs >= 0.95;
const epOrder = (a, b) => (a.season - b.season) || (a.episode - b.episode);
function shows(prog) {
  const by = {};
  for (const p of Object.values(prog)) if (p.durationMs) (by[p.metaId] ??= []).push(p);
  return Object.values(by).map((list) => ({ list, newest: Math.max(...list.map((p) => p.updatedAt)),
    furthest: list[0].type === 'movie' ? list[0] : [...list].sort(epOrder).at(-1) }));
}
export const needsMeta = (prog, set) => (set.cwNextUp ? shows(prog).filter((s) => s.furthest.season != null && done(s.furthest)).map((s) => s.furthest.metaId) : []);
export function continueRows(prog, metas, set, now = Date.now()) {
  const resume = [], upcoming = [];
  for (const s of shows(prog).sort((a, b) => b.newest - a.newest)) {
    const last = set.cwNextUp ? s.furthest : [...s.list].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!done(last)) { resume.push(last); continue; }
    if (!set.cwNextUp || last.season == null) continue;
    const eps = (metas[last.metaId]?.videos ?? []).filter((v) => v.season > 0).sort(epOrder);
    const v = eps.find((e) => epOrder(e, last) > 0);
    if (!v) continue;
    const item = { ...last, videoId: v.id, season: v.season, episode: v.episode, positionMs: 0, durationMs: 0, next: true, thumbnail: v.thumbnail, released: v.released, stream: null };
    if (v.released && Date.parse(v.released) <= now) resume.push(item);
    else if (set.cwUpcoming) upcoming.push(item);
  }
  return { resume, upcoming };
}

// "What can I watch in…": addon runtime text ("142 min", "2h 22min", "1h", "50") → minutes; null when unknown.
export function runtimeMin(r) {
  if (typeof r === 'number') return r > 0 ? r : null;
  const s = String(r ?? ''), h = /(\d+)\s*h/i.exec(s), m = /(\d+)\s*m/i.exec(s);
  if (h || m) return +(h?.[1] ?? 0) * 60 + +(m?.[1] ?? 0) || null;
  return /^\s*\d+\s*$/.test(s) ? +s || null : null;
}
// cands: { left (minutes, null = unknown), genres }. max 0 = any length. Longest that still fits first: it fills the time you have.
export const fitList = (cands, { max = 0, genre = '' } = {}) => cands
  .filter((c) => c.left != null && (!max || c.left <= max) && (!genre || c.genres.includes(genre)))
  .sort((a, b) => b.left - a.left);
// Calendar month m (0-11): blanks before the 1st, then each day as 'YYYY-MM-DD'.
// shortcut: weeks always start on Sunday; read the locale's first weekday if anyone asks
export function monthDays(y, m) {
  const pad = (n) => String(n).padStart(2, '0'), first = new Date(y, m, 1).getDay(), n = new Date(y, m + 1, 0).getDate();
  return [...Array(first).fill(null), ...Array.from({ length: n }, (_, i) => `${y}-${pad(m + 1)}-${pad(i + 1)}`)];
}
// Dated episodes (specials left out) of the given series metas, by air day, for days starting with prefix ('YYYY-MM').
// The date part of the addon's timestamp is its air date: Cinemeta stamps midnight UTC or midnight US Eastern, so a local-time conversion would move some a day.
export function airDays(metas, prefix) {
  const out = {};
  for (const meta of metas) for (const v of meta.videos ?? []) {
    const d = v.released?.slice(0, 10);
    if (v.season > 0 && d?.startsWith(prefix)) (out[d] ??= []).push({ meta, v });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.meta.name.localeCompare(b.meta.name) || a.v.season - b.v.season || a.v.episode - b.v.episode);
  return out;
}
// Yearly recap from history entries ({day, id, videoId, minutes}): totals and one stub per title, most-watched first.
// A movie's videoId is its own id; anything else is an episode. genresOf(id) feeds the top genre, weighted by minutes.
export function recap(entries, genresOf = () => []) {
  const by = new Map(), months = Array(12).fill(0), genres = {};
  for (const e of entries) {
    if (!by.has(e.id)) by.set(e.id, { id: e.id, type: e.videoId === e.id ? 'movie' : 'series', minutes: 0, eps: new Set(), first: e.day });
    const t = by.get(e.id);
    t.minutes += e.minutes; if (e.day < t.first) t.first = e.day;
    if (t.type === 'series') t.eps.add(e.videoId);
    months[+e.day.slice(5, 7) - 1] += e.minutes;
  }
  const titles = [...by.values()].map(({ eps, ...t }) => ({ ...t, episodes: eps.size })).sort((a, b) => b.minutes - a.minutes);
  for (const t of titles) for (const g of genresOf(t.id) ?? []) genres[g] = (genres[g] ?? 0) + t.minutes;
  const minutes = titles.reduce((n, t) => n + t.minutes, 0);
  return { minutes, titles, episodes: titles.reduce((n, t) => n + t.episodes, 0), movies: titles.filter((t) => t.type === 'movie').length,
    busiest: minutes ? months.indexOf(Math.max(...months)) : null, genre: Object.entries(genres).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null };
}
export const hoursMin = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
