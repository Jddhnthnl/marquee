// Playback rules shared by the main page and the player: settings, which stream to play, skip and next-episode timing.

export const PLAYBACK_DEFAULTS = { player: 'marquee', externalPath: '', streamMode: 'reuse', quality: '1080p', nextDelay: 10, nextWhen: 'credits', stillWatching: 3, skip: 'button',
  // Streams
  rules: [], customRule: '', streamWait: -1, sameGroup: true,
  // Player
  audioLang: '', holdSpeed: 2, showRemaining: true, fit: 'fit', brightness: 0, contrast: 0, saturation: 0, gamma: 0, deband: false,
  // Subtitles
  subSize: 100, subColor: '#FFFFFF', subEdge: 'outline', subLift: 0, subLang1: '', subLang2: '', subOnlyMine: false, subForced: true,
  subSdh: false, subFont: '', subBold: false };

export const SUB_COLORS = [['#FFFFFF', 'White'], ['#F2E6C9', 'Cream'], ['#FFE347', 'Yellow'], ['#8FE3F0', 'Cyan'], ['#A6E88F', 'Green'], ['#F5A8CB', 'Pink']];
// mpv uses system fonts; '' is mpv's own default
export const SUB_FONTS = [['', 'Default'], ['Georgia', 'Serif'], ['Verdana', 'Wide'], ['Consolas', 'Mono']];
// Subtitle look as mpv properties. Text subtitles (SRT) take all of it; styled anime subtitles (ASS) keep their own look and only scale.
const EDGES = {
  none: ['outline-and-shadow', 0, 0, '#00000000'],
  shadow: ['outline-and-shadow', 0, 2.5, '#C0000000'],
  outline: ['outline-and-shadow', 2, 0, '#00000000'],
  box: ['background-box', 2, 0, '#B0000000'], // outline size pads the box
};
export function subProps(set) {
  const [style, outline, shadow, back] = EDGES[set.subEdge] ?? EDGES.outline;
  return [['sub-scale', set.subSize / 100], ['sub-color', set.subColor], ['sub-pos', 100 - set.subLift],
    ['sub-border-style', style], ['sub-outline-size', outline], ['sub-shadow-offset', shadow], ['sub-back-color', back],
    ['sub-font', set.subFont || 'sans-serif'], ['sub-bold', !!set.subBold], ['sub-filter-sdh', !!set.subSdh]];
}
// Picture tuning, -100..100 like mpv's own equalizer
export const videoProps = (set) => [['brightness', set.brightness], ['contrast', set.contrast], ['saturation', set.saturation], ['gamma', set.gamma], ['deband', !!set.deband]];

// Languages offered in Settings (ISO 639-1), with the 3-letter codes files use for them.
export const LANGS = { en: ['eng', 'English'], es: ['spa', 'Spanish'], fr: ['fre', 'fra', 'French'], de: ['ger', 'deu', 'German'], it: ['ita', 'Italian'],
  pt: ['por', 'Portuguese'], nl: ['dut', 'nld', 'Dutch'], pl: ['pol', 'Polish'], ru: ['rus', 'Russian'], tr: ['tur', 'Turkish'], ar: ['ara', 'Arabic'],
  hi: ['hin', 'Hindi'], ja: ['jpn', 'Japanese'], ko: ['kor', 'Korean'], zh: ['chi', 'zho', 'Chinese'], th: ['tha', 'Thai'], vi: ['vie', 'Vietnamese'],
  id: ['ind', 'Indonesian'], tl: ['fil', 'tgl', 'Filipino'] };
const isLang = (code, want) => { const c = (code ?? '').toLowerCase().split(/[-_]/)[0]; return c === want || (LANGS[want] ?? []).includes(c); };
// Track id to show for the preferred languages; 'no' turns subtitles off; null leaves mpv's choice alone.
// forced: when no wanted language is there, show a forced (signs-only) track in the audio's language. onlyMine: otherwise turn them off.
export function pickSub(tracks, langs, { onlyMine = false, forced = false, audio = '' } = {}) {
  const subs = tracks.filter((t) => t.type === 'sub');
  for (const want of langs.filter(Boolean)) {
    const hits = subs.filter((t) => isLang(t.lang, want));
    const best = hits.find((t) => !t.forced) ?? hits[0];
    if (best) return best.id;
  }
  const a = (audio ?? '').toLowerCase().split(/[-_]/)[0];
  const sign = forced && a && subs.find((t) => t.forced && (isLang(t.lang, a) || Object.keys(LANGS).some((k) => isLang(a, k) && isLang(t.lang, k))));
  if (sign) return sign.id;
  return onlyMine ? 'no' : null;
}
export const pickAudio = (tracks, want) => (want ? tracks.find((t) => t.type === 'audio' && isLang(t.lang, want))?.id : null) ?? null;

