// Dithering Studio — single-file vanilla app.

import { GIFEncoder, quantize, applyPalette } from './gifenc.js';

// Guard against duplicate execution — if some host (HMR, eval re-injection,
// embedding) re-imports this module, we don't want to double-bind listeners.
if (window.__ditherStudioLoaded) {
  console.warn('Dithering Studio already loaded — skipping duplicate init.');
  throw new Error('Dithering Studio already initialized in this window.');
}
window.__ditherStudioLoaded = true;

// ---------- defaults ----------
const DEFAULT_SVGS = [
  // 0 shadow → 6 highlight: dot ramp then square
  '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="4" fill="currentColor"/></svg>',
  '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="12" fill="currentColor"/></svg>',
  '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="20" fill="currentColor"/></svg>',
  '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="28" fill="currentColor"/></svg>',
  '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="36" fill="currentColor"/></svg>',
  '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="46" fill="currentColor"/></svg>',
  '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="100" height="100" fill="currentColor"/></svg>',
];
const DEFAULT_COLORS = ['#ffffff','#ffffff','#ffffff','#ffffff','#ffffff','#ffffff','#ffffff'];

// ---------- shape ramps for starter presets ----------
// NOTE: xmlns is required for `new Image()` to decode these as SVG when loaded
// as a Blob URL. Without it, rebuildShapeCache() throws and no render happens.
const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = (inner) =>
  `<svg viewBox="0 0 100 100" xmlns="${SVG_NS}">${inner}</svg>`;
const PLUS_RAMP = [
  svg('<rect x="46" y="46" width="8" height="8" fill="currentColor"/>'),
  svg('<rect x="42" y="35" width="16" height="30" fill="currentColor"/><rect x="35" y="42" width="30" height="16" fill="currentColor"/>'),
  svg('<rect x="40" y="25" width="20" height="50" fill="currentColor"/><rect x="25" y="40" width="50" height="20" fill="currentColor"/>'),
  svg('<rect x="38" y="15" width="24" height="70" fill="currentColor"/><rect x="15" y="38" width="70" height="24" fill="currentColor"/>'),
  svg('<rect x="35" y="5" width="30" height="90" fill="currentColor"/><rect x="5" y="35" width="90" height="30" fill="currentColor"/>'),
  svg('<rect x="30" y="0" width="40" height="100" fill="currentColor"/><rect x="0" y="30" width="100" height="40" fill="currentColor"/>'),
  svg('<rect x="0" y="0" width="100" height="100" fill="currentColor"/>'),
];
const DIAMOND_RAMP = [
  svg('<polygon points="50,46 54,50 50,54 46,50" fill="currentColor"/>'),
  svg('<polygon points="50,38 62,50 50,62 38,50" fill="currentColor"/>'),
  svg('<polygon points="50,28 72,50 50,72 28,50" fill="currentColor"/>'),
  svg('<polygon points="50,18 82,50 50,82 18,50" fill="currentColor"/>'),
  svg('<polygon points="50,10 90,50 50,90 10,50" fill="currentColor"/>'),
  svg('<polygon points="50,2 98,50 50,98 2,50" fill="currentColor"/>'),
  svg('<polygon points="50,0 100,50 50,100 0,50" fill="currentColor"/>'),
];
const BAR_RAMP = [
  svg('<rect x="10" y="48" width="80" height="4" fill="currentColor"/>'),
  svg('<rect x="5" y="44" width="90" height="12" fill="currentColor"/>'),
  svg('<rect x="0" y="40" width="100" height="20" fill="currentColor"/>'),
  svg('<rect x="0" y="34" width="100" height="32" fill="currentColor"/>'),
  svg('<rect x="0" y="26" width="100" height="48" fill="currentColor"/>'),
  svg('<rect x="0" y="14" width="100" height="72" fill="currentColor"/>'),
  svg('<rect x="0" y="0" width="100" height="100" fill="currentColor"/>'),
];
const TRI_RAMP = [
  svg('<polygon points="50,46 55,55 45,55" fill="currentColor"/>'),
  svg('<polygon points="50,38 62,60 38,60" fill="currentColor"/>'),
  svg('<polygon points="50,28 70,68 30,68" fill="currentColor"/>'),
  svg('<polygon points="50,18 80,80 20,80" fill="currentColor"/>'),
  svg('<polygon points="50,10 88,88 12,88" fill="currentColor"/>'),
  svg('<polygon points="50,2 96,96 4,96" fill="currentColor"/>'),
  svg('<polygon points="50,0 100,100 0,100" fill="currentColor"/>'),
];
// Full-width horizontal bars, growing in thickness, occupying the full cell so
// adjacent same-state cells form continuous lines (riso/scanline aesthetic).
const LINE_RAMP = [
  svg('<rect x="0" y="49.5" width="100" height="1" fill="currentColor"/>'),
  svg('<rect x="0" y="47" width="100" height="6" fill="currentColor"/>'),
  svg('<rect x="0" y="43" width="100" height="14" fill="currentColor"/>'),
  svg('<rect x="0" y="37" width="100" height="26" fill="currentColor"/>'),
  svg('<rect x="0" y="29" width="100" height="42" fill="currentColor"/>'),
  svg('<rect x="0" y="15" width="100" height="70" fill="currentColor"/>'),
  svg('<rect x="0" y="0" width="100" height="100" fill="currentColor"/>'),
];

// Solid centred squares that grow with luminance — reproduces the chunky
// square-pixel ordered-dither look of the "Dithered Fire" shader style.
const pixelSquare = (s) =>
  svg(`<rect x="${(100 - s) / 2}" y="${(100 - s) / 2}" width="${s}" height="${s}" fill="currentColor"/>`);
const PIXEL_RAMP = [26, 42, 56, 70, 82, 92, 100].map(pixelSquare);

// ---------- Serpier-branded presets ----------
// Each ramp is a fractal dither: every dither cell IS a 3×3 sub-grid filled
// progressively from sparse to dense, with state 3 = the Serpier signature
// "X" (4 corners + centre — the dark mass in the middle of the logo, where
// the + sits in negative space).
const SERPIER_CELL_RAMP = [
  // 0 — just the centre cell (1/9)
  svg('<rect x="35" y="35" width="30" height="30" fill="currentColor"/>'),
  // 1 — opposite diagonal corners (2/9)
  svg('<rect x="0" y="0" width="30" height="30" fill="currentColor"/><rect x="70" y="70" width="30" height="30" fill="currentColor"/>'),
  // 2 — four corners (4/9)
  svg('<rect x="0" y="0" width="30" height="30" fill="currentColor"/><rect x="70" y="0" width="30" height="30" fill="currentColor"/><rect x="0" y="70" width="30" height="30" fill="currentColor"/><rect x="70" y="70" width="30" height="30" fill="currentColor"/>'),
  // 3 — Serpier signature: 4 corners + centre (5/9)
  svg('<rect x="0" y="0" width="30" height="30" fill="currentColor"/><rect x="70" y="0" width="30" height="30" fill="currentColor"/><rect x="35" y="35" width="30" height="30" fill="currentColor"/><rect x="0" y="70" width="30" height="30" fill="currentColor"/><rect x="70" y="70" width="30" height="30" fill="currentColor"/>'),
  // 4 — X + top & bottom middle (7/9)
  svg('<rect x="0" y="0" width="30" height="30" fill="currentColor"/><rect x="35" y="0" width="30" height="30" fill="currentColor"/><rect x="70" y="0" width="30" height="30" fill="currentColor"/><rect x="35" y="35" width="30" height="30" fill="currentColor"/><rect x="0" y="70" width="30" height="30" fill="currentColor"/><rect x="35" y="70" width="30" height="30" fill="currentColor"/><rect x="70" y="70" width="30" height="30" fill="currentColor"/>'),
  // 5 — full 3×3 grid with gaps (9/9)
  svg('<rect x="0" y="0" width="30" height="30" fill="currentColor"/><rect x="35" y="0" width="30" height="30" fill="currentColor"/><rect x="70" y="0" width="30" height="30" fill="currentColor"/><rect x="0" y="35" width="30" height="30" fill="currentColor"/><rect x="35" y="35" width="30" height="30" fill="currentColor"/><rect x="70" y="35" width="30" height="30" fill="currentColor"/><rect x="0" y="70" width="30" height="30" fill="currentColor"/><rect x="35" y="70" width="30" height="30" fill="currentColor"/><rect x="70" y="70" width="30" height="30" fill="currentColor"/>'),
  // 6 — solid (no sub-grid gaps)
  svg('<rect x="0" y="0" width="100" height="100" fill="currentColor"/>'),
];

