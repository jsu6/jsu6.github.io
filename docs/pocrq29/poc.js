// RQ2: the 29 predicted bypasses of Brave's default hooks that our Brave 1.92.144 run confirmed, read with the
// study's probe code (analysis/rq2/pages/probe.js). A bypass is confirmed when, in Brave Standard, the API returns the
// reference value (Brave with fingerprinting protection off) on every repeat while a sibling API the same defense hooks
// at the default level returns a changed value. Nothing is sent; readings stay in localStorage or move by copy and paste.
'use strict';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPS = 3;

function err(e) { return {error: String(e && e.name ? e.name + ': ' + e.message : e)}; }
function safe(f) { try { const v = f(); return v === undefined ? {error: 'undefined'} : v; } catch (e) { return err(e); } }
async function asafe(f) { try { const v = await f(); return v === undefined ? {error: 'undefined'} : v; } catch (e) { return err(e); } }
async function sha(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// ------------------------------------------------------------------ canvas (probe.js canvasReads)
const CW = 240, CH = 128, TEXT = 'FProots probe é中😀';
function glReadBitmap(bmp) {  // ImageBitmap -> WebGL texture -> framebuffer -> readPixels
  const c = document.createElement('canvas'); c.width = CW; c.height = CH;
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) throw new Error('no webgl');
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  const px = new Uint8Array(CW * CH * 4); gl.readPixels(0, 0, CW, CH, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}
function ctx2d() { const x = document.createElement('canvas').getContext('2d'); x.font = '18px sans-serif'; return x; }
const POINTS = [[10.5, 10.5], [60.25, 30.75], [109.5, 59.5], [110.5, 60.5]];
function ellipse() { const x = ctx2d(); x.beginPath(); x.ellipse(60, 35, 50.3, 25.7, 0.3, 0, 2 * Math.PI); x.lineWidth = 3.3; return x; }
// fillText draws; its pixels are read through WebGL, the route Brave leaves unfarbled in Standard
async function fillTextPixels() {
  const c = document.createElement('canvas'); c.width = CW; c.height = CH; const t = c.getContext('2d');
  t.font = '18px sans-serif'; t.fillText(TEXT, 12, 60);
  return sha(glReadBitmap(await createImageBitmap(c)));
}
function measureText() {
  const m = ctx2d().measureText(TEXT);
  return [m.width, m.actualBoundingBoxLeft, m.actualBoundingBoxRight, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent];
}

// ------------------------------------------------------------------ WebGL (probe.js webglReads)
const MAX_PARAMS = ['MAX_TEXTURE_SIZE', 'MAX_CUBE_MAP_TEXTURE_SIZE', 'MAX_RENDERBUFFER_SIZE', 'MAX_VIEWPORT_DIMS',
  'MAX_VERTEX_ATTRIBS', 'MAX_VERTEX_UNIFORM_VECTORS', 'MAX_VARYING_VECTORS', 'MAX_FRAGMENT_UNIFORM_VECTORS',
  'MAX_TEXTURE_IMAGE_UNITS', 'MAX_VERTEX_TEXTURE_IMAGE_UNITS', 'MAX_COMBINED_TEXTURE_IMAGE_UNITS', 'MAX_3D_TEXTURE_SIZE'];
let GL = null;
function gl2() { if (!GL) GL = document.createElement('canvas').getContext('webgl2'); if (!GL) throw new Error('no webgl2 context'); return GL; }
function gpuStrings() {
  const gl = gl2(), d = gl.getExtension('WEBGL_debug_renderer_info');
  return {vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER),
          unmasked_vendor: d ? gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : null,
          unmasked_renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : null};
}
function maxLimits() {
  const gl = gl2();
  return Object.fromEntries(MAX_PARAMS.map((n) => [n, safe(() => { const v = gl.getParameter(gl[n]); return v && v.length !== undefined ? [...v] : v; })]));
}
function shaderPrecision() {
  const gl = gl2(), out = [];
  for (const s of [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER])
    for (const p of [gl.LOW_FLOAT, gl.MEDIUM_FLOAT, gl.HIGH_FLOAT, gl.LOW_INT, gl.MEDIUM_INT, gl.HIGH_INT]) {
      const f = gl.getShaderPrecisionFormat(s, p); out.push(f ? [f.rangeMin, f.rangeMax, f.precision] : null);
    }
  return out;
}
function supportedExtensions() { const e = gl2().getSupportedExtensions(); return e === null ? {error: 'null'} : [...e].sort(); }
function astcProfiles() {
  const e = gl2().getExtension('WEBGL_compressed_texture_astc');
  return e ? e.getSupportedProfiles() : {error: 'extension WEBGL_compressed_texture_astc not available'};
}

