// node look.test.mjs
import assert from 'node:assert/strict';
import { LOOK_DEFAULTS, ACCENTS, AVATARS, PROFILE_COLORS, orderRows, removeProfile, resetSection, newProfileId, accentFromHex, isUnreleased, needsMeta, continueRows, runtimeMin, fitList, monthDays, airDays, recap, hoursMin, nearest, PIN, pinHash, pinWait } from './look.js';

// defaults the spec settled on
assert.equal(LOOK_DEFAULTS.accent, 'tungsten');
assert.equal(LOOK_DEFAULTS.posterSize, 'M');
assert.equal(LOOK_DEFAULTS.intro, true);
assert.deepEqual(Object.keys(ACCENTS), ['tungsten', 'red', 'plum', 'green']);
assert.equal(Object.keys(AVATARS).length, 16);
assert.equal(PROFILE_COLORS.length, 8);

// home rows: saved order first, rows the user never arranged keep their place at the end, gone rows drop out
assert.deepEqual(orderRows(['cw', 'a', 'b', 'c'], { order: [], hidden: [] }),
  [{ key: 'cw', shown: true }, { key: 'a', shown: true }, { key: 'b', shown: true }, { key: 'c', shown: true }]);
assert.deepEqual(orderRows(['cw', 'a', 'b', 'c'], { order: ['b', 'gone', 'cw'], hidden: ['a'] }),
  [{ key: 'b', shown: true }, { key: 'cw', shown: true }, { key: 'a', shown: false }, { key: 'c', shown: true }]);

// profiles: never delete the last one; deleting the active one hands over to the first left
const two = { active: '1', list: [{ id: '1', name: 'Main' }, { id: 'k2', name: 'Kid' }] };
assert.deepEqual(removeProfile(two, '1'), { active: 'k2', list: [{ id: 'k2', name: 'Kid' }] });
assert.deepEqual(removeProfile(two, 'k2'), { active: '1', list: [{ id: '1', name: 'Main' }] });
const one = { active: '1', list: [{ id: '1', name: 'Main' }] };
assert.equal(removeProfile(one, '1'), one);
// new ids never repeat a deleted one (its synced data would come back)
assert.match(newProfileId(), /^\w+$/);
assert.notEqual(newProfileId(), newProfileId());

// each section's reset only clears its own keys
const saved = { player: 'mpv', subSize: 150, subLang1: 'es', accent: 'red', homeRows: { order: ['a'], hidden: [] }, intro: false };
assert.deepEqual(resetSection(saved, 'look'), { player: 'mpv', subSize: 150, subLang1: 'es', homeRows: { order: ['a'], hidden: [] } }, 'home rows live in Home since v0.7');
assert.deepEqual(resetSection(saved, 'subtitles'), { player: 'mpv', accent: 'red', homeRows: { order: ['a'], hidden: [] }, intro: false });
assert.deepEqual(resetSection(saved, 'player'), { subSize: 150, subLang1: 'es', accent: 'red', homeRows: { order: ['a'], hidden: [] }, intro: false });

// ---- v0.7.0
// custom accent: any #rrggbb, glow worked out from it; anything else is refused
assert.equal(accentFromHex('#3366FF'), '51 102 255');
assert.equal(accentFromHex('#3366ff'), '51 102 255');
assert.equal(accentFromHex('red'), null);
assert.equal(accentFromHex('#36f'), null);

// pinned rows sit on top whatever the saved order says
assert.deepEqual(orderRows(['cw', 'a', 'b'], { order: ['cw', 'a', 'b'], hidden: ['b'], pinned: ['b'] }).map((r) => r.key), ['b', 'cw', 'a']);

// new sections reset only their keys
const all = { accent: 'red', posterRadius: 'pill', rules: ['hevc'], quality: '720p', holdSpeed: 3, subBold: true, nextDelay: 5,
  cwStyle: 'wide', librarySort: 'title', hoverSound: true, detailBg: 'color', homeRows: { order: [] } };
assert.deepEqual(Object.keys(resetSection(all, 'streams')), ['accent', 'posterRadius', 'holdSpeed', 'subBold', 'nextDelay', 'cwStyle', 'librarySort', 'hoverSound', 'detailBg', 'homeRows']);
assert.ok(!('holdSpeed' in resetSection(all, 'player')));
assert.ok(!('hoverSound' in resetSection(all, 'home')) && !('homeRows' in resetSection(all, 'home')));
assert.ok(!('detailBg' in resetSection(all, 'detail')));
assert.ok(!('cwStyle' in resetSection(all, 'cw')));
assert.ok(!('librarySort' in resetSection(all, 'system')));
assert.deepEqual(Object.keys(resetSection(all, 'playback')).length, Object.keys(all).length - 1, 'playback only drops nextDelay');
assert.deepEqual(Object.keys(resetSection(all, 'look')), ['rules', 'quality', 'holdSpeed', 'subBold', 'nextDelay', 'cwStyle', 'librarySort', 'hoverSound', 'detailBg', 'homeRows']);

