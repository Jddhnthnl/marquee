// Look and profile rules: accents, poster size, home row order, avatars. Pure, so node can test them (look.test.mjs).

export const LOOK_DEFAULTS = { accent: 'tungsten', posterSize: 'M', homeRows: { order: [], hidden: [] },
  bannerTrailer: true, hoverTrailer: true, hoverDelay: 700, intro: true };

// [name, color, the same color as "r g b" for glows]
export const ACCENTS = {
  tungsten: ['Tungsten gold', '#F0B35A', '240 179 90'],
  red: ['Marquee red', '#E8564A', '232 86 74'],
  plum: ['Velvet plum', '#C48FDC', '196 143 220'],
  green: ['Exit-sign green', '#5FD38A', '95 211 138'],
};

export const PROFILE_COLORS = [['#3E7C8C', 'Teal'], ['#2E5A8C', 'Blue'], ['#5A4E8C', 'Indigo'], ['#8C3E62', 'Rose'],
  ['#8C4A3E', 'Brick'], ['#8C6A2E', 'Brass'], ['#4E7A4A', 'Green'], ['#5A6670', 'Slate']];

// Line drawings on a 48 px grid, stroked in the text color over the profile color.
export const AVATARS = {
  popcorn: ['Popcorn', '<path d="M14 22l3 18h14l3-18zM20 22l1.5 18M28 22l-1.5 18"/><circle cx="17" cy="18" r="4"/><circle cx="24" cy="14" r="5"/><circle cx="31" cy="18" r="4"/>'],
  reel: ['Film reel', '<circle cx="24" cy="24" r="15"/><circle cx="24" cy="24" r="2.5"/><circle cx="24" cy="15" r="3.5"/><circle cx="32.5" cy="21" r="3.5"/><circle cx="29.3" cy="31.3" r="3.5"/><circle cx="18.7" cy="31.3" r="3.5"/><circle cx="15.5" cy="21" r="3.5"/>'],
  clapper: ['Clapperboard', '<path d="M10 22h28v17H10zM10 22l-1.5-6.5 27-6.5 1.5 6.5M17.5 14l4 6.5M26 12l4 6.5M10 29h28"/>'],
  ticket: ['Ticket', '<path d="M9 16h30v5.5a2.5 2.5 0 0 0 0 5V32H9v-5.5a2.5 2.5 0 0 0 0-5z"/><path d="M31 17v14" stroke-dasharray="2.5 3"/><path d="M15 21h10M15 26h7"/>'],
  projector: ['Projector', '<circle cx="17" cy="14" r="5"/><circle cx="28" cy="14" r="5"/><path d="M10 21h22v13H10zM32 25l6-3.5v12L32 30M14 34l-2 5M28 34l2 5"/>'],
  glasses: ['3D glasses', '<path d="M7 19h34M10 19l1.5 10.5a2 2 0 0 0 2 1.5h6.5a2 2 0 0 0 2-1.5l1-4.5h2l1 4.5a2 2 0 0 0 2 1.5h6.5a2 2 0 0 0 2-1.5L38 19"/>'],
  camera: ['Movie camera', '<path d="M8 20h24v16H8zM32 24l8-4v16l-8-4M13 20l3-8h8l3 8"/><circle cx="20" cy="28" r="3.5"/>'],
  chair: ['Director’s chair', '<path d="M15 10v30M33 10v30M15 13h18v7H15M13 27h22M15 27l18 13M33 27L15 40"/>'],
  megaphone: ['Megaphone', '<path d="M9 21v7l5 1 18 8V12l-18 8zM14 29l2.5 9h4.5l-1.5-8M36 19c2 2 2 9 0 11"/>'],
  star: ['Star', '<path d="M24 8.5l4.6 9.4 10.3 1.5-7.4 7.3 1.7 10.3L24 32.1l-9.2 4.9 1.7-10.3-7.4-7.3 10.3-1.5z"/>'],
  spotlight: ['Spotlight', '<path d="M13 15l10-5 5 10-10 5zM28 13l9-3M30 19l9 3M18 25l-3 14M18 25l7 14M11 39h18"/>'],
  strip: ['Film strip', '<path d="M14 8h20v32H14zM20 14h8v8h-8zM20 26h8v8h-8z"/><path d="M17 10v28M31 10v28" stroke-dasharray="1.5 4"/>'],
  soda: ['Soda', '<path d="M14 17h20l-2.5 23h-15zM12 17h24M26 17l3-9h5M16 27h16"/>'],
  curtain: ['Curtain', '<path d="M7 10h34M9 10c0 12 5 22 13 28M39 10c0 12-5 22-13 28M9 10v28h13M39 10v28H26M15 10c1 8 4 15 7 19M33 10c-1 8-4 15-7 19"/>'],
  trophy: ['Trophy', '<path d="M17 9h14v8a7 7 0 0 1-14 0zM17 12h-4a4 4 0 0 0 4 6M31 12h4a4 4 0 0 1-4 6M24 24v7M18 38h12M20 31h8v7h-8z"/>'],
  flashlight: ['Usher’s torch', '<path d="M9 32L22 19l7 7-13 13zM22 19l4-4 7 7-4 4M35 13l5-5M37 20l6 0M28 11V5"/>'],
};

// Home rows as the settings list shows them: the saved order first, rows never arranged keep their place after, rows that no longer exist drop out.
export function orderRows(keys, { order = [], hidden = [] } = {}) {
  const sorted = [...order.filter((k) => keys.includes(k)), ...keys.filter((k) => !order.includes(k))];
  return sorted.map((key) => ({ key, shown: !hidden.includes(key) }));
}

// The last profile can't go; when the one in use goes, the first one left takes over.
export function removeProfile(p, id) {
  if (p.list.length <= 1) return p;
  const list = p.list.filter((x) => x.id !== id);
  return { ...p, list, active: p.active === id ? list[0].id : p.active };
}

// Time-based so a deleted profile's id (and its synced data) never comes back.
let last = 0;
export const newProfileId = () => (last = Math.max(Date.now(), last + 1)).toString(36);

// Saved settings without the keys of one Settings section.
const sectionOf = (k) => (k in LOOK_DEFAULTS ? 'look' : k.startsWith('sub') ? 'subtitles' : 'playback');
export const resetSection = (saved, section) => Object.fromEntries(Object.entries(saved).filter(([k]) => sectionOf(k) !== section));