const QUALITY = { '2160p': '2160p|\\b4k\\b|uhd', '1080p': '1080p', '720p': '720p' };
// Stream rules (Nuvio's regex presets): [label, pattern, true = must NOT match]
export const RULES = {
  hd: ['1080p or better', '2160p|\\b4k\\b|uhd|1080p'],
  uhd: ['4K or Remux', '2160p|\\b4k\\b|uhd|remux'],
  small: ['720p or smaller', '720p|576p|480p|360p'],
  hdr: ['HDR or Dolby Vision', 'hdr|\\bdv\\b|dolby.?vision|dovi'],
  hevc: ['HEVC (x265)', 'hevc|x265|h\\.?265'],
  avc: ['AVC (x264)', '\\bavc\\b|x264|h\\.?264'],
  bluray: ['BluRay', 'blu-?ray|bdrip|brrip|remux'],
  web: ['WEB', '\\bweb'],
  atmos: ['Atmos or DTS', 'atmos|\\bdts|truehd'],
  english: ['English audio', 'english|\\beng\\b'],
  nocam: ['No CAM or TS', '\\b(cam|hdcam|camrip|ts|hdts|telesync|tc|telecine)\\b', true],
  noremux: ['No Remux or HDR', 'remux|hdr|\\bdv\\b|dolby.?vision', true],
};
const re = (src) => { try { return src ? new RegExp(src, 'i') : null; } catch { return null; } }; // a broken custom rule is ignored
const text = (s) => `${s.name ?? ''} ${s.title ?? ''} ${s.description ?? ''}`;

// mode 'reuse' replays last.stream (the link that played this video before), else behaves like 'auto'; 'ask' never picks.
// Auto: same release group as the last episode, else streams passing every rule (all of them if none pass), best quality first.
export function chooseStream({ mode, quality, last, groups, bingeGroup = null, rules = [], custom = '', sameGroup = true }) {
  if (mode === 'ask') return null;
  if (mode === 'reuse' && last?.stream?.url) return last.stream;
  const all = groups.flatMap((g) => g.streams).filter((s) => s.url); // torrents and external links can't auto-play
  const same = sameGroup && bingeGroup && all.find((s) => s.behaviorHints?.bingeGroup === bingeGroup);
  if (same) return same;
  const tests = [...rules.filter((k) => RULES[k]).map((k) => [re(RULES[k][1]), RULES[k][2]]), [re(custom), false]].filter(([r]) => r);
  const passing = all.filter((s) => tests.every(([r, not]) => r.test(text(s)) !== !!not));
  const pool = passing.length ? passing : all;
  const q = re(QUALITY[quality]);
  return (q && pool.find((s) => q.test(text(s)))) || pool[0] || null;
}

// Segments are { kind: 'intro' | 'recap' | 'outro', start, end } in seconds.
export const fromIntroDB = (j) => ['intro', 'recap', 'outro']
  .filter((k) => j?.[k] && j[k].end_sec > j[k].start_sec)
  .map((k) => ({ kind: k, start: j[k].start_sec, end: j[k].end_sec }));

const ANISKIP = { op: 'intro', 'mixed-op': 'intro', ed: 'outro', 'mixed-ed': 'outro', recap: 'recap' };
export const fromAniSkip = (j) => (j?.results ?? [])
  .filter((r) => ANISKIP[r.skipType])
  .map((r) => ({ kind: ANISKIP[r.skipType], start: r.interval.startTime, end: r.interval.endTime }));

export const segmentAt = (segs, t) => segs.find((x) => x.kind !== 'outro' && t >= x.start && t < x.end - 1) ?? null;

// Card time. 'credits': when the end credits start, else 30 s before the end (credits before the halfway mark are bad data).
// 'p90': at 90% watched. 'm2': 2 minutes before the end. Never before halfway.
export const NEXT_WHEN = [['credits', 'When credits start'], ['p90', 'At 90%'], ['p95', 'At 95%'], ['m1', '1 min before end'], ['m3', '3 min before end']];
export function nextCardAt(segs, duration, when = 'credits') {
  if (!(duration > 0)) return null;
  const n = +String(when).slice(1);
  if (when[0] === 'p' && n) return Math.max(duration / 2, (duration * n) / 100);
  if (when[0] === 'm' && n) return Math.max(duration / 2, duration - n * 60);
  const outro = segs.find((x) => x.kind === 'outro' && x.start > duration / 2);
  return outro ? outro.start : Math.max(duration / 2, duration - 30);
}

// Chapter names inside the file; a chapter runs until the next one (the last until the end).
const CHAPTER = [[/recap|previously/i, 'recap'], [/intro|opening|^op$/i, 'intro'], [/credits|ending|outro|^ed$/i, 'outro']];
export const fromChapters = (list, duration) => (list ?? []).flatMap((c, i) => {
  const kind = CHAPTER.find(([re]) => re.test(c.title ?? ''))?.[1];
  return kind ? [{ kind, start: c.time, end: list[i + 1]?.time ?? duration }] : [];
});
