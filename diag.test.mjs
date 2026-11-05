// node diag.test.mjs
import assert from 'node:assert/strict';
import { redact, buildReport, logLine, appLines, MAX_LINES } from './diag.js';

const KEY = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const HASH = '0123456789abcdef0123456789abcdef01234567';
const leaks = (s) => s.includes(KEY) || s.includes('SECRETTOKEN') || s.includes('Bearer abc');

// must never leak a key
assert.ok(!leaks(redact(`https://torrentio.strem.fun/resolve/torbox/${KEY}/${HASH}/null/0/Show.S01E01.mkv`)), 'resolve URL key');
assert.ok(!leaks(redact(`https://torrentio.strem.fun/torbox=${KEY}|qualityfilter=480p/manifest.json`)), 'addon config key');
assert.ok(!leaks(redact(`https://store-031.weur.tb-cdn.st/dld/x?token=SECRETTOKEN&a=1`)), 'query token');
assert.ok(!leaks(redact('[ffmpeg] http: Authorization: Bearer abc123def')), 'auth header in the mpv log');
assert.equal(redact(`https://x/realdebrid=${KEY}|debridoptions=nodownloadlinks/manifest.json?apikey=${KEY}`),
  'https://x/realdebrid=<key>|debridoptions=nodownloadlinks/manifest.json?apikey=<key>', 'other services and apikey');
// ...and keep what makes the report useful
assert.ok(redact(`https://torrentio.strem.fun/resolve/torbox/${KEY}/${HASH}/null/0/x.mkv`).includes(HASH), 'info-hash kept');
assert.match(redact(`https://torrentio.strem.fun/resolve/torbox/${KEY}/${HASH}/null/0/Show.S01E01.mkv`), /torrentio\.strem\.fun.*Show\.S01E01\.mkv/, 'host and file name survive');
assert.equal(redact('[cplayer] Exiting... (Errors when loading file)'), '[cplayer] Exiting... (Errors when loading file)', 'plain lines untouched');

// report shape
const r = buildReport({ version: '0.8.0', note: '  froze  ', url: `https://torrentio.strem.fun/resolve/torbox/${KEY}/x`, app: ['a1', 'a2'], mpv: 'm1\nm2' }, 5);
assert.deepEqual(Object.keys(r).sort(), ['at', 'log', 'note', 'url', 'v']);
assert.equal(r.note, 'froze');
assert.equal(r.log, 'a1\na2\n--- mpv ---\nm1\nm2');
assert.ok(!leaks(r.url));
assert.equal(buildReport({ mpv: Array.from({ length: 500 }, (_, i) => i).join('\n') }).log.split('\n').length, MAX_LINES, 'last 200 lines only');
assert.equal(buildReport({ note: 'x'.repeat(900) }).note.length, 500);

// app buffer
for (let i = 0; i < 120; i++) logLine('error', [new Error(`e${i}`)], new Date(0));
assert.equal(appLines().length, 100);
assert.equal(appLines().at(-1), '00:00:00 error Error: e119');

console.log('diag tests passed');