// ------------------------------------------------------------------ audio (probe.js audioReads)
async function offlineRender() {  // a 10 kHz triangle wave through a compressor, rendered offline (nothing is played)
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 10000;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -50; comp.knee.value = 40; comp.ratio.value = 12; comp.attack.value = 0; comp.release.value = 0.25;
  osc.connect(comp); comp.connect(ctx.destination); osc.start(0);
  return ctx.startRendering();
}
// The rendered samples read through no AudioBuffer method: played into a second offline context, an AudioWorklet sums them.
const SUM_WORKLET = URL.createObjectURL(new Blob([`registerProcessor('sum', class extends AudioWorkletProcessor {
  constructor() { super(); this.s = 0; this.port.onmessage = () => this.port.postMessage(this.s); }
  process(inputs) { for (const ch of inputs[0] || []) for (const x of ch) this.s += Math.abs(x); return true; }
});`], {type: 'text/javascript'}));
async function workletSum() {
  const buffer = await offlineRender();
  const ctx = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
  await ctx.audioWorklet.addModule(SUM_WORKLET);
  const src = new AudioBufferSourceNode(ctx, {buffer}), sum = new AudioWorkletNode(ctx, 'sum');
  src.connect(sum); sum.connect(ctx.destination); src.start(0);
  await ctx.startRendering();
  return new Promise((r) => { sum.port.onmessage = (m) => r(m.data); sum.port.postMessage(0); });
}
async function getChannelData() {  // Brave's hook adds per-site noise here
  const d = (await offlineRender()).getChannelData(0);
  let s = 0; for (let j = 4500; j < 5000; j++) s += Math.abs(d[j]);
  return s;
}
let AC = null;
function audioContext() { if (!AC) AC = new AudioContext(); return AC; }

// ------------------------------------------------------------------ media capabilities (probe.js mediaCapReads)
const ENC = [
  {type: 'webrtc', video: {contentType: 'video/VP8', width: 1280, height: 720, bitrate: 2e6, framerate: 30}},
  {type: 'webrtc', video: {contentType: 'video/VP8', width: 3840, height: 2160, bitrate: 2e7, framerate: 60}},
  {type: 'webrtc', video: {contentType: 'video/VP9', width: 1920, height: 1080, bitrate: 4e6, framerate: 30, scalabilityMode: 'L1T3'}},
  {type: 'webrtc', video: {contentType: 'video/VP9', width: 3840, height: 2160, bitrate: 2e7, framerate: 60}},
  {type: 'webrtc', video: {contentType: 'video/AV1', width: 1920, height: 1080, bitrate: 4e6, framerate: 30}},
  {type: 'webrtc', video: {contentType: 'video/H264', width: 1920, height: 1080, bitrate: 4e6, framerate: 30}},
  {type: 'webrtc', audio: {contentType: 'audio/opus'}},
  {type: 'webrtc', audio: {contentType: 'audio/G722'}},
];
async function encodingInfo() {
  const out = [];
  for (const c of ENC) {
    try { const r = await navigator.mediaCapabilities.encodingInfo(c); out.push([r.supported, r.smooth, r.powerEfficient]); }
    catch (e) { out.push(err(e)); }
  }
  return out;
}

// ------------------------------------------------------------------ Window Management and wheel input
let SCREEN_DETAILS = null;
async function screenDetailed(key) {
  if (!SCREEN_DETAILS) throw new Error('window management not granted');
  return SCREEN_DETAILS.currentScreen[key];
}
const WHEEL = [];
function wheel(key) {
  if (!WHEEL.length) throw new Error('no wheel event: scroll the box in step 1, then run again');
  return WHEEL[0][key];
}

