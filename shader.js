// Shader Studio — animated WebGL background shaders with copy-paste code export.
// Sibling module to the Dithering Studio (app.js). Shares the page via a mode
// toggle; all shader logic is isolated here so the dither tool is untouched.

import { GIFEncoder, quantize, applyPalette } from './gifenc.js';

const $ = (id) => document.getElementById(id);

// ---------- colour helpers ----------
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const r4 = (x) => Math.round(x * 1e4) / 1e4;

// ---------- shared GLSL helpers (embedded per preset so exports stand alone) ----------
const GLSL_HEAD = `precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
`;

const GLSL_BAYER = `
float Bayer2(vec2 a){ a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float Bayer4(vec2 a){ return Bayer2(0.5 * a) * 0.25 + Bayer2(a); }
float Bayer8(vec2 a){ return Bayer4(0.5 * a) * 0.25 + Bayer2(a); }
`;

const GLSL_NOISE = `
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * noise(p); p *= 2.0; a *= 0.5; } return s; }
`;

// ---------- presets ----------
// Each preset: id, name, component (export name), speed default, controls[].
// control = { key, label, group, min, max, step, value }  (numeric uniform)
//         | { key, label, group, type:'color', value:'#rrggbb' }
const PRESETS = [
  {
    id: 'plasma',
    name: 'Dithered Plasma',
    component: 'PlasmaBackground',
    speed: 0.6,
    controls: [
      { key: 'u_bg', label: 'Background', group: 'Colors', type: 'color', value: '#2b34ff' },
      { key: 'u_dot', label: 'Dot color', group: 'Colors', type: 'color', value: '#ffffff' },
      { key: 'u_pixelSize', label: 'Pixel size', group: 'Dither', min: 1, max: 24, step: 1, value: 6 },
      { key: 'u_threshold', label: 'Threshold', group: 'Dither', min: 0, max: 1, step: 0.01, value: 0.5 },
      { key: 'u_intensity', label: 'Plasma intensity', group: 'Plasma', min: 1, max: 8, step: 0.05, value: 3.5 },
      { key: 'u_contrast', label: 'Plasma contrast', group: 'Plasma', min: 0.5, max: 3, step: 0.01, value: 1.3 },
      { key: '__speed', label: 'Animation speed', group: 'Animation', min: 0, max: 2, step: 0.01, value: 0.6 },
    ],
    frag: GLSL_HEAD + `
uniform float u_pixelSize, u_threshold, u_intensity, u_contrast, u_transparent;
uniform vec3 u_bg, u_dot;
` + GLSL_BAYER + `
void main(){
  vec2 cell = floor(gl_FragCoord.xy / u_pixelSize);
  vec2 uv = (cell * u_pixelSize) / u_resolution;
  float t = u_time;
  vec2 p = uv * u_intensity;
  float v = sin(p.x * 3.0 + t)
          + sin(p.y * 3.0 + t * 1.3)
          + sin((p.x + p.y) * 2.0 + t * 0.7);
  vec2 q = p * 1.5 + vec2(sin(t * 0.4), cos(t * 0.5));
  v += sin(length(q) * 3.0 - t * 1.2);
  v *= 0.25;
  float lum = clamp((v * 0.5 + 0.5 - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  float dither = Bayer8(cell);
  float on = step(dither, lum - (u_threshold - 0.5));
  float a = mix(1.0, on, u_transparent);   // transparent mode -> only dots are opaque
  gl_FragColor = vec4(mix(u_bg, u_dot, on), a);
}`,
  },

  {
    id: 'herobottom',
    name: 'Hero Bottom (Plasma)',
    component: 'HeroPlasmaBottom',
    speed: 0.5,
    controls: [
      { key: 'u_bg', label: 'Shape color', group: 'Colors', type: 'color', value: '#2b34ff' },
      { key: 'u_dot', label: 'Dot color', group: 'Colors', type: 'color', value: '#ffffff' },
      { key: 'u_height', label: 'Height', group: 'Shape', min: 0.1, max: 0.95, step: 0.01, value: 0.5 },
      { key: 'u_curve', label: 'Edge lift', group: 'Shape', min: 0, max: 0.6, step: 0.01, value: 0.18 },
      { key: 'u_wave', label: 'Wave', group: 'Shape', min: 0, max: 0.2, step: 0.005, value: 0.05 },
      { key: 'u_softness', label: 'Edge fade', group: 'Shape', min: 0.02, max: 0.6, step: 0.01, value: 0.32 },
      { key: 'u_pixelSize', label: 'Pixel size', group: 'Dither', min: 1, max: 24, step: 1, value: 6 },
      { key: 'u_threshold', label: 'Threshold', group: 'Dither', min: 0, max: 1, step: 0.01, value: 0.5 },
      { key: 'u_intensity', label: 'Plasma intensity', group: 'Plasma', min: 1, max: 8, step: 0.05, value: 3.5 },
      { key: 'u_contrast', label: 'Plasma contrast', group: 'Plasma', min: 0.5, max: 3, step: 0.01, value: 1.3 },
      { key: '__speed', label: 'Animation speed', group: 'Animation', min: 0, max: 2, step: 0.01, value: 0.5 },
    ],
    frag: GLSL_HEAD + `
uniform float u_pixelSize, u_threshold, u_intensity, u_contrast;
uniform float u_height, u_curve, u_wave, u_softness;
uniform vec3 u_bg, u_dot;
` + GLSL_BAYER + `
void main(){
  vec2 cell = floor(gl_FragCoord.xy / u_pixelSize);
  vec2 uv = (cell * u_pixelSize) / u_resolution;   // y is 0 at bottom, 1 at top
  float t = u_time;
  vec2 p = uv * u_intensity;
  float v = sin(p.x * 3.0 + t)
          + sin(p.y * 3.0 + t * 1.3)
          + sin((p.x + p.y) * 2.0 + t * 0.7);
  vec2 q = p * 1.5 + vec2(sin(t * 0.4), cos(t * 0.5));
  v += sin(length(q) * 3.0 - t * 1.2);
  v *= 0.25;
  float lum = clamp((v * 0.5 + 0.5 - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  float on = step(Bayer8(cell), lum - (u_threshold - 0.5));
  vec3 col = mix(u_bg, u_dot, on);

  // Wavy shape rising from the bottom: higher at the sides, dipping in the centre.
  float valley = cos(uv.x * 6.2831) * 0.5 + 0.5;      // 1 at edges, 0 at centre
  float wave = sin(uv.x * 6.2831 * 1.5 + t * 0.6);
  float boundary = u_height + valley * u_curve + wave * u_wave;
  float fill = clamp((boundary - uv.y) / max(u_softness, 0.001), 0.0, 1.0);
  float a = 1.0 - step(fill, Bayer8(cell + 17.0));    // dotty edge; fill=0 -> fully clear
  gl_FragColor = vec4(col, a);
}`,
  },

  {
    id: 'fire',
    name: 'Dithered Fire',
    component: 'FireBackground',
    speed: 1.0,
    controls: [
      { key: 'u_c1', label: 'Flame core (base)', group: 'Colors', type: 'color', value: '#ffd24d' },
      { key: 'u_c2', label: 'Mid', group: 'Colors', type: 'color', value: '#ff6a00' },
      { key: 'u_c3', label: 'Tip', group: 'Colors', type: 'color', value: '#b3261a' },
      { key: 'u_height', label: 'Flame height', group: 'Fire', min: 0.2, max: 1, step: 0.01, value: 0.85 },
      { key: 'u_falloff', label: 'Falloff', group: 'Fire', min: 0.5, max: 5, step: 0.05, value: 2.0 },
      { key: 'u_intensity', label: 'Intensity', group: 'Fire', min: 0.5, max: 4, step: 0.05, value: 1.8 },
      { key: 'u_scale', label: 'Detail', group: 'Fire', min: 1, max: 8, step: 0.1, value: 3.0 },
      { key: 'u_riseSpeed', label: 'Rise speed', group: 'Fire', min: 0, max: 3, step: 0.05, value: 1.2 },
      { key: 'u_base', label: 'Base height', group: 'Fire', min: 0, max: 0.6, step: 0.01, value: 0.12 },
      { key: 'u_pixelSize', label: 'Pixel size', group: 'Dither', min: 1, max: 24, step: 1, value: 6 },
      { key: 'u_levels', label: 'Color steps', group: 'Dither', min: 3, max: 8, step: 1, value: 5 },
      { key: '__speed', label: 'Animation speed', group: 'Animation', min: 0, max: 2, step: 0.01, value: 1.0 },
    ],
    frag: GLSL_HEAD + `
uniform float u_pixelSize, u_levels, u_scale, u_intensity, u_height, u_falloff, u_riseSpeed, u_base;
uniform vec3 u_c1, u_c2, u_c3;
` + GLSL_NOISE + GLSL_BAYER + `
void main(){
  vec2 cell = floor(gl_FragCoord.xy / u_pixelSize);
  vec2 uv = (cell * u_pixelSize) / u_resolution;   // y is 0 at bottom, 1 at top
  float t = u_time;
  // Rising, domain-warped noise makes the flame licks.
  vec2 sp = vec2(uv.x * u_scale, uv.y * u_scale - t * u_riseSpeed);
  float n1 = fbm(sp);
  float n2 = fbm(sp * 2.0 + vec2(n1 * 1.5, -t * u_riseSpeed));
  float n = mix(n1, n2, 0.6);
  // Confine the heat to the bottom and let it taper off upward.
  float grad = clamp((u_height - uv.y) / max(u_height, 0.001), 0.0, 1.0);
  grad = pow(grad, u_falloff);
  float heat = clamp(n * u_intensity * grad, 0.0, 1.0);
  float baseWave = (fbm(vec2(uv.x * 2.5, 7.3)) - 0.5) * 0.12;        // static wavy boundary
  float baseTop = u_base + baseWave;
  heat = max(heat, 1.0 - smoothstep(baseTop, baseTop + 0.22, uv.y)); // solid base, organic dithered dissolve upward
  // Ordered-dithered posterization — the plasma "pixel dither" look.
  float lv = max(2.0, u_levels);
  float q = clamp(floor(heat * (lv - 1.0) + Bayer8(cell)) / (lv - 1.0), 0.0, 1.0);
  float qStep = 1.0 / (lv - 1.0);
  float a = step(qStep * 0.5, q);   // lowest band -> clear; dotty flame tips
  // s: 0 at coolest visible band (tips) .. 1 at hottest base (core).
  float s = clamp((q - qStep) / max(1.0 - qStep, 0.001), 0.0, 1.0);
  vec3 col = mix(u_c3, u_c2, smoothstep(0.0, 0.5, s));   // tip -> mid
  col = mix(col, u_c1, smoothstep(0.5, 1.0, s));          // mid -> core (base)
  gl_FragColor = vec4(col, a);
}`,
  },

  {
    id: 'flames',
    name: 'Dithered Flames (separate)',
    component: 'FlamesBackground',
    speed: 1.0,
    controls: [
      { key: 'u_c1', label: 'Flame core (base)', group: 'Colors', type: 'color', value: '#ffd24d' },
      { key: 'u_c2', label: 'Mid', group: 'Colors', type: 'color', value: '#ff6a00' },
      { key: 'u_c3', label: 'Tip', group: 'Colors', type: 'color', value: '#b3261a' },
      { key: 'u_count', label: 'Flame count', group: 'Flames', min: 3, max: 16, step: 1, value: 7 },
      { key: 'u_separation', label: 'Separation', group: 'Flames', min: 1, max: 6, step: 0.1, value: 2.6 },
      { key: 'u_height', label: 'Flame height', group: 'Flames', min: 0.2, max: 1, step: 0.01, value: 0.8 },
      { key: 'u_falloff', label: 'Falloff', group: 'Flames', min: 0.5, max: 5, step: 0.05, value: 1.6 },
      { key: 'u_intensity', label: 'Intensity', group: 'Flames', min: 0.5, max: 4, step: 0.05, value: 2.0 },
      { key: 'u_scale', label: 'Detail', group: 'Flames', min: 1, max: 8, step: 0.1, value: 3.0 },
      { key: 'u_riseSpeed', label: 'Rise speed', group: 'Flames', min: 0, max: 3, step: 0.05, value: 1.4 },
      { key: 'u_base', label: 'Base height', group: 'Flames', min: 0, max: 0.6, step: 0.01, value: 0.12 },
      { key: 'u_pixelSize', label: 'Pixel size', group: 'Dither', min: 1, max: 24, step: 1, value: 6 },
      { key: 'u_levels', label: 'Color steps', group: 'Dither', min: 3, max: 8, step: 1, value: 5 },
      { key: '__speed', label: 'Animation speed', group: 'Animation', min: 0, max: 2, step: 0.01, value: 1.0 },
    ],
    frag: GLSL_HEAD + `
uniform float u_pixelSize, u_levels, u_scale, u_intensity, u_height, u_falloff, u_riseSpeed, u_count, u_separation, u_base;
uniform vec3 u_c1, u_c2, u_c3;
` + GLSL_NOISE + GLSL_BAYER + `
void main(){
  vec2 cell = floor(gl_FragCoord.xy / u_pixelSize);
  vec2 uv = (cell * u_pixelSize) / u_resolution;
  float t = u_time;
  vec2 sp = vec2(uv.x * u_scale, uv.y * u_scale - t * u_riseSpeed);
  float n1 = fbm(sp);
  float n2 = fbm(sp * 2.0 + vec2(n1 * 1.5, -t * u_riseSpeed));
  float n = mix(n1, n2, 0.6);
  float grad = clamp((u_height - uv.y) / max(u_height, 0.001), 0.0, 1.0);
  grad = pow(grad, u_falloff);
  float heat = clamp(n * u_intensity * grad, 0.0, 1.0);
  // Carve the heat into separate tongues that merge at the base and split as they rise.
  float wob = fbm(vec2(uv.x * 3.0, -t * u_riseSpeed)) * 1.2;
  float comb = 0.5 + 0.5 * sin((uv.x * u_count + wob) * 6.2831);
  comb = pow(comb, u_separation);
  float sep = mix(1.0, comb, smoothstep(0.0, u_height * 0.6, uv.y));
  heat *= sep;
  float baseWave = (fbm(vec2(uv.x * 2.5, 7.3)) - 0.5) * 0.12;        // static wavy boundary
  float baseTop = u_base + baseWave;
  heat = max(heat, 1.0 - smoothstep(baseTop, baseTop + 0.22, uv.y)); // solid base, organic dithered dissolve upward
  float lv = max(2.0, u_levels);
  float q = clamp(floor(heat * (lv - 1.0) + Bayer8(cell)) / (lv - 1.0), 0.0, 1.0);
  float qStep = 1.0 / (lv - 1.0);
  // s: 0 at the coolest visible band (flame tips) .. 1 at the hottest base (core).
  // Mapping over the visible range makes picked colours land exactly on the bands.
  float s = clamp((q - qStep) / max(1.0 - qStep, 0.001), 0.0, 1.0);
  vec3 col = mix(u_c3, u_c2, smoothstep(0.0, 0.5, s));   // tip -> mid
  col = mix(col, u_c1, smoothstep(0.5, 1.0, s));          // mid -> core (base)
  float a = step(0.5 / (lv - 1.0), q);
  gl_FragColor = vec4(col, a);
}`,
  },

  {
    id: 'aurora',
    name: 'Flowing Aurora',
    component: 'AuroraBackground',
    speed: 0.4,
    controls: [
      { key: 'u_c1', label: 'Color 1', group: 'Colors', type: 'color', value: '#0b1e3a' },
      { key: 'u_c2', label: 'Color 2', group: 'Colors', type: 'color', value: '#2e6df6' },
      { key: 'u_c3', label: 'Color 3', group: 'Colors', type: 'color', value: '#36e0c0' },
      { key: 'u_scale', label: 'Scale', group: 'Pattern', min: 0.5, max: 4, step: 0.05, value: 1.5 },
      { key: 'u_contrast', label: 'Contrast', group: 'Pattern', min: 0.5, max: 2, step: 0.01, value: 1.0 },
      { key: '__speed', label: 'Animation speed', group: 'Animation', min: 0, max: 2, step: 0.01, value: 0.4 },
    ],
    frag: GLSL_HEAD + `
uniform float u_scale, u_contrast;
uniform vec3 u_c1, u_c2, u_c3;
void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.x *= u_resolution.x / u_resolution.y;
  float t = u_time;
  float a = sin(uv.x * u_scale * 2.0 + t)
          + sin(uv.y * u_scale * 3.0 - t * 0.8)
          + sin((uv.x + uv.y) * u_scale * 1.5 + t * 0.6);
  float b = cos(uv.y * u_scale * 2.5 + t * 0.7)
          + sin(length(uv - 0.5) * u_scale * 4.0 - t);
  a /= 3.0; b /= 2.0;
  float m1 = clamp(0.5 + 0.5 * a * u_contrast, 0.0, 1.0);
  float m2 = clamp(0.5 + 0.5 * b * u_contrast, 0.0, 1.0);
  vec3 col = mix(u_c1, u_c2, m1);
  col = mix(col, u_c3, m2 * 0.6);
  gl_FragColor = vec4(col, 1.0);
}`,
  },

  {
    id: 'warp',
    name: 'Warp / Fractal Noise',
    component: 'WarpBackground',
    speed: 1.0,
    controls: [
      { key: 'u_lo', label: 'Low color', group: 'Colors', type: 'color', value: '#071a2c' },
      { key: 'u_hi', label: 'High color', group: 'Colors', type: 'color', value: '#38bdf8' },
      { key: 'u_scale', label: 'Scale', group: 'Pattern', min: 1, max: 8, step: 0.05, value: 3.0 },
      { key: 'u_warp', label: 'Warp amount', group: 'Pattern', min: 0, max: 6, step: 0.05, value: 3.5 },
      { key: 'u_contrast', label: 'Contrast', group: 'Pattern', min: 0.5, max: 2.5, step: 0.01, value: 1.3 },
      { key: '__speed', label: 'Animation speed', group: 'Animation', min: 0, max: 2, step: 0.01, value: 1.0 },
    ],
    frag: GLSL_HEAD + `
uniform float u_scale, u_warp, u_contrast;
uniform vec3 u_lo, u_hi;
` + GLSL_NOISE + `
void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.x *= u_resolution.x / u_resolution.y;
  float t = u_time * 0.2;
  vec2 p = uv * u_scale;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3 - t)));
  vec2 r = vec2(fbm(p + u_warp * q + vec2(1.7, 9.2) + t), fbm(p + u_warp * q + vec2(8.3, 2.8) - t));
  float f = fbm(p + u_warp * r);
  f = clamp((f - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  vec3 col = mix(u_lo, u_hi, f);
  col = mix(col, u_hi, dot(r, r) * 0.15);
  gl_FragColor = vec4(col, 1.0);
}`,
  },

  {
    id: 'grid',
    name: 'Animated Grid / Wave',
    component: 'GridBackground',
    speed: 1.0,
    controls: [
      { key: 'u_bg', label: 'Background', group: 'Colors', type: 'color', value: '#05080f' },
      { key: 'u_line', label: 'Line color', group: 'Colors', type: 'color', value: '#00e0ff' },
      { key: 'u_grid', label: 'Grid size', group: 'Pattern', min: 4, max: 40, step: 1, value: 14 },
      { key: 'u_thickness', label: 'Line width', group: 'Pattern', min: 0.01, max: 0.2, step: 0.005, value: 0.04 },
      { key: 'u_glow', label: 'Glow', group: 'Pattern', min: 0, max: 1, step: 0.01, value: 0.6 },
      { key: '__speed', label: 'Animation speed', group: 'Animation', min: 0, max: 2, step: 0.01, value: 1.0 },
    ],
    frag: GLSL_HEAD + `
uniform float u_grid, u_thickness, u_glow;
uniform vec3 u_bg, u_line;
void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.x *= u_resolution.x / u_resolution.y;
  float t = u_time;
  uv.y += sin(uv.x * 6.0 + t) * 0.05;
  uv.x += cos(uv.y * 6.0 + t * 0.8) * 0.03;
  vec2 g = fract(uv * u_grid);
  vec2 d = abs(g - 0.5);
  float e = max(d.x, d.y);
  float line = smoothstep(0.5 - u_thickness, 0.5, e);
  float band = 0.5 + 0.5 * sin(uv.x * 2.0 - uv.y * 2.0 + t * 1.5);
  float intensity = line * (0.4 + u_glow * band);
  vec3 col = mix(u_bg, u_line, clamp(intensity, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`,
  },

  {
    id: 'voronoi',
    name: 'Voronoi Cells',
    component: 'VoronoiBackground',
    speed: 1.0,
    controls: [
      { key: 'u_c1', label: 'Cell color', group: 'Colors', type: 'color', value: '#0a0f2c' },
      { key: 'u_c2', label: 'Edge color', group: 'Colors', type: 'color', value: '#6ee7ff' },
      { key: 'u_scale', label: 'Scale', group: 'Pattern', min: 2, max: 14, step: 0.1, value: 6.0 },
      { key: 'u_edge', label: 'Edge width', group: 'Pattern', min: 0.02, max: 0.5, step: 0.005, value: 0.12 },
      { key: '__speed', label: 'Animation speed', group: 'Animation', min: 0, max: 2, step: 0.01, value: 1.0 },
    ],
    frag: GLSL_HEAD + `
uniform float u_scale, u_edge;
uniform vec3 u_c1, u_c2;
vec2 hash2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.x *= u_resolution.x / u_resolution.y;
  float t = u_time;
  vec2 p = uv * u_scale;
  vec2 g = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 c = hash2(g + o);
      c = 0.5 + 0.5 * sin(t + 6.2831 * c);
      float d = length(o + c - f);
      if (d < d1) { d2 = d1; d1 = d; }
      else if (d < d2) { d2 = d; }
    }
  }
  float edge = smoothstep(0.0, u_edge, d2 - d1);
  vec3 col = mix(u_c1, u_c2, d1);
  col = mix(u_c2 * 0.2, col, edge);
  gl_FragColor = vec4(col, 1.0);
}`,
  },

  {
    id: 'blackhole',
    name: 'Black Hole (particles)',
    component: 'BlackHoleBackground',
    speed: 1.0,
    controls: [
      { key: 'u_bg', label: 'Background', group: 'Colors', type: 'color', value: '#113BFF' },
      { key: 'u_fg', label: 'Particle / core', group: 'Colors', type: 'color', value: '#ffffff' },
      { key: 'u_core', label: 'Core size', group: 'Black hole', min: 0, max: 0.5, step: 0.005, value: 0.0 },
      { key: 'u_count', label: 'Particles', group: 'Black hole', min: 1, max: 40, step: 1, value: 10 },
      { key: 'u_size', label: 'Particle size (px)', group: 'Black hole', min: 1, max: 20, step: 0.5, value: 2 },
      { key: 'u_reach', label: 'Reach', group: 'Black hole', min: 0.2, max: 1.2, step: 0.01, value: 0.75 },
      { key: 'u_rate', label: 'Emit rate', group: 'Black hole', min: 0.1, max: 3, step: 0.05, value: 0.7 },
      { key: 'u_swirl', label: 'Swirl', group: 'Black hole', min: -2, max: 2, step: 0.01, value: 0.2 },
      { key: 'u_pixelSize', label: 'Pixel size', group: 'Dither', min: 1, max: 24, step: 1, value: 6 },
      { key: 'u_levels', label: 'Color steps', group: 'Dither', min: 2, max: 8, step: 1, value: 4 },
      { key: '__speed', label: 'Animation speed', group: 'Animation', min: 0, max: 3, step: 0.01, value: 1.0 },
    ],
    frag: GLSL_HEAD + `
uniform float u_pixelSize, u_levels, u_core, u_count, u_size, u_reach, u_rate, u_swirl, u_transparent;
uniform vec3 u_bg, u_fg;
` + GLSL_BAYER + `
float h11(float n){ return fract(sin(n * 127.1) * 43758.5453); }
void main(){
  vec2 cell = floor(gl_FragCoord.xy / u_pixelSize);
  vec2 frag = (cell + 0.5) * u_pixelSize;
  float minDim = min(u_resolution.x, u_resolution.y);
  vec2 p = (frag - 0.5 * u_resolution) / minDim;   // centred, aspect-correct
  float cellN = u_pixelSize / minDim;              // one pixel cell, in p-units
  float t = u_time;
  float val = 0.0;
  // Discrete particles: each repeatedly spawns at the centre and flies out
  // along a fresh random angle, so only a few pixels stream out at a time.
  int count = int(u_count);
  for (int i = 0; i < 40; i++) {
    if (i >= count) break;
    float fi = float(i);
    float ph = t * u_rate + h11(fi * 1.7);
    float cyc = floor(ph);
    float life = fract(ph);                                  // 0..1 flight progress
    float ang = h11(fi * 3.3 + cyc * 5.1) * 6.2831 + t * u_swirl;
    float spd = 0.55 + 0.9 * h11(fi * 2.1 + cyc * 1.7);
    float rad = life * u_reach * spd;                        // outward from centre
    vec2 pp = vec2(cos(ang), sin(ang)) * rad;
    vec2 dCell = (p - pp) / cellN;                           // delta in pixel cells
    float hsz = u_size * 0.5;
    float sq = step(abs(dCell.x), hsz) * step(abs(dCell.y), hsz); // SOLID hard square
    sq *= step(life, 0.92);                                  // blink off briefly before respawn
    val = max(val, sq);
  }
  float r = length(p);
  val = max(val, 1.0 - step(u_core, r));                     // solid central core (0 = none)
  val = clamp(val, 0.0, 1.0);
  float lv = max(2.0, u_levels);
  float q = clamp(floor(val * (lv - 1.0) + Bayer8(cell)) / (lv - 1.0), 0.0, 1.0);
  vec3 col = mix(u_bg, u_fg, q);
  float a = mix(1.0, q, u_transparent);
  gl_FragColor = vec4(col, a);
}`,
  },

  {
    id: 'blackhole2',
    name: 'Black Hole v2 (rays)',
    component: 'BlackHoleRaysBackground',
    speed: 1.0,
    controls: [
      { key: 'u_bg', label: 'Background', group: 'Colors', type: 'color', value: '#113BFF' },
      { key: 'u_fg', label: 'Particle / core', group: 'Colors', type: 'color', value: '#ffffff' },
      { key: 'u_core', label: 'Core size', group: 'Black hole', min: 0, max: 0.5, step: 0.005, value: 0.0 },
      { key: 'u_intensity', label: 'Intensity', group: 'Black hole', min: 0.3, max: 4, step: 0.05, value: 1.8 },
      { key: 'u_density', label: 'Particle density', group: 'Black hole', min: 1, max: 12, step: 0.1, value: 5.0 },
      { key: 'u_falloff', label: 'Spread / fade', group: 'Black hole', min: 0.5, max: 6, step: 0.05, value: 2.5 },
      { key: 'u_swirl', label: 'Swirl', group: 'Black hole', min: -2, max: 2, step: 0.01, value: 0.4 },
      { key: 'u_pixelSize', label: 'Pixel size', group: 'Dither', min: 1, max: 24, step: 1, value: 6 },
      { key: 'u_levels', label: 'Color steps', group: 'Dither', min: 2, max: 8, step: 1, value: 4 },
      { key: '__speed', label: 'Animation speed', group: 'Animation', min: 0, max: 3, step: 0.01, value: 1.0 },
    ],
    frag: GLSL_HEAD + `
uniform float u_pixelSize, u_levels, u_core, u_intensity, u_density, u_falloff, u_swirl, u_transparent;
uniform vec3 u_bg, u_fg;
` + GLSL_NOISE + GLSL_BAYER + `
void main(){
  vec2 cell = floor(gl_FragCoord.xy / u_pixelSize);
  vec2 frag = (cell + 0.5) * u_pixelSize;
  vec2 p = (frag - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y); // centred, aspect-correct
  float r = length(p) + 1e-4;
  float ang = atan(p.y, p.x) + u_time * u_swirl;       // swirl over time
  float t = u_time;
  // Particles stream outward: noise scrolls along radius, varies around angle.
  float stream = fbm(vec2(ang * u_density, r * u_density - t));
  float fine = fbm(vec2(ang * u_density * 2.0 + t * 0.3, r * u_density * 2.0 - t * 1.7));
  float field = mix(stream, fine, 0.5);
  float fade = exp(-r * u_falloff);                    // particles thin out with distance
  float particles = field * fade * u_intensity;
  float core = 1.0 - smoothstep(u_core * 0.6, u_core, r); // bright centre, 0 size = none
  float val = clamp(max(core, particles), 0.0, 1.0);
  float lv = max(2.0, u_levels);
  float q = clamp(floor(val * (lv - 1.0) + Bayer8(cell)) / (lv - 1.0), 0.0, 1.0);
  vec3 col = mix(u_bg, u_fg, q);
  float a = mix(1.0, q, u_transparent);                // transparent -> only particles/core opaque
  gl_FragColor = vec4(col, a);
}`,
  },
];

