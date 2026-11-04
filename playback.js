// Playback rules shared by the main page and the player: settings, which stream to play, skip and next-episode timing.
import { pickAutoPlay } from './protocol.js';

export const PLAYBACK_DEFAULTS = { player: 'marquee', externalPath: '', streamMode: 'reuse', quality: '1080p', nextDelay: 10, stillWatching: 3, skip: 'button',
  subSize: 100, subColor: '#FFFFFF', subEdge: 'outline', subLift: 0, subLang1: '', subLang2: '' };

export const SUB_COLORS = [['#FFFFFF', 'White'], ['#F2E6C9', 'Cream'], ['#FFE347', 'Yellow'], ['#8FE3F0', 'Cyan'], ['#A6E88F', 'Green'], ['#F5A8CB', 'Pink']];
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
    ['sub-border-style', style], ['sub-outline-size', outline], ['sub-shadow-offset', shadow], ['sub-back-color', back]];
}

// Languages offered in Settings (ISO 639-1), with the 3-letter codes files use for them.
export const LANGS = { en: ['eng', 'English'], es: ['spa', 'Spanish'], fr: ['fre', 'fra', 'French'], de: ['ger', 'deu', 'German'], it: ['ita', 'Italian'],
  pt: ['por', 'Portuguese'], nl: ['dut', 'nld', 'Dutch'], pl: ['pol', 'Polish'], ru: ['rus', 'Russian'], tr: ['tur', 'Turkish'], ar: ['ara', 'Arabic'],
  hi: ['hin', 'Hindi'], ja: ['jpn', 'Japanese'], ko: ['kor', 'Korean'], zh: ['chi', 'zho', 'Chinese'], th: ['tha', 'Thai'], vi: ['vie', 'Vietnamese'],
  id: ['ind', 'Indonesian'], tl: ['fil', 'tgl', 'Filipino'] };
const isLang = (code, want) => { const c = (code ?? '').toLowerCase().split(/[-_]/)[0]; return c === want || (LANGS[want] ?? []).includes(c); };
// Track id to show for the preferred languages, or null to leave mpv's choice alone.
export function pickSub(tracks, langs) {
  for (const want of langs.filter(Boolean)) {
    const hits = tracks.filter((t) => t.type === 'sub' && isLang(t.lang, want));
    const best = hits.find((t) => !t.forced) ?? hits[0];
    if (best) return best.id;
  }
  return null;
}
const QUALITY = { '2160p': '2160p|\\b4k\\b|uhd', '1080p': '1080p', '720p': '720p' };

// mode 'reuse' replays last.stream (the link that played this video before), else behaves like 'auto'; 'ask' never picks.
export function chooseStream({ mode, quality, last, groups, bingeGroup = null }) {
  if (mode === 'ask') return null;
  if (mode === 'reuse' && last?.stream?.url) return last.stream;
  return pickAutoPlay(groups, { mode: 'regex', regex: QUALITY[quality] ?? '', bingeGroup });
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

// Card time: when the end credits start, else 30 s before the end. Credits before the halfway mark are bad data.
export function nextCardAt(segs, duration) {
  if (!(duration > 0)) return null;
  const outro = segs.find((x) => x.kind === 'outro' && x.start > duration / 2);
  return outro ? outro.start : Math.max(0, duration - 30);
}

// Chapter names inside the file; a chapter runs until the next one (the last until the end).
const CHAPTER = [[/recap|previously/i, 'recap'], [/intro|opening|^op$/i, 'intro'], [/credits|ending|outro|^ed$/i, 'outro']];
export const fromChapters = (list, duration) => (list ?? []).flatMap((c, i) => {
  const kind = CHAPTER.find(([re]) => re.test(c.title ?? ''))?.[1];
  return kind ? [{ kind, start: c.time, end: list[i + 1]?.time ?? duration }] : [];
});
