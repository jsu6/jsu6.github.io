// FPdemo: each piece of information read twice, through the API Brave hooks and through a
// route that avoids the hook. In Chromium the two agree; in Brave they disagree, and the
// route's value matches Chromium's. Nothing is sent or stored anywhere.
'use strict';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ display helpers

async function sha256(bytes) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', copy));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}
const textHash = (s) => sha256(new TextEncoder().encode(s));

// A value with a colour swatch derived from it, so two windows compare at a glance.
async function setVal(id, text, sub) {
  const el = $(id);
  const colour = '#' + (await textHash(text)).slice(0, 6);
  el.innerHTML = '<span class="swatch"></span><span></span>';
  el.firstChild.style.background = colour;
  el.lastChild.textContent = text;
  if (sub !== undefined) $(id + '-sub').textContent = sub;
}

function setVerdict(id, same, what) {
  const el = $(id);
  if (same) {
    el.className = 'verdict same';
    el.innerHTML = 'Same value on both sides: nothing is changing this here.' +
      '<small>Expected in Chromium. In Brave it means the hook is off for this site.</small>';
  } else {
    el.className = 'verdict bypass';
    el.innerHTML = `Hook bypassed: the hooked API and the route disagree.` +
      `<small>Brave changed the hooked API's ${what}; the route still reads the real one. ` +
      `Check that the route's value matches the Chromium window.</small>`;
  }
}

function setError(id, e) {
  const el = $(id);
  el.className = 'verdict wait';
  el.textContent = `Could not run: ${e.message}`;
}

async function describeBrowser() {
  let brave = false;
  try { brave = !!(navigator.brave && await navigator.brave.isBrave()); } catch (e) { brave = false; }
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  const chromium = brands.find((b) => b.brand === 'Chromium');
  const version = chromium ? `Chromium ${chromium.version}` : '';
  $('browser').innerHTML = `${brave ? 'BRAVE' : 'NOT BRAVE'}${version ? ' · ' + version : ''}` +
    `<small>${brave ? 'Hooks active (Shields up, Standard): expect red verdicts.'
                    : 'No Brave hooks here: expect green verdicts.'}</small>`;
}

// ------------------------------------------------------------------ 1. screen

// The largest N for which (min-<feature>: Npx) matches.
function mediaMax(feature) {
  let lo = 0, hi = 20000;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (matchMedia(`(min-${feature}: ${mid}px)`).matches) lo = mid; else hi = mid - 1;
  }
  return lo;
}

async function untilStable() {
  // Wait for the viewport to settle after entering fullscreen.
  let last = '', since = performance.now();
  const start = performance.now();
  while (performance.now() - start < 5000) {
    await sleep(100);
    const now = `${visualViewport.width}x${visualViewport.height}`;
    if (now !== last) { last = now; since = performance.now(); }
    else if (performance.now() - since > 600) return;
  }
}

function showScreenHooked() {
  return setVal('screen-hooked', `${screen.width} × ${screen.height}`,
    `device-width media query: ${mediaMax('device-width')} × ${mediaMax('device-height')}\n` +
    `outerWidth × outerHeight: ${outerWidth} × ${outerHeight}`);
}

async function runScreen() {
  const root = document.documentElement, overflow = root.style.overflow;
  root.style.overflow = 'hidden';  // no scrollbar: the viewport is then the whole screen
  try {
    await Promise.race([root.requestFullscreen({ navigationUI: 'hide' }),
      sleep(5000).then(() => { throw new Error('the browser did not enter fullscreen'); })]);
    await untilStable();
    const w = Math.round(visualViewport.width * visualViewport.scale);
    const h = Math.round(visualViewport.height * visualViewport.scale);
    const dpr = devicePixelRatio;
    await document.exitFullscreen();
    root.style.overflow = overflow;
    await sleep(300);
    await showScreenHooked();
    await setVal('screen-route', `${w} × ${h}`,
      `× devicePixelRatio ${dpr} = ${Math.round(w * dpr)} × ${Math.round(h * dpr)} device px\n` +
      `screen.orientation.type: ${screen.orientation ? screen.orientation.type : '(absent)'}`);
    // Within 1 px: at a fractional devicePixelRatio the viewport can round differently.
    const same = Math.abs(w - screen.width) <= 1 && Math.abs(h - screen.height) <= 1;
    setVerdict('screen-verdict', same, 'screen size');
  } catch (e) {
    root.style.overflow = overflow;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    setError('screen-verdict', e);
  }
}

// ------------------------------------------------------------------ 2. canvas