// Serpier brand colours, taken directly from the official logo SVG.
const SERPIER_BG = '#003d20';
const SERPIER_FG = '#e6ff9a';

// The actual logo geometry (two C-shapes + the centre square), authored in a
// 1920×1080 canvas. Wrapped in a transform that centres it inside a 100×100
// dither-cell viewBox at a given scale factor.
const serpierStamp = (scale) => svg(
  `<g transform="translate(50 50) scale(${scale}) translate(-905 -487)">` +
    `<path fill="currentColor" d="M810,487.01v100h100v100h-104.67c-82.84,0-150-67.16-150-150,0-41.42,16.79-78.92,43.93-106.07,27.15-27.14,64.65-43.93,106.07-43.93h104.67v100h-100Z"/>` +
    `<path fill="currentColor" d="M1255.33,537.01c0,41.42-16.79,78.92-43.93,106.07-27.15,27.14-64.65,43.93-106.07,43.93h-95.33v-100h100v-100h-100v-100h95.33c82.84,0,150,67.16,150,150Z"/>` +
    `<rect fill="currentColor" x="910" y="487.01" width="100" height="100"/>` +
  `</g>`
);
const SERPIER_STAMP_RAMP = [0.015, 0.030, 0.050, 0.075, 0.100, 0.115, 0.130].map(serpierStamp);

// Pill (stadium) shapes — clean silhouettes without the checker cutouts.
// Same aspect ratio as the actual logo (~1.75:1).
const capsule = (w, h) => svg(
  `<rect x="${(100 - w) / 2}" y="${(100 - h) / 2}" width="${w}" height="${h}" rx="${h / 2}" fill="currentColor"/>`
);
const SERPIER_CAPSULE_RAMP = [
  capsule(20, 11),
  capsule(32, 18),
  capsule(46, 26),
  capsule(58, 33),
  capsule(70, 40),
  capsule(82, 47),
  capsule(94, 54),
];

const SERPIER_PRESETS = {
  serpierCells: {
    label: 'Serpier Cells',
    settings: {
      gridCells: 50, aspect: 'original',
      bgOn: true, bgColor: SERPIER_BG,
      svgs: [...SERPIER_CELL_RAMP],
      colors: Array(7).fill(SERPIER_FG),
      enabled: [true,true,true,true,true,true,true],
      // Lock scale at 100% — the shape geometry already conveys luminance,
      // and full-cell shapes make the sub-grid sub-cells line up between
      // neighbouring dither cells (creates emergent continuous pattern).
      invert: false, scaleMin: 1.0, scaleMax: 1.0,
      rotation: 0, randomRot: false,
    },
  },
  serpierStamp: {
    label: 'Serpier Stamp',
    settings: {
      // Chunky grid so the mini logo's cutouts and centre square actually
      // resolve at each cell. Push grid higher for finer texture.
      gridCells: 30, aspect: 'original',
      bgOn: true, bgColor: SERPIER_BG,
      svgs: [...SERPIER_STAMP_RAMP],
      colors: Array(7).fill(SERPIER_FG),
      enabled: [true,true,true,true,true,true,true],
      invert: false, scaleMin: 0.5, scaleMax: 1.0,
      rotation: 0, randomRot: false,
    },
  },
  serpierCapsule: {
    label: 'Serpier Capsule',
    settings: {
      gridCells: 60, aspect: 'original',
      bgOn: true, bgColor: SERPIER_BG,
      svgs: [...SERPIER_CAPSULE_RAMP],
      colors: Array(7).fill(SERPIER_FG),
      enabled: [true,true,true,true,true,true,true],
      invert: false, scaleMin: 0.5, scaleMax: 1.0,
      rotation: 0, randomRot: false,
    },
  },
};

// ---------- generic built-in presets ----------
const BUILTIN_PRESETS = {
  pixelBlue: {
    label: 'Pixel Dither (Blue)',
    settings: {
      // Square-pixel dithering like the "Dithered Fire" shader: full-cell
      // squares grow with luminance and tile seamlessly into solid areas.
      gridCells: 110, aspect: 'original',
      bgOn: true, bgColor: '#05060f',
      svgs: [...PIXEL_RAMP],
      colors: Array(7).fill('#133BFF'),
      enabled: [true, true, true, true, true, true, true],
      invert: false, scaleMin: 1.0, scaleMax: 1.0,
      rotation: 0, randomRot: false,
    },
  },
  halftone: {
    label: 'Halftone Print',
    settings: {
      gridCells: 100, aspect: 'original',
      bgOn: true, bgColor: '#f4ead5',
      svgs: [...DEFAULT_SVGS],
      colors: ['#1a1a1a','#1a1a1a','#1a1a1a','#1a1a1a','#1a1a1a','#1a1a1a','#1a1a1a'],
      enabled: [true,true,true,true,true,true,true],
      invert: false, scaleMin: 0.3, scaleMax: 0.95,
      rotation: 0, randomRot: false,
    },
  },
  cross: {
    label: 'Pixel Cross',
    settings: {
      gridCells: 60, aspect: '1:1',
      bgOn: true, bgColor: '#0a0e2a',
      svgs: [...PLUS_RAMP],
      colors: ['#7fff5e','#7fff5e','#7fff5e','#7fff5e','#7fff5e','#7fff5e','#7fff5e'],
      enabled: [true,true,true,true,true,true,true],
      invert: false, scaleMin: 0.5, scaleMax: 0.95,
      rotation: 0, randomRot: true,
    },
  },
  diamond: {
    label: 'Diamond Cascade',
    settings: {
      gridCells: 90, aspect: 'original',
      bgOn: true, bgColor: '#1a0033',
      svgs: [...DIAMOND_RAMP],
      colors: ['#2c5fff','#5e7fff','#a35eff','#ff5ee0','#ff8e5e','#5effe6','#a5ffea'],
      enabled: [true,true,true,true,true,true,true],
      invert: false, scaleMin: 0.4, scaleMax: 1.1,
      rotation: 0, randomRot: false,
    },
  },
  brutalist: {
    label: 'Brutalist Bars',
    settings: {
      gridCells: 45, aspect: 'original',
      bgOn: true, bgColor: '#000000',
      svgs: [...BAR_RAMP],
      colors: ['#ffffff','#ffffff','#ffffff','#ffffff','#ffffff','#ffffff','#ffffff'],
      enabled: [false,true,true,true,true,true,false],
      invert: false, scaleMin: 0.55, scaleMax: 1.0,
      rotation: 0, randomRot: true,
    },
  },
  glitch: {
    label: 'Glitch Triangles',
    settings: {
      gridCells: 80, aspect: 'original',
      bgOn: true, bgColor: '#007373',
      svgs: [...TRI_RAMP],
      colors: ['#ffffff','#ffea00','#ffffff','#ffea00','#ffffff','#ffea00','#ffffff'],
      enabled: [true,true,true,true,true,true,true],
      invert: false, scaleMin: 0.3, scaleMax: 1.1,
      rotation: 0, randomRot: true,
    },
  },
  riso: {
    label: 'Riso Lines',
    settings: {
      // Scanline / risograph effect: every cell is a full-width horizontal bar,
      // varying in thickness with luminance. Invert so dark source areas fill
      // solid and light areas leave the cream paper showing.
      gridCells: 80, aspect: 'original',
      bgOn: true, bgColor: '#f0e8d4',
      svgs: [...LINE_RAMP],
      colors: ['#1a3eb8','#1a3eb8','#1a3eb8','#1a3eb8','#1a3eb8','#1a3eb8','#1a3eb8'],
      enabled: [true,true,true,true,true,true,true],
      invert: true,
      scaleMin: 1.0, scaleMax: 1.0,
      rotation: 0, randomRot: false,
    },
  },
};