// ---------- live state ----------
const state = {
  presetId: PRESETS[0].id,
  values: {}, // key -> number | hex string
  transparentBg: false,
  canvas: { mode: 'fit', w: 1080, h: 1080 }, // mode: 'fit' (fill stage) | 'fixed'
};

// Aspect presets -> default pixel sizes.
const RATIOS = {
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '9:16': [1080, 1920],
  '16:9': [1920, 1080],
};
function presetById(id) { return PRESETS.find((p) => p.id === id) || PRESETS[0]; }
function loadPresetDefaults(preset) {
  state.presetId = preset.id;
  state.values = {};
  for (const c of preset.controls) state.values[c.key] = c.value;
}

// ---------- WebGL renderer ----------
let gl = null, canvas = null, program = null, locs = {}, quadBuf = null;
let rafId = 0, startTime = 0, active = false, initialised = false;
let fpsCount = 0, fpsAt = 0;

const VERT_SRC = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';

function compileShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(log || 'shader compile failed');
  }
  return s;
}

function buildProgram(preset) {
  if (program) { gl.deleteProgram(program); program = null; }
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(gl.VERTEX_SHADER, VERT_SRC));
  gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, preset.frag));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || 'link failed');
  }
  program = p;
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  const ploc = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(ploc);
  gl.vertexAttribPointer(ploc, 2, gl.FLOAT, false, 0, 0);

  locs = { u_resolution: gl.getUniformLocation(program, 'u_resolution'), u_time: gl.getUniformLocation(program, 'u_time') };
  for (const c of preset.controls) {
    if (c.key === '__speed') continue;
    locs[c.key] = gl.getUniformLocation(program, c.key);
  }
  locs.u_transparent = gl.getUniformLocation(program, 'u_transparent'); // null if preset has none
}

