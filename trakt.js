// Trakt for one profile: device-code sign-in, Trakt watchlist <-> Library (removals too), Trakt history in as watched marks,
// finished titles out. Pure parts first so node can test them (trakt.test.mjs). Only IMDb ids (tt…) take part.
// cfg = { id, secret } from trakt-config.js, which CI writes from repo secrets (gitignored, never committed).
const API = 'https://api.trakt.tv';
const IMDB = /^tt\d+$/;
const posterOf = (id) => `https://images.metahub.space/poster/medium/${id}/img`;

// base = the ids both sides held after the last sync. In base but missing on one side = removed there;
// not in base = added on the side that has it. First sync (empty base) is a plain union.
export function mirror(local, remote, base) {
  const L = new Set(local), R = new Set(remote), B = new Set(base);
  const d = {
    addRemote: local.filter((id) => !R.has(id) && !B.has(id)),
    removeRemote: remote.filter((id) => B.has(id) && !L.has(id)),
    addLocal: remote.filter((id) => !L.has(id) && !B.has(id)),
    removeLocal: local.filter((id) => B.has(id) && !R.has(id)),
  };
  const gone = new Set([...d.removeRemote, ...d.removeLocal]);
  return { ...d, base: [...new Set([...local, ...remote])].filter((id) => !gone.has(id)) };
}

// Trakt's watched lists -> watch_progress entries Marquee lacks, in "Mark season"'s finished shape (1 of 1).
// Entries Marquee already has are left alone, so a rewatch in progress keeps its resume point.
export function marks(movies, shows, prog) {
  const out = {}, at = (s) => Date.parse(s) || 0;
  for (const { movie: m, last_watched_at: t } of movies) {
    const id = m?.ids?.imdb;
    if (IMDB.test(id ?? '') && !prog[id]) out[id] = { metaId: id, type: 'movie', name: m.title, poster: posterOf(id), videoId: id, positionMs: 1, durationMs: 1, updatedAt: at(t) };
  }
  for (const { show: s, seasons = [] } of shows) {
    const id = s?.ids?.imdb;
    if (!IMDB.test(id ?? '')) continue;
    for (const se of seasons) for (const e of se.episodes ?? []) {
      const v = `${id}:${se.number}:${e.number}`;
      if (!prog[v]) out[v] = { metaId: id, type: 'series', name: s.title, poster: posterOf(id), videoId: v, season: se.number, episode: e.number, positionMs: 1, durationMs: 1, updatedAt: at(e.last_watched_at) };
    }
  }
  return out;
}

// A finished movie or episode -> the /sync/history body, or null when it has no IMDb id.
export function historyBody(ctx, when = new Date()) {
  const id = ctx.metaId, watched_at = when.toISOString();
  if (!IMDB.test(id ?? '')) return null;
  return ctx.season != null
    ? { shows: [{ ids: { imdb: id }, seasons: [{ number: +ctx.season, episodes: [{ number: +ctx.episode, watched_at }] }] }] }
    : { movies: [{ ids: { imdb: id }, watched_at }] };
}

// Library items -> a watchlist add/remove body.
export const listBody = (items) => ({
  movies: items.filter((m) => m.type === 'movie').map((m) => ({ ids: { imdb: m.id } })),
  shows: items.filter((m) => m.type !== 'movie').map((m) => ({ ids: { imdb: m.id } })),
});

