// Stremio addon protocol, mirroring Nuvio's AddonTransportUrlsKt / AddonManifestParser / StreamsRepository.
// Pure functions only (no DOM, no storage) so protocol.test.mjs can run them under Node.

/** Nuvio: manifestUrl.substringBefore("?").removeSuffix("/manifest.json") */
export function transportBase(manifestUrl) {
  return manifestUrl.trim().split('?')[0].replace(/\/manifest\.json$/, '').replace(/\/+$/, '');
}

/** {base}/{resource}/{type}/{id}.json or {base}/{resource}/{type}/{id}/{extra}.json */
export function resourceUrl(manifestUrl, resource, type, id, extra = {}) {
  const enc = encodeURIComponent;
  const extraSeg = Object.entries(extra)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join('&');
  return `${transportBase(manifestUrl)}/${resource}/${enc(type)}/${enc(id)}${extraSeg ? '/' + extraSeg : ''}.json`;
}

/** resources may be "stream" or {name, types, idPrefixes}; missing fields fall back to manifest-level ones. */
export function supports(manifest, resource, type, id) {
  for (const r of manifest.resources || []) {
    const name = typeof r === 'string' ? r : r.name;
    if (name !== resource) continue;
    const types = (typeof r === 'object' && r.types) || manifest.types || [];
    const prefixes = (typeof r === 'object' && r.idPrefixes) || manifest.idPrefixes;
    if (!types.includes(type)) continue;
    if (id && prefixes?.length && !prefixes.some((p) => id.startsWith(p))) continue;
    return true;
  }
  return false;
}

const extras = (c) => c.extra || (c.extraSupported || []).map((name) => ({ name, isRequired: (c.extraRequired || []).includes(name) }));

/** Home rows: catalogs that need no required extra (Nuvio's HomeCatalogDefinition). */
export function homeCatalogs(addons) {
  return addons.flatMap(({ url, manifest }) =>
    (manifest.catalogs || []).filter((c) => !extras(c).some((e) => e.isRequired)).map((c) => ({ url, manifest, catalog: c })));
}

/** Search: catalogs that accept a `search` extra. */
export function searchCatalogs(addons) {
  return addons.flatMap(({ url, manifest }) =>
    (manifest.catalogs || []).filter((c) => extras(c).some((e) => e.name === 'search')).map((c) => ({ url, manifest, catalog: c })));
}

/** How a stream object gets played. Nuvio: url → mpv, infoHash → torrent engine, externalUrl → browser, ytId → YouTube. */
export function streamTarget(s) {
  if (s.url) return { kind: 'url', href: s.url };
  if (s.infoHash) {
    const trackers = (s.sources || []).filter((x) => x.startsWith('tracker:')).map((x) => '&tr=' + encodeURIComponent(x.slice(8)));
    return { kind: 'magnet', href: `magnet:?xt=urn:btih:${s.infoHash}${trackers.join('')}`, fileIdx: s.fileIdx };
  }
  if (s.externalUrl) return { kind: 'external', href: s.externalUrl };
  if (s.ytId) return { kind: 'external', href: `https://www.youtube.com/watch?v=${s.ytId}` };
  return null;
}

/**
 * Pick the stream the "Play best" button uses (Nuvio: StreamAutoPlaySelector, modes MANUAL / FIRST_STREAM / REGEX_MATCH).
 * groups: [{ addonName, streams: [{ name, title, description, url, infoHash, behaviorHints: { bingeGroup } }] }] in install order.
 * prefs: { mode: 'manual' | 'first' | 'regex', regex: string, bingeGroup: string|null } — bingeGroup is the group of the last stream played for this show.
 * Return a stream object, or null for no auto-pick (the button is hidden).
 */
export function pickAutoPlay(groups, prefs = {}) {
  if (prefs.mode === 'manual') return null;
  const all = groups.flatMap((g) => g.streams).filter((s) => s.url); // skip torrents: the browser can't play magnets
  const same = prefs.bingeGroup && all.find((s) => s.behaviorHints?.bingeGroup === prefs.bingeGroup);
  if (same) return same; // keep the last episode's source/release group
  let re = null;
  try { if (prefs.mode === 'regex' && prefs.regex) re = new RegExp(prefs.regex, 'i'); } catch { /* bad pattern: fall back to first */ }
  return (re && all.find((s) => re.test(`${s.name ?? ''} ${s.title ?? ''} ${s.description ?? ''}`))) || all[0] || null;
}

/** Strip query strings and long path segments so configured addon URLs (which embed API keys) are safe to display. */
export function redactUrl(u) {
  try {
    const { host } = new URL(u);
    return host;
  } catch {
    return '(invalid url)';
  }
}