function ensureGL() {
  if (gl) return true;
  canvas = $('shaderView');
  // preserveDrawingBuffer lets us read frames back reliably for PNG/GIF export.
  const glAttrs = { alpha: true, premultipliedAlpha: false, antialias: true, preserveDrawingBuffer: true };
  gl = canvas.getContext('webgl', glAttrs) || canvas.getContext('experimental-webgl', glAttrs);
  if (!gl) {
    $('shaderInfo').textContent = 'WebGL not supported in this browser.';
    return false;
  }
  quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  return true;
}

function resizeCanvas() {
  let w, h;
  if (state.canvas.mode === 'fixed') {
    w = state.canvas.w; h = state.canvas.h;
  } else {
    w = Math.max(1, Math.floor(canvas.clientWidth));
    h = Math.max(1, Math.floor(canvas.clientHeight));
  }
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
}

// Make the preview element fill the stage (fit) or display at its fixed
// resolution scaled to fit while preserving aspect ratio.
function applyCanvasStyle() {
  if (!canvas) return;
  if (state.canvas.mode === 'fixed') {
    canvas.style.width = 'auto';
    canvas.style.height = 'auto';
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '100%';
  } else {
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.maxWidth = '';
    canvas.style.maxHeight = '';
  }
}

// Grey out the W/H inputs when fitting to the stage.
function syncCanvasInputs() {
  const fit = state.canvas.mode === 'fit';
  const w = $('shaderW'), h = $('shaderH');
  if (w) w.disabled = fit;
  if (h) h.disabled = fit;
}