// unreleased titles
const now = Date.parse('2026-11-05');
assert.equal(isUnreleased({ released: '2027-01-01T00:00:00Z' }, now), true);
assert.equal(isUnreleased({ released: '2020-01-01T00:00:00Z' }, now), false);
assert.equal(isUnreleased({ releaseInfo: '2028' }, now), true);
assert.equal(isUnreleased({ releaseInfo: '2019-' }, now), false);
assert.equal(isUnreleased({}, now), false, 'no date: keep it');

// Continue watching: furthest episode of each show, next up after a finished one, unaired ones in their own row
const prog = {
  'tt1:1:1': { metaId: 'tt1', type: 'series', videoId: 'tt1:1:1', season: 1, episode: 1, positionMs: 100, durationMs: 100, updatedAt: 5 },
  'tt1:1:2': { metaId: 'tt1', type: 'series', videoId: 'tt1:1:2', season: 1, episode: 2, positionMs: 50, durationMs: 100, updatedAt: 3 },
  'tt2:1:3': { metaId: 'tt2', type: 'series', videoId: 'tt2:1:3', season: 1, episode: 3, positionMs: 99, durationMs: 100, updatedAt: 4 },
  m1: { metaId: 'm1', type: 'movie', videoId: 'm1', positionMs: 10, durationMs: 100, updatedAt: 2 },
  m2: { metaId: 'm2', type: 'movie', videoId: 'm2', positionMs: 100, durationMs: 100, updatedAt: 6 },
  'tt3:2:1': { metaId: 'tt3', type: 'series', videoId: 'tt3:2:1', season: 2, episode: 1, positionMs: 100, durationMs: 100, updatedAt: 1 },
};
const metas = {
  tt2: { videos: [{ id: 'tt2:1:3', season: 1, episode: 3 }, { id: 'tt2:1:4', season: 1, episode: 4, released: '2020-01-01', thumbnail: 'th4' }] },
  tt3: { videos: [{ id: 'tt3:2:1', season: 2, episode: 1 }, { id: 'tt3:2:2', season: 2, episode: 2, released: '2099-01-01' }] },
};
const cwSet = { cwNextUp: true, cwUpcoming: true };
assert.deepEqual(needsMeta(prog, cwSet), ['tt2', 'tt3'], 'only shows whose last episode is finished');
const cwr = continueRows(prog, metas, cwSet, now);
assert.deepEqual(cwr.resume.map((x) => x.videoId), ['tt1:1:2', 'tt2:1:4', 'm1'], 'furthest episode, next up, newest show first');
assert.equal(cwr.resume[1].next, true);
assert.equal(cwr.resume[1].positionMs, 0);
assert.equal(cwr.resume[1].thumbnail, 'th4');
assert.deepEqual(cwr.upcoming.map((x) => x.videoId), ['tt3:2:2']);
assert.deepEqual(continueRows(prog, metas, { ...cwSet, cwUpcoming: false }, now).upcoming, []);
// next up off: the most recently watched episode, finished ones drop out
assert.deepEqual(continueRows(prog, metas, { cwNextUp: false, cwUpcoming: true }, now).resume.map((x) => x.videoId), ['m1']);


// What can I watch in…
assert.equal(runtimeMin('142 min'), 142);
assert.equal(runtimeMin('2h 22min'), 142);
assert.equal(runtimeMin('1h'), 60);
assert.equal(runtimeMin('50'), 50);
assert.equal(runtimeMin(45), 45);
for (const bad of [null, undefined, '', 'N/A', '0 min', 0]) assert.equal(runtimeMin(bad), null, `unknown: ${bad}`);
const fc = [{ id: 'a', left: 40, genres: ['Drama'] }, { id: 'b', left: 44.5, genres: ['Comedy'] }, { id: 'c', left: 130, genres: ['Drama'] }, { id: 'd', left: null, genres: ['Drama'] }];
assert.deepEqual(fitList(fc, { max: 45 }).map((c) => c.id), ['b', 'a'], 'fits, longest first, unknown left out');
assert.deepEqual(fitList(fc, { max: 45, genre: 'Drama' }).map((c) => c.id), ['a'], 'genre filter');
assert.deepEqual(fitList(fc, { max: 0 }).map((c) => c.id), ['c', 'b', 'a'], 'any length');
assert.deepEqual(fitList(fc, { max: 30 }), [], 'nothing fits');