// ---------- state ----------
const state = {
  source: null, // { type, width, height, element|frames, ... }
  gridCells: 80,
  aspect: 'original',
  bgOn: true,
  bgColor: '#0a0a0a',
  svgs: [...DEFAULT_SVGS],
  colors: [...DEFAULT_COLORS],
  enabled: [true, true, true, true, true, true, true],
  invert: false,
  scaleMin: 0.4,
  scaleMax: 1.0,
  rotation: 0,
  randomRot: false,
  exportNoBg: false,
};
if (typeof window !== 'undefined') window.__state = state;

// Pre-rasterized tile per highlight state, recoloured on demand. 512 keeps
// shape edges crisp when scaled up to large cell sizes.
const SHAPE_TILE = 512;
const shapeCache = new Array(7).fill(null);

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const view = $('view');
const vctx = view.getContext('2d');
vctx.imageSmoothingEnabled = true;
vctx.imageSmoothingQuality = 'high';
const srcCanvas = $('src');
const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
const vid = $('vid');

// ---------- SVG colour injection ----------
const SVG_VISIBLE = new Set(['path','rect','circle','ellipse','polygon','polyline','line']);
const parser = new DOMParser();
const serializer = new XMLSerializer();

function injectColor(svgText, color) {
  let doc;
  try {
    doc = parser.parseFromString(svgText, 'image/svg+xml');
  } catch {
    return svgText;
  }
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') return svgText;

  // Defensive: ensure xmlns is set so the SVG decodes when loaded via
  // `new Image()` from a Blob URL with image/svg+xml mime.
  if (!root.hasAttribute('xmlns')) {
    root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }

  // root colour (for currentColor users)
  const existing = root.getAttribute('style') || '';
  root.setAttribute('style', existing.replace(/color\s*:[^;]+;?/i,'') + `;color:${color}`);

  // Walk visible shapes; if fill !== none, set to colour; same for stroke.
  const walk = (node) => {
    if (node.nodeType !== 1) return;
    const name = node.nodeName.toLowerCase();
    if (SVG_VISIBLE.has(name) || name === 'g') {
      const fill = (node.getAttribute('fill') || '').trim().toLowerCase();
      const styleAttr = node.getAttribute('style') || '';
      const styleFill = /fill\s*:\s*([^;]+)/i.exec(styleAttr);
      const fillVal = styleFill ? styleFill[1].trim().toLowerCase() : fill;
      if (fillVal !== 'none') {
        node.setAttribute('fill', color);
        if (styleFill) {
          node.setAttribute('style', styleAttr.replace(/fill\s*:[^;]+;?/i, `fill:${color};`));
        }
      }
      const stroke = (node.getAttribute('stroke') || '').trim().toLowerCase();
      const styleStroke = /stroke\s*:\s*([^;]+)/i.exec(styleAttr);
      const strokeVal = styleStroke ? styleStroke[1].trim().toLowerCase() : stroke;
      if (strokeVal && strokeVal !== 'none') {
        node.setAttribute('stroke', color);
      }
    }
    for (const c of node.children) walk(c);
  };
  walk(root);

  // Strip <style> blocks that could override (best-effort).
  doc.querySelectorAll('style').forEach((s) => s.remove());

  return serializer.serializeToString(doc);
}

function rasterizeShape(idx) {
  return new Promise((resolve, reject) => {
    const svg = injectColor(state.svgs[idx], state.colors[idx]);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = SHAPE_TILE;
      const cx = c.getContext('2d');
      cx.drawImage(img, 0, 0, SHAPE_TILE, SHAPE_TILE);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

async function rebuildShapeCache(only = null) {
  if (only !== null) {
    try { shapeCache[only] = await rasterizeShape(only); }
    catch (e) { console.warn(`Shape ${only} failed to rasterize:`, e); shapeCache[only] = null; }
  } else {
    const out = await Promise.allSettled([0,1,2,3,4,5,6].map(rasterizeShape));
    for (let i = 0; i < 7; i++) {
      if (out[i].status === 'fulfilled') shapeCache[i] = out[i].value;
      else { console.warn(`Shape ${i} failed:`, out[i].reason); shapeCache[i] = null; }
    }
  }
}

// ---------- slot UI ----------
const slotsEl = $('slots');
function renderSlots() {
  slotsEl.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot' + (state.enabled[i] ? '' : ' off');
    slot.innerHTML = `
      <span class="idx">${i+1}</span>
      <label class="upload" title="Click to upload an SVG for state ${i+1}">
        <div class="preview"></div>
        <input type="file" accept=".svg,image/svg+xml" />
      </label>
      <label class="swatch" title="Change colour of state ${i+1}" style="background:${state.colors[i]}">
        <input type="color" value="${state.colors[i]}" />
      </label>
      <button class="toggle" type="button" title="Toggle state ${i+1}">${state.enabled[i] ? '✓' : '×'}</button>
    `;
    const preview = slot.querySelector('.preview');
    const swatch = slot.querySelector('.swatch');
    const toggle = slot.querySelector('.toggle');
    preview.innerHTML = injectColor(state.svgs[i], state.colors[i]);
    const fileIn = slot.querySelector('input[type="file"]');
    const colorIn = slot.querySelector('input[type="color"]');
    fileIn.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const text = await f.text();
      state.svgs[i] = text;
      preview.innerHTML = injectColor(state.svgs[i], state.colors[i]);
      await rebuildShapeCache(i);
      requestRender();
    });
    colorIn.addEventListener('input', async (e) => {
      state.colors[i] = e.target.value;
      swatch.style.background = e.target.value;
      preview.innerHTML = injectColor(state.svgs[i], state.colors[i]);
      await rebuildShapeCache(i);
      requestRender();
    });
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      state.enabled[i] = !state.enabled[i];
      slot.classList.toggle('off', !state.enabled[i]);
      toggle.textContent = state.enabled[i] ? '✓' : '×';
      requestRender();
    });
    slotsEl.appendChild(slot);
  }
}

// ---------- source loading ----------
function disposeSource() {
  if (state.source?.type === 'video') {
    vid.pause();
    if (state.source.objectUrl) URL.revokeObjectURL(state.source.objectUrl);
    vid.removeAttribute('src');
    vid.load();
  }
  state.source = null;
  $('playBtn').disabled = true;
  $('pauseBtn').disabled = true;
  $('exportVideo').disabled = true;
  $('exportLottie').disabled = true;
  $('exportGif').disabled = true;
}

async function loadFile(file) {
  disposeSource();
  const isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name);
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/') && !isGif;
  try {
    if (isGif) {
      await loadGif(file);
    } else if (isVideo) {
      await loadVideo(file);
    } else if (isImage) {
      await loadImage(file);
    } else {
      throw new Error('Unsupported file');
    }
    $('srcInfo').textContent = `${file.name} — ${state.source.width}×${state.source.height}${state.source.type !== 'image' ? ` · ${state.source.type}` : ''}`;
    requestRender();
  } catch (e) {
    $('srcInfo').textContent = `Failed to load: ${e.message || e}`;
  }
}

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  state.source = { type: 'image', element: img, width: img.naturalWidth, height: img.naturalHeight, objectUrl: url };
  $('exportLottie').disabled = false;
  $('exportGif').disabled = false;
}