// Return the matching ratio key for an exact pixel size, else 'custom'.
function matchRatio(w, h) {
  for (const k in RATIOS) { if (RATIOS[k][0] === w && RATIOS[k][1] === h) return k; }
  return 'custom';
}

function currentSpeed() {
  const v = state.values['__speed'];
  return typeof v === 'number' ? v : 1;
}

// Set all uniforms for the current preset at a given time (seconds), then draw.
function drawAt(timeSec) {
  const preset = presetById(state.presetId);
  gl.uniform2f(locs.u_resolution, canvas.width, canvas.height);
  gl.uniform1f(locs.u_time, timeSec * currentSpeed());
  for (const c of preset.controls) {
    if (c.key === '__speed') continue;
    const loc = locs[c.key];
    if (!loc) continue;
    if (c.type === 'color') {
      const rgb = hexToRgb(state.values[c.key]);
      gl.uniform3f(loc, rgb[0], rgb[1], rgb[2]);
    } else {
      gl.uniform1f(loc, state.values[c.key]);
    }
  }
  if (locs.u_transparent) gl.uniform1f(locs.u_transparent, state.transparentBg ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function renderLoop(now) {
  if (!active) return;
  resizeCanvas();
  drawAt((now - startTime) / 1000);

  fpsCount++;
  if (now - fpsAt >= 1000) { $('shaderFps').textContent = `${fpsCount} fps`; fpsCount = 0; fpsAt = now; $('shaderInfo').textContent = `${canvas.width}×${canvas.height}`; }
  rafId = requestAnimationFrame(renderLoop);
}

function startLoop() {
  if (!gl) return;
  if (rafId) cancelAnimationFrame(rafId);
  active = true;
  startTime = performance.now();
  fpsAt = startTime;
  rafId = requestAnimationFrame(renderLoop);
}
function stopLoop() {
  active = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
}

// ---------- controls UI ----------
function buildControls() {
  const preset = presetById(state.presetId);
  const host = $('shaderControls');
  host.innerHTML = '';
  // group controls in declared order
  const groups = [];
  for (const c of preset.controls) {
    let g = groups.find((x) => x.name === c.group);
    if (!g) { g = { name: c.group, items: [] }; groups.push(g); }
    g.items.push(c);
  }
  for (const g of groups) {
    const h = document.createElement('h2');
    h.textContent = g.name;
    h.style.cssText = 'margin:14px 0 8px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);';
    host.appendChild(h);
    for (const c of g.items) host.appendChild(buildControlRow(c));
  }
}

function buildControlRow(c) {
  const row = document.createElement('div');
  row.className = 'row';
  const label = document.createElement('label');
  label.textContent = c.label;
  row.appendChild(label);

  if (c.type === 'color') {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = state.values[c.key];
    input.addEventListener('input', () => { state.values[c.key] = input.value; regenerateExport(); });
    row.appendChild(input);
  } else {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = c.min; input.max = c.max; input.step = c.step;
    input.value = state.values[c.key];
    const num = document.createElement('span');
    num.className = 'num';
    const fmt = (v) => (c.step < 1 ? (+v).toFixed(2) : String(v));
    num.textContent = fmt(input.value);
    input.addEventListener('input', () => {
      state.values[c.key] = parseFloat(input.value);
      num.textContent = fmt(input.value);
      regenerateExport();
    });
    row.appendChild(input);
    row.appendChild(num);
  }
  return row;
}

// ---------- preset switching ----------
function applyPreset(id, resetDefaults = true) {
  const preset = presetById(id);
  if (resetDefaults) loadPresetDefaults(preset);
  else state.presetId = id;
  if (gl) {
    try { buildProgram(preset); }
    catch (e) { $('shaderInfo').textContent = 'Shader error: ' + e.message; console.error(e); }
  }
  buildControls();
  regenerateExport();
}

// ---------- code export ----------
function uniformsLiteral(preset) {
  const parts = [];
  for (const c of preset.controls) {
    if (c.key === '__speed') continue;
    if (c.type === 'color') {
      const rgb = hexToRgb(state.values[c.key]).map(r4);
      parts.push(`    ${c.key}: [${rgb.join(', ')}]`);
    } else {
      parts.push(`    ${c.key}: ${r4(state.values[c.key])}`);
    }
  }
  if (preset.frag.includes('u_transparent')) {
    parts.push(`    u_transparent: ${state.transparentBg ? 1 : 0}`);
  }
  return '{\n' + parts.join(',\n') + '\n  }';
}

function coreLines(frag, uniformsLit, speed) {
  return [
    "  const glAttrs = { alpha: true, premultipliedAlpha: false, antialias: true };",
    "  const gl = canvas.getContext('webgl', glAttrs) || canvas.getContext('experimental-webgl', glAttrs);",
    "  if (!gl) return;",
    "  const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';",
    "  const FRAG = `" + frag.trim() + "`;",
    "  const compile = (type, src) => {",
    "    const s = gl.createShader(type);",
    "    gl.shaderSource(s, src); gl.compileShader(s);",
    "    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));",
    "    return s;",
    "  };",
    "  const program = gl.createProgram();",
    "  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));",
    "  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));",
    "  gl.linkProgram(program);",
    "  gl.useProgram(program);",
    "  const quad = gl.createBuffer();",
    "  gl.bindBuffer(gl.ARRAY_BUFFER, quad);",
    "  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);",
    "  const ploc = gl.getAttribLocation(program, 'p');",
    "  gl.enableVertexAttribArray(ploc);",
    "  gl.vertexAttribPointer(ploc, 2, gl.FLOAT, false, 0, 0);",
    "  const uniforms = " + uniformsLit + ";",
    "  const speed = " + r4(speed) + ";",
    "  const loc = { u_resolution: gl.getUniformLocation(program, 'u_resolution'), u_time: gl.getUniformLocation(program, 'u_time') };",
    "  for (const k in uniforms) loc[k] = gl.getUniformLocation(program, k);",
    "  const start = performance.now();",
    "  let raf = 0;",
    "  const resize = () => {",
    "    const w = Math.max(1, Math.floor(canvas.clientWidth || canvas.width));",
    "    const h = Math.max(1, Math.floor(canvas.clientHeight || canvas.height));",
    "    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }",
    "    gl.viewport(0, 0, canvas.width, canvas.height);",
    "  };",
    "  const render = (now) => {",
    "    resize();",
    "    gl.uniform2f(loc.u_resolution, canvas.width, canvas.height);",
    "    gl.uniform1f(loc.u_time, (now - start) / 1000 * speed);",
    "    for (const k in uniforms) {",
    "      const v = uniforms[k];",
    "      if (Array.isArray(v)) gl.uniform3f(loc[k], v[0], v[1], v[2]);",
    "      else gl.uniform1f(loc[k], v);",
    "    }",
    "    gl.drawArrays(gl.TRIANGLES, 0, 3);",
    "    raf = requestAnimationFrame(render);",
    "  };",
    "  raf = requestAnimationFrame(render);",
  ];
}

function genReact(preset) {
  const speed = currentSpeed();
  const core = coreLines(preset.frag, uniformsLiteral(preset), speed)
    .map((l) => '    ' + l.replace(/^  /, '')) // re-indent into useEffect body
    .join('\n');
  return `import { useEffect, useRef } from "react";

// ${preset.name} — animated background shader.
// Generated with Serpier Shader Studio. No dependencies beyond React (plain WebGL).
// Drop it behind a hero/section. Give the parent a size; the canvas fills it.
export default function ${preset.component}() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
${core}
    const onResize = () => {};
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
`;
}

function genHtml(preset) {
  const speed = currentSpeed();
  const core = coreLines(preset.frag, uniformsLiteral(preset), speed).join('\n');
  return `<!-- ${preset.name} — animated background shader.
     Generated with Serpier Shader Studio. No dependencies (plain WebGL). -->
<div style="position:relative;width:100%;height:100vh;overflow:hidden;">
  <canvas id="shader-bg" style="position:absolute;inset:0;width:100%;height:100%;display:block;"></canvas>
</div>
<script>
(function () {
  var canvas = document.getElementById("shader-bg");
${core}
})();
</script>
`;
}

function genGlsl(preset) {
  const uniformList = preset.controls
    .filter((c) => c.key !== '__speed')
    .map((c) => `//   ${c.key.padEnd(14)} ${c.type === 'color' ? 'vec3 ' : 'float'}  (${c.label})`)
    .join('\n');
  return `// ${preset.name} — WebGL1 fragment shader (Serpier Shader Studio)
// Vertex shader: ${VERT_SRC}
// Built-in uniforms:  u_resolution (vec2), u_time (float)
// Control uniforms:
${uniformList}

${preset.frag.trim()}
`;
}

function generateCode() {
  const preset = presetById(state.presetId);
  const fmt = $('shaderFormat').value;
  if (fmt === 'react') return { code: genReact(preset), file: `${preset.component}.tsx` };
  if (fmt === 'html') return { code: genHtml(preset), file: `${preset.id}-shader.html` };
  return { code: genGlsl(preset), file: `${preset.id}.frag` };
}

const DEPS = {
  react: 'Dependencies: none beyond React. Paste as a .tsx component and render it (e.g. behind your hero). Perfect for Lovable.',
  html: 'Dependencies: none. Plain HTML + WebGL — works in any site or framework. Paste into a page or component.',
  glsl: 'Standard WebGL1 fragment shader. Feed it u_resolution + u_time plus the control uniforms listed at the top.',
};

let lastCode = '';
function regenerateExport() {
  const { code } = generateCode();
  lastCode = code;
  const ta = $('shaderCode');
  if (ta) ta.value = code;
  const deps = $('shaderDeps');
  if (deps) deps.textContent = DEPS[$('shaderFormat').value];
}

// ---------- wiring ----------
function populatePresetSelect() {
  const sel = $('shaderPreset');
  sel.innerHTML = '';
  for (const p of PRESETS) {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name;
    sel.appendChild(o);
  }
  sel.value = state.presetId;
}

function initShaderUI() {
  if (initialised) return;
  initialised = true;
  loadPresetDefaults(PRESETS[0]);
  populatePresetSelect();
  ensureGL();
  applyPreset(state.presetId, true);

  $('shaderPreset').addEventListener('change', (e) => {
    applyPreset(e.target.value, true);
    populatePresetSelect();
  });
  $('shaderFormat').addEventListener('change', regenerateExport);
  $('shaderReset').addEventListener('click', () => applyPreset(state.presetId, true));
  $('shaderRandom').addEventListener('click', randomize);
  $('shaderTransparent').addEventListener('change', (e) => {
    state.transparentBg = e.target.checked;
    regenerateExport();
  });
  $('shaderExportAnim').addEventListener('click', exportAnimation);
  $('shaderStopRec').addEventListener('click', stopShaderRecord);

  // Canvas size / ratio
  $('shaderW').value = state.canvas.w;
  $('shaderH').value = state.canvas.h;
  syncCanvasInputs();
  $('shaderRatio').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === 'fit') {
      state.canvas.mode = 'fit';
    } else if (v === 'custom') {
      state.canvas.mode = 'fixed';
    } else {
      const [w, h] = RATIOS[v];
      state.canvas = { mode: 'fixed', w, h };
      $('shaderW').value = w; $('shaderH').value = h;
    }
    syncCanvasInputs();
    applyCanvasStyle();
  });
  const onSizeInput = () => {
    const w = Math.max(16, Math.min(4096, parseInt($('shaderW').value, 10) || 16));
    const h = Math.max(16, Math.min(4096, parseInt($('shaderH').value, 10) || 16));
    state.canvas = { mode: 'fixed', w, h };
    $('shaderRatio').value = matchRatio(w, h);
    syncCanvasInputs();
    applyCanvasStyle();
  };
  $('shaderW').addEventListener('change', onSizeInput);
  $('shaderH').addEventListener('change', onSizeInput);
  applyCanvasStyle();

  $('shaderCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(lastCode);
      $('shaderExportStatus').textContent = 'Copied to clipboard ✓';
    } catch {
      $('shaderCode').select();
      document.execCommand('copy');
      $('shaderExportStatus').textContent = 'Copied ✓';
    }
    setTimeout(() => { $('shaderExportStatus').textContent = ''; }, 2500);
  });

  $('shaderDownload').addEventListener('click', () => {
    const { code, file } = generateCode();
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = file;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('shaderExportStatus').textContent = `Downloaded ${file}`;
    setTimeout(() => { $('shaderExportStatus').textContent = ''; }, 2500);
  });
}