function drawCanvas(c) {
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);   // opaque, so alpha handling cannot differ between the reads
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f60';
  ctx.fillRect(125, 1, 62, 20);
  ctx.fillStyle = '#069';
  ctx.font = '15px Arial';
  ctx.fillText('Cwm fjordbank glyphs vext quiz, \u{1F603}', 2, 18);
  ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
  ctx.font = '18px "Times New Roman"';
  ctx.fillText('Cwm fjordbank glyphs vext quiz, \u{1F603}', 4, 48);
  const g = ctx.createLinearGradient(0, 60, 300, 120);
  g.addColorStop(0, '#d0021b'); g.addColorStop(1, '#2f5d8a');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(60, 90, 26, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgb(255,0,255)'; ctx.beginPath(); ctx.arc(90, 90, 26, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgb(0,255,255)'; ctx.beginPath(); ctx.arc(120, 90, 26, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = 8; ctx.shadowColor = '#000'; ctx.fillStyle = '#ffd400';
  ctx.fillRect(170, 70, 100, 36);
}

// The 2D canvas's pixels, copied into a WebGL texture and read back with readPixels.
async function webglReadback(c) {
  const bitmap = await createImageBitmap(c, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const glc = document.createElement('canvas');
  glc.width = c.width; glc.height = c.height;
  const gl = glc.getContext('webgl', { antialias: false, premultipliedAlpha: false });
  if (!gl) throw new Error('WebGL is not available');
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
  const px = new Uint8Array(c.width * c.height * 4);
  gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;  // texture row 0 is the image's top row, as in getImageData
}

// Red where the two reads differ, over a faint copy of the drawing.
function drawDiff(c, img, gl) {
  const ctx = $('canvas-diff').getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalAlpha = 0.2;
  ctx.drawImage(c, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ff0000';
  let changed = 0;
  for (let p = 0; p < c.width * c.height; p++) {
    const i = p * 4;
    if (img[i] !== gl[i] || img[i + 1] !== gl[i + 1] || img[i + 2] !== gl[i + 2] || img[i + 3] !== gl[i + 3]) {
      changed++;
      ctx.fillRect(p % c.width, Math.floor(p / c.width), 1, 1);
    }
  }
  return changed;
}

async function runCanvas() {
  try {
    const c = document.createElement('canvas');  // fresh: no drawing state carried over
    c.width = 300; c.height = 120;
    drawCanvas(c);
    const img = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const url = c.toDataURL('image/png');
    const gl = await webglReadback(c);
    const changed = drawDiff(c, img, gl);
    const hooked = (await sha256(img)).slice(0, 16), route = (await sha256(gl)).slice(0, 16);
    await setVal('canvas-hooked', hooked, `toDataURL → SHA-256: ${(await textHash(url)).slice(0, 16)}`);
    await setVal('canvas-route', route, `${changed} of ${c.width * c.height} pixels differ from getImageData`);
    setVerdict('canvas-verdict', hooked === route, 'pixels');
  } catch (e) {
    setError('canvas-verdict', e);
  }
}

// ------------------------------------------------------------------ 3. audio

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    const block = input.length ? input[0] : new Float32Array(output[0].length);
    output[0].set(block);
    this.port.postMessage({ frame: currentFrame, data: block.slice() });
    return true;
  }
}
registerProcessor('fpdemo-tap', Tap);`;

const FRAMES = 5000;

async function runAudio() {
  try {
    const ctx = new OfflineAudioContext(1, FRAMES, 44100);
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 10000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -50; comp.knee.value = 40; comp.ratio.value = 12;
    comp.attack.value = 0; comp.release.value = 0.25;
    const tap = new AudioWorkletNode(ctx, 'fpdemo-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const captured = new Float32Array(FRAMES);
    let got = 0;
    tap.port.onmessage = (e) => {
      const { frame, data } = e.data;
      const n = Math.max(0, Math.min(data.length, FRAMES - frame));
      captured.set(data.subarray(0, n), frame);
      got += n;
    };
    osc.connect(comp).connect(tap).connect(ctx.destination);
    osc.start(0);
    const buffer = await ctx.startRendering();
    const start = performance.now();
    while (got < FRAMES && performance.now() - start < 3000) await sleep(20);
    if (got < FRAMES) throw new Error(`the worklet delivered ${got} of ${FRAMES} frames`);
    const samples = buffer.getChannelData(0);
    const sum = (a) => { let s = 0; for (let i = 4500; i < FRAMES; i++) s += Math.abs(a[i]); return s; };
    const hooked = (await sha256(samples)).slice(0, 16), route = (await sha256(captured)).slice(0, 16);
    await setVal('audio-hooked', hooked, `sum |samples| 4500–5000: ${sum(samples)}`);
    await setVal('audio-route', route, `sum |samples| 4500–5000: ${sum(captured)}`);
    setVerdict('audio-verdict', hooked === route, 'samples');
  } catch (e) {
    setError('audio-verdict', e);
  }
}

// ------------------------------------------------------------------ 4. the other hooked APIs

const BRAVE_SRC = 'https://github.com/brave/brave-core/blob/aeb45b6bbb1c16e67ba195ef74d7222a30dce160/' +
  'chromium_src/third_party/blink/renderer/';

// [API, Brave's override under BRAVE_SRC, what the hook does, how to read the API]
const OTHER = [
  ['Navigator.hardwareConcurrency', 'core/execution_context/navigator_base.cc', 'a random value between 2 and the real count',
   () => navigator.hardwareConcurrency],
  ['Navigator.deviceMemory', 'core/frame/navigator_device_memory.cc', 'a random value between 4 and the real size',
   () => navigator.deviceMemory],
  ['Navigator.languages', 'core/frame/navigator_language.cc', 'only the first language',
   () => JSON.stringify(navigator.languages)],
  ['Navigator.plugins', 'modules/plugins/dom_plugin_array.cc', 'randomised PDF plugin names, plus fake plugins',
   () => JSON.stringify(Array.from(navigator.plugins || [], (p) => p.name))],
  ['MediaDevices.enumerateDevices (kinds)', 'modules/mediastream/media_devices.cc', 'order shuffled after the first device',
   async () => JSON.stringify((await navigator.mediaDevices.enumerateDevices()).map((d) => d.kind))],
  ['SpeechSynthesis.getVoices', 'modules/speech/speech_synthesis.cc', 'the real voices plus one fake voice',
   async () => {
     let v = speechSynthesis.getVoices();
     for (let i = 0; i < 20 && !v.length; i++) { await sleep(100); v = speechSynthesis.getVoices(); }
     return `${v.length} voices, names ${(await textHash(v.map((x) => x.name).join('\n'))).slice(0, 8)}`;
   }],
  ['Window.outerWidth × outerHeight', 'core/frame/local_dom_window.cc', 'innerWidth/innerHeight + random 0–8 px',
   () => `${outerWidth} × ${outerHeight}`],
  ['Window.screenX, screenY', 'core/frame/local_dom_window.cc', 'random 0–8',
   () => `${screenX}, ${screenY}`],
  ['CSS device-width × device-height', 'core/css/media_values.cc', 'the viewport size + random 0–8 px',
   () => `${mediaMax('device-width')} × ${mediaMax('device-height')}`],
  ['Navigator.keyboard', 'modules/keyboard/navigator_keyboard.cc', 'null',
   () => (navigator.keyboard ? 'present' : String(navigator.keyboard))],
  ['Navigator.getBattery()', 'modules/battery/battery_manager.cc', 'fixed: charging, full (even with Shields off)',
   async () => {
     if (!navigator.getBattery) return '(absent)';
     const b = await navigator.getBattery();
     return `charging ${b.charging}, level ${b.level}, chargingTime ${b.chargingTime}, dischargingTime ${b.dischargingTime}`;
   }],
  ['Navigator.connection', 'platform/bindings/idl_member_installer.cc', 'removed (even with Shields off)',
   () => (navigator.connection ? 'present' : '(absent)')],
  ['StorageManager.estimate().quota', 'bindings/modules/v8/v8_storage_estimate.h', 'fixed at 2 GiB (2147483648)',
   async () => (await navigator.storage.estimate()).quota],
  ['Navigator.queryHandwritingRecognizer', 'modules/handwriting/handwriting_recognition_service.cc', 'throws NotSupportedError (always)',
   async () => {
     if (!navigator.queryHandwritingRecognizer) return '(absent)';
     await navigator.queryHandwritingRecognizer({ languages: ['en'] });
     return 'answered';
   }],
  ['WebGL2 getParameter(MAX_VERTEX_UNIFORM_COMPONENTS)', 'modules/webgl/webgl2_rendering_context_base.cc', 'the real value or 1 less, per site and session',
   () => {
     const gl = document.createElement('canvas').getContext('webgl2');
     return gl ? gl.getParameter(gl.MAX_VERTEX_UNIFORM_COMPONENTS) : '(absent)';
   }],
];

async function runOther() {
  const tbody = $('other-table');
  tbody.textContent = '';
  for (const [api, src, hook, read] of OTHER) {
    let v;
    try { v = await read(); } catch (e) { v = `error: ${e.name}`; }
    const tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td class="v"></td><td class="h"></td>';
    tr.children[0].textContent = api;
    tr.children[1].textContent = v === undefined ? '(absent)' : String(v);
    tr.children[2].textContent = hook;
    const link = document.createElement('a');
    link.href = BRAVE_SRC + src;
    link.textContent = src;
    tr.children[2].append(document.createElement('br'), link);
    tbody.appendChild(tr);
  }
}

// ------------------------------------------------------------------ start

$('run-screen').addEventListener('click', runScreen);
drawCanvas($('canvas-shown'));
describeBrowser();
showScreenHooked();
runCanvas().then(runAudio).then(runOther);
