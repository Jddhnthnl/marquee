// node look.test.mjs
import assert from 'node:assert/strict';
import { LOOK_DEFAULTS, ACCENTS, AVATARS, PROFILE_COLORS, orderRows, removeProfile, resetSection, newProfileId, accentFromHex, isUnreleased, needsMeta, continueRows } from './look.js';

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

console.log('look tests pass');