// ---------- download + minimal STORE zip (for PNG sequences) ----------
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let CRC32_TABLE = null;
function crc32(bytes) {
  if (!CRC32_TABLE) {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c; }
    CRC32_TABLE = t;
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function buildZip(files) {
  const enc = new TextEncoder();
  const parts = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const sz = f.data.length, crc = crc32(f.data);
    const lfh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lfh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, sz, true); lv.setUint32(22, sz, true);
    lv.setUint16(26, nameBytes.length, true);
    lfh.set(nameBytes, 30);
    parts.push(lfh, f.data);
    const cdh = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdh.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, sz, true); cv.setUint32(24, sz, true);
    cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true);
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

// ---------- offline frame export helpers ----------
function exportFrameCount() {
  const fps = parseInt($('shaderFps').value, 10) || 30;
  const secs = Math.max(0.2, Math.min(60, parseFloat($('shaderSecs').value) || 5));
  const total = Math.min(1800, Math.max(1, Math.round(fps * secs)));
  return { fps, secs, total };
}

// Scratch buffers (top-left origin RGBA) reused across frames.
let _glPixels = null, _bufOut = null, _bufA = null, _bufB = null, _pngCanvas = null;
function ensureScratch(w, h) {
  const n = w * h * 4;
  if (!_glPixels || _glPixels.length !== n) {
    _glPixels = new Uint8Array(n); _bufOut = new Uint8Array(n);
    _bufA = new Uint8Array(n); _bufB = new Uint8Array(n);
  }
  if (!_pngCanvas) _pngCanvas = document.createElement('canvas');
  if (_pngCanvas.width !== w || _pngCanvas.height !== h) { _pngCanvas.width = w; _pngCanvas.height = h; }
}
// readPixels is bottom-up; flip into a top-left-origin buffer.
function readFlipped(dst, w, h) {
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, _glPixels);
  const rb = w * 4;
  for (let y = 0; y < h; y++) dst.set(_glPixels.subarray((h - 1 - y) * rb, (h - y) * rb), y * rb);
}
// Produce output frame i of N into _bufOut. Seamless uses a forward crossfade
// loop: out[i] = (1-i/N)*s[i+N] + (i/N)*s[i], which closes the loop because the
// wrap point lands between consecutive source frames (no seam, motion stays forward).
function renderLoopFrameRGBA(i, N, fps, seamless, w, h) {
  if (!seamless) {
    drawAt(i / fps);
    readFlipped(_bufOut, w, h);
    return;
  }
  drawAt((i + N) / fps); readFlipped(_bufA, w, h);
  drawAt(i / fps);       readFlipped(_bufB, w, h);
  const wB = i / N, wA = 1 - wB;
  for (let k = 0; k < _bufOut.length; k++) _bufOut[k] = (_bufA[k] * wA + _bufB[k] * wB) | 0;
}

