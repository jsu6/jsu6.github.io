// RQ2: 24 of the 29 predicted bypasses of Brave's default hooks that our Brave 1.92.144 run confirmed (the five that
// need a wheel event or the window-management permission left out), read in Brave and in Chromium with the study's
// probe code (analysis/rq2/pages/probe.js). Each row reads one such API next to a sibling API the same defense hooks at
// Brave's default level. A bypass works when, in Brave, the sibling differs from Chromium's (the defense is active) and
// the API returns Chromium's value (the hook missed it). Nothing is sent or stored; results cross windows only by copy
// and paste.
'use strict';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sha(bytes) {  // the first 8 bytes of SHA-256, in hex
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ------------------------------------------------------------------ canvas
const W = 240, H = 128, TEXT = 'FProots probe é中😀';
function pixelsThroughWebGL(bitmap) {  // a bitmap's pixels: uploaded as a WebGL texture and read back
  const gl = document.createElement('canvas').getContext('webgl2');
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gl.getParameter(gl.TEXTURE_BINDING_2D), 0);
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}
function context2d() { const x = document.createElement('canvas').getContext('2d'); x.font = '18px sans-serif'; return x; }
// fillText draws; its pixels are read through WebGL, which Brave leaves unfarbled in Standard
async function readFillText() {
  const c = Object.assign(document.createElement('canvas'), {width: W, height: H});
  const x = c.getContext('2d'); x.font = '18px sans-serif'; x.fillText(TEXT, 12, 60);
  return sha(pixelsThroughWebGL(await createImageBitmap(c)));
}
function readMeasureText() {
  const m = context2d().measureText(TEXT);
  return [m.width, m.actualBoundingBoxLeft, m.actualBoundingBoxRight, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent];
}
const POINTS = [[10.5, 10.5], [60.25, 30.75], [109.5, 59.5], [110.5, 60.5]];
function ellipse() { const x = context2d(); x.beginPath(); x.ellipse(60, 35, 50.3, 25.7, 0.3, 0, 2 * Math.PI); x.lineWidth = 3.3; return x; }
function readIsPointInPath() { const x = ellipse(); return POINTS.map(([a, b]) => x.isPointInPath(a, b)); }
function readIsPointInStroke() { const x = ellipse(); return POINTS.map(([a, b]) => x.isPointInStroke(a, b)); }

// ------------------------------------------------------------------ WebGL
const gl2 = () => document.createElement('canvas').getContext('webgl2');
function readGPUStrings() {
  const gl = gl2(), d = gl.getExtension('WEBGL_debug_renderer_info');
  return `${gl.getParameter(gl.VENDOR)} | ${gl.getParameter(gl.RENDERER)} | ` +
    `${d ? gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : '-'} | ${d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '-'}`;
}
// hooked: Brave lowers these limits at its default level
const LIMITS = ['MAX_TEXTURE_SIZE', 'MAX_CUBE_MAP_TEXTURE_SIZE', 'MAX_RENDERBUFFER_SIZE', 'MAX_VERTEX_ATTRIBS',
  'MAX_VERTEX_UNIFORM_VECTORS', 'MAX_VARYING_VECTORS', 'MAX_FRAGMENT_UNIFORM_VECTORS', 'MAX_TEXTURE_IMAGE_UNITS',
  'MAX_VERTEX_TEXTURE_IMAGE_UNITS', 'MAX_COMBINED_TEXTURE_IMAGE_UNITS', 'MAX_3D_TEXTURE_SIZE'];
