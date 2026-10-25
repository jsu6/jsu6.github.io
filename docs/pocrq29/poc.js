// RQ2: the confirmed bypasses among the 29 that pair with a hooked API, as the five-row page (pocrq2) does. Each row
// reads one piece of information through an API Brave hooks at its default level and through an API among the 29 that
// returns the same value. A bypass works when, in Brave, the hooked API differs from Chromium's (the hook is active)
// and the other API returns Chromium's value of the hooked API (the hook missed it). Nothing is sent or stored; results
// cross windows only by copy and paste.
'use strict';

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ canvas
const W = 240, H = 120;
function drawText(ctx) {  // text on an opaque background (opaque: no alpha premultiplication differs between reads)
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.font = '18px sans-serif'; ctx.fillStyle = '#069'; ctx.fillText('FProots probe é中😀', 12, 60);
}
function textCanvas() {
  const c = Object.assign(document.createElement('canvas'), {width: W, height: H});
  drawText(c.getContext('2d'));
  return c;
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
function readTextGetImageData() { return textCanvas().getContext('2d').getImageData(0, 0, W, H).data; }
// other API: the pixels fillText drew, read back through WebGL; Brave's WebGL read-back hook acts only at Strict
async function readTextThroughWebGL() { return pixelsThroughWebGL(await createImageBitmap(textCanvas())); }

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
// route: the same rendered samples played into a second offline context, where an AudioWorklet sums them
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

// ------------------------------------------------------------------ screen
// hooked: Brave replaces the screen size by the smallest common desktop size at least as large as the window
function readScreenSize() { return `${screen.width} × ${screen.height}`; }
// other APIs: in fullscreen the visual viewport and the window are the screen (called from the Run click, which
// fullscreen needs)
async function readFullscreenViewport() {
  document.documentElement.style.overflow = 'hidden';  // no scrollbar, so the viewport spans the screen
  await Promise.race([document.documentElement.requestFullscreen(),
    sleep(5000).then(() => { throw new Error('fullscreen did not start in 5 s'); })]);
  let last = -1, stable = 0;  // wait until the window manager has resized the window (the width unchanged for 1 s)
  for (let i = 0; i < 100 && stable < 10; i++) {
    await sleep(100);
    stable = visualViewport.width === last ? stable + 1 : 0;
    last = visualViewport.width;
  }
  const sizes = {viewport: `${Math.round(visualViewport.width)} × ${Math.round(visualViewport.height)}`,
                 inner: `${innerWidth} × ${innerHeight}`};
  await Promise.race([document.exitFullscreen(), sleep(2000)]);
  document.documentElement.style.overflow = '';
  return sizes;
}

// ------------------------------------------------------------------ the board
const CHROMIUM = 'https://source.chromium.org/chromium/chromium/src/+/refs/tags/150.0.7871.186:';
const IN = 'ground-truth slices';
const ROWS = [
  {key: 'canvas', info: 'Canvas text pixels (SHA-256)', hooked: 'CanvasRenderingContext2D.getImageData',
   route: 'CanvasRenderingContext2D.fillText → WebGL readPixels', demo: 'canvas',
   source: ['third_party/blink/renderer/platform/graphics/canvas_resource.cc', 331,
            'mapping->GetSkPixmapForPlane(…): the canvas pixels mapped back from GPU memory', IN]},
  {key: 'audio', info: 'Rendered audio samples (sum)', hooked: 'AudioBuffer.getChannelData',
   route: 'OfflineAudioContext.startRendering → AudioWorklet', demo: 'audio',
   source: ['third_party/blink/renderer/modules/webaudio/offline_audio_context.cc', 163,
            'only a feature flag (WebAudioConfigurableRenderQuantumEnabled): the samples are computed in the renderer and have no source of their own', IN]},
  {key: 'viewport', info: 'Screen size (CSS px)', hooked: 'Screen.width × height', route: 'VisualViewport.width × height in fullscreen',
   demo: 'screen', near: 1,
   source: ['ui/display/mojom/screen_infos_mojom_traits.cc', 15, 'the screen information the browser sends the renderer', IN]},
  {key: 'inner', info: 'Screen size (CSS px)', hooked: 'Screen.width × height', route: 'Window.innerWidth × innerHeight in fullscreen',
   demo: 'screen', near: 1,
   source: ['ui/display/mojom/screen_infos_mojom_traits.cc', 15, 'the screen information the browser sends the renderer', IN]},
];

async function sha(bytes) {  // the first 8 bytes of SHA-256, in hex
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const attempt = async (f) => {
  try { return await f(); } catch (e) { return 'error: ' + (e && e.name || 'Error') + (e && e.message ? ': ' + e.message : ''); }
};

async function readAll() {  // row key -> {hooked, route}; the screen first, while the Run click still allows fullscreen
  const size = readScreenSize();
  const full = await attempt(readFullscreenViewport);
  const failed = typeof full === 'string';
  return {
    viewport: {hooked: size, route: failed ? full : full.viewport},
    inner: {hooked: size, route: failed ? full : full.inner},
    canvas: {hooked: await attempt(async () => sha(readTextGetImageData())), route: await attempt(async () => sha(await readTextThroughWebGL()))},
    audio: {hooked: await attempt(readGetChannelData), route: await attempt(readThroughWorklet)},
  };
}

let MINE = null, THEIRS = null;
const fmt = (v) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
// Equal values; screen sizes within 1 px (a fractional devicePixelRatio rounds the two differently).
function same(row, a, b) {
  if (a === undefined || b === undefined) return false;
  if (!row.near || typeof a !== 'string' || typeof b !== 'string') return JSON.stringify(a) === JSON.stringify(b);
  const pa = a.split(' × ').map(Number), pb = b.split(' × ').map(Number);
  return pa.length === 2 && pb.length === 2 && Math.abs(pa[0] - pb[0]) <= row.near && Math.abs(pa[1] - pb[1]) <= row.near;
}

function verdict(r) {
  if (!MINE) return '<span class="muted">press Run</span>';
  if (!THEIRS) return '<span class="muted">paste Chromium\'s results</span>';
  const truth = THEIRS[r.key].hooked;
  const changed = !same(r, MINE[r.key].hooked, truth), leaks = same(r, MINE[r.key].route, truth);
  if (changed && leaks) return '<span class="yes">yes</span><div class="why">the hooked API differs from Chromium\'s; the other API returns Chromium\'s value</div>';
  if (!changed) return '<span class="wait">not hooked here</span><div class="why">the hooked API returns Chromium\'s value in this browser</div>';
  return '<span class="no">no</span><div class="why">the other API differs from Chromium\'s value too</div>';
}
// Columns: Chromium's value of the hooked API (the ground truth, pasted), this browser's hooked API, this browser's route.
function render() {
  const v = (x) => `<div class="v">${esc(fmt(x))}</div>`;
  const api = (name) => `<div class="k">${name}</div>`;
  $('board').innerHTML = ROWS.map((r) => {
    const gt = THEIRS ? THEIRS[r.key] : null, me = MINE ? MINE[r.key] : null;
    const mark = (ok, yes, no) => (gt && me ? `<div class="${ok ? 'ok' : 'muted'}">${ok ? yes : no}</div>` : '');
    const truth = gt ? api(r.hooked) + v(gt.hooked) : '<span class="muted">paste Chromium\'s results</span>';
    const hooked = me ? api(r.hooked) + v(me.hooked) + mark(gt && !same(r, me.hooked, gt.hooked), 'differs from Chromium: hooked', 'same as Chromium') : '';
    const route = me ? api(r.route) + v(me.route) + mark(gt && same(r, me.route, gt.hooked), 'same as Chromium: leaks', 'differs from Chromium') : '';
    return `<tr><td>${r.info}<div><a href="#${r.demo}">how</a></div></td><td>${truth}</td>` +
      `<td class="hooked">${hooked}</td><td class="route">${route}</td><td>${verdict(r)}</td>` +
      `<td class="src"><a href="${CHROMIUM}${r.source[0]};l=${r.source[1]}">${r.source[0].split('/').pop()}:${r.source[1]}</a>` +
      `<div class="why">${esc(r.source[2])}</div><div class="why"><i>in: ${esc(r.source[3])}</i></div></td></tr>`;
  }).join('');
}

function showCode(id, ...fns) { $(id).textContent = fns.map((f) => f.toString()).join('\n\n'); }

document.addEventListener('DOMContentLoaded', () => {
  showCode('code-canvas', drawText, textCanvas, readTextGetImageData, readTextThroughWebGL, pixelsThroughWebGL);
  showCode('code-audio', renderSound, readGetChannelData, readThroughWorklet);
  showCode('code-screen', readScreenSize, readFullscreenViewport);
  render();
  $('run').onclick = async () => {
    $('run').disabled = true;
    $('run-status').textContent = 'reading… (fullscreen for a moment)';
    try { MINE = await readAll(); } catch (e) {
      $('run-status').textContent = 'error: ' + (e && e.message || e);
      $('run').disabled = false;
      return;
    }
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
  if (Q.get('report') === '1') {  // local verification: the harness sends one trusted click anywhere once ready (fullscreen needs it)
    addEventListener('click', (e) => { if (e.target.id !== 'run') $('run').onclick(); }, {once: true});
    fetch('/report', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ready: true, run: (Q.get('run') || 'none') + '.ready.0'})});
  }
});