function rgbaToPngBytes(w, h) {
  const ctx = _pngCanvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  img.data.set(_bufOut);
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve) => _pngCanvas.toBlob(async (b) => resolve(new Uint8Array(await b.arrayBuffer())), 'image/png'));
}

// PNG image sequence (zip) — full 8-bit alpha. Import into Premiere as an image sequence.
async function exportPngSequence() {
  stopLoop();
  resizeCanvas();
  const { fps, total, secs } = exportFrameCount();
  const w = canvas.width, h = canvas.height;
  const seamless = $('shaderLoop').checked;
  ensureScratch(w, h);
  const files = [];
  $('shaderExportAnim').disabled = true;
  try {
    for (let i = 0; i < total; i++) {
      renderLoopFrameRGBA(i, total, fps, seamless, w, h);
      const bytes = await rgbaToPngBytes(w, h);
      files.push({ name: `${state.presetId}_${String(i + 1).padStart(4, '0')}.png`, data: bytes });
      if (i % 4 === 0) { $('shaderRecStatus').textContent = `Rendering PNG ${i + 1}/${total}…`; await new Promise((r) => setTimeout(r, 0)); }
    }
    downloadBlob(buildZip(files), `${state.presetId}-${secs}s.zip`);
    $('shaderRecStatus').textContent = `Saved ${total} PNG frames${seamless ? ' (seamless loop)' : ''} · Premiere: File ▸ Import, pick frame 0001, tick "Image Sequence", set ${fps} fps`;
  } catch (e) {
    console.error(e); $('shaderRecStatus').textContent = 'PNG export failed: ' + e.message;
  } finally {
    $('shaderExportAnim').disabled = false;
    startLoop();
  }
}