const nov = monthDays(2026, 10);
assert.equal(nov.length, 30, 'Nov 2026 starts on a Sunday: no blanks');
assert.deepEqual([nov[0], nov.at(-1)], ['2026-11-01', '2026-11-30']);
const feb = monthDays(2028, 1);
assert.deepEqual([feb.indexOf('2028-02-01'), feb.at(-1)], [2, '2028-02-29'], 'Feb 2028 starts Tuesday, leap day');
const sa = { name: 'B show', videos: [{ season: 1, episode: 2, released: '2026-11-03T00:00:00.000Z' }, { season: 1, episode: 1, released: '2026-11-03T00:00:00.000Z' },
  { season: 0, episode: 1, released: '2026-11-04T00:00:00.000Z' }, { season: 1, episode: 3, released: '2026-12-01T00:00:00.000Z' }, { season: 1, episode: 4 }] };
const sb = { name: 'A show', videos: [{ season: 2, episode: 5, released: '2026-11-03T00:00:00.000Z' }] };
const days = airDays([sa, sb], '2026-11');
assert.deepEqual(Object.keys(days), ['2026-11-03'], 'specials, other months and undated left out');
assert.deepEqual(days['2026-11-03'].map((x) => x.meta.name + x.v.episode), ['A show5', 'B show1', 'B show2'], 'by show, then episode');

const hist = [{ day: '2026-03-02', id: 's', videoId: 's:1:1', minutes: 50 }, { day: '2026-03-01', id: 's', videoId: 's:1:2', minutes: 45 },
  { day: '2026-03-05', id: 's', videoId: 's:1:2', minutes: 10 }, { day: '2026-07-04', id: 'm', videoId: 'm', minutes: 130 }];
const rc = recap(hist, (id) => ({ s: ['Crime', 'Drama'], m: ['Drama', 'Action'] })[id]);
assert.deepEqual(rc.titles.map((t) => [t.id, t.type, t.minutes, t.episodes, t.first]), [['m', 'movie', 130, 0, '2026-07-04'], ['s', 'series', 105, 2, '2026-03-01']], 'stubs: most-watched first, rewatched episode counted once');
assert.deepEqual([rc.minutes, rc.episodes, rc.movies, rc.busiest, rc.genre], [235, 2, 1, 6, 'Drama'], 'totals; busiest is July (130) over March (105); Drama on both');
assert.deepEqual(recap([]), { minutes: 0, titles: [], episodes: 0, movies: 0, busiest: null, genre: null }, 'empty year');
assert.deepEqual([hoursMin(45), hoursMin(60), hoursMin(135)], ['45 min', '1 h', '2 h 15 min']);
// couch mode focus: rects as {left, top, right, bottom}
const R = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h });
const tile = R(0, 0, 100, 150), shelf = [R(114, 0, 100, 150), R(0, 200, 100, 150), R(228, 0, 100, 150)];
assert.equal(nearest(tile, shelf, 'right'), 0, 'next poster in the row, not the one after');
assert.equal(nearest(tile, shelf, 'down'), 1, 'poster in the next row');
assert.equal(nearest(tile, shelf, 'left'), -1, 'nothing to the left');
assert.equal(nearest(tile, [tile, ...shelf], 'up'), -1, 'never itself');
const link = R(0, 0, 100, 50);
assert.equal(nearest(link, [R(600, 60, 100, 50), R(0, 200, 100, 50)], 'down'), 1, 'straight below beats a nearer item far to the side');
// profile PIN
assert.ok(PIN.test('0420') && !PIN.test('123') && !PIN.test('12a4') && !PIN.test('12345'));
const h = await pinHash('1234', 'salt');
assert.match(h, /^[0-9a-f]{64}$/);
assert.equal(h, await pinHash('1234', 'salt'), 'same pin + salt, same hash');
assert.notEqual(h, await pinHash('1234', 'other'), 'salt matters');
assert.notEqual(h, await pinHash('1235', 'salt'));
assert.deepEqual([0, 1, 4, 5, 6, 10].map(pinWait), [0, 0, 0, 30000, 0, 30000]);
console.log('look tests pass');