// ---------- network ----------
const headers = (cfg, token) => ({ 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': cfg.id, ...(token ? { Authorization: `Bearer ${token}` } : {}) });
async function call(cfg, token, path, body) {
  const r = await fetch(API + path, { method: body ? 'POST' : 'GET', headers: headers(cfg, token), body: body && JSON.stringify(body) });
  if (!r.ok) throw Object.assign(new Error(`Trakt answered ${r.status}`), { status: r.status });
  return r.status === 204 ? null : r.json();
}
const tokens = (t) => ({ access: t.access_token, refresh: t.refresh_token, expires: (t.created_at + t.expires_in) * 1000 });
const grant = (cfg, extra) => call(cfg, null, '/oauth/token', { client_id: cfg.id, client_secret: cfg.secret, redirect_uri: 'http://localhost/marquee' /* must match the app registered on trakt.tv */, ...extra });

// { device_code, user_code, verification_url, expires_in, interval }
export const deviceCode = (cfg) => call(cfg, null, '/oauth/device/code', { client_id: cfg.id });

// Polls until the code is approved: a new link, or null when it expired, was denied, or stop() turned true.
export async function deviceLink(cfg, dc, stop) {
  let wait = dc.interval * 1000;
  const end = Date.now() + dc.expires_in * 1000;
  while (Date.now() < end && !stop()) {
    await new Promise((r) => setTimeout(r, wait));
    if (stop()) return null;
    const r = await fetch(API + '/oauth/device/token', { method: 'POST', headers: headers(cfg), body: JSON.stringify({ code: dc.device_code, client_id: cfg.id, client_secret: cfg.secret }) });
    if (r.ok) {
      const link = tokens(await r.json());
      const me = await call(cfg, link.access, '/users/settings').catch(() => null);
      return { ...link, user: me?.user?.username ?? '', base: [] };
    }
    if (r.status === 429) wait += 1000;
    else if (r.status !== 400) return null; // 400 = not approved yet; 404/409/410/418 = bad, used, expired, denied
  }
  return null;
}

// Access tokens are short-lived: refresh a minute early. Trakt rotates the refresh token, so the caller saves the result.
export async function fresh(cfg, link) {
  return Date.now() < link.expires - 60000 ? link : { ...link, ...tokens(await grant(cfg, { refresh_token: link.refresh, grant_type: 'refresh_token' })
    .catch((e) => { throw Object.assign(e, { status: e.status === 400 ? 401 : e.status }); })) }; // 400 = refresh token no longer valid
}

export const revoke = (cfg, link) => call(cfg, null, '/oauth/revoke', { token: link.access, client_id: cfg.id, client_secret: cfg.secret }).catch(() => {});

// One sync. Pushes watchlist changes to Trakt itself; returns what Marquee must change locally:
// { link, addLocal: [library items], removeLocal: [ids], marks: {videoId: progress} }.
export async function sync(cfg, link, library, prog) {
  link = await fresh(cfg, link);
  const get = (p) => call(cfg, link.access, p), post = (p, b) => call(cfg, link.access, p, b);
  const [wm, ws, act] = await Promise.all([get('/sync/watchlist/movies'), get('/sync/watchlist/shows'), get('/sync/last_activities')]);
  const item = (x, type) => ({ id: x.ids?.imdb, type, name: x.title, poster: posterOf(x.ids?.imdb), releaseInfo: String(x.year ?? '') });
  const remote = new Map([...wm.map((x) => item(x.movie, 'movie')), ...ws.map((x) => item(x.show, 'series'))].filter((m) => IMDB.test(m.id ?? '')).map((m) => [m.id, m]));
  const local = library.filter((m) => IMDB.test(m.id));
  const d = mirror(local.map((m) => m.id), [...remote.keys()], link.base ?? []);
  const pick = (ids) => ids.map((id) => local.find((m) => m.id === id) ?? remote.get(id));
  if (d.addRemote.length) await post('/sync/watchlist', listBody(pick(d.addRemote)));
  if (d.removeRemote.length) await post('/sync/watchlist/remove', listBody(pick(d.removeRemote)));
  const stamp = `${act.movies?.watched_at}|${act.episodes?.watched_at}`; // history is only fetched when Trakt says it changed
  let add = {};
  if (stamp !== link.watchedAt) {
    const [hm, hs] = await Promise.all([get('/sync/watched/movies'), get('/sync/watched/shows')]);
    add = marks(hm, hs, prog);
  }
  return { link: { ...link, base: d.base, watchedAt: stamp, at: Date.now() }, addLocal: d.addLocal.map((id) => remote.get(id)), removeLocal: d.removeLocal, marks: add };
}

// A finished title out to Trakt history. Returns the (maybe refreshed) link, or the old one when there was nothing to send.
export async function addHistory(cfg, link, ctx) {
  const body = historyBody(ctx);
  if (!body) return link;
  link = await fresh(cfg, link);
  await call(cfg, link.access, '/sync/history', body);
  return link;
}
