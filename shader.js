// Shader Studio — animated WebGL background shaders with copy-paste code export.
// Sibling module to the Dithering Studio (app.js). Shares the page via a mode
// toggle; all shader logic is isolated here so the dither tool is untouched.

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
uniform float u_pixelSize, u_threshold, u_intensity, u_contrast;
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
  gl_FragColor = vec4(mix(u_bg, u_dot, on), 1.0);
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
];

// ---------- live state ----------
const state = {
  presetId: PRESETS[0].id,
  values: {}, // key -> number | hex string
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
}

function ensureGL() {
  if (gl) return true;
  canvas = $('shaderView');
  gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
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
  const w = Math.max(1, Math.floor(canvas.clientWidth));
  const h = Math.max(1, Math.floor(canvas.clientHeight));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
}

function currentSpeed() {
  const v = state.values['__speed'];
  return typeof v === 'number' ? v : 1;
}

function renderLoop(now) {
  if (!active) return;
  resizeCanvas();
  const preset = presetById(state.presetId);
  gl.uniform2f(locs.u_resolution, canvas.width, canvas.height);
  gl.uniform1f(locs.u_time, (now - startTime) / 1000 * currentSpeed());
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
  gl.drawArrays(gl.TRIANGLES, 0, 3);

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
  return '{\n' + parts.join(',\n') + '\n  }';
}

function coreLines(frag, uniformsLit, speed) {
  return [
    "  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');",
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
