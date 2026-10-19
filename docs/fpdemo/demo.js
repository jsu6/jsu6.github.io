// FPdemo: each piece of information read twice, through the API Brave hooks and through a
// route that avoids the hook, in Brave and in Chromium. A bypass works when, in Chromium, the
// route equals the hooked API (so it reads the real value); in Brave, the hooked API differs from
// Chromium's (the hook is active); and in Brave, the route still equals Chromium's (the hook
// missed it). Nothing is sent or stored; results cross windows only by copy and paste.
'use strict';

const SCRIPT_URL = document.currentScript.src;  // this file, shown under "The exact code this page runs"
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BRAVE_SRC = 'https://github.com/brave/brave-core/blob/aeb45b6bbb1c16e67ba195ef74d7222a30dce160/' +
  'chromium_src/third_party/blink/renderer/';

async function sha256(bytes) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', copy));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}
const textHash = (s) => sha256(new TextEncoder().encode(s));
const short = async (bytes) => (await sha256(bytes)).slice(0, 16);

// This window's results, and the other window's once pasted.
const ME = { kind: 'fpdemo-results-v1', brave: false, version: '', rows: {}, other: {} };
let THEM = null;

// ------------------------------------------------------------------ the results board

const ROWS = [
  { key: 'screen', info: 'Screen size (CSS px)', hooked: 'screen.width × height', route: 'visualViewport in fullscreen',
    demo: 'screen-demo', size: true },
  { key: 'screenDetails', info: 'Screen size (CSS px), optional', hooked: 'screen.width × height',
    route: 'getScreenDetails().currentScreen', demo: 'screen-demo', size: true, optional: true },
  { key: 'canvas', info: 'Canvas pixels (SHA-256)', hooked: 'getImageData', route: 'WebGL readPixels', demo: 'canvas-demo' },
  { key: 'canvas2', info: 'Canvas pixels (SHA-256)', hooked: 'getImageData', route: 'VideoFrame.copyTo', demo: 'canvas-demo' },
  { key: 'audio', info: 'Audio samples (SHA-256)', hooked: 'AudioBuffer.getChannelData', route: 'AudioWorklet input',
    demo: 'audio-demo' },
  { key: 'webgl', info: 'WebGL 2 limits', hooked: 'MAX_{VERTEX_UNIFORM, FRAGMENT_UNIFORM, VARYING}_COMPONENTS',
    route: '4 × the matching *_VECTORS', demo: 'webgl-demo' },
];

const nameOf = (r) => (r.brave ? 'Brave' : 'Chromium');

// Equal values; screen sizes may differ by 1 px (a fractional devicePixelRatio rounds differently).
function same(row, a, b) {
  if (a === undefined || b === undefined) return false;
  if (!row.size) return a === b;
  const pa = a.split(' × ').map(Number), pb = b.split(' × ').map(Number);
  return Math.abs(pa[0] - pb[0]) <= 1 && Math.abs(pa[1] - pb[1]) <= 1;
}

async function cell(who, value) {
  const div = document.createElement('div');
  div.className = 'cell';
  div.innerHTML = '<span class="who"></span><span class="swatch"></span><span class="v"></span>';
  div.children[0].textContent = who;
  if (value === undefined) {
    div.children[1].style.visibility = 'hidden';
    div.children[2].textContent = '—';
  } else {
    div.children[1].style.background = '#' + (await textHash(value)).slice(0, 6);
    div.children[2].textContent = value;
  }
  return div;
}