// Parse Graphics Control Extension blocks from raw GIF bytes to extract the
// canonical per-frame delays (in centiseconds). ImageDecoder in Chrome
// historically clamps short delays to 100ms, so we override its timing with
// what the source actually says.
function parseGifFrameDelays(bytes) {
  const delays = [];
  for (let i = 0; i < bytes.length - 8; i++) {
    if (bytes[i] === 0x21 && bytes[i+1] === 0xF9 && bytes[i+2] === 0x04) {
      const delay = bytes[i+4] | (bytes[i+5] << 8); // centiseconds (1/100 s)
      delays.push(delay * 10); // → ms
    }
  }
  return delays;
}

async function loadGif(file) {
  if (typeof ImageDecoder === 'undefined') {
    await loadImage(file);
    state.source.type = 'image';
    return;
  }
  const buf = await file.arrayBuffer();
  const rawDelays = parseGifFrameDelays(new Uint8Array(buf));
  let dec, track, count;
  try {
    dec = new ImageDecoder({ data: buf, type: 'image/gif' });
    // Tracks become non-null only after `tracks.ready`. `completed` waits for
    // frame data but does not guarantee a selected track yet.
    if (dec.tracks?.ready) await dec.tracks.ready;
    track = dec.tracks?.selectedTrack;
    if (!track) throw new Error('no track');
    count = track.frameCount;
    if (!count || count < 1) throw new Error('no frames');
  } catch (e) {
    // Not a decodable animated GIF — fall back to static image.
    console.warn('GIF decode failed, falling back to still image:', e);
    await loadImage(file);
    state.source.type = 'image';
    return;
  }
  const frames = [];
  for (let i = 0; i < count; i++) {
    try {
      const { image, duration } = await dec.decode({ frameIndex: i });
      const c = document.createElement('canvas');
      c.width = image.displayWidth;
      c.height = image.displayHeight;
      c.getContext('2d').drawImage(image, 0, 0);
      // Prefer the canonical delay from the GIF bytes; fall back to the
      // decoder's reported duration (µs → ms) if parsing missed this frame.
      const rawMs = rawDelays[i];
      const decoderMs = duration ? duration / 1000 : null;
      const ms = rawMs && rawMs >= 10 ? rawMs : (decoderMs ?? 100);
      frames.push({ canvas: c, duration: Math.max(20, ms) });
      image.close();
    } catch (e) {
      console.warn(`GIF frame ${i} failed to decode, skipping:`, e);
    }
  }
  if (!frames.length) {
    await loadImage(file);
    state.source.type = 'image';
    return;
  }
  state.source = {
    type: 'gif',
    frames,
    width: frames[0].canvas.width,
    height: frames[0].canvas.height,
    frameIdx: 0,
    playing: true,
    lastTick: performance.now(),
  };
  $('playBtn').disabled = false;
  $('pauseBtn').disabled = false;
  $('exportVideo').disabled = false;
  $('exportLottie').disabled = false;
  $('exportGif').disabled = false;
}

async function loadVideo(file) {
  const url = URL.createObjectURL(file);
  vid.src = url;
  // loadedmetadata fires when dimensions are known; loadeddata fires when a
  // frame is actually drawable. Need the latter before drawImage() works.
  await new Promise((res, rej) => {
    const onMeta = () => { cleanup(); res(); };
    const onErr = () => {
      cleanup();
      const code = vid.error?.code;
      const msg = ({1:'aborted', 2:'network', 3:'decode', 4:'codec/format not supported by this browser'})[code] || 'unknown';
      rej(new Error(`video load failed (${msg})`));
    };
    const cleanup = () => { vid.removeEventListener('loadedmetadata', onMeta); vid.removeEventListener('error', onErr); };
    vid.addEventListener('loadedmetadata', onMeta);
    vid.addEventListener('error', onErr);
  });
  if (vid.readyState < 2) {
    await new Promise((res, rej) => {
      const onData = () => { cleanup(); res(); };
      const onErr = () => { cleanup(); rej(new Error('video data load error')); };
      const cleanup = () => { vid.removeEventListener('loadeddata', onData); vid.removeEventListener('error', onErr); };
      vid.addEventListener('loadeddata', onData);
      vid.addEventListener('error', onErr);
    });
  }
  state.source = {
    type: 'video',
    element: vid,
    width: vid.videoWidth,
    height: vid.videoHeight,
    objectUrl: url,
    playing: false,
  };
  $('playBtn').disabled = false;
  $('pauseBtn').disabled = false;
  $('exportVideo').disabled = false;
  $('exportLottie').disabled = false;
  // Render the first frame immediately so the user sees the video even if
  // autoplay is blocked. If play succeeds, the tick loop drives subsequent frames.
  requestRender();
  try { await vid.play(); state.source.playing = true; } catch {}
  // Re-render even if play was blocked so the seek to t=0 is visible.
  requestRender();
}

// ---------- render ----------
let renderScheduled = false;
function requestRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderOnce();
  });
}

function currentFrameSource() {
  if (!state.source) return null;
  if (state.source.type === 'image') return state.source.element;
  if (state.source.type === 'video') return state.source.element;
  if (state.source.type === 'gif') {
    return state.source.frames[state.source.frameIdx].canvas;
  }
  return null;
}

function renderOnce() {
  const fs = currentFrameSource();
  if (!fs) return;
  drawFrame(fs);
  $('dimsLabel').textContent = `${view.width}×${view.height} · ${state.source.width}×${state.source.height} src`;
}

const MAX_OUTPUT_DIM = 1280;

function drawFrame(frameSource) {
  if (!state.source) return;
  const sw = state.source.width;
  const sh = state.source.height;
  // Output aspect
  let aspectW, aspectH;
  if (state.aspect === '1:1') { aspectW = 1; aspectH = 1; }
  else { aspectW = sw; aspectH = sh; }

  const longCells = state.gridCells;
  let cellsX, cellsY;
  if (aspectW >= aspectH) {
    cellsX = longCells;
    cellsY = Math.max(1, Math.round(longCells * (aspectH / aspectW)));
  } else {
    cellsY = longCells;
    cellsX = Math.max(1, Math.round(longCells * (aspectW / aspectH)));
  }
  const cellPx = Math.max(2, Math.floor(MAX_OUTPUT_DIM / Math.max(cellsX, cellsY)));
  const W = cellsX * cellPx;
  const H = cellsY * cellPx;
  if (view.width !== W) view.width = W;
  if (view.height !== H) view.height = H;
  // Canvas state resets when dimensions change — re-apply smoothing each frame.
  vctx.imageSmoothingEnabled = true;
  vctx.imageSmoothingQuality = 'high';

  // Sample source into srcCanvas at cellsX × cellsY.
  srcCanvas.width = cellsX;
  srcCanvas.height = cellsY;
  if (state.aspect === '1:1') {
    const s = Math.min(sw, sh);
    const dx = (sw - s) / 2;
    const dy = (sh - s) / 2;
    sctx.drawImage(frameSource, dx, dy, s, s, 0, 0, cellsX, cellsY);
  } else {
    sctx.drawImage(frameSource, 0, 0, cellsX, cellsY);
  }
  const data = sctx.getImageData(0, 0, cellsX, cellsY).data;

  // Background.
  if (state.bgOn) {
    vctx.fillStyle = state.bgColor;
    vctx.fillRect(0, 0, W, H);
  } else {
    vctx.clearRect(0, 0, W, H);
  }

  const scaleRange = state.scaleMax - state.scaleMin;
  // Build list of enabled bucket indices (0..6). With all 7 on this is [0..6].
  // With N enabled, luminance is mapped into N buckets so the gradient still
  // covers the full shadow→highlight range using only the picked states.
  const activeBuckets = [];
  for (let k = 0; k < 7; k++) if (state.enabled[k]) activeBuckets.push(k);
  const N = activeBuckets.length;
  if (N === 0) return; // nothing to draw — background only

  for (let y = 0; y < cellsY; y++) {
    for (let x = 0; x < cellsX; x++) {
      const i = (y * cellsX + x) * 4;
      // Skip transparent cells so the background shows through (paper effect
      // for logo-on-alpha sources). 50% alpha is the threshold for "this cell
      // is mostly the logo, not mostly the background".
      if (data[i+3] < 128) continue;
      let lum = (0.2126 * data[i] + 0.7152 * data[i+1] + 0.0722 * data[i+2]) / 255;
      if (state.invert) lum = 1 - lum;
      let idx = Math.floor(lum * N);
      if (idx >= N) idx = N - 1;
      if (idx < 0) idx = 0;
      const bucket = activeBuckets[idx];
      const scale = state.scaleMin + scaleRange * lum;
      let rot = state.rotation;
      if (state.randomRot) {
        // deterministic per-cell hash to 0/90/180/270
        const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        rot = (h & 3) * 90;
      }
      const shape = shapeCache[bucket];
      if (!shape) continue;
      const drawSize = cellPx * scale;
      if (drawSize <= 0.5) continue;
      const cx = x * cellPx + cellPx / 2;
      const cy = y * cellPx + cellPx / 2;
      vctx.save();
      vctx.translate(cx, cy);
      if (rot) vctx.rotate(rot * Math.PI / 180);
      vctx.drawImage(shape, -drawSize/2, -drawSize/2, drawSize, drawSize);
      vctx.restore();
    }
  }
}

