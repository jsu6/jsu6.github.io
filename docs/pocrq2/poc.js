// RQ2 proofs of concept: each piece of information read through the API Brave hooks and through an API our
// slices show ending at the same source without passing the hook, in Brave and in Chromium. A bypass works when, in
// Brave, the hooked API differs from Chromium's (the hook is active) and the route still equals Chromium's (the hook
// missed it). Nothing is sent or stored; results cross windows only by copy and paste.
'use strict';

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);

// ------------------------------------------------------------------ canvas
const W = 240, H = 120;
function draw(ctx) {  // the same opaque drawing every time (opaque: no alpha premultiplication differs between reads)
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f60'; ctx.fillRect(10, 10, 100, 40);
  ctx.font = '18px sans-serif'; ctx.fillStyle = '#069'; ctx.fillText('FProots é中😀', 12, 90);
  ctx.beginPath(); ctx.arc(170, 60, 40, 0, 2 * Math.PI); ctx.fillStyle = 'rgba(0,160,80,0.6)'; ctx.fill();
}
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
// hooked: Brave adds per-site noise to the pixels getImageData returns
function readGetImageData() {
  const c = Object.assign(document.createElement('canvas'), {width: W, height: H});
  draw(c.getContext('2d'));
  return c.getContext('2d').getImageData(0, 0, W, H).data;
}
// hooked: Brave adds the noise before toDataURL encodes the PNG; the PNG is decoded here without a 2D read
async function readToDataURL() {
  const c = Object.assign(document.createElement('canvas'), {width: W, height: H});
  draw(c.getContext('2d'));
  const png = await (await fetch(c.toDataURL())).blob();
  return pixelsThroughWebGL(await createImageBitmap(png, {colorSpaceConversion: 'none', premultiplyAlpha: 'none'}));
}
// route: the canvas as an ImageBitmap, read back through WebGL
function readTransferToImageBitmap() {
  const o = new OffscreenCanvas(W, H);
  draw(o.getContext('2d'));
  return pixelsThroughWebGL(o.transferToImageBitmap());
}

// ------------------------------------------------------------------ audio
// hooked: Brave adds per-site noise to the samples getChannelData returns (a 10 kHz triangle wave through a
// compressor, rendered offline; nothing is played)
async function readGetChannelData() {
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 10000;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -50; comp.knee.value = 40; comp.ratio.value = 12; comp.attack.value = 0; comp.release.value = 0.25;
  osc.connect(comp); comp.connect(ctx.destination); osc.start(0);
  const samples = (await ctx.startRendering()).getChannelData(0);
  let s = 0; for (const x of samples) s += Math.abs(x);
  return s;
}
// routes: the output device's sample rate and buffer latency (nothing is played)
async function readAudioDevice() {
  const ctx = new AudioContext();
  const out = {sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency};
  await ctx.close();
  return out;
}

// ------------------------------------------------------------------ screen
// hooked: Brave replaces the screen size with a common desktop size
function readScreenWidth() { return `${screen.width} × ${screen.height}`; }
// routes: other fields of the same screen information
function readScreenRoutes() {
  return {devicePixelRatio: window.devicePixelRatio, orientation: screen.orientation.type, colorDepth: screen.colorDepth};
}

// ------------------------------------------------------------------ plugins
// hooked: Brave renames the PDF plugin and adds two random plugins
function readPlugins() { return [...navigator.plugins].map((p) => p.name).join(', '); }
// route: whether the browser has a PDF viewer
function readPdfViewerEnabled() { return navigator.pdfViewerEnabled; }

// ------------------------------------------------------------------ the board
const CHROMIUM = 'https://source.chromium.org/chromium/chromium/src/+/refs/tags/150.0.7871.186:';
const ROWS = [
  {key: 'canvas1', info: 'Canvas pixels (SHA-256)', hooked: 'CanvasRenderingContext2D.getImageData',
   route: 'OffscreenCanvas.transferToImageBitmap → WebGL readPixels', demo: 'canvas',
   source: ['third_party/blink/renderer/platform/graphics/canvas_resource.cc', 331, 'mapping->GetSkPixmapForPlane(…): the canvas pixels mapped back from GPU memory']},
  {key: 'canvas2', info: 'Canvas pixels (SHA-256)', hooked: 'HTMLCanvasElement.toDataURL',
   route: 'OffscreenCanvas.transferToImageBitmap → WebGL readPixels', demo: 'canvas',
   source: ['third_party/blink/renderer/platform/graphics/canvas_resource.cc', 331, 'the same source']},
  {key: 'audio1', info: 'Audio output device', hooked: 'AudioBuffer.getChannelData (sum)', route: 'BaseAudioContext.sampleRate',
   demo: 'audio', source: ['media/base/audio_parameters.cc', 227, 'AudioParameters: sample_rate']},
  {key: 'audio2', info: 'Audio output device', hooked: 'AudioBuffer.getChannelData (sum)', route: 'AudioContext.baseLatency',
   demo: 'audio', source: ['media/base/audio_parameters.cc', 228, 'AudioParameters: frames_per_buffer']},
  {key: 'screen1', info: 'Screen', hooked: 'Screen.width × height', route: 'Window.devicePixelRatio', demo: 'screen',
   source: ['ui/display/mojom/screen_info_mojom_traits.cc', 21, 'ScreenInfo read from the browser: device_scale_factor']},
  {key: 'screen2', info: 'Screen', hooked: 'Screen.width × height', route: 'ScreenOrientation.type', demo: 'screen',
   source: ['ui/display/mojom/screen_info_mojom_traits.cc', 15, 'ScreenInfo read from the browser: rect']},
  {key: 'screen3', info: 'Screen', hooked: 'Screen.width × height', route: 'Screen.colorDepth', demo: 'screen',
   source: ['ui/display/mojom/screen_infos_mojom_traits.cc', 15, 'ScreenInfos read from the browser']},
  {key: 'plugins', info: 'Plugins', hooked: 'Navigator.plugins (names)', route: 'Navigator.pdfViewerEnabled', demo: 'plugins',
   source: ['third_party/blink/renderer/core/page/plugin_data.cc', 102, 'registry->GetPlugins(&plugins): the plugin list']},
];

