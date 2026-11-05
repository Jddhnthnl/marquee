// node playback.test.mjs
import assert from 'node:assert/strict';
import { PLAYBACK_DEFAULTS, subProps, pickSub, pickAudio, videoProps, chooseStream, fromIntroDB, fromAniSkip, fromChapters, segmentAt, nextCardAt, sessionMinutes, deadAt, failedLabel, DEAD_MS } from './playback.js';

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

// dead links: skipped for 7 days, then eligible again
const now = Date.now(), dead = { u1080: now - 1000, uOld: now - 1000, u2160: now - DEAD_MS - 1 };
assert.equal(chooseStream({ mode: 'auto', quality: '1080p', groups, dead }).url, 'u720', 'a dead link is never auto-picked');
assert.equal(chooseStream({ mode: 'auto', quality: '720p', groups, bingeGroup: 'grp', dead }).url, 'u720', 'a dead same-group link is skipped too');
assert.equal(chooseStream({ mode: 'reuse', quality: '2160p', last, groups, dead }).url, 'u2160', 'a dead saved link is not reused; expired entries count as alive');
assert.equal(chooseStream({ mode: 'auto', quality: '1080p', groups, dead: { u720: now, u1080: now, u2160: now } }), null, 'all dead: nothing to pick');
assert.equal(deadAt(dead, { url: 'u2160' }, now), 0, 'expired after 7 days');
assert.equal(failedLabel(now - 30e3, now), 'Failed 1 min ago');
assert.equal(failedLabel(now - 2 * 36e5, now), 'Failed 2 h ago');
assert.equal(failedLabel(now - 3 * 864e5, now), 'Failed 3 d ago');

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
assert.equal(nextCardAt([], 20), 10, 'short clip without credits data: still not before halfway');

// subtitle style -> mpv properties; every edge choice sets the same keys so switching never leaves a leftover outline or box
const props = (set) => Object.fromEntries(subProps({ ...PLAYBACK_DEFAULTS, ...set }));
assert.deepEqual(props({}), { 'sub-scale': 1, 'sub-color': '#FFFFFF', 'sub-pos': 100, 'sub-border-style': 'outline-and-shadow', 'sub-outline-size': 2, 'sub-shadow-offset': 0, 'sub-back-color': '#00000000',
  'sub-font': 'sans-serif', 'sub-bold': false, 'sub-filter-sdh': false }, 'defaults: white, outlined, at the bottom');
assert.equal(props({ subSize: 150 })['sub-scale'], 1.5);
assert.equal(props({ subLift: 20 })['sub-pos'], 80, 'lift moves them up the screen');
assert.equal(props({ subEdge: 'box' })['sub-border-style'], 'background-box');
assert.equal(props({ subEdge: 'shadow' })['sub-shadow-offset'] > 0 && props({ subEdge: 'shadow' })['sub-outline-size'], 0);
assert.equal(props({ subEdge: 'none' })['sub-outline-size'] + props({ subEdge: 'none' })['sub-shadow-offset'], 0);
for (const e of ['none', 'shadow', 'outline', 'box']) assert.equal(Object.keys(props({ subEdge: e })).length, 10);

// preferred languages: first language wins, mpv's 3-letter and regional codes match, forced (signs-only) tracks lose
const tracks = [{ id: 1, type: 'sub', lang: 'spa' }, { id: 2, type: 'sub', lang: 'eng', forced: true }, { id: 3, type: 'sub', lang: 'en-US' }, { id: 4, type: 'audio', lang: 'jpn' }, { id: 5, type: 'sub', lang: 'ger' }];
assert.equal(pickSub(tracks, ['en', 'es']), 3);
assert.equal(pickSub(tracks, ['', 'es']), 1, 'empty first choice is skipped');
assert.equal(pickSub(tracks, ['de']), 5, 'bibliographic code ger');
assert.equal(pickSub(tracks, ['ja']), null, 'audio tracks are not subtitles');
assert.equal(pickSub(tracks, ['', '']), null, 'no preference: leave mpv alone');
assert.equal(pickSub([{ id: 7, type: 'sub', lang: 'eng', forced: true }], ['en']), 7, 'a forced track beats nothing');