// ---------- animation loop ----------
let lastFpsAt = performance.now();
let frameCount = 0;
function tick(now) {
  if (state.source) {
    if (state.source.type === 'gif' && state.source.playing) {
      const cur = state.source.frames[state.source.frameIdx];
      if (now - state.source.lastTick >= cur.duration) {
        state.source.frameIdx = (state.source.frameIdx + 1) % state.source.frames.length;
        state.source.lastTick = now;
        renderOnce();
        frameCount++;
      }
    } else if (state.source.type === 'video') {
      if (!vid.paused && !vid.ended) {
        renderOnce();
        frameCount++;
      }
    }
  }
  if (now - lastFpsAt >= 1000) {
    $('fpsLabel').textContent = `${frameCount} fps`;
    frameCount = 0;
    lastFpsAt = now;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- export ----------
let recorder = null;
let recordChunks = [];

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportImage() {
  // For export-no-bg, render once with bg disabled.
  const prev = state.bgOn;
  if (state.exportNoBg) {
    state.bgOn = false;
    renderOnce();
  }
  const out = captureFrameCanvas();
  out.toBlob((blob) => {
    if (state.exportNoBg) {
      state.bgOn = prev;
      renderOnce();
    }
    if (blob) downloadBlob(blob, 'dither.png');
  }, 'image/png');
}

// ---------- minimal ZIP writer (STORE, no compression) ----------
// Used to build .lottie archives in-browser without bundling a zip library.
let CRC32_TABLE = null;
function crc32(bytes) {
  if (!CRC32_TABLE) {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    CRC32_TABLE = t;
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function buildZip(files) {
  // files: Array<{ name: string, data: Uint8Array }>
  const enc = new TextEncoder();
  const parts = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const sz = f.data.length;
    const crc = crc32(f.data);
    const lfh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lfh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); lv.setUint16(6, 0, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true); // dummy time/date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, sz, true); lv.setUint32(22, sz, true);
    lv.setUint16(26, nameBytes.length, true); lv.setUint16(28, 0, true);
    lfh.set(nameBytes, 30);
    parts.push(lfh, f.data);

    const cdh = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdh.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, sz, true); cv.setUint32(24, sz, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
    cdh.set(nameBytes, 46);
    centrals.push(cdh);
    offset += lfh.length + f.data.length;
  }
  const centralStart = offset;
  const centralSize = centrals.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, centralStart, true);
  return new Blob([...parts, ...centrals, eocd], { type: 'application/zip' });
}

// Render the current canvas to raw PNG bytes (Uint8Array). Used by .lottie export.
function canvasToPngBytes(srcCanvas = view) {
  return new Promise((resolve, reject) => {
    srcCanvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error('toBlob failed'));
      const buf = await blob.arrayBuffer();
      resolve(new Uint8Array(buf));
    }, 'image/png');
  });
}

// ---------- export-size + fps helpers ----------
function getExportSize() {
  const v = $('exportSize').value;
  if (v === 'match' || !v) return { w: view.width, h: view.height };
  const max = parseInt(v, 10);
  const ratio = view.height / view.width;
  if (view.width >= view.height) return { w: max, h: Math.max(1, Math.round(max * ratio)) };
  return { w: Math.max(1, Math.round(max / ratio)), h: max };
}

// Returns the source FPS (frames per second) the export should target.
function getExportFps() {
  const v = $('exportFps').value;
  if (v === 'match' || !v) {
    if (state.source?.type === 'gif' && state.source.frames.length) {
      const avgMs = state.source.frames.reduce((a, f) => a + f.duration, 0) / state.source.frames.length;
      return Math.max(1, Math.round(1000 / avgMs));
    }
    return 30;
  }
  return parseInt(v, 10);
}

// Build the list of frames to export, optionally subsampling to a target fps.
function getExportFrameList() {
  if (!state.source) return [];
  if (state.source.type !== 'gif') {
    return [{ srcIdx: 0, durationMs: 1000 }];
  }
  const v = $('exportFps').value;
  if (v === 'match' || !v) {
    return state.source.frames.map((f, i) => ({ srcIdx: i, durationMs: f.duration }));
  }
  const targetFps = parseInt(v, 10);
  const targetMs = 1000 / targetFps;
  const totalMs = state.source.frames.reduce((a, f) => a + f.duration, 0);
  const count = Math.max(1, Math.round(totalMs / targetMs));
  const out = [];
  for (let i = 0; i < count; i++) {
    const tMs = i * targetMs;
    let acc = 0, srcIdx = state.source.frames.length - 1;
    for (let j = 0; j < state.source.frames.length; j++) {
      const next = acc + state.source.frames[j].duration;
      if (tMs < next) { srcIdx = j; break; }
      acc = next;
    }
    out.push({ srcIdx, durationMs: targetMs });
  }
  return out;
}

// Downsize `view` to a target dimension into a fresh canvas (or return `view`
// directly when no resize is needed).
function captureFrameCanvas() {
  const { w, h } = getExportSize();
  if (w === view.width && h === view.height) return view;
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const ctx = tmp.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(view, 0, 0, w, h);
  return tmp;
}

// Uint8Array → "data:image/png;base64,…" (chunked to avoid call-stack limits).
function pngBytesToDataUrl(bytes) {
  let bin = '';
  const CHUNK = 32768;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return `data:image/png;base64,${btoa(bin)}`;
}