// ------------------------------------------------------------------ the 29 rows
// kind: the static grade; defense: the Brave defense whose protected source the API reads; study: what our run showed
// beyond agreement (knob, strict, none). read: the probe; reads are repeated REPS times.
const SIBLINGS = {  // a sibling API the defense hooks at the default level, to show the defense is active
  'brave-audio': ['AudioBuffer.getChannelData (sum of 500 samples)', getChannelData],
  'brave-screen': ['Screen.width × height', () => `${screen.width} × ${screen.height}`],
  'brave-memory': ['Navigator.deviceMemory', () => navigator.deviceMemory],
  'brave-plugins': ['Navigator.plugins', () => [...navigator.plugins].map((p) => p.name)],
  'brave-webgl': ['WebGL2 getParameter MAX_* limits', maxLimits],
};
const STRICT_ONLY = {
  'brave-measuretext': 'measureText', 'brave-pointinpath': 'isPointInPath', 'brave-useragent': 'user agent', 'brave-webgl': 'WebGL',
};
const KINDS = {
  unhooked: 'No Brave hook on any path from the protected source to the API.',
  around: 'A path reaches the API around the hook, through a field every object of its type shares.',
  'field gap': 'The hook acts in Standard but passes this part of the value unchanged.',
  'strict-only': 'The hook acts only at Strict, which Brave hides by default since 1.64.',
};
const ROWS = [
  ['AudioContext.baseLatency', 'unhooked', 'brave-audio', 'knob', () => audioContext().baseLatency],
  ['BaseAudioContext.sampleRate', 'unhooked', 'brave-audio', 'knob', () => audioContext().sampleRate],
  ['CanvasRenderingContext2D.font', 'unhooked', 'brave-measuretext', 'none', () => ctx2d().font],
  ['MediaCapabilities.encodingInfo', 'unhooked', 'brave-memory', 'none', encodingInfo],
  ['Navigator.pdfViewerEnabled', 'unhooked', 'brave-plugins', 'none', () => navigator.pdfViewerEnabled],
  ['OfflineAudioContext.startRendering', 'unhooked', 'brave-audio', 'none', workletSum],
  ['ScreenOrientation.angle', 'unhooked', 'brave-screen', 'none', () => screen.orientation.angle],
  ['ScreenOrientation.type', 'unhooked', 'brave-screen', 'knob', () => screen.orientation.type],
  ['VisualViewport.scale', 'unhooked', 'brave-screen', 'none', () => visualViewport.scale],
  ['VisualViewport.width', 'unhooked', 'brave-screen', 'knob', () => visualViewport.width],
  ['WheelEvent.deltaMode', 'unhooked', 'brave-screen', 'none', () => wheel('deltaMode')],
  ['WheelEvent.wheelDelta', 'unhooked', 'brave-screen', 'none', () => wheel('wheelDelta')],
  ['Window.devicePixelRatio', 'unhooked', 'brave-screen', 'knob', () => devicePixelRatio],
  ['Window.innerWidth', 'unhooked', 'brave-screen', 'knob', () => innerWidth],
  ['CanvasRenderingContext2D.fillText', 'around', 'brave-measuretext', 'knob', fillTextPixels],
  ['ScreenDetailed.devicePixelRatio', 'around', 'brave-screen', 'knob', () => screenDetailed('devicePixelRatio')],
  ['Screen.colorDepth', 'field gap', 'brave-screen', 'none', () => screen.colorDepth],
  ['Screen.pixelDepth', 'field gap', 'brave-screen', 'none', () => screen.pixelDepth],
  ['ScreenDetailed.isInternal', 'field gap', 'brave-screen', 'none', () => screenDetailed('isInternal')],
  ['ScreenDetailed.label', 'field gap', 'brave-screen', 'none', () => screenDetailed('label')],
  ['WebGL2RenderingContext.getParameter (GPU strings)', 'field gap', 'brave-webgl', 'strict', gpuStrings],
  ['CanvasRenderingContext2D.isPointInPath', 'strict-only', 'brave-pointinpath', 'strict', () => { const x = ellipse(); return POINTS.map(([a, b]) => x.isPointInPath(a, b)); }],
  ['CanvasRenderingContext2D.isPointInStroke', 'strict-only', 'brave-pointinpath', 'none', () => { const x = ellipse(); return POINTS.map(([a, b]) => x.isPointInStroke(a, b)); }],
  ['CanvasRenderingContext2D.measureText', 'strict-only', 'brave-measuretext', 'strict', measureText],
  ['Navigator.appVersion', 'strict-only', 'brave-useragent', 'strict', () => navigator.appVersion],
  ['Navigator.userAgent', 'strict-only', 'brave-useragent', 'strict', () => navigator.userAgent],
  ['WebGL2RenderingContext.getShaderPrecisionFormat', 'strict-only', 'brave-webgl', 'strict', shaderPrecision],
  ['WebGL2RenderingContext.getSupportedExtensions', 'strict-only', 'brave-webgl', 'strict', supportedExtensions],
  ['WebGLCompressedTextureASTC.getSupportedProfiles', 'strict-only', 'brave-webgl', 'strict', astcProfiles],
].map(([api, kind, defense, study, read]) => ({api, kind, defense, study, read}));