// ---- v0.7.0: stream rules (all ticked presets must match), custom regex, fallback to quality
const pool = [{ addonName: 'A', streams: [s('1080p WEB-DL x264', 'a'), s('2160p BluRay REMUX HDR HEVC', 'b', 'g2'), s('720p HDTS', 'c'), s('1080p BluRay x265 HDR', 'd')] }];
const pickWith = (o) => chooseStream({ mode: 'auto', quality: '1080p', groups: pool, ...o })?.url;
assert.equal(pickWith({ rules: ['hevc'] }), 'd', 'rule narrows, quality decides inside the matches');
assert.equal(pickWith({ rules: ['hevc'], quality: '2160p' }), 'b');
assert.equal(pickWith({ rules: ['hevc', 'noremux'] }), 'a', 'nothing passes every rule: back to the quality pick');
assert.equal(pickWith({ rules: ['nocam'], quality: '720p' }), 'a', 'excluded CAM/TS is never the fallback-in-pool');
assert.equal(pickWith({ rules: ['web'] }), 'a');
assert.equal(pickWith({ custom: 'remux', quality: '720p' }), 'b', 'custom rule');
assert.equal(pickWith({ custom: '(' }), 'a', 'a broken custom rule is ignored');
assert.equal(pickWith({ rules: ['unknown-preset'] }), 'a', 'unknown preset ignored');
assert.equal(pickWith({ bingeGroup: 'g2' }), 'b', 'same release group wins by default');
assert.equal(pickWith({ bingeGroup: 'g2', sameGroup: false }), 'a', 'unless turned off');

// next-episode card: % watched or minutes before the end, instead of the credits
assert.equal(nextCardAt(segs, 1400, 'credits'), 1300);
assert.equal(nextCardAt(segs, 1000, 'p90'), 900);
assert.equal(nextCardAt(segs, 1400, 'm2'), 1280);
assert.equal(nextCardAt([], 60, 'm5'), 30, 'never earlier than halfway');

// new subtitle options: font, bold, hearing-impaired text removed
assert.equal(props({})['sub-font'], 'sans-serif');
assert.equal(props({ subFont: 'Georgia' })['sub-font'], 'Georgia');
assert.equal(props({ subBold: true })['sub-bold'], true);
assert.equal(props({ subSdh: true })['sub-filter-sdh'], true);
assert.equal(props({})['sub-filter-sdh'], false);

// only my languages / forced subtitles when the audio is already in your language
const t2 = [{ id: 1, type: 'sub', lang: 'eng', forced: true }, { id: 2, type: 'sub', lang: 'spa' }, { id: 9, type: 'audio', lang: 'eng' }];
assert.equal(pickSub(t2, ['fr']), null);
assert.equal(pickSub(t2, ['fr'], { onlyMine: true }), 'no', 'no match and only-mine: subtitles off');
assert.equal(pickSub(t2, ['fr'], { forced: true, audio: 'eng' }), 1, 'forced track in the audio language');
assert.equal(pickSub(t2, ['es'], { forced: true, audio: 'eng' }), 2, 'a wanted language still wins');
assert.equal(pickAudio(t2, 'en'), 9);
assert.equal(pickAudio(t2, 'ja'), null);
assert.equal(pickAudio(t2, ''), null);

// picture tuning -> mpv properties
assert.deepEqual(videoProps({ ...PLAYBACK_DEFAULTS, brightness: 10, saturation: -5, deband: true }),
  [['brightness', 10], ['contrast', 0], ['saturation', -5], ['gamma', 0], ['deband', true]]);

console.log('playback tests pass');

// history: minutes watched per session
assert.equal(sessionMinutes(0, 1500, 1500), 25, 'played straight through');
assert.equal(sessionMinutes(600, 900, 3600), 5, 'paused for most of an hour: only playback counts');
assert.equal(sessionMinutes(0, 3000, 300), 5, 'skipped ahead: capped by time open');
assert.equal(sessionMinutes(0, 100, 100), 0, 'under 2 minutes is not logged');
assert.equal(sessionMinutes(900, 300, 600), 0, 'seeked backwards');