function readLimits() { const gl = gl2(); return LIMITS.map((n) => gl.getParameter(gl[n])).join(' '); }
async function readShaderPrecision() {
  const gl = gl2(), out = [];
  for (const s of [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER])
    for (const p of [gl.LOW_FLOAT, gl.MEDIUM_FLOAT, gl.HIGH_FLOAT, gl.LOW_INT, gl.MEDIUM_INT, gl.HIGH_INT]) {
      const f = gl.getShaderPrecisionFormat(s, p); out.push(f ? [f.rangeMin, f.rangeMax, f.precision] : null);
    }
  return sha(new TextEncoder().encode(JSON.stringify(out)));
}
async function readExtensions() { return sha(new TextEncoder().encode(JSON.stringify([...gl2().getSupportedExtensions()].sort()))); }
function readASTC() {
  const e = gl2().getExtension('WEBGL_compressed_texture_astc');
  return e ? e.getSupportedProfiles().join(' ') : 'extension not available';
}

// ------------------------------------------------------------------ audio
// A 10 kHz triangle wave through a compressor, rendered offline (nothing is played).
async function renderSound() {
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 10000;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -50; comp.knee.value = 40; comp.ratio.value = 12; comp.attack.value = 0; comp.release.value = 0.25;
  osc.connect(comp); comp.connect(ctx.destination); osc.start(0);
  return ctx.startRendering();
}
// hooked: Brave adds per-site noise to the samples getChannelData returns
async function readGetChannelData() {
  const samples = (await renderSound()).getChannelData(0);
  let s = 0; for (const x of samples) s += Math.abs(x);
  return s;
}
// the same rendered samples played into a second offline context, where an AudioWorklet sums them
const SUM = URL.createObjectURL(new Blob([`registerProcessor('sum', class extends AudioWorkletProcessor {
  constructor() { super(); this.s = 0; this.port.onmessage = () => this.port.postMessage(this.s); }
  process(inputs) { for (const ch of inputs[0] || []) for (const x of ch) this.s += Math.abs(x); return true; }
});`], {type: 'text/javascript'}));
async function readThroughWorklet() {
  const buffer = await renderSound();
  const ctx = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
  await ctx.audioWorklet.addModule(SUM);
  const src = new AudioBufferSourceNode(ctx, {buffer}), sum = new AudioWorkletNode(ctx, 'sum');
  src.connect(sum); sum.connect(ctx.destination); src.start(0);
  await ctx.startRendering();
  return new Promise((r) => { sum.port.onmessage = (m) => r(m.data); sum.port.postMessage(0); });
}
async function readAudioContext(field) {
  const ctx = new AudioContext();
  const v = ctx[field];
  await ctx.close();
  return v;
}

// ------------------------------------------------------------------ others
const ENC = [
  {type: 'webrtc', video: {contentType: 'video/VP8', width: 1280, height: 720, bitrate: 2e6, framerate: 30}},
  {type: 'webrtc', video: {contentType: 'video/VP9', width: 3840, height: 2160, bitrate: 2e7, framerate: 60}},
  {type: 'webrtc', video: {contentType: 'video/AV1', width: 1920, height: 1080, bitrate: 4e6, framerate: 30}},
  {type: 'webrtc', video: {contentType: 'video/H264', width: 1920, height: 1080, bitrate: 4e6, framerate: 30}},
];
async function readEncodingInfo() {
  const out = [];
  for (const c of ENC) {
    const r = await navigator.mediaCapabilities.encodingInfo(c);
    out.push([r.supported, r.smooth, r.powerEfficient].map(Number).join(''));
  }
  return out.join(' ');
}