async function exportLottie() {
  if (!state.source) return;
  if (state.source.type === 'video') {
    $('exportStatus').textContent = 'Video → Lottie not yet supported. Try WebM, or convert your video to a GIF first.';
    return;
  }
  const fmt = $('lottieFormat').value === 'lottie' ? 'lottie' : 'json';
  $('exportLottie').disabled = true;
  $('exportStatus').textContent = 'Rendering frames…';

  // Pause animation while we capture so frameIdx doesn't drift.
  const wasPlaying = state.source.type === 'gif' && state.source.playing;
  if (state.source.type === 'gif') state.source.playing = false;
  const savedFrameIdx = state.source.type === 'gif' ? state.source.frameIdx : 0;

  // For export-no-bg, flip bg off during render so frames carry alpha through PNG.
  const prevBg = state.bgOn;
  if (state.exportNoBg) state.bgOn = false;

  const frames = []; // each: { durationMs, png (data URL for .json) OR pngBytes (Uint8Array for .lottie) }
  try {
    const list = getExportFrameList();
    const n = list.length;
    for (let i = 0; i < n; i++) {
      if (state.source.type === 'gif') state.source.frameIdx = list[i].srcIdx;
      renderOnce();
      await new Promise((r) => requestAnimationFrame(r));
      const out = captureFrameCanvas();
      const bytes = await canvasToPngBytes(out);
      if (fmt === 'lottie') {
        frames.push({ pngBytes: bytes, durationMs: list[i].durationMs });
      } else {
        frames.push({ png: pngBytesToDataUrl(bytes), durationMs: list[i].durationMs });
      }
      if (i % 8 === 0) {
        $('exportStatus').textContent = `Rendering frame ${i + 1}/${n}…`;
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } finally {
    if (state.exportNoBg) state.bgOn = prevBg;
    if (state.source.type === 'gif') {
      state.source.frameIdx = savedFrameIdx;
      state.source.playing = wasPlaying;
      state.source.lastTick = performance.now();
    }
    requestRender();
  }

  $('exportStatus').textContent = `Building ${fmt === 'lottie' ? '.lottie' : '.json'}…`;
  await new Promise((r) => setTimeout(r, 0));

  const fr = getExportFps();
  const { w, h } = getExportSize();

  // Build the Lottie animation JSON. For .json we embed PNGs as base64 in `p`;
  // for .lottie we reference external files in the archive's images/ folder.
  const assets = frames.map((f, i) => fmt === 'lottie'
    ? { id: `img_${i}`, w, h, u: '', p: `img_${i}.png`, e: 0 }
    : { id: `img_${i}`, w, h, u: '', p: f.png, e: 1 }
  );
  const layers = [];
  let cursor = 0;
  for (let i = 0; i < frames.length; i++) {
    const durF = Math.max(1, Math.round(frames[i].durationMs / 1000 * fr));
    layers.push({
      ddd: 0, ind: i + 1, ty: 2, nm: `Frame ${i}`, refId: `img_${i}`, sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [w / 2, h / 2, 0] },
        a: { a: 0, k: [w / 2, h / 2, 0] },
        s: { a: 0, k: [100, 100, 100] },
      },
      ao: 0, ip: cursor, op: cursor + durF, st: cursor, bm: 0,
    });
    cursor += durF;
  }
  const lottieJson = {
    v: '5.7.0', fr, ip: 0, op: cursor, w, h, nm: 'Dither Studio export',
    ddd: 0, assets, layers,
  };

  let blob, filename;
  if (fmt === 'lottie') {
    // dotLottie v1: ZIP archive containing manifest.json + animations/<id>.json + images/*.png
    const enc = new TextEncoder();
    const id = 'dither';
    const manifest = {
      version: '1.0.0',
      revision: 1,
      generator: 'Dithering Studio',
      animations: [{ id, speed: 1, loop: true, autoplay: true }],
    };
    const zipFiles = [
      { name: 'manifest.json', data: enc.encode(JSON.stringify(manifest)) },
      { name: `animations/${id}.json`, data: enc.encode(JSON.stringify(lottieJson)) },
    ];
    for (let i = 0; i < frames.length; i++) {
      zipFiles.push({ name: `images/img_${i}.png`, data: frames[i].pngBytes });
    }
    blob = buildZip(zipFiles);
    filename = 'dither.lottie';
  } else {
    blob = new Blob([JSON.stringify(lottieJson)], { type: 'application/json' });
    filename = 'dither.json';
  }

  downloadBlob(blob, filename);
  $('exportStatus').textContent = `Saved ${filename} · ${(blob.size / 1024 / 1024).toFixed(2)} MB · ${frames.length} frames`;
  $('exportLottie').disabled = false;
}

// ---------- animated GIF export ----------
// Encode one already-rendered canvas as a single GIF frame. Uses a per-frame
// palette (local colour table) for best fidelity with the dither's colours.
function writeGifFrame(gif, srcCanvas, durationMs, transparent) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const ctx = srcCanvas.getContext('2d');
  const data = ctx.getImageData(0, 0, w, h).data;
  const opts = { delay: durationMs, repeat: 0 };
  let palette, index;
  if (transparent) {
    // 1-bit alpha: cells below the alpha threshold become a single transparent
    // colour so the page background shows through and loops stay clean.
    palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true });
    index = applyPalette(data, palette, 'rgba4444');
    let ti = palette.findIndex((p) => p.length >= 4 && p[3] === 0);
    if (ti < 0) { ti = palette.length; palette.push([0, 0, 0, 0]); }
    opts.transparent = true;
    opts.transparentIndex = ti;
    opts.dispose = 2; // restore to background between frames
  } else {
    palette = quantize(data, 256, { format: 'rgb565' });
    index = applyPalette(data, palette, 'rgb565');
  }
  opts.palette = palette;
  gif.writeFrame(index, w, h, opts);
}

// GIF + image sources: walk the existing export frame list (one full loop).
async function encodeGifFromList(gif, transparent) {
  const isGif = state.source.type === 'gif';
  const wasPlaying = isGif && state.source.playing;
  if (isGif) state.source.playing = false;
  const savedIdx = isGif ? state.source.frameIdx : 0;
  try {
    const list = getExportFrameList();
    const n = list.length;
    for (let i = 0; i < n; i++) {
      if (isGif) state.source.frameIdx = list[i].srcIdx;
      renderOnce();
      await new Promise((r) => requestAnimationFrame(r));
      writeGifFrame(gif, captureFrameCanvas(), list[i].durationMs, transparent);
      if (i % 5 === 0) {
        $('exportStatus').textContent = `Encoding GIF frame ${i + 1}/${n}…`;
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } finally {
    if (isGif) {
      state.source.frameIdx = savedIdx;
      state.source.playing = wasPlaying;
      state.source.lastTick = performance.now();
    }
  }
}

// Video sources: seek across the whole clip at the chosen fps so the GIF spans
// the source's full length — no manual record/stop, loops match the source.
async function encodeGifFromVideo(gif, transparent) {
  const dur = isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 0;
  if (!dur) throw new Error('video duration unknown');
  const wasPlaying = !vid.paused;
  vid.pause();
  const savedTime = vid.currentTime;

  const fps = getExportFps();
  const MAX_FRAMES = 600; // safety cap so huge clips don't blow up memory
  let count = Math.max(1, Math.round(dur * fps));
  let perFrameMs = 1000 / fps;
  if (count > MAX_FRAMES) { count = MAX_FRAMES; perFrameMs = (dur * 1000) / count; }

  const seek = (t) => new Promise((res) => {
    const on = () => { vid.removeEventListener('seeked', on); res(); };
    vid.addEventListener('seeked', on);
    vid.currentTime = t;
  });

  try {
    for (let i = 0; i < count; i++) {
      await seek(Math.min(dur - 1e-4, (i / count) * dur));
      renderOnce();
      await new Promise((r) => requestAnimationFrame(r));
      writeGifFrame(gif, captureFrameCanvas(), perFrameMs, transparent);
      if (i % 3 === 0) {
        $('exportStatus').textContent = `Encoding GIF frame ${i + 1}/${count}…`;
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } finally {
    vid.currentTime = savedTime;
    if (wasPlaying) vid.play().catch(() => {});
  }
}

async function exportGif() {
  if (!state.source) return;
  $('exportGif').disabled = true;
  $('exportStatus').textContent = 'Rendering frames…';
  await new Promise((r) => setTimeout(r, 0));

  const transparent = state.exportNoBg;
  const prevBg = state.bgOn;
  if (transparent) state.bgOn = false;

  try {
    const gif = GIFEncoder();
    if (state.source.type === 'video') {
      await encodeGifFromVideo(gif, transparent);
    } else {
      await encodeGifFromList(gif, transparent);
    }
    gif.finish();
    const blob = new Blob([gif.bytes()], { type: 'image/gif' });
    downloadBlob(blob, 'dither.gif');
    $('exportStatus').textContent = `Saved dither.gif · ${(blob.size / 1024 / 1024).toFixed(2)} MB`;
  } catch (e) {
    console.error('GIF export failed:', e);
    $('exportStatus').textContent = `GIF export failed: ${e.message || e}`;
  } finally {
    if (transparent) state.bgOn = prevBg;
    requestRender();
    $('exportGif').disabled = false;
  }
}

function startVideoExport() {
  if (!state.source || state.source.type === 'image') return;
  const types = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  let mimeType = '';
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) { mimeType = t; break; }
  }
  if (!mimeType) {
    $('exportStatus').textContent = 'WebM not supported in this browser.';
    return;
  }
  // If exporting without bg, flip bg for the duration of recording.
  const prevBg = state.bgOn;
  if (state.exportNoBg) state.bgOn = false;

  const stream = view.captureStream(30);
  recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  recordChunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) recordChunks.push(e.data); };
  recorder.onstop = () => {
    if (state.exportNoBg) { state.bgOn = prevBg; requestRender(); }
    const blob = new Blob(recordChunks, { type: mimeType });
    downloadBlob(blob, 'dither.webm');
    $('exportStatus').textContent = `Saved ${(blob.size / 1024 / 1024).toFixed(2)} MB`;
    $('exportVideo').disabled = false;
    $('stopRecord').disabled = true;
  };
  recorder.start();
  $('exportStatus').textContent = 'Recording…';
  $('exportVideo').disabled = true;
  $('stopRecord').disabled = false;

  // Auto-stop after one full loop for gifs, or 10s for video (user can stop earlier).
  if (state.source.type === 'gif') {
    const total = state.source.frames.reduce((a,f) => a + f.duration, 0);
    setTimeout(stopVideoExport, total + 200);
  } else if (state.source.type === 'video') {
    const dur = isFinite(vid.duration) && vid.duration > 0 ? Math.min(vid.duration * 1000, 30000) : 10000;
    setTimeout(stopVideoExport, dur + 200);
  }
}
function stopVideoExport() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}