// [class, headline, explanation] for one row. The real value is Chromium's hooked API: with no
// hooks there, it returns what the browser actually has.
function judge(row) {
  const me = ME.rows[row.key];
  const them = THEM && THEM.rows[row.key];
  if (!me) return ['wait', row.optional ? 'Optional' : 'Press Run', ''];
  if (!them) {
    if (ME.brave) {
      return ['wait', 'Paste Chromium\'s results',
        same(row, me.hooked, me.route) ? 'Here in Brave the two agree: the hook did not change this value.'
                                       : 'Here in Brave the hooked API and the route disagree.'];
    }
    return ['wait', 'Now compare in Brave', same(row, me.hooked, me.route)
      ? 'Check 1 ✔: here in Chromium the route returns the same value as the hooked API.'
      : 'Check 1 ✘: even here the route differs from the hooked API (see the diagnostics under "How it works").'];
  }
  if (ME.brave && THEM.brave) {
    // Two Brave runs, in different sessions or on different sites: Brave reseeds its noise, the
    // real value stays. A route that stays put while the hooked API moves is not carrying noise.
    const routeSame = same(row, me.route, them.route), hookedMoved = !same(row, me.hooked, them.hooked);
    const why = `${routeSame ? '✔' : '✘'} the route is identical in both Brave runs\n` +
      `${hookedMoved ? '✔' : '–'} the hooked API changed between them (Brave reseeded its noise)`;
    if (routeSame && hookedMoved) return ['yes', 'Route not affected by the noise', why];
    if (!routeSame) return ['no', 'The route changed', why];
    if (row.size) {
      return ['yes', 'Route stable', why + '\nBrave picks its stand-in screen size from the window size, not from a ' +
        'random seed, so the hooked value need not change between sessions.'];
    }
    return ['wait', 'Same noise seed', why + '\nQuit and reopen Brave (a new session) and run again.'];
  }
  if (!ME.brave && !THEM.brave) return ['wait', 'Both windows are Chromium', 'Paste results from a Brave window.'];
  const B = ME.brave ? me : them, C = ME.brave ? them : me;
  const c1 = same(row, C.hooked, C.route), c2 = !same(row, B.hooked, C.hooked), c3 = same(row, B.route, C.hooked);
  const why = `${c1 ? '✔' : '✘'} 1. in Chromium, the route equals the hooked API\n` +
    `${c2 ? '✔' : '✘'} 2. in Brave, the hooked API differs from the real value\n` +
    `${c3 ? '✔' : '✘'} 3. in Brave, the route equals the real value`;
  if (c1 && c2 && c3) return ['yes', 'Yes: bypassed', why];
  if (!c1 && c2 && c3) {
    return ['no', 'Check 1 failed in Chromium', why + '\nBrave\'s route found the real value, but the same route ' +
      'measured something else in the Chromium window' + (row.size ? ': see the screen diagnostics.' : '.')];
  }
  if (!c2) return ['no', 'No: the hook did not change it', why];
  return ['no', 'No', why];
}

async function renderBoard() {
  const tbody = $('board');
  const rows = [];
  for (const row of ROWS) {
    if (row.optional && !ME.rows[row.key] && !(THEM && THEM.rows[row.key])) continue;
    const tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td class="hooked"></td><td class="route"></td><td></td>';
    tr.children[0].innerHTML = `<b></b><div class="why"><a href="#${row.demo}">how it works</a></div>`;
    tr.children[0].querySelector('b').textContent = row.info;
    const me = ME.rows[row.key] || {}, them = (THEM && THEM.rows[row.key]) || {};
    const label = (r) => (r === ME ? `${nameOf(ME)} (here)` : nameOf(THEM));
    for (const [i, part, api] of [[1, 'hooked', row.hooked], [2, 'route', row.route]]) {
      const td = tr.children[i];
      const head = document.createElement('div');
      head.className = 'why';
      head.style.marginTop = '0';
      head.textContent = api;
      td.append(head, await cell(label(ME), me[part]));
      if (THEM) td.append(await cell(label(THEM), them[part]));
    }
    const [cls, head, why] = judge(row);
    tr.children[3].innerHTML = `<span class="verdict ${cls}"></span><div class="why"></div>`;
    tr.children[3].firstChild.textContent = head;
    tr.children[3].lastChild.textContent = why;
    rows.push(tr);
  }
  tbody.replaceChildren(...rows);
  $('mine').value = JSON.stringify(ME);
  $('copy').disabled = !Object.keys(ME.rows).length;
}

// ------------------------------------------------------------------ screen

async function untilScreenSettles(before) {
  // Wait for the viewport to leave its windowed size, then to hold still for a second.
  const size = () => `${visualViewport.width}x${visualViewport.height}`;
  const start = performance.now();
  while (size() === before && performance.now() - start < 3000) await sleep(50);
  let last = size(), since = performance.now();
  while (performance.now() - start < 8000) {
    await sleep(100);
    const now = size();
    if (now !== last) { last = now; since = performance.now(); }
    else if (performance.now() - since > 1000) return;
  }
}