// ------------------------------------------------------------------ the board
// The hooked sibling of each defense: an API it changes at Brave's default level. null: the defense's hook on this
// information acts only at Strict, so nothing is hooked in a default profile.
const SIB = {
  audio: ['AudioBuffer.getChannelData (sum)', readGetChannelData],
  screen: ['Screen.width × height', () => `${screen.width} × ${screen.height}`],
  memory: ['Navigator.deviceMemory', () => navigator.deviceMemory],
  plugins: ['Navigator.plugins', () => [...navigator.plugins].map((p) => p.name).join(', ')],
  webgl: ['WebGL2 getParameter MAX_* limits', readLimits],
  strict: null,
};
const KINDS = {
  unhooked: 'no Brave hook on any path from the protected source',
  around: 'a path around the hook, through a field every object of its type shares',
  'field gap': 'the hook acts in Standard but passes this part of the value unchanged',
  'strict-only': 'the hook acts only at Strict, which Brave hides by default',
};
const ROWS = [
  ['unhooked', 'audio', 'BaseAudioContext.sampleRate', () => readAudioContext('sampleRate')],
  ['unhooked', 'audio', 'AudioContext.baseLatency', () => readAudioContext('baseLatency')],
  ['unhooked', 'audio', 'OfflineAudioContext.startRendering → AudioWorklet (sum)', readThroughWorklet],
  ['unhooked', 'strict', 'CanvasRenderingContext2D.font', () => context2d().font],
  ['unhooked', 'memory', 'MediaCapabilities.encodingInfo', readEncodingInfo],
  ['unhooked', 'plugins', 'Navigator.pdfViewerEnabled', () => navigator.pdfViewerEnabled],
  ['unhooked', 'screen', 'ScreenOrientation.angle', () => screen.orientation.angle],
  ['unhooked', 'screen', 'ScreenOrientation.type', () => screen.orientation.type],
  ['unhooked', 'screen', 'VisualViewport.scale', () => visualViewport.scale],
  ['unhooked', 'screen', 'VisualViewport.width', () => visualViewport.width],
  ['unhooked', 'screen', 'Window.devicePixelRatio', () => devicePixelRatio],
  ['unhooked', 'screen', 'Window.innerWidth', () => innerWidth],
  ['around', 'strict', 'CanvasRenderingContext2D.fillText (pixels via WebGL)', readFillText],
  ['field gap', 'screen', 'Screen.colorDepth', () => screen.colorDepth],
  ['field gap', 'screen', 'Screen.pixelDepth', () => screen.pixelDepth],
  ['field gap', 'webgl', 'WebGL2RenderingContext.getParameter (GPU strings)', readGPUStrings],
  ['strict-only', 'strict', 'CanvasRenderingContext2D.isPointInPath', readIsPointInPath],
  ['strict-only', 'strict', 'CanvasRenderingContext2D.isPointInStroke', readIsPointInStroke],
  ['strict-only', 'strict', 'CanvasRenderingContext2D.measureText', readMeasureText],
  ['strict-only', 'strict', 'Navigator.appVersion', () => navigator.appVersion],
  ['strict-only', 'strict', 'Navigator.userAgent', () => navigator.userAgent],
  ['strict-only', 'strict', 'WebGL2RenderingContext.getShaderPrecisionFormat (SHA-256)', readShaderPrecision],
  ['strict-only', 'strict', 'WebGL2RenderingContext.getSupportedExtensions (SHA-256)', readExtensions],
  ['strict-only', 'strict', 'WebGLCompressedTextureASTC.getSupportedProfiles', readASTC],
].map(([kind, defense, api, read], i) => ({key: 'r' + i, kind, defense, api, read}));

const attempt = async (f) => {  // a value, or the error as text; a read that hangs gives up after 5 s
  try {
    return await Promise.race([Promise.resolve().then(f), sleep(5000).then(() => { throw new Error('timed out after 5 s'); })]);
  } catch (e) { return 'error: ' + (e && e.name || 'Error') + (e && e.message ? ': ' + e.message : ''); }
};

async function readAll(progress) {  // row key -> value; 'sib:<defense>' -> the hooked sibling's value
  const out = {};
  for (const [d, s] of Object.entries(SIB)) if (s) out['sib:' + d] = await attempt(s[1]);
  for (const [i, r] of ROWS.entries()) { progress(`reading ${i + 1} of ${ROWS.length}…`); out[r.key] = await attempt(r.read); }
  return out;
}

let MINE = null, THEIRS = null;
const fmt = (v) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
const same = (a, b) => a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b);
const failed = (v) => typeof v === 'string' && v.startsWith('error: ');