async function sha(bytes) {  // the first 8 bytes of SHA-256, in hex
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const attempt = async (f) => { try { return await f(); } catch (e) { return 'error: ' + (e && e.name || e); } };

async function readAll() {  // row key -> {hooked, route}
  const pixels = await attempt(async () => sha(readTransferToImageBitmap()));
  const audioSum = await attempt(readGetChannelData);
  const device = await attempt(readAudioDevice);
  const screenRoutes = await attempt(readScreenRoutes);
  const size = await attempt(readScreenWidth);
  return {
    canvas1: {hooked: await attempt(async () => sha(readGetImageData())), route: pixels},
    canvas2: {hooked: await attempt(async () => sha(await readToDataURL())), route: pixels},
    audio1: {hooked: audioSum, route: device.sampleRate},
    audio2: {hooked: audioSum, route: device.baseLatency},
    screen1: {hooked: size, route: screenRoutes.devicePixelRatio},
    screen2: {hooked: size, route: screenRoutes.orientation},
    screen3: {hooked: size, route: screenRoutes.colorDepth},
    plugins: {hooked: await attempt(readPlugins), route: await attempt(readPdfViewerEnabled)},
  };
}

let MINE = null, THEIRS = null;
const fmt = (v) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function values(api, key, part) {
  const cell = (who, v) => `<div class="cell"><span class="who">${who}</span><span class="v">${esc(fmt(v))}</span></div>`;
  return `<div class="k">${api}</div>` + (THEIRS ? cell('Chromium', THEIRS[key][part]) : '') +
    (MINE ? cell(THEIRS ? 'here' : 'this browser', MINE[key][part]) : '');
}
function verdict(key) {
  if (!MINE) return '<span class="muted">press Run</span>';
  if (!THEIRS) return '<span class="muted">paste Chromium\'s results</span>';
  const changed = !same(MINE[key].hooked, THEIRS[key].hooked), leaks = same(MINE[key].route, THEIRS[key].route);
  if (changed && leaks) return '<span class="yes">yes</span><div class="why">the hook changes the hooked API; the route returns Chromium\'s value</div>';
  if (!changed) return '<span class="wait">no hook here</span><div class="why">the hooked API returns Chromium\'s value in this browser</div>';
  return '<span class="no">no</span><div class="why">the route differs from Chromium\'s here</div>';
}
function render() {
  $('board').innerHTML = ROWS.map((r) => `<tr><td>${r.info}<div><a href="#${r.demo}">how</a></div></td>` +
    `<td class="hooked">${values(r.hooked, r.key, 'hooked')}</td><td class="route">${values(r.route, r.key, 'route')}</td>` +
    `<td>${verdict(r.key)}</td><td class="src"><a href="${CHROMIUM}${r.source[0]};l=${r.source[1]}">` +
    `${r.source[0].split('/').pop()}:${r.source[1]}</a><div class="why">${esc(r.source[2])}</div></td></tr>`).join('');
}

function showCode(id, ...fns) { $(id).textContent = fns.map((f) => f.toString()).join('\n\n'); }

document.addEventListener('DOMContentLoaded', () => {
  showCode('code-canvas', draw, readGetImageData, readToDataURL, readTransferToImageBitmap, pixelsThroughWebGL);
  showCode('code-audio', readGetChannelData, readAudioDevice);
  showCode('code-screen', readScreenWidth, readScreenRoutes);
  showCode('code-plugins', readPlugins, readPdfViewerEnabled);
  render();
  $('run').onclick = async () => {
    $('run').disabled = true;
    $('run-status').textContent = 'reading…';
    MINE = await readAll();
    $('run-status').textContent = 'done';
    $('run').disabled = false;
    $('copy').disabled = false;
    render();
    if (Q.get('report') === '1') {  // local verification only (analysis/rq2/poc_verify.py); on github.io nothing is sent
      fetch('/report', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({run: Q.get('run') || 'none', host: location.hostname, readings: MINE})});
    }
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
  if (Q.get('report') === '1') $('run').onclick();
});