// ---------- wiring ----------
$('srcFile').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) loadFile(f);
});

const bindRange = (id, valId, key, transform = (v) => v, suffix = '') => {
  const el = $(id);
  const v = $(valId);
  const sync = () => {
    state[key] = transform(+el.value);
    if (v) v.textContent = `${el.value}${suffix}`;
    requestRender();
  };
  el.addEventListener('input', sync);
  sync();
};

bindRange('grid', 'gridVal', 'gridCells');
bindRange('scaleMin', 'scaleMinVal', 'scaleMin', (v) => v/100, '%');
bindRange('scaleMax', 'scaleMaxVal', 'scaleMax', (v) => v/100, '%');

$('aspect').addEventListener('change', (e) => { state.aspect = e.target.value; requestRender(); });
$('bgColor').addEventListener('input', (e) => { state.bgColor = e.target.value; requestRender(); });
$('bgOn').addEventListener('change', (e) => { state.bgOn = e.target.checked; requestRender(); });
$('invert').addEventListener('change', (e) => { state.invert = e.target.checked; requestRender(); });
$('rotation').addEventListener('change', (e) => { state.rotation = +e.target.value; requestRender(); });
$('randomRot').addEventListener('change', (e) => { state.randomRot = e.target.checked; requestRender(); });
$('exportNoBg').addEventListener('change', (e) => { state.exportNoBg = e.target.checked; });

$('playBtn').addEventListener('click', () => {
  if (!state.source) return;
  if (state.source.type === 'gif') { state.source.playing = true; state.source.lastTick = performance.now(); }
  else if (state.source.type === 'video') { vid.play().catch(()=>{}); }
});
$('pauseBtn').addEventListener('click', () => {
  if (!state.source) return;
  if (state.source.type === 'gif') state.source.playing = false;
  else if (state.source.type === 'video') vid.pause();
});

$('resetSlots').addEventListener('click', async () => {
  state.svgs = [...DEFAULT_SVGS];
  state.colors = [...DEFAULT_COLORS];
  state.enabled = [true, true, true, true, true, true, true];
  renderSlots();
  await rebuildShapeCache();
  requestRender();
});

$('exportImage').addEventListener('click', exportImage);
$('exportGif').addEventListener('click', exportGif);
$('exportVideo').addEventListener('click', startVideoExport);
$('stopRecord').addEventListener('click', stopVideoExport);
$('exportLottie').addEventListener('click', exportLottie);

// ---------- zoom & pan ----------
let zoom = 1, panX = 0, panY = 0;
const stageInner = document.querySelector('.stage-inner');
const ZOOM_MIN = 0.1, ZOOM_MAX = 16;

function applyTransform() {
  view.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  $('zoomLabel').textContent = `${Math.round(zoom * 100)}%`;
}

function setZoom(next, anchorX = null, anchorY = null) {
  next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
  if (anchorX !== null && anchorY !== null) {
    const rect = view.getBoundingClientRect();
    const cx = anchorX - (rect.left + rect.width / 2);
    const cy = anchorY - (rect.top + rect.height / 2);
    const k = next / zoom;
    panX -= cx * (k - 1);
    panY -= cy * (k - 1);
  }
  zoom = next;
  applyTransform();
}

stageInner.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * 0.0015);
  setZoom(zoom * factor, e.clientX, e.clientY);
}, { passive: false });

let dragging = false, dragOrigin = null;
stageInner.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragging = true;
  dragOrigin = { x: e.clientX - panX, y: e.clientY - panY };
  stageInner.classList.add('dragging');
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  panX = e.clientX - dragOrigin.x;
  panY = e.clientY - dragOrigin.y;
  applyTransform();
});
window.addEventListener('mouseup', () => {
  dragging = false;
  stageInner.classList.remove('dragging');
});

$('zoomIn').addEventListener('click', () => setZoom(zoom * 1.25));
$('zoomOut').addEventListener('click', () => setZoom(zoom / 1.25));
$('zoomReset').addEventListener('click', () => { zoom = 1; panX = 0; panY = 0; applyTransform(); });

// drag-drop on stage
const stage = document.querySelector('.stage');
['dragenter','dragover'].forEach((e) => stage.addEventListener(e, (ev) => { ev.preventDefault(); stage.style.outline = '2px dashed var(--accent)'; stage.style.outlineOffset = '-12px'; }));
['dragleave','drop'].forEach((e) => stage.addEventListener(e, (ev) => { ev.preventDefault(); stage.style.outline = ''; }));
stage.addEventListener('drop', (ev) => {
  ev.preventDefault();
  const f = ev.dataTransfer.files[0];
  if (f) loadFile(f);
});

// drag-drop on the Choose file button itself
const fileBtn = $('fileBtn');
['dragenter','dragover'].forEach((e) => fileBtn.addEventListener(e, (ev) => {
  ev.preventDefault(); ev.stopPropagation();
  fileBtn.classList.add('dragover');
}));
['dragleave','drop'].forEach((e) => fileBtn.addEventListener(e, (ev) => {
  ev.preventDefault(); ev.stopPropagation();
  fileBtn.classList.remove('dragover');
}));
fileBtn.addEventListener('drop', (ev) => {
  ev.preventDefault(); ev.stopPropagation();
  const f = ev.dataTransfer.files[0];
  if (f) loadFile(f);
});
// suppress default browser open-file when missing the drop zone
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ---------- presets: persistence + apply ----------
const PRESETS_KEY = 'dither-studio-presets-v1';

function loadStoredPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}'); }
  catch { return {}; }
}
function saveStoredPresets(p) { localStorage.setItem(PRESETS_KEY, JSON.stringify(p)); }