function verdict(r) {
  if (!MINE) return '<span class="muted">press Run</span>';
  if (!THEIRS) return '<span class="muted">paste Chromium\'s results</span>';
  const mine = MINE[r.key], truth = THEIRS[r.key];
  if (failed(mine) || failed(truth)) return '<span class="wait">can\'t read</span>';
  if (!same(mine, truth)) return '<span class="no">no</span><div class="why">differs from Chromium\'s value</div>';
  if (!SIB[r.defense]) return '<span class="yes">yes</span><div class="why">Chromium\'s value; Brave hooks this information only at Strict</div>';
  if (same(MINE['sib:' + r.defense], THEIRS['sib:' + r.defense]))
    return '<span class="wait">not hooked here</span><div class="why">the hooked sibling returns Chromium\'s value too</div>';
  return '<span class="yes">yes</span><div class="why">the hooked sibling differs from Chromium\'s; this API returns Chromium\'s value</div>';
}
// Columns: Chromium's value (pasted), this browser's hooked sibling, this browser's API, the verdict.
function render() {
  const v = (x) => `<div class="v">${esc(fmt(x))}</div>`;
  const api = (name) => `<div class="k">${esc(name)}</div>`;
  let yes = 0, n = 0;
  const rows = [];
  for (const kind of Object.keys(KINDS)) {
    const group = ROWS.filter((r) => r.kind === kind);
    rows.push(`<tr class="grp"><th colspan="4">${kind} (${group.length}) <span class="d">${KINDS[kind]}</span></th></tr>`);
    for (const r of group) {
      const s = SIB[r.defense], verd = verdict(r);
      if (MINE && THEIRS) { n++; if (verd.includes('class="yes"')) yes++; }
      const truth = THEIRS ? api(r.api) + v(THEIRS[r.key]) : '<span class="muted">paste Chromium\'s results</span>';
      const hooked = !MINE ? '' : !s ? '<span class="muted">none in Standard</span>' :
        api(s[0]) + v(MINE['sib:' + r.defense]) + (THEIRS ? `<div class="why">Chromium: ${esc(fmt(THEIRS['sib:' + r.defense]))}</div>` : '');
      const route = MINE ? api(r.api) + v(MINE[r.key]) : '';
      rows.push(`<tr><td>${truth}</td><td class="hooked">${hooked}</td><td class="route">${route}</td><td>${verd}</td></tr>`);
    }
  }
  $('board').innerHTML = rows.join('');
  $('summary').textContent = MINE && THEIRS ? `${yes} of ${n} bypasses work in this browser` : '';
}

function showCode() {
  $('code').textContent = ROWS.map((r) => `// ${r.api}\n${r.read.toString()}`).join('\n') + '\n\n' +
    [pixelsThroughWebGL, context2d, readFillText, readMeasureText, ellipse, readGPUStrings, readLimits, readShaderPrecision,
      readExtensions, readASTC, renderSound, readGetChannelData, readThroughWorklet, readAudioContext, readEncodingInfo]
      .map((f) => f.toString()).join('\n\n');
}

document.addEventListener('DOMContentLoaded', () => {
  showCode();
  render();
  $('run').onclick = async () => {
    $('run').disabled = true;
    try { MINE = await readAll((t) => { $('run-status').textContent = t; }); } catch (e) {
      $('run-status').textContent = 'error: ' + (e && e.message || e);
      $('run').disabled = false;
      return;
    }
    $('run-status').textContent = 'done';
    $('run').disabled = false;
    $('copy').disabled = false;
    render();
  };
  $('copy').onclick = () => {
    $('mine').value = JSON.stringify(MINE);
    $('mine').select();
    if (navigator.clipboard) navigator.clipboard.writeText($('mine').value).catch(() => {});
  };
  $('compare').onclick = () => {
    try { THEIRS = JSON.parse($('theirs').value); $('compare-status').textContent = ''; }
    catch (e) { $('compare-status').textContent = 'cannot read the pasted text: ' + e.message; return; }
    render();
  };
});
