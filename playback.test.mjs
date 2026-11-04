// node playback.test.mjs
import assert from 'node:assert/strict';
import { PLAYBACK_DEFAULTS, subProps, pickSub, chooseStream,fromIntroDB, fromAniSkip, fromChapters, segmentAt, nextCardAt } from './playback.js';

const s = (name, url, bingeGroup) => ({ name, url, behaviorHints: bingeGroup ? { bingeGroup } : {} });
const groups = [{ addonName: 'A', streams: [s('720p WEB', 'u720'), s('1080p WEB', 'u1080', 'grp'), s('2160p 4K', 'u2160')] }];
const last = { stream: s('old', 'uOld') };

// stream selection
assert.equal(chooseStream({ mode: 'reuse', quality: '1080p', last, groups }).url, 'uOld', 'reuse replays the saved link');
assert.equal(chooseStream({ mode: 'reuse', quality: '1080p', last: null, groups }).url, 'u1080', 'reuse without history falls back to auto');
assert.equal(chooseStream({ mode: 'auto', quality: '2160p', last, groups }).url, 'u2160', 'auto ignores history, picks quality');
assert.equal(chooseStream({ mode: 'auto', quality: '720p', groups, bingeGroup: 'grp' }).url, 'u1080', 'same source as last episode beats quality');
assert.equal(chooseStream({ mode: 'auto', quality: '480p', groups }).url, 'u720', 'unknown quality: first playable');
assert.equal(chooseStream({ mode: 'ask', quality: '1080p', last, groups }), null, 'ask never picks');
assert.equal(chooseStream({ mode: 'auto', quality: '1080p', groups: [{ streams: [{ infoHash: 'x' }] }] }), null, 'torrents are never picked');

// skip segments: real response shapes captured 2026-11-04
const introdb = { intro: { start_sec: 314.5, end_sec: 331 }, recap: null, outro: { start_sec: 2843, end_sec: 2901 } };
assert.deepEqual(fromIntroDB(introdb), [{ kind: 'intro', start: 314.5, end: 331 }, { kind: 'outro', start: 2843, end: 2901 }]);
assert.deepEqual(fromIntroDB({ error: 'x' }), []);
const aniskip = { found: true, results: [{ interval: { startTime: 57.4, endTime: 145.7 }, skipType: 'op' }, { interval: { startTime: 1357.9, endTime: 1447.9 }, skipType: 'ed' }, { interval: { startTime: 0, endTime: 30 }, skipType: 'recap' }] };
assert.deepEqual(fromAniSkip(aniskip).map((x) => x.kind), ['intro', 'outro', 'recap']);
assert.deepEqual(fromAniSkip({ found: false, results: [] }), []);
const chapters = [{ title: 'Recap', time: 0 }, { title: 'Opening', time: 40 }, { title: 'Part A', time: 130 }, { title: 'End Credits', time: 1300 }];
assert.deepEqual(fromChapters(chapters, 1400), [{ kind: 'recap', start: 0, end: 40 }, { kind: 'intro', start: 40, end: 130 }, { kind: 'outro', start: 1300, end: 1400 }]);
assert.deepEqual(fromChapters(undefined, 100), []);

// when the Skip button shows: inside an intro/recap, but not in its last second (the skip would land on nothing)
const segs = [{ kind: 'recap', start: 0, end: 40 }, { kind: 'intro', start: 40, end: 130 }, { kind: 'outro', start: 1300, end: 1400 }];
assert.equal(segmentAt(segs, 10).kind, 'recap');
assert.equal(segmentAt(segs, 40).kind, 'intro', 'boundary belongs to the next segment');
assert.equal(segmentAt(segs, 129.5), null, 'last second: no button');
assert.equal(segmentAt(segs, 1350), null, 'credits use the next-episode card, not a skip button');

// when the next-episode card shows
assert.equal(nextCardAt(segs, 1400), 1300, 'end credits start');
assert.equal(nextCardAt([], 1400), 1370, 'no data: last 30 s');
assert.equal(nextCardAt([{ kind: 'outro', start: 200, end: 260 }], 1400), 1370, 'an "outro" in the first half is bad data');
assert.equal(nextCardAt([], 0), null, 'unknown length: never');

// subtitle style -> mpv properties; every edge choice sets the same keys so switching never leaves a leftover outline or box
const props = (set) => Object.fromEntries(subProps({ ...PLAYBACK_DEFAULTS, ...set }));
assert.deepEqual(props({}), { 'sub-scale': 1, 'sub-color': '#FFFFFF', 'sub-pos': 100, 'sub-border-style': 'outline-and-shadow', 'sub-outline-size': 2, 'sub-shadow-offset': 0, 'sub-back-color': '#00000000' }, 'defaults: white, outlined, at the bottom');
assert.equal(props({ subSize: 150 })['sub-scale'], 1.5);
assert.equal(props({ subLift: 20 })['sub-pos'], 80, 'lift moves them up the screen');
assert.equal(props({ subEdge: 'box' })['sub-border-style'], 'background-box');
assert.equal(props({ subEdge: 'shadow' })['sub-shadow-offset'] > 0 && props({ subEdge: 'shadow' })['sub-outline-size'], 0);
assert.equal(props({ subEdge: 'none' })['sub-outline-size'] + props({ subEdge: 'none' })['sub-shadow-offset'], 0);
for (const e of ['none', 'shadow', 'outline', 'box']) assert.equal(Object.keys(props({ subEdge: e })).length, 7);

// preferred languages: first language wins, mpv's 3-letter and regional codes match, forced (signs-only) tracks lose
const tracks = [{ id: 1, type: 'sub', lang: 'spa' }, { id: 2, type: 'sub', lang: 'eng', forced: true }, { id: 3, type: 'sub', lang: 'en-US' }, { id: 4, type: 'audio', lang: 'jpn' }, { id: 5, type: 'sub', lang: 'ger' }];
assert.equal(pickSub(tracks, ['en', 'es']), 3);
assert.equal(pickSub(tracks, ['', 'es']), 1, 'empty first choice is skipped');
assert.equal(pickSub(tracks, ['de']), 5, 'bibliographic code ger');
assert.equal(pickSub(tracks, ['ja']), null, 'audio tracks are not subtitles');
assert.equal(pickSub(tracks, ['', '']), null, 'no preference: leave mpv alone');
assert.equal(pickSub([{ id: 7, type: 'sub', lang: 'eng', forced: true }], ['en']), 7, 'a forced track beats nothing');

console.log('playback tests pass');