// Animated GIF (single file, transparent-capable, infinite loop, exact length).
async function exportGifAnim() {
  stopLoop();
  resizeCanvas();
  const { fps, total, secs } = exportFrameCount();
  const w = canvas.width, h = canvas.height;
  const seamless = $('shaderLoop').checked;
  ensureScratch(w, h);
  const enc = GIFEncoder();
  const transparent = state.transparentBg || /float a =/.test(presetById(state.presetId).frag);
  // Distribute centiseconds so the total duration is exactly `secs`.
  let accCs = 0;
  $('shaderExportAnim').disabled = true;
  try {
    for (let i = 0; i < total; i++) {
      renderLoopFrameRGBA(i, total, fps, seamless, w, h);
      const targetCs = Math.round((i + 1) * 100 * secs / total);
      const cs = Math.max(1, targetCs - accCs); accCs = targetCs;
      const opts = { delay: cs * 10, repeat: 0 }; // repeat 0 = loop forever
      let palette, index;
      if (transparent) {
        palette = quantize(_bufOut, 256, { format: 'rgba4444', oneBitAlpha: true });
        index = applyPalette(_bufOut, palette, 'rgba4444');
        let ti = palette.findIndex((p) => p.length >= 4 && p[3] === 0);
        if (ti < 0) { ti = palette.length; palette.push([0, 0, 0, 0]); }
        opts.transparent = true; opts.transparentIndex = ti; opts.dispose = 2;
      } else {
        palette = quantize(_bufOut, 256, { format: 'rgb565' });
        index = applyPalette(_bufOut, palette, 'rgb565');
      }
      opts.palette = palette;
      enc.writeFrame(index, w, h, opts);
      if (i % 4 === 0) { $('shaderRecStatus').textContent = `Encoding GIF ${i + 1}/${total}…`; await new Promise((r) => setTimeout(r, 0)); }
    }
    enc.finish();
    downloadBlob(new Blob([enc.bytes()], { type: 'image/gif' }), `${state.presetId}-${secs}s.gif`);
    $('shaderRecStatus').textContent = `Saved ${state.presetId}.gif · ${secs}s · ${total} frames${seamless ? ' · seamless loop' : ''}`;
  } catch (e) {
    console.error(e); $('shaderRecStatus').textContent = 'GIF export failed: ' + e.message;
  } finally {
    $('shaderExportAnim').disabled = false;
    startLoop();
  }
}

