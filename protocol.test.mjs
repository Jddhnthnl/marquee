// Run: node protocol.test.mjs
import assert from 'node:assert/strict';
import { transportBase, resourceUrl, supports, homeCatalogs, searchCatalogs, streamTarget, redactUrl, pickAutoPlay } from './protocol.js';

const M = 'https://addon.example/cfg=a|b/manifest.json?x=1';
assert.equal(transportBase(M), 'https://addon.example/cfg=a|b');
assert.equal(resourceUrl(M, 'stream', 'series', 'tt1:2:3'), 'https://addon.example/cfg=a|b/stream/series/tt1%3A2%3A3.json');
assert.equal(resourceUrl(M, 'catalog', 'movie', 'top', { search: 'a b', skip: 0, genre: '' }),
  'https://addon.example/cfg=a|b/catalog/movie/top/search=a%20b&skip=0.json');

const manifest = { types: ['movie', 'series'], idPrefixes: ['tt'], resources: ['catalog', { name: 'stream', types: ['movie'] }],
  catalogs: [{ type: 'movie', id: 'top' }, { type: 'movie', id: 's', extra: [{ name: 'search', isRequired: true }] }, { type: 'series', id: 'old', extraSupported: ['search'], extraRequired: ['search'] }] };
assert.equal(supports(manifest, 'stream', 'movie', 'tt1'), true);
assert.equal(supports(manifest, 'stream', 'series', 'tt1'), false); // object resource narrows types
assert.equal(supports(manifest, 'stream', 'movie', 'kitsu:1'), false); // falls back to manifest idPrefixes
assert.equal(supports(manifest, 'meta', 'movie', 'tt1'), false);
const addons = [{ url: M, manifest }];
assert.deepEqual(homeCatalogs(addons).map((x) => x.catalog.id), ['top']);
assert.deepEqual(searchCatalogs(addons).map((x) => x.catalog.id), ['s', 'old']);

assert.deepEqual(streamTarget({ url: 'http://v' }), { kind: 'url', href: 'http://v' });
assert.equal(streamTarget({ infoHash: 'ab', sources: ['tracker:udp://t:1', 'dht:ab'] }).href, 'magnet:?xt=urn:btih:ab&tr=udp%3A%2F%2Ft%3A1');
assert.equal(streamTarget({ ytId: 'q' }).href, 'https://www.youtube.com/watch?v=q');
assert.equal(streamTarget({}), null);
assert.equal(redactUrl('https://torrentio.strem.fun/torbox=SECRET/manifest.json'), 'torrentio.strem.fun');
const g = [{ addonName: 'A', streams: [{ infoHash: 'x', name: '1080p' }, { url: 'u1', name: '4K' }] },
  { addonName: 'B', streams: [{ url: 'u2', title: 'Show 1080p WEB-DL' }, { url: 'u3', name: '720p', behaviorHints: { bingeGroup: 'grp' } }] }];
const re = { mode: 'regex', regex: '1080p|WEB-?DL' };
assert.equal(pickAutoPlay(g, re).url, 'u2'); // regex hit, torrent with "1080p" skipped
assert.equal(pickAutoPlay(g, { ...re, bingeGroup: 'grp' }).url, 'u3'); // same source beats regex
assert.equal(pickAutoPlay(g, { mode: 'regex', regex: 'nomatch' }).url, 'u1'); // fallback: first direct url
assert.equal(pickAutoPlay(g, { mode: 'regex', regex: '(' }).url, 'u1'); // bad pattern doesn't throw
assert.equal(pickAutoPlay(g, { mode: 'manual' }), null);
assert.equal(pickAutoPlay([{ streams: [{ infoHash: 'x' }] }], re), null); // torrents only → no button
console.log('protocol ok');