async function readAll() {  // {api: [repeats]}, plus 'sibling:<defense>': [repeats]
  try {  // first, while the Run click still counts as a user gesture
    SCREEN_DETAILS = await Promise.race([window.getScreenDetails(), sleep(8000).then(() => { throw new Error('timed out'); })]);
  } catch (e) { SCREEN_DETAILS = null; }
  const out = {};
  for (let i = 0; i < REPS; i++) {
    for (const r of ROWS) (out[r.api] = out[r.api] || []).push(await asafe(r.read));
    for (const [d, [, f]] of Object.entries(SIBLINGS)) (out['sibling:' + d] = out['sibling:' + d] || []).push(await asafe(f));
    await sleep(50);
  }
  return {label: navigator.userAgent, at: new Date().toISOString(), r: out};
}

// ------------------------------------------------------------------ comparison
const key = (v) => JSON.stringify(v);
const isErr = (v) => v && typeof v === 'object' && !Array.isArray(v) && 'error' in v;
function one(reps) {  // the value when every repeat agrees and none failed; otherwise null
  if (!reps || !reps.length || reps.some(isErr)) return null;
  return reps.every((x) => key(x) === key(reps[0])) ? reps[0] : null;
}
function show(reps) {
  if (!reps) return '—';
  const ks = [...new Set(reps.map(key))];
  return ks.length === 1 ? ks[0] : 'varies: ' + ks.join(' / ');
}
function verdict(r, ref, cur) {
  if (!cur) return '<span class="muted">press Run</span>';
  if (!ref) return '<span class="muted">save a reference</span>';
  const a = one(ref.r[r.api]), b = one(cur.r[r.api]);
  if (cur.r[r.api] && cur.r[r.api].some(isErr)) return '<span class="wait">can\'t read</span><div class="why">' + esc(show(cur.r[r.api])) + '</div>';
  if (a === null) return '<span class="wait">can\'t check</span><div class="why">the reference varies or failed</div>';
  if (b === null) return '<span class="no">no</span><div class="why">varies between repeats (per-call noise)</div>';
  if (key(a) !== key(b)) return '<span class="no">no</span><div class="why">differs from the reference: protected</div>';
  if (r.kind === 'strict-only') return '<span class="yes">yes</span><div class="why">reference value; Brave hooks it only at Strict</div>';
  const s = sibling(r.defense, ref, cur);
  if (s === true) return '<span class="yes">yes</span><div class="why">reference value while the defense changes its sibling</div>';
  if (s === false) return '<span class="wait">equal, defense idle</span><div class="why">the sibling is unchanged too: is Block fingerprinting on?</div>';
  return '<span class="yes">yes</span><div class="why">reference value</div>';
}
function sibling(defense, ref, cur) {  // true: the defense's sibling differs from the reference; false: it does not; null: none
  if (!SIBLINGS[defense]) return null;
  const k = 'sibling:' + defense, a = ref.r[k], b = cur.r[k];
  if (!a || !b) return null;
  return show(a) !== show(b);
}

