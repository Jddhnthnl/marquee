// node trakt.test.mjs
import assert from 'node:assert/strict';
import { mirror, marks, historyBody, listBody } from './trakt.js';

// first sync: union, nothing removed
let d = mirror(['a', 'b'], ['b', 'c'], []);
assert.deepEqual([d.addRemote, d.addLocal, d.removeRemote, d.removeLocal, d.base], [['a'], ['c'], [], [], ['a', 'b', 'c']]);
// removed in Marquee since the last sync -> removed on Trakt; removed on Trakt -> removed in Marquee
d = mirror(['a', 'c'], ['a', 'b'], ['a', 'b', 'c']);
assert.deepEqual([d.removeRemote, d.removeLocal, d.addRemote, d.addLocal, d.base], [['b'], ['c'], [], [], ['a']]);
// removed on both sides: gone, no calls
d = mirror(['a'], ['a'], ['a', 'x']);
assert.deepEqual([d.removeRemote, d.removeLocal, d.base], [[], [], ['a']]);
// re-added on one side after a sync: a fresh add again
d = mirror(['a', 'n'], ['a', 'm'], ['a']);
assert.deepEqual([d.addRemote, d.addLocal, d.base], [['n'], ['m'], ['a', 'n', 'm']]);

// watched marks: only what Marquee lacks, finished shape, Trakt's watched time
const m = marks(
  [{ last_watched_at: '2026-01-02T00:00:00.000Z', movie: { title: 'The Matrix', ids: { imdb: 'tt0133093' } } }, { movie: { title: 'No IMDb', ids: { tmdb: 1 } } }],
  [{ show: { title: 'Breaking Bad', ids: { imdb: 'tt0903747' } }, seasons: [{ number: 1, episodes: [{ number: 1, last_watched_at: '2026-01-03T00:00:00.000Z' }, { number: 2 }] }] }],
  { 'tt0903747:1:2': { positionMs: 500, durationMs: 3000 } });
assert.deepEqual(Object.keys(m), ['tt0133093', 'tt0903747:1:1'], 'skips non-IMDb and keeps a rewatch in progress');
assert.equal(m.tt0133093.updatedAt, Date.parse('2026-01-02T00:00:00.000Z'));
assert.deepEqual([m['tt0903747:1:1'].season, m['tt0903747:1:1'].episode, m['tt0903747:1:1'].positionMs, m['tt0903747:1:1'].durationMs, m['tt0903747:1:1'].metaId], [1, 1, 1, 1, 'tt0903747']);

// history out
const when = new Date('2026-11-05T12:00:00.000Z');
assert.deepEqual(historyBody({ metaId: 'tt0133093' }, when), { movies: [{ ids: { imdb: 'tt0133093' }, watched_at: '2026-11-05T12:00:00.000Z' }] });
assert.deepEqual(historyBody({ metaId: 'tt0903747', season: '2', episode: 3 }, when).shows[0].seasons, [{ number: 2, episodes: [{ number: 3, watched_at: '2026-11-05T12:00:00.000Z' }] }]);
assert.equal(historyBody({ metaId: 'kitsu:1', season: 1, episode: 1 }), null, 'non-IMDb ids stay off Trakt');
assert.deepEqual(listBody([{ id: 'tt1', type: 'movie' }, { id: 'tt2', type: 'series' }]), { movies: [{ ids: { imdb: 'tt1' } }], shows: [{ ids: { imdb: 'tt2' } }] });
console.log('trakt tests pass');