function captureSettings() {
  return {
    gridCells: state.gridCells,
    aspect: state.aspect,
    bgOn: state.bgOn,
    bgColor: state.bgColor,
    svgs: [...state.svgs],
    colors: [...state.colors],
    enabled: [...state.enabled],
    invert: state.invert,
    scaleMin: state.scaleMin,
    scaleMax: state.scaleMax,
    rotation: state.rotation,
    randomRot: state.randomRot,
  };
}

async function applyPreset(s) {
  if (!s) return;
  // Mutate state.
  Object.assign(state, {
    gridCells: s.gridCells ?? state.gridCells,
    aspect: s.aspect ?? state.aspect,
    bgOn: s.bgOn ?? state.bgOn,
    bgColor: s.bgColor ?? state.bgColor,
    svgs: s.svgs ? [...s.svgs] : state.svgs,
    colors: s.colors ? [...s.colors] : state.colors,
    enabled: s.enabled ? [...s.enabled] : state.enabled,
    invert: s.invert ?? state.invert,
    scaleMin: s.scaleMin ?? state.scaleMin,
    scaleMax: s.scaleMax ?? state.scaleMax,
    rotation: s.rotation ?? state.rotation,
    randomRot: s.randomRot ?? state.randomRot,
  });
  // Sync UI controls.
  $('grid').value = state.gridCells; $('gridVal').textContent = state.gridCells;
  $('aspect').value = state.aspect;
  $('bgOn').checked = state.bgOn;
  $('bgColor').value = state.bgColor;
  $('invert').checked = state.invert;
  const sMin = Math.round(state.scaleMin * 100), sMax = Math.round(state.scaleMax * 100);
  $('scaleMin').value = sMin; $('scaleMinVal').textContent = `${sMin}%`;
  $('scaleMax').value = sMax; $('scaleMaxVal').textContent = `${sMax}%`;
  $('rotation').value = String(state.rotation);
  $('randomRot').checked = state.randomRot;
  renderSlots();
  try {
    await rebuildShapeCache();
  } catch (err) {
    // Don't let one bad SVG block the rest of the preset (background, grid, etc.)
    console.warn('Some preset shapes failed to load:', err);
  }
  requestRender();
}

function refreshSavedDropdown(selectName = '') {
  const sel = $('savedPreset');
  const stored = loadStoredPresets();
  const names = Object.keys(stored).sort((a,b) => a.localeCompare(b));
  sel.innerHTML = names.length
    ? '<option value="">— pick one —</option>' + names.map((n) => `<option value="${n}">${n}</option>`).join('')
    : '<option value="">— none saved —</option>';
  if (selectName && names.includes(selectName)) sel.value = selectName;
  $('deletePreset').disabled = !sel.value;
}

$('starterPreset').addEventListener('change', async (e) => {
  const key = e.target.value;
  e.target.value = ''; // reset first so re-selecting same preset still triggers
  if (!key) return;
  const preset = BUILTIN_PRESETS[key] || SERPIER_PRESETS[key];
  if (preset) await applyPreset(preset.settings);
});

$('savedPreset').addEventListener('change', async (e) => {
  const name = e.target.value;
  $('deletePreset').disabled = !name;
  if (!name) return;
  const stored = loadStoredPresets();
  if (stored[name]) await applyPreset(stored[name]);
});

$('savePreset').addEventListener('click', () => {
  const name = prompt('Name this preset:');
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  const stored = loadStoredPresets();
  if (stored[trimmed] && !confirm(`Overwrite "${trimmed}"?`)) return;
  stored[trimmed] = captureSettings();
  saveStoredPresets(stored);
  refreshSavedDropdown(trimmed);
});

$('deletePreset').addEventListener('click', () => {
  const sel = $('savedPreset');
  const name = sel.value;
  if (!name) return;
  if (!confirm(`Delete preset "${name}"?`)) return;
  const stored = loadStoredPresets();
  delete stored[name];
  saveStoredPresets(stored);
  refreshSavedDropdown();
});

refreshSavedDropdown();

// Populate the built-in / Serpier preset dropdown from the JS maps so adding
// a preset is a one-place change.
function populateBuiltinDropdown() {
  const sel = $('starterPreset');
  sel.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— pick one —';
  sel.appendChild(placeholder);

  const addGroup = (label, map) => {
    const keys = Object.keys(map);
    if (!keys.length) return;
    const g = document.createElement('optgroup');
    g.label = label;
    for (const k of keys) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = map[k].label || k;
      g.appendChild(o);
    }
    sel.appendChild(g);
  };
  addGroup('Built-in', BUILTIN_PRESETS);
  addGroup('Serpier', SERPIER_PRESETS);
}
populateBuiltinDropdown();

// Export / import user presets as a JSON file — lets colleagues move presets
// between devices or share them with each other without a backend.
$('exportPresets').addEventListener('click', () => {
  const stored = loadStoredPresets();
  if (!Object.keys(stored).length) {
    alert('You have no saved presets yet. Use "Save current as…" first.');
    return;
  }
  const payload = { version: 1, exportedAt: new Date().toISOString(), presets: stored };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  downloadBlob(blob, 'dithering-studio-presets.json');
});

$('importPresets').addEventListener('click', () => $('importPresetsFile').click());

$('importPresetsFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  let payload;
  try { payload = JSON.parse(await f.text()); }
  catch { alert('Could not read that file — is it a valid presets JSON?'); return; }
  const incoming = payload?.presets && typeof payload.presets === 'object'
    ? payload.presets
    : (payload && typeof payload === 'object' ? payload : null);
  if (!incoming) { alert('No presets found in that file.'); return; }
  const stored = loadStoredPresets();
  const existing = new Set(Object.keys(stored));
  const collisions = Object.keys(incoming).filter((k) => existing.has(k));
  let mode = 'merge';
  if (collisions.length) {
    const overwrite = confirm(
      `${collisions.length} preset name${collisions.length === 1 ? '' : 's'} already exist (${collisions.slice(0, 3).join(', ')}${collisions.length > 3 ? '…' : ''}).\n\nOK = overwrite. Cancel = keep yours, rename incoming.`
    );
    mode = overwrite ? 'overwrite' : 'rename';
  }
  let count = 0;
  for (const [name, settings] of Object.entries(incoming)) {
    if (!settings || typeof settings !== 'object') continue;
    let key = name;
    if (mode === 'rename' && existing.has(key)) {
      let i = 2;
      while (existing.has(`${name} (${i})`)) i++;
      key = `${name} (${i})`;
    }
    stored[key] = settings;
    existing.add(key);
    count++;
  }
  saveStoredPresets(stored);
  refreshSavedDropdown();
  alert(`Imported ${count} preset${count === 1 ? '' : 's'}.`);
});

// init
renderSlots();
rebuildShapeCache().then(async () => {
  // Show the empty-state hint while we try to fetch the default demo asset.
  view.width = 480; view.height = 480;
  vctx.fillStyle = '#0a0a0a';
  vctx.fillRect(0,0,view.width,view.height);
  vctx.fillStyle = '#666';
  vctx.font = '14px -apple-system, sans-serif';
  vctx.textAlign = 'center';
  vctx.fillText('Loading demo…', 240, 240);

  // Boot the tool with the Serpier logo + Riso Lines preset so visitors see
  // what the dither does without having to upload anything. If the asset is
  // missing or fails to load, fall back silently to the empty state.
  try {
    const res = await fetch('default.gif', { cache: 'force-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const file = new File([blob], 'default.gif', { type: 'image/gif' });
    await loadFile(file);
    await applyPreset(BUILTIN_PRESETS.riso.settings);
  } catch (e) {
    console.warn('Default demo asset not loaded:', e);
    vctx.fillStyle = '#0a0a0a';
    vctx.fillRect(0,0,view.width,view.height);
    vctx.fillStyle = '#666';
    vctx.fillText('Drop an image, GIF, or video — or click "Choose file"', 240, 240);
  }
});