// ------------------------------------------------------------------ state and rendering
const LS = {ref: 'pocrq29.reference', others: 'pocrq29.others'};
function load(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
let CUR = null, REF = load(LS.ref, null), OTHERS = load(LS.others, []);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const cut = (s) => (s.length > 120 ? s.slice(0, 118) + '…' : s);

function render() {
  const rows = [];
  let confirmed = 0, checked = 0;
  for (const kind of Object.keys(KINDS)) {
    const group = ROWS.filter((r) => r.kind === kind);
    rows.push(`<tr class="grp"><th colspan="5">${kind} (${group.length}) <span class="d">${KINDS[kind]}</span></th></tr>`);
    for (const r of group) {
      const v = verdict(r, REF, CUR);
      if (CUR && REF) { checked++; if (v.includes('class="yes"')) confirmed++; }
      const sib = SIBLINGS[r.defense] && r.kind !== 'strict-only'
        ? (rs) => (rs && rs.r['sibling:' + r.defense] ? `<div class="sib">sibling ${esc(SIBLINGS[r.defense][0])}: ${esc(cut(show(rs.r['sibling:' + r.defense])))}</div>` : '')
        : () => '';
      const cell = (rs) => (rs ? `<div class="v" title="${esc(show(rs.r[r.api]))}">${esc(cut(show(rs.r[r.api])))}</div>${sib(rs)}` : '<span class="muted">—</span>');
      const all = [REF, CUR, ...OTHERS].filter(Boolean).map((x) => one(x.r[r.api])).filter((x) => x !== null);
      const distinct = new Set(all.map(key)).size;
      const others = OTHERS.length ? `${distinct} distinct of ${all.length}<div class="why">${OTHERS.map((o) => esc(o.name)).join(', ')}</div>` : '<span class="muted">none added</span>';
      rows.push(`<tr><td><div class="k">${esc(r.api)}</div><div class="why">${r.defense.replace('brave-', '')} · ` +
        `<span class="tag">study: ${r.study}</span></div></td><td>${cell(REF)}</td><td>${cell(CUR)}</td><td>${v}</td><td>${others}</td></tr>`);
    }
  }
  $('board').innerHTML = rows.join('');
  $('summary').textContent = CUR && REF ? `— ${confirmed} of ${checked} confirmed in this run` : '';
  $('save-ref').disabled = !CUR;
  $('copy').disabled = !CUR;
}

function showCode() {
  const fns = [glReadBitmap, fillTextPixels, measureText, ellipse, gpuStrings, maxLimits, shaderPrecision, supportedExtensions,
    astcProfiles, offlineRender, workletSum, getChannelData, encodingInfo];
  $('code').textContent = ROWS.map((r) => `${r.api}: ${r.read.toString()}`).join('\n') + '\n\n' + fns.map((f) => f.toString()).join('\n\n');
}

document.addEventListener('DOMContentLoaded', () => {
  $('wheel').addEventListener('wheel', (e) => {
    if (WHEEL.length < 6 && e.isTrusted) WHEEL.push({deltaMode: e.deltaMode, wheelDelta: e.wheelDelta});
    $('wheel-status').textContent = `${WHEEL.length} wheel event(s) recorded`;
  }, {passive: true});
  showCode();
  render();
  $('run').onclick = async () => {
    $('run').disabled = true;
    $('run-status').textContent = 'reading…';
    try { CUR = await readAll(); $('run-status').textContent = 'done'; } catch (e) { $('run-status').textContent = 'error: ' + (e && e.message || e); }
    $('run').disabled = false;
    render();
  };
  $('save-ref').onclick = () => { REF = CUR; store(LS.ref, REF); $('run-status').textContent = 'saved as reference'; render(); };
  $('clear-ref').onclick = () => { REF = null; store(LS.ref, null); render(); };
  $('copy').onclick = () => {
    $('mine').value = JSON.stringify(CUR);
    $('mine').select();
    if (navigator.clipboard) navigator.clipboard.writeText($('mine').value).catch(() => {});
  };
  $('add').onclick = () => {
    let x;
    try { x = JSON.parse($('other').value); } catch (e) { $('add-status').textContent = 'cannot read the pasted text: ' + e.message; return; }
    if (!x || !x.r) { $('add-status').textContent = 'not a set of readings from this page'; return; }
    x.name = $('other-label').value.trim() || x.label;
    OTHERS.push(x); store(LS.others, OTHERS);
    $('other').value = ''; $('other-label').value = ''; $('add-status').textContent = `${OTHERS.length} added`;
    render();
  };
  $('clear-others').onclick = () => { OTHERS = []; store(LS.others, OTHERS); $('add-status').textContent = ''; render(); };
});