function exportAnimation() {
  const fmt = $('shaderAnimFormat').value;
  if (fmt === 'webm') return startShaderRecord();
  if (fmt === 'gif') return exportGifAnim();
  return exportPngSequence();
}

// ---------- video recording (WebM, alpha-capable) ----------
let mediaRec = null, recChunks = [], recTimeout = 0;

function startShaderRecord() {
  if (!gl || !canvas.captureStream || !window.MediaRecorder) {
    $('shaderRecStatus').textContent = 'Video recording not supported in this browser.';
    return;
  }
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  let mime = '';
  for (const t of types) { if (MediaRecorder.isTypeSupported(t)) { mime = t; break; } }
  if (!mime) { $('shaderRecStatus').textContent = 'WebM not supported in this browser.'; return; }

  const stream = canvas.captureStream(60);
  mediaRec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12000000 });
  recChunks = [];
  mediaRec.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
  mediaRec.onstop = () => {
    const blob = new Blob(recChunks, { type: mime });
    const name = `${state.presetId}-shader${state.transparentBg ? '-alpha' : ''}.webm`;
    downloadBlob(blob, name);
    $('shaderRecStatus').textContent = `Saved ${name} · ${(blob.size / 1024 / 1024).toFixed(2)} MB`;
    $('shaderExportAnim').disabled = false;
    $('shaderStopRec').disabled = true;
  };
  mediaRec.start();
  $('shaderExportAnim').disabled = true;
  $('shaderStopRec').disabled = false;
  const secs = Math.max(0.2, Math.min(60, parseFloat($('shaderSecs').value) || 5));
  const note = state.transparentBg ? ' · transparent (view in Chrome)' : '';
  $('shaderRecStatus').textContent = `Recording ${secs}s${note}… (WebM loops via <video loop>; for a seamless loop use GIF/PNG)`;
  recTimeout = setTimeout(stopShaderRecord, secs * 1000);
}

function stopShaderRecord() {
  if (recTimeout) { clearTimeout(recTimeout); recTimeout = 0; }
  if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop();
}

function randomize() {
  const preset = presetById(state.presetId);
  for (const c of preset.controls) {
    if (c.type === 'color') {
      const rnd = '#' + Array.from({ length: 3 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
      state.values[c.key] = rnd;
    } else if (c.key !== '__speed') {
      state.values[c.key] = r4(c.min + Math.random() * (c.max - c.min));
    }
  }
  buildControls();
  regenerateExport();
}

// ---------- mode toggle ----------
function setMode(mode) {
  const shader = mode === 'shader';
  $('ditherApp').hidden = shader;
  $('shaderApp').hidden = !shader;
  $('modeShader').classList.toggle('active', shader);
  $('modeDither').classList.toggle('active', !shader);
  if (shader) {
    initShaderUI();
    requestAnimationFrame(() => { if (gl) startLoop(); });
  } else {
    stopLoop();
  }
}

$('modeDither').addEventListener('click', () => setMode('dither'));
$('modeShader').addEventListener('click', () => setMode('shader'));