async function measureScreen() {
  const root = document.documentElement, overflow = root.style.overflow;
  const before = `${visualViewport.width}x${visualViewport.height}`;
  root.style.overflow = 'hidden';  // no scrollbar: the viewport is then the whole screen
  try {
    await Promise.race([root.requestFullscreen({ navigationUI: 'hide' }),
      sleep(5000).then(() => { throw new Error('the browser did not enter fullscreen'); })]);
    await untilScreenSettles(before);
    const vw = visualViewport.width, vh = visualViewport.height, vs = visualViewport.scale;
    const iw = innerWidth, ih = innerHeight, ow = outerWidth, oh = outerHeight, fs = !!document.fullscreenElement;
    await document.exitFullscreen();
    root.style.overflow = overflow;
    await sleep(300);
    ME.rows.screen = { hooked: `${screen.width} × ${screen.height}`, route: `${Math.round(vw * vs)} × ${Math.round(vh * vs)}` };
    $('screen-diag').textContent =
      `Before fullscreen, viewport: ${before.replace('x', ' × ')}\n` +
      `In fullscreen (${fs ? 'confirmed' : 'NOT confirmed'}): visualViewport ${vw} × ${vh} (scale ${vs}), ` +
      `innerWidth × innerHeight ${iw} × ${ih}\n` +
      `screen.width × height ${screen.width} × ${screen.height}, availWidth × availHeight ${screen.availWidth} × ${screen.availHeight}\n` +
      `devicePixelRatio ${devicePixelRatio}: the screen in device px is ${Math.round(vw * vs * devicePixelRatio)} × ${Math.round(vh * vs * devicePixelRatio)}\n` +
      `In fullscreen, outerWidth × outerHeight ${ow} × ${oh}: ${ow - iw} × ${oh - ih} px of the window is not page.\n` +
      'If the fullscreen size is not the screen size in Chromium, check that page zoom is 100% (Ctrl+0).';
    // In fullscreen the whole window should be page. Brave reports outerHeight as innerHeight + 0–8 px,
    // so only a larger gap is a sign of browser UI (an infobar) taking part of the screen.
    if (oh - ih > 8 || ow - iw > 8) {
      const warn = `Warning: in fullscreen, ${oh - ih} px of the window height (${ow - iw} px of the width) was not ` +
        'page. A bar under the address bar (an infobar) is probably open in this window. Close it with its × and ' +
        'press Run again.';
      $('screen-diag').textContent += '\n' + warn;
      $('run-status').dataset.warn = warn;
    }
  } catch (e) {
    root.style.overflow = overflow;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    $('screen-diag').textContent = `Screen: could not measure (${e.message}).`;
  }
}

async function measureScreenDetails() {
  if (!window.getScreenDetails) { $('run-status').textContent = 'This browser has no getScreenDetails().'; return; }
  try {
    const d = await window.getScreenDetails();
    const cs = d.currentScreen;
    ME.rows.screenDetails = { hooked: `${screen.width} × ${screen.height}`, route: `${cs.width} × ${cs.height}` };
    $('screen-diag').textContent += '\n\ngetScreenDetails(): ' + d.screens.map((s) =>
      `${s.label || '(no label)'} ${s.width} × ${s.height} at (${s.left}, ${s.top}), devicePixelRatio ${s.devicePixelRatio}`
      + (s === cs ? ' [current]' : '')).join('; ');
  } catch (e) {
    $('run-status').textContent = `Screen details: ${e.name} (${e.message}).`;
  }
}

// ------------------------------------------------------------------ canvas

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

// Route 1: the 2D canvas's pixels, copied into a WebGL texture and read back with readPixels.
async function viaWebGL(c) {
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
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
  const px = new Uint8Array(c.width * c.height * 4);
  gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;  // texture row 0 is the image's top row, as in getImageData
}

// Route 2: the canvas wrapped in a WebCodecs VideoFrame and copied out as RGBA.
async function viaVideoFrame(c) {
  const frame = new VideoFrame(c, { timestamp: 0 });
  try {
    const px = new Uint8Array(c.width * c.height * 4);
    try {
      await frame.copyTo(px, { format: 'RGBA' });
      return px;
    } catch (e) {
      // Older Chromium: no format conversion. Copy the native layout and reorder it.
      const raw = new Uint8Array(frame.allocationSize());
      await frame.copyTo(raw);
      const bgr = frame.format.startsWith('BGR'), opaque = frame.format.endsWith('X');
      for (let i = 0; i < px.length; i += 4) {
        px[i] = raw[bgr ? i + 2 : i]; px[i + 1] = raw[i + 1]; px[i + 2] = raw[bgr ? i : i + 2];
        px[i + 3] = opaque ? 255 : raw[i + 3];
      }
      return px;
    }
  } finally {
    frame.close();
  }
}

