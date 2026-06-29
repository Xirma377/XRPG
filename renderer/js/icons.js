// Inline SVG icons (stroke-based, currentColor). icon(name, size) -> SVGElement.

const P = {
  home: 'M3 11l9-8 9 8M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10',
  book: 'M4 5a2 2 0 012-2h12v16H6a2 2 0 00-2 2V5zM18 3v18M8 7h6M8 11h6',
  scroll: 'M5 4h11l3 3v10a3 3 0 01-3 3H7a3 3 0 01-3-3V4zM16 4v3h3M8 10h8M8 14h6',
  users: 'M16 19v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1M9 11a3 3 0 100-6 3 3 0 000 6zM22 19v-1a4 4 0 00-3-3.87M16 5.13A4 4 0 0119 9',
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  mask: 'M4 5c5-2 11-2 16 0 0 7-2 11-8 14C6 16 4 12 4 5zM9 10h.01M15 10h.01M9 14c1 1 5 1 6 0',
  dice: 'M3 8l9-5 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8M8 7l8 4M16 7l-8 4',
  swords: 'M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M5 14l-2 2v3h3l2-2',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM21 16a3 3 0 11-6 0 3 3 0 016 0z',
  mic: 'M12 2a3 3 0 013 3v6a3 3 0 01-6 0V5a3 3 0 013-3zM19 10a7 7 0 01-14 0M12 17v5M8 22h8',
  spark: 'M12 2l1.8 5.5L19 9l-5.2 1.5L12 16l-1.8-5.5L5 9l5.2-1.5L12 2zM19 14l.8 2.4L22 17l-2.2.6L19 20l-.8-2.4L16 17l2.2-.6L19 14z',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 13a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7.6 1.6 1.6 0 00-1 1.5V22a2 2 0 11-4 0v-.2a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H2a2 2 0 110-4h.2a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H8a1.6 1.6 0 001-1.5V2a2 2 0 114 0v.2a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V8a1.6 1.6 0 001.5 1H22a2 2 0 110 4h-.2a1.6 1.6 0 00-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  x: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  edit: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4 9.5-9.5z',
  trash: 'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6',
  copy: 'M9 9h10a2 2 0 012 2v10a2 2 0 01-2 2H9a2 2 0 01-2-2V11a2 2 0 012-2zM5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1',
  download: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12',
  eraser: 'M16 3a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L10 19H5l-2.4-2.4a2 2 0 010-2.8L16 3zM8.5 8.5l7 7',
  play: 'M6 4l14 8-14 8V4z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  stop: 'M6 6h12v12H6z',
  record: 'M12 12m-7 0a7 7 0 1014 0 7 7 0 10-14 0',
  replay: 'M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 3v4h4',
  skip: 'M5 4l10 8-10 8V4zM19 5v14',
  chevR: 'M9 18l6-6-6-6',
  chevD: 'M6 9l6 6 6-6',
  chevL: 'M15 18l-6-6 6-6',
  clock: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2',
  fire: 'M12 2c1 3-1 5-2 6-2 2-3 4-3 6a5 5 0 0010 0c0-2-1-3-2-4 0 1-1 2-2 2 1-3 0-6-1-6.5M12 2c0 2 1 3 2 4',
  snow: 'M12 2v20M4.5 6.5l15 11M19.5 6.5l-15 11M12 7l-3 2M12 7l3 2M12 17l-3-2M12 17l3-2',
  shield: 'M12 2l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V5l8-3z',
  heart: 'M20.8 5.6a5 5 0 00-7-.2L12 7l-1.8-1.6a5 5 0 00-7 7.2L12 21l8.8-8.2a5 5 0 000-7.2z',
  brain: 'M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 006 0V5a3 3 0 00-3-1zM15 4a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5',
  layers: 'M12 2l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  target: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 18a6 6 0 100-12 6 6 0 000 12zM12 14a2 2 0 100-4 2 2 0 000 4z',
  flag: 'M4 22V4M4 4s1-1 4-1 4 2 7 2 4-1 4-1v10s-1 1-4 1-4-2-7-2-4 1-4 1',
  link: 'M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1.5 1.5M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1.5-1.5',
  save: 'M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM17 21v-8H7v8M7 3v5h8',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeOff: 'M9.9 4.2A10.9 10.9 0 0112 4c6 0 10 7 10 7a13 13 0 01-2 2.6M6 6a13 13 0 00-4 6s4 7 10 7a10.9 10.9 0 005.2-1.3M3 3l18 18M9 9a3 3 0 004 4',
  pin: 'M12 22s7-7 7-12a7 7 0 10-14 0c0 5 7 12 7 12zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  ruler: 'M3 17L17 3l4 4L7 21l-4-4zM7 11l2 2M11 7l2 2M15 11l2 2',
  volume: 'M11 5L6 9H2v6h4l5 4V5zM15 9a3 3 0 010 6M18 6a7 7 0 010 12',
  volumeX: 'M11 5L6 9H2v6h4l5 4V5zM22 9l-6 6M16 9l6 6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  bolt: 'M13 2L3 14h7l-1 8 10-12h-7l1-8z',
  warn: 'M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.4 3.9a2 2 0 00-3.4 0zM12 9v4M12 17h.01',
  info: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01',
  filter: 'M22 3H2l8 9.5V19l4 2v-8.5L22 3z',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  history: 'M3 3v5h5M3.05 13A9 9 0 106 5.3L3 8M12 7v5l4 2',
  cards: 'M3 7l5-4 12 4-2 13-12-1L3 7zM8 3v15',
  road: 'M4 22L8 2h8l4 20M12 5v2M12 11v2M12 17v2',
  radio: 'M4 12a8 8 0 018-8M2 16a12 12 0 0112-12M12 16a4 4 0 014-4M16 20a8 8 0 01-8-8M7 20h14v-6H7v6zM10 17h.01',
  npc: 'M12 12a4 4 0 100-8 4 4 0 000 8zM6 21v-1a4 4 0 014-4h4a4 4 0 014 4v1M3 8l2-2-2-2M21 8l-2-2 2-2',
  zombie: 'M12 2a7 7 0 00-7 7v4l-1 3 2 1 1 4h10l1-4 2-1-1-3V9a7 7 0 00-7-7zM9 10l1.5 1M15 10l-1.5 1M9.5 15c1 .8 4 .8 5 0',
  compass: 'M12 22a10 10 0 100-20 10 10 0 000 20zM16 8l-2 6-6 2 2-6 6-2z',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  menu: 'M3 12h18M3 6h18M3 18h18',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15',
};

export function icon(name, size = 18, opts = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', opts.fill || 'none');
  svg.setAttribute('stroke', opts.stroke || 'currentColor');
  svg.setAttribute('stroke-width', opts.weight || 1.7);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('icon');
  if (opts.class) svg.classList.add(...opts.class.split(' '));
  const d = P[name] || P.info;
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  if (name === 'record') { path.setAttribute('fill', 'currentColor'); path.setAttribute('stroke', 'none'); }
  svg.appendChild(path);
  return svg;
}

export const iconNames = Object.keys(P);