function drawDiff(c, a, b) {
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
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
      changed++;
      ctx.fillRect(p % c.width, Math.floor(p / c.width), 1, 1);
    }
  }
  return changed;
}

async function measureCanvas() {
  const notes = [];
  try {
    const c = document.createElement('canvas');  // fresh: no drawing state carried over
    c.width = 300; c.height = 120;
    drawCanvas(c);
    const img = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const hooked = await short(img);
    try {
      const gl = await viaWebGL(c);
      ME.rows.canvas = { hooked, route: await short(gl) };
      notes.push(`WebGL readPixels: ${drawDiff(c, img, gl)} of ${c.width * c.height} pixels differ from getImageData.`);
    } catch (e) { notes.push(`WebGL route: ${e.message}`); }
    try {
      const vf = await viaVideoFrame(c);
      ME.rows.canvas2 = { hooked, route: await short(vf) };
      let n = 0;
      for (let i = 0; i < img.length; i += 4) if (img[i] !== vf[i] || img[i + 1] !== vf[i + 1] || img[i + 2] !== vf[i + 2]) n++;
      notes.push(`VideoFrame.copyTo: ${n} of ${c.width * c.height} pixels differ from getImageData.`);
    } catch (e) { notes.push(`VideoFrame route: ${e.message}`); }
    notes.push(`toDataURL → SHA-256 (also hooked): ${(await textHash(c.toDataURL('image/png'))).slice(0, 16)}`);
  } catch (e) { notes.push(`Canvas: ${e.message}`); }
  $('canvas-diag').textContent = notes.join('\n');
}

// ------------------------------------------------------------------ audio

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

async function measureAudio() {
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
    ME.rows.audio = { hooked: await short(samples), route: await short(captured) };
    $('audio-diag').textContent = `Sum of |samples| 4500–5000: getChannelData ${sum(samples)}, worklet ${sum(captured)}.`;
  } catch (e) {
    $('audio-diag').textContent = `Audio: ${e.message}`;
  }
}

// ------------------------------------------------------------------ WebGL 2 limits

async function measureWebGL() {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) { $('webgl-diag').textContent = 'WebGL 2 is not available.'; return; }
  const pairs = [['MAX_VERTEX_UNIFORM_COMPONENTS', 'MAX_VERTEX_UNIFORM_VECTORS'],
                 ['MAX_FRAGMENT_UNIFORM_COMPONENTS', 'MAX_FRAGMENT_UNIFORM_VECTORS'],
                 ['MAX_VARYING_COMPONENTS', 'MAX_VARYING_VECTORS']];
  const hooked = pairs.map(([c]) => gl.getParameter(gl[c]));
  const route = pairs.map(([, v]) => 4 * gl.getParameter(gl[v]));
  ME.rows.webgl = { hooked: hooked.join(', '), route: route.join(', ') };
  $('webgl-diag').textContent = pairs.map(([c, v], i) => `${c} ${hooked[i]}   4 × ${v} ${route[i]}`).join('\n');
}

// ------------------------------------------------------------------ the other hooked APIs

function mediaMax(feature) {
  let lo = 0, hi = 20000;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (matchMedia(`(min-${feature}: ${mid}px)`).matches) lo = mid; else hi = mid - 1;
  }
  return lo;
}

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
  ['Navigator.queryHandwritingRecognizer', 'modules/handwriting/handwriting_recognition_service.cc',
   'throws NotSupportedError (always)',
   async () => {
     if (!navigator.queryHandwritingRecognizer) return '(absent)';
     await navigator.queryHandwritingRecognizer({ languages: ['en'] });
     return 'answered';
   }],
];

async function measureOther() {
  for (const [api, , , read] of OTHER) {
    let v;
    try { v = await read(); } catch (e) { v = `error: ${e.name}`; }
    ME.other[api] = v === undefined ? '(absent)' : String(v);
  }
}

function renderOther() {
  const rows = OTHER.map(([api, src, hook]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td class="v"></td><td class="v"></td><td class="h"></td>';
    const mine = ME.other[api], theirs = THEM ? THEM.other[api] : undefined;
    tr.children[0].textContent = api;
    tr.children[1].textContent = mine === undefined ? '' : `${nameOf(ME)}: ${mine}`;
    tr.children[2].textContent = theirs === undefined ? '' : `${nameOf(THEM)}: ${theirs}`;
    if (theirs !== undefined && mine !== theirs) tr.children[1].classList.add('diff'), tr.children[2].classList.add('diff');
    tr.children[3].textContent = hook;
    const link = document.createElement('a');
    link.href = BRAVE_SRC + src;
    link.textContent = src;
    tr.children[3].append(document.createElement('br'), link);
    return tr;
  });
  $('other-table').replaceChildren(...rows);
}

// ------------------------------------------------------------------ wiring

async function describeBrowser() {
  try { ME.brave = !!(navigator.brave && await navigator.brave.isBrave()); } catch (e) { ME.brave = false; }
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  const chromium = brands.find((b) => b.brand === 'Chromium');
  const m = navigator.userAgent.match(/Chrom(?:e|ium)\/(\d+)/);
  ME.version = chromium ? chromium.version : (m ? m[1] : '?');
  $('browser').innerHTML = `${ME.brave ? 'BRAVE' : 'CHROMIUM (not Brave)'} · version ${ME.version}` +
    `<small>${ME.brave ? 'Compare with Chromium: run here, then paste Chromium\'s results in step 3.'
                       : 'Run here, then copy the results into the Brave window (step 2).'}</small>`;
}

async function measureQuiet() {
  await measureCanvas();
  await measureAudio();
  await measureWebGL();
  await measureOther();
  await renderBoard();
  renderOther();
}

$('run-all').addEventListener('click', async () => {
  $('run-status').textContent = 'Measuring the screen (fullscreen for a moment)…';
  await measureScreen();             // first, while the click still allows fullscreen
  $('run-status').textContent = 'Reading the rest…';
  await measureQuiet();
  $('run-status').textContent = $('run-status').dataset.warn || 'Done.';
  delete $('run-status').dataset.warn;
});

$('run-details').addEventListener('click', async () => {
  $('run-status').textContent = 'Asking for screen details…';
  await measureScreenDetails();
  await renderBoard();
  if (ME.rows.screenDetails) $('run-status').textContent = 'Done.';
});

$('copy').addEventListener('click', async () => {
  const text = $('mine').value;
  try { await navigator.clipboard.writeText(text); $('copy-status').textContent = 'Copied.'; }
  catch (e) { $('mine').select(); document.execCommand('copy'); $('copy-status').textContent = 'Copied (selected).'; }
});

$('compare').addEventListener('click', async () => {
  try {
    const t = JSON.parse($('theirs').value.trim());
    if (!t || t.kind !== ME.kind || !t.rows) throw new Error('not FPdemo results');
    THEM = t;
    let note = `Comparing with ${nameOf(THEM)} ${THEM.version}.`;
    if (THEM.version !== ME.version) note += ` The versions differ (${ME.version} here); use the same version.`;
    $('compare-status').textContent = note;
    await renderBoard();
    renderOther();
    $('board').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    $('compare-status').textContent = `Could not read the pasted text: ${e.message}.`;
  }
});

// ------------------------------------------------------------------ the exact code this page runs

async function showCode() {
  try {
    const text = await (await fetch(SCRIPT_URL)).text();
    const lines = text.split('\n');
    const pre = $('code');
    pre.replaceChildren(...lines.map((line, i) => {
      const div = document.createElement('div');
      div.id = `L${i + 1}`;
      div.innerHTML = '<span class="ln"></span><span></span>';
      div.firstChild.textContent = String(i + 1);
      div.lastChild.textContent = line || ' ';
      return div;
    }));
    const index = [];
    lines.forEach((line, i) => {
      const m = line.match(/^(?:async )?function (\w+)|^const (WORKLET|OTHER|ROWS) =/);
      if (m) index.push([m[1] || m[2], i + 1]);
    });
    $('code-index').replaceChildren(...index.map(([name, n]) => {
      const a = document.createElement('a');
      a.href = `#L${n}`;
      a.textContent = `${name} (line ${n})`;
      return a;
    }));
    $('code-hash').textContent = `${SCRIPT_URL.replace(location.origin, '')}: ${lines.length} lines, ` +
      `SHA-256 ${await textHash(text)}`;
  } catch (e) {
    $('code-hash').textContent = `Could not load the script text: ${e.message}`;
  }
}

$('code-index').addEventListener('click', (e) => {
  if (e.target.closest('a')) $('code-view').open = true;
});

$('board').addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (a) { const d = document.querySelector(a.getAttribute('href')); if (d) d.open = true; }
});

drawCanvas($('canvas-shown'));
showCode();
describeBrowser().then(() => { renderBoard(); return measureQuiet(); });
