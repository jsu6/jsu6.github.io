// Built by analysis/web_poc.py from out/experiments/3.4/pages/probe.js and analysis/web_poc/web.js.
// 3.4 probes: one entry per candidate API. Each probe returns the API's value (awaited); the page
// serializes it deterministically and posts all results to /report. Written before any measurement.
'use strict';

const TIMEOUT_MS = 15000;

async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isBuffer(v) {
  return v instanceof ArrayBuffer || ArrayBuffer.isView(v) ||
    (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer);
}

function bytesOf(v) {
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice();
}

// Deterministic serialization: primitives as JSON, buffers as sha256, nodes by tag, other objects as
// sorted own enumerable properties plus prototype-chain getters (functions skipped), depth-limited.
async function ser(v, depth = 0, seen = new Set()) {
  if (v === undefined) return {$undefined: true};
  if (v === null) return null;
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v) ? v : {$num: String(v)};
  if (t === 'bigint') return {$bigint: String(v)};
  if (t === 'string' || t === 'boolean') return v;
  if (t === 'function' || t === 'symbol') return {$type: t};
  if (isBuffer(v)) return {$sha256: await sha256(bytesOf(v)), $len: v.byteLength};
  if (typeof ImageData !== 'undefined' && v instanceof ImageData) {
    return {$ImageData: true, width: v.width, height: v.height, colorSpace: v.colorSpace,
      pixelFormat: v.pixelFormat, data: await ser(v.data, depth + 1, seen)};
  }
  if (typeof Node !== 'undefined' && v instanceof Node) {
    return {$node: v.nodeName, id: v.id || null};
  }
  if (v instanceof Promise) return {$promise: true};
  if (seen.has(v) || depth > 3) return {$ref: Object.prototype.toString.call(v)};
  seen.add(v);
  if (Array.isArray(v) || (typeof v.length === 'number' && typeof v.item === 'function')) {
    const out = [];
    for (let i = 0; i < v.length; i++) out.push(await ser(v[i], depth + 1, seen));
    return out;
  }
  if (v instanceof Map) {
    const ent = [];
    for (const [k, x] of v) ent.push([String(k), await ser(x, depth + 1, seen)]);
    ent.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return {$map: ent};
  }
  const keys = new Set(Object.keys(v));
  for (let p = Object.getPrototypeOf(v); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(p))) {
      if (d.get && k !== '__proto__') keys.add(k);
    }
  }
  const out = {$class: Object.prototype.toString.call(v).slice(8, -1)};
  for (const k of [...keys].sort()) {
    let x;
    try { x = v[k]; } catch (e) { out[k] = {$error: e.name}; continue; }
    if (typeof x === 'function') continue;
    out[k] = await ser(x, depth + 1, seen);
  }
  return out;
}

function sortedJSON(v) {
  if (Array.isArray(v)) return '[' + v.map(sortedJSON).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + sortedJSON(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
function fail(name, msg) { const e = new Error(msg); e.name = name; return e; }
function need(cond, what) { if (!cond) throw fail('NotExposed', what + ' is not exposed'); }

async function pixelHash(canvas) {
  const ctx = canvas.getContext('2d');
  return sha256(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
}

function canvas2d(w = 120, h = 40) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// Shared fixtures, created lazily once per load.
const once = (f) => { let p; return () => (p ||= f()); };

const iceFixture = once(async () => {
  const pc = new RTCPeerConnection();
  pc.createDataChannel('probe');
  const cands = [];
  const done = new Promise((res) => {
    pc.onicecandidate = (e) => { if (e.candidate) cands.push(e.candidate); else res(); };
    setTimeout(res, 3000);
  });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await done;
  return {pc, offer, cands};
});

async function candidateAttr(name) {
  const {cands} = await iceFixture();
  if (!cands.length) throw fail('NoCandidate', 'no ICE candidate gathered');
  const vals = [];
  for (const c of cands) vals.push(sortedJSON(await ser(name === 'toJSON' ? c.toJSON() : c[name])));
  return vals.sort();
}

const audioFixture = once(async () => {
  const ctx = new AudioContext();
  const msgs = [];
  await ctx.audioWorklet.addModule('worklet.js');
  const node = new AudioWorkletNode(ctx, 'probe');
  const got = new Promise((res) => {
    node.port.onmessage = (m) => { msgs.push(m.data); if (m.data.kind === 'process') res(); };
    setTimeout(res, 10000);
  });
  node.connect(ctx.destination);
  await ctx.resume();
  await got;
  return {ctx, msgs};
});

async function renderPeriodicWave(make) {
  const off = new OfflineAudioContext(1, 4410, 44100);
  const real = new Float32Array([0, 0.4, 0.3, 0.2, 0.1]);
  const imag = new Float32Array([0, 0.1, 0.2, 0.3, 0.4]);
  const wave = make(off, real, imag);
  const osc = off.createOscillator();
  osc.setPeriodicWave(wave);
  osc.frequency.value = 441;
  osc.connect(off.destination);
  osc.start();
  const buf = await off.startRendering();
  return {wave: await ser(wave), rendered: await sha256(bytesOf(buf.getChannelData(0)))};
}

const gl1 = once(() => document.createElement('canvas').getContext('webgl'));
const gl2 = once(() => document.createElement('canvas').getContext('webgl2'));

function texParams(gl, names) {
  need(gl, 'WebGL context');
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const out = {};
  for (const n of names) out[n] = gl.getTexParameter(gl.TEXTURE_2D, gl[n]);
  return out;
}

const gpuDevice = once(async () => {
  need(navigator.gpu, 'navigator.gpu');
  const a = await navigator.gpu.requestAdapter();
  if (!a) throw fail('NotSupportedError', 'no WebGPU adapter');
  return a.requestDevice();
});

const keySystem = once(async () => navigator.requestMediaKeySystemAccess('org.w3.clearkey', [{
  initDataTypes: ['webm'], videoCapabilities: [{contentType: 'video/webm; codecs="vp9"'}],
  audioCapabilities: [{contentType: 'audio/webm; codecs="opus"'}]}]));

const screenDetails = once(async () => {
  need(window.getScreenDetails, 'getScreenDetails');
  const st = (await navigator.permissions.query({name: 'window-management'})).state;
  if (st !== 'granted') throw fail('NotAllowedError', 'window-management permission is ' + st);
  return window.getScreenDetails();
});
const screenAttr = (k) => async () => (await screenDetails()).screens[0][k];

const nocharsetDoc = once(() => new Promise((res, rej) => {
  const f = document.createElement('iframe');
  f.src = 'nocharset.html';
  f.style.display = 'none';
  f.onload = () => res(f.contentDocument);
  f.onerror = rej;
  document.body.appendChild(f);
}));

function textBox(wrap) {
  const d = document.createElement('div');
  d.style.cssText = 'width:120px;height:40px;overflow:auto;font:16px sans-serif;' +
    (wrap ? '' : 'white-space:nowrap;');
  d.textContent = 'The quick brown fox jumps over the lazy dog 0123456789';
  document.getElementById('stage').appendChild(d);
  return d;
}

function svgEl(markup) {
  const host = document.createElement('div');
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40">${markup}</svg>`;
  document.getElementById('stage').appendChild(host);
  return host.firstElementChild;
}

async function clusterDraw(method) {
  const [c, ctx] = canvas2d();
  ctx.font = '20px sans-serif';
  const m = ctx.measureText('Hg fi');
  need(m.getTextClusters, 'TextMetrics.getTextClusters');
  const ret = [];
  for (const cl of m.getTextClusters()) ret.push(await ser(ctx[method](cl, 5, 28)));
  return {ret, pixels: await pixelHash(c)};
}

async function elementImageCanvas() {
  const c = document.createElement('canvas');
  c.width = 160; c.height = 40;
  c.setAttribute('layoutsubtree', '');
  const div = document.createElement('div');
  div.style.cssText = 'font:16px sans-serif;width:150px';
  div.textContent = 'Element image Hg';
  c.appendChild(div);
  document.getElementById('stage').appendChild(c);
  await raf(); await raf();
  return [c, div];
}

const P = {
  'Navigator.presentation': async () => navigator.presentation,
  'NavigatorUAData.toJSON': async () => navigator.userAgentData.toJSON(),
  'ScreenDetailed.highDynamicRangeHeadroom': screenAttr('highDynamicRangeHeadroom'),
  'SVGTextContentElement.getNumberOfChars': async () => svgEl('<text x="1" y="20">abc</text>').firstElementChild.getNumberOfChars(),
  'Plugin.namedItem': async () => { need(navigator.plugins.length, 'a plugin'); return navigator.plugins[0].namedItem('application/pdf'); },
  'MimeType.enabledPlugin': async () => { need(navigator.mimeTypes.length, 'a mime type'); return navigator.mimeTypes[0].enabledPlugin; },
  'WorkerNavigator.deviceMemory': () => new Promise((res, rej) => {
    const w = new Worker('worker.js');
    w.onmessage = (m) => { res(m.data.deviceMemory); w.terminate(); };
    w.onerror = (e) => rej(fail('WorkerError', e.message));
  }),
  'Navigator.requestMediaKeySystemAccess': async () => {
    const out = {};
    for (const ks of ['org.w3.clearkey', 'com.widevine.alpha']) {
      try {
        const a = await navigator.requestMediaKeySystemAccess(ks, [{initDataTypes: ['cenc', 'webm'],
          videoCapabilities: [{contentType: 'video/webm; codecs="vp9"'}, {contentType: 'video/mp4; codecs="avc1.42E01E"'}],
          audioCapabilities: [{contentType: 'audio/webm; codecs="opus"'}, {contentType: 'audio/mp4; codecs="mp4a.40.2"'}]}]);
        out[ks] = await ser(a.getConfiguration());
      } catch (e) { out[ks] = {$rejected: e.name}; }
    }
    return out;
  },
  'SVGTextContentElement.getRotationOfChar': async () => svgEl('<text x="1" y="20" rotate="15">abc</text>').firstElementChild.getRotationOfChar(0),
  'Window.restore': async () => { need(window.restore, 'window.restore'); return window.restore(); },
  'Window.maximize': async () => { need(window.maximize, 'window.maximize'); return window.maximize(); },
  'CanvasCaptureMediaStreamTrack.canvas': async () => { const [c] = canvas2d(); c.id = 'cap'; return c.captureStream().getVideoTracks()[0].canvas; },
  'ScreenDetailed.whitePointX': screenAttr('whitePointX'),
  'ScreenDetailed.redPrimaryX': screenAttr('redPrimaryX'),
  'Window.minimize': async () => { need(window.minimize, 'window.minimize'); return window.minimize(); },
  'ImageData.colorSpace': async () => { const [, ctx] = canvas2d(); return ctx.getImageData(0, 0, 1, 1).colorSpace; },
  'ScreenDetailed.greenPrimaryY': screenAttr('greenPrimaryY'),
  'ScreenDetailed.bluePrimaryY': screenAttr('bluePrimaryY'),
  'ScreenDetailed.hdrHeadroom': screenAttr('hdrHeadroom'),
  'ScreenDetailed.bluePrimaryX': screenAttr('bluePrimaryX'),
  'ScreenDetailed.redPrimaryY': screenAttr('redPrimaryY'),
  'ScreenDetailed.whitePointY': screenAttr('whitePointY'),
  'SVGSVGElement.animationsPaused': async () => svgEl('').animationsPaused(),
  'ScreenDetailed.greenPrimaryX': screenAttr('greenPrimaryX'),
  'PreferenceObject.value': async () => {
    need(navigator.preferences, 'navigator.preferences');
    const out = {};
    for (const k of ['colorScheme', 'contrast', 'reducedMotion', 'reducedTransparency', 'reducedData']) {
      out[k] = navigator.preferences[k] ? navigator.preferences[k].value : {$missing: true};
    }
    return out;
  },
  'HTMLCanvasElement.transferControlToOffscreen': async () => { const [c] = [Object.assign(document.createElement('canvas'), {width: 30, height: 20})]; return c.transferControlToOffscreen(); },
  'Window.requestResize': async () => { need(window.requestResize, 'window.requestResize'); return window.requestResize(); },
  'RTCIceCandidate.sdpMLineIndex': () => candidateAttr('sdpMLineIndex'),
  'RTCIceCandidate.priority': () => candidateAttr('priority'),
  'HTMLCanvasElement.configureHighDynamicRange': async () => {
    const [c, ctx] = canvas2d();
    need(c.configureHighDynamicRange, 'configureHighDynamicRange');
    const ret = await ser(c.configureHighDynamicRange({mode: 'extended'}));
    ctx.fillStyle = 'color(srgb 1 0.5 0)'; ctx.fillRect(10, 10, 50, 20);
    return {ret, pixels: await pixelHash(c)};
  },
  'WheelEvent.momentum': async () => { throw fail('NeedsGesture', 'trusted wheel event needs a user gesture'); },
  'RTCIceCandidate.foundation': () => candidateAttr('foundation'),
  'CanvasRenderingContext2D.reset': async () => {
    const [c, ctx] = canvas2d();
    ctx.font = '16px sans-serif'; ctx.fillText('reset Hg', 5, 25);
    const ret = await ser(ctx.reset());
    return {ret, pixels: await pixelHash(c)};
  },
  'RTCIceCandidate.url': () => candidateAttr('url'),
  'PeriodicWave.constructor': () => renderPeriodicWave((ctx, real, imag) => new PeriodicWave(ctx, {real, imag})),
  'RTCIceCandidate.sdpMid': () => candidateAttr('sdpMid'),
  'RTCIceCandidate.usernameFragment': () => candidateAttr('usernameFragment'),
  'OffscreenCanvasRenderingContext2D.drawElementImage': async () => {
    const [c, div] = await elementImageCanvas();
    need(c.captureElementImage, 'captureElementImage');
    const oc = c.transferControlToOffscreen();
    const img = c.captureElementImage(div);
    const octx = oc.getContext('2d');
    const ret = await ser(octx.drawElementImage(img, 0, 0));
    return {ret, pixels: await sha256(octx.getImageData(0, 0, 160, 40).data)};
  },
  'AudioWorkletGlobalScope.currentTime': async () => {
    const {msgs} = await audioFixture();
    const m = msgs.find((x) => x.kind === 'process');
    if (!m) throw fail('NoProcess', 'AudioWorkletProcessor.process was not called');
    return m.currentTime;
  },
  'InputDeviceInfo.getCapabilities': async () => {
    const ds = (await navigator.mediaDevices.enumerateDevices()).filter((d) => typeof d.getCapabilities === 'function');
    if (!ds.length) throw fail('NotFoundError', 'no input device');
    return ds.map((d) => d.getCapabilities());
  },
  'CanvasRenderingContext2D.drawElementImage': async () => {
    const [c, div] = await elementImageCanvas();
    const ctx = c.getContext('2d');
    need(ctx.drawElementImage, 'drawElementImage');
    const ret = await ser(ctx.drawElementImage(div, 0, 0));
    return {ret, pixels: await pixelHash(c)};
  },
  'IdleDetector.screenState': async () => {
    need(window.IdleDetector, 'IdleDetector');
    const d = new IdleDetector();
    await d.start({threshold: 60000});
    return d.screenState;
  },
  'Document.inputEncoding': async () => (await nocharsetDoc()).inputEncoding,
  'RTCIceCandidate.toJSON': () => candidateAttr('toJSON'),
  'CanvasRenderingContext2D.createImageData': async () => { const [, ctx] = canvas2d(); return ctx.createImageData(2, 2); },
  'MediaDeviceInfo.toJSON': async () => (await navigator.mediaDevices.enumerateDevices()).map((d) => d.toJSON()),
  'WheelEvent.deltaX': async () => { throw fail('NeedsGesture', 'trusted wheel event needs a user gesture'); },
  'Document.charset': async () => (await nocharsetDoc()).charset,
  'Document.characterSet': async () => (await nocharsetDoc()).characterSet,
  'BaseAudioContext.createPeriodicWave': () => renderPeriodicWave((ctx, real, imag) => ctx.createPeriodicWave(real, imag)),
  'ImageBitmapRenderingContext.canvas': async () => { const c = document.createElement('canvas'); c.id = 'bmr'; return c.getContext('bitmaprenderer').canvas; },
  'WebGL2RenderingContext.getTexParameter': async () => texParams(gl2(), ['TEXTURE_MAG_FILTER', 'TEXTURE_MIN_FILTER', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'TEXTURE_BASE_LEVEL', 'TEXTURE_MAX_LEVEL', 'TEXTURE_MAX_LOD', 'TEXTURE_MIN_LOD', 'TEXTURE_IMMUTABLE_FORMAT']),
  'Element.scrollWidth': async () => textBox(false).scrollWidth,
  'WebGLRenderingContext.getTexParameter': async () => texParams(gl1(), ['TEXTURE_MAG_FILTER', 'TEXTURE_MIN_FILTER', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T']),
  'Element.scrollHeight': async () => textBox(true).scrollHeight,
  'ImageData.constructor': async () => new ImageData(2, 2),
  'WebGLShaderPixelLocalStorage.isCoherent': async () => {
    const g = gl2();
    need(g, 'WebGL2 context');
    const ext = g.getExtension('WEBGL_shader_pixel_local_storage');
    return ext ? ext.isCoherent() : null;
  },
  'BackgroundFetchRegistration.result': async () => { throw fail('NeedsServiceWorker', 'background fetch needs a service worker on a trusted certificate'); },
  'TouchEvent.shiftKey': async () => { throw fail('NeedsGesture', 'trusted touch event'); },
  'OffscreenCanvasRenderingContext2D.createImageData': async () => new OffscreenCanvas(4, 4).getContext('2d').createImageData(2, 2),
  'CanvasRenderingContext2D.fillTextCluster': () => clusterDraw('fillTextCluster'),
  'GPUDevice.adapterInfo': async () => (await gpuDevice()).adapterInfo,
  'MLContext.lost': async () => {
    need(navigator.ml, 'navigator.ml');
    const ctx = await navigator.ml.createContext();
    return Promise.race([ctx.lost.then((x) => ({resolved: x})), sleep(1000).then(() => 'pending')]);
  },
  'CanvasRenderingContext2D.strokeTextCluster': () => clusterDraw('strokeTextCluster'),
  'TouchEvent.metaKey': async () => { throw fail('NeedsGesture', 'trusted touch event'); },
  'VideoPlaybackQuality.totalVideoFrames': async () => {
    const [c, ctx] = canvas2d(64, 64);
    const s = c.captureStream(30);
    const v = document.createElement('video');
    v.muted = true; v.srcObject = s;
    document.getElementById('stage').appendChild(v);
    let i = 0;
    const t = setInterval(() => { ctx.fillStyle = `rgb(${(i++ * 40) % 256},0,0)`; ctx.fillRect(0, 0, 64, 64); }, 30);
    await v.play();
    await sleep(1000);
    clearInterval(t);
    return v.getVideoPlaybackQuality().totalVideoFrames;
  },
  'WheelEvent.deltaY': async () => { throw fail('NeedsGesture', 'trusted wheel event needs a user gesture'); },
  'ImageBitmap.width': async () => (await createImageBitmap(Object.assign(document.createElement('canvas'), {width: 30, height: 20}))).width,
  'TouchEvent.altKey': async () => { throw fail('NeedsGesture', 'trusted touch event'); },
  'CanvasRenderingContext2D.drawFocusIfNeeded': async () => {
    const c = document.createElement('canvas');
    c.width = 120; c.height = 40;
    const b = document.createElement('button');
    b.textContent = 'f';
    c.appendChild(b);
    document.getElementById('stage').appendChild(c);
    b.focus();
    const ctx = c.getContext('2d');
    ctx.beginPath(); ctx.rect(10, 10, 60, 20);
    const ret = await ser(ctx.drawFocusIfNeeded(b));
    return {ret, focused: document.activeElement === b, pixels: await pixelHash(c)};
  },
  'AudioWorkletGlobalScope.sampleRate': async () => {
    const {msgs} = await audioFixture();
    const m = msgs.find((x) => x.kind === 'ctor');
    if (!m) throw fail('NoProcessor', 'AudioWorkletProcessor was not constructed');
    return m.sampleRate;
  },
  'ImageBitmapRenderingContext.transferFromImageBitmap': async () => {
    const [src, sctx] = canvas2d(30, 20);
    sctx.fillStyle = '#3a7'; sctx.fillRect(0, 0, 30, 20);
    const bm = await createImageBitmap(src);
    const c = Object.assign(document.createElement('canvas'), {width: 30, height: 20});
    const ret = await ser(c.getContext('bitmaprenderer').transferFromImageBitmap(bm));
    const [o, octx] = canvas2d(30, 20);
    octx.drawImage(c, 0, 0);
    return {ret, pixels: await pixelHash(o)};
  },
  'MediaDevices.selectAudioOutput': async () => { throw fail('NeedsGesture', 'selectAudioOutput needs a user gesture and a chooser'); },
  'TouchEvent.ctrlKey': async () => { throw fail('NeedsGesture', 'trusted touch event'); },
  'MediaKeySystemAccess.keySystem': async () => (await keySystem()).keySystem,
  'BluetoothAdvertisingEvent.rssi': async () => { throw fail('NeedsHardware', 'Bluetooth'); },
  'CanvasRenderingContext2D.resetTransform': async () => {
    const [, ctx] = canvas2d();
    ctx.translate(3, 4); ctx.scale(2, 2);
    const ret = await ser(ctx.resetTransform());
    return {ret, transform: await ser(ctx.getTransform())};
  },
  'Window.moveBy': async () => { throw fail('NeedsGesture', 'moveBy only moves a popup opened by a user gesture'); },
  'Window.moveTo': async () => { throw fail('NeedsGesture', 'moveTo only moves a popup opened by a user gesture'); },
  'CSSColorValue.parse': async () => {
    need(window.CSSColorValue && CSSColorValue.parse, 'CSSColorValue.parse');
    const out = {};
    for (const s of ['rgb(1 2 3)', 'red', 'Canvas', 'CanvasText', 'AccentColor', 'Highlight']) {
      try { out[s] = await ser(CSSColorValue.parse(s)); } catch (e) { out[s] = {$threw: e.name}; }
    }
    return out;
  },
  'ImageBitmap.height': async () => (await createImageBitmap(Object.assign(document.createElement('canvas'), {width: 30, height: 20}))).height,
  'RTCPeerConnection.canTrickleIceCandidates': async () => {
    const {offer} = await iceFixture();
    const pc2 = new RTCPeerConnection();
    await pc2.setRemoteDescription(offer);
    const v = pc2.canTrickleIceCandidates;
    pc2.close();
    return v;
  },
  'IntersectionObserver.thresholds': async () => new IntersectionObserver(() => {}, {threshold: [0, 0.5]}).thresholds,
  'IntersectionObserver.trackVisibility': async () => new IntersectionObserver(() => {}, {trackVisibility: true, delay: 100}).trackVisibility,
  'BluetoothAdvertisingEvent.uuids': async () => { throw fail('NeedsHardware', 'Bluetooth'); },
  'MediaKeys.createSession': async () => {
    const keys = await (await keySystem()).createMediaKeys();
    return keys.createSession();
  },
  'RTCPeerConnection.createAnswer': async () => {
    const {offer} = await iceFixture();
    const pc2 = new RTCPeerConnection();
    await pc2.setRemoteDescription(offer);
    const a = await pc2.createAnswer();
    pc2.close();
    return a;
  },
  'BluetoothLEScan.acceptAllAdvertisements': async () => { throw fail('NeedsHardware', 'Bluetooth'); },
  'RemotePlayback.state': async () => document.createElement('video').remote.state,
  'Element.scrollLeft': async () => { const d = textBox(false); d.scrollLeft = 1e6; return d.scrollLeft; },
  'IntersectionObserver.delay': async () => new IntersectionObserver(() => {}, {trackVisibility: true, delay: 100}).delay,
  'Touch.identifier': async () => { throw fail('NeedsGesture', 'trusted touch event'); },
  'Window.createImageBitmap': async () => {
    const [src, sctx] = canvas2d(64, 64);
    const g = sctx.createLinearGradient(0, 0, 64, 64);
    g.addColorStop(0, '#f00'); g.addColorStop(0.5, '#0f8'); g.addColorStop(1, '#00f');
    sctx.fillStyle = g; sctx.fillRect(0, 0, 64, 64);
    sctx.fillStyle = '#000'; sctx.fillRect(20, 20, 3, 30);
    const bm = await createImageBitmap(src, {resizeWidth: 37, resizeHeight: 23, resizeQuality: 'high'});
    const [o, octx] = canvas2d(37, 23);
    octx.drawImage(bm, 0, 0);
    return {width: bm.width, height: bm.height, pixels: await pixelHash(o)};
  },
  'ImageBitmap.close': async () => {
    const bm = await createImageBitmap(Object.assign(document.createElement('canvas'), {width: 30, height: 20}));
    const ret = await ser(bm.close());
    return {ret, width: bm.width};
  },
  'USBIsochronousOutTransferPacket.constructor': async () => { need(window.USBIsochronousOutTransferPacket, 'WebUSB'); return new USBIsochronousOutTransferPacket('ok', 3); },
  'BluetoothLEScan.keepRepeatedDevices': async () => { throw fail('NeedsHardware', 'Bluetooth'); },
  'PopStateEvent.hasUAVisualTransition': () => new Promise((res, rej) => {
    const f = document.createElement('iframe');
    f.src = 'pop.html';
    f.style.display = 'none';
    const onmsg = (m) => {
      if (!m.data || !m.data.pop) return;
      removeEventListener('message', onmsg);
      if (!m.data.trusted) rej(fail('Untrusted', 'popstate was not trusted'));
      else res(m.data.v);
    };
    addEventListener('message', onmsg);
    f.onload = () => f.contentWindow.postMessage('go', '*');
    document.body.appendChild(f);
  }),
  'RTCPeerConnection.setRemoteDescription': async () => {
    const {offer} = await iceFixture();
    const pc2 = new RTCPeerConnection();
    const r = await pc2.setRemoteDescription(offer);
    pc2.close();
    return r;
  },
  'BackgroundFetchRegistration.uploadTotal': async () => { throw fail('NeedsServiceWorker', 'background fetch needs a service worker on a trusted certificate'); },
  'TextMetrics.emHeightDescent': async () => { const [, ctx] = canvas2d(); ctx.font = '16px sans-serif'; return ctx.measureText('Hg').emHeightDescent; },
  // control
  'Window.credentialless': async () => window.credentialless,
  'PaymentAddress.organization': async () => { throw fail('NeedsGesture', 'payment UI'); },
  'RtcTransport.setRemoteDtlsParameters': async () => {
    need(window.RtcTransport, 'RtcTransport');
    const t = new RtcTransport({iceControlling: true});
    return t.setRemoteDtlsParameters({sslRole: 'client', fingerprintDigestAlgorithm: 'sha-256', fingerprint: new Uint8Array(32).buffer});
  },
  'FetchEvent.clientId': async () => {
    need(navigator.serviceWorker, 'navigator.serviceWorker');
    await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 20 && !navigator.serviceWorker.controller; i++) await sleep(100);
    if (!navigator.serviceWorker.controller) throw fail('NotControlled', 'page not controlled by the service worker');
    return (await fetch('sw-echo')).text();
  },
  'WebGL2RenderingContext.colorMask': async () => {
    const g = document.createElement('canvas').getContext('webgl2');
    need(g, 'WebGL2 context');
    const ret = await ser(g.colorMask(true, false, true, false));
    return {ret, mask: g.getParameter(g.COLOR_WRITEMASK)};
  },
  'XRVisibilityMaskChangeEvent.eye': async () => { throw fail('NeedsHardware', 'XR'); },
  'SharedStorage.entries': async () => { throw fail('NeedsEnrollment', 'shared storage worklet'); },
  'VirtualKeyboard.boundingRect': async () => { need(navigator.virtualKeyboard, 'navigator.virtualKeyboard'); return navigator.virtualKeyboard.boundingRect; },
  'SVGFETurbulenceElement.numOctaves': async () => svgEl('<filter><feTurbulence numOctaves="3"/></filter>').querySelector('feTurbulence').numOctaves.baseVal,
  'XRSession.domOverlayState': async () => { throw fail('NeedsHardware', 'XR'); },
  'MojoInterfaceRequestEvent.isTrusted': async () => { need(window.MojoInterfaceRequestEvent, 'MojoInterfaceRequestEvent'); return null; },
  'DataTransferItem.type': async () => { const dt = new DataTransfer(); dt.items.add('x', 'text/plain'); return dt.items[0].type; },
  'Selection.empty': async () => {
    const p = document.createElement('p'); p.textContent = 'select me';
    document.getElementById('stage').appendChild(p);
    const s = getSelection(); s.selectAllChildren(p);
    const ret = await ser(s.empty());
    return {ret, rangeCount: s.rangeCount};
  },
  'SVGMatrix.d': async () => svgEl('').createSVGMatrix().scale(2).d,
  'SVGNumberList.removeItem': async () => svgEl('<text rotate="1 2 3">abc</text>').firstElementChild.rotate.baseVal.removeItem(0).value,
  'SVGLinearGradientElement.y1': async () => svgEl('<defs><linearGradient y1="0.3"/></defs>').querySelector('linearGradient').y1.baseVal.value,
  'CSSScale.constructor': async () => new CSSScale(1, 2),
  'GPUBindGroup.label': async () => {
    const dev = await gpuDevice();
    const layout = dev.createBindGroupLayout({entries: []});
    return dev.createBindGroup({label: 'probe-group', layout, entries: []}).label;
  },
  'OpaqueRange.getBoundingClientRect': async () => {
    const i = document.createElement('input');
    i.value = 'Hello world';
    i.style.font = '16px sans-serif';
    document.getElementById('stage').appendChild(i);
    need(i.createValueRange, 'createValueRange');
    return i.createValueRange(0, 5).getBoundingClientRect().toJSON();
  },
  'CSSPositionTryDescriptors.max-height': async () => {
    const st = document.createElement('style');
    st.textContent = '@position-try --probe { max-height: 10px; }';
    document.head.appendChild(st);
    const rule = [...st.sheet.cssRules].find((r) => r.constructor.name === 'CSSPositionTryRule');
    need(rule, 'CSSPositionTryRule');
    return rule.style['max-height'];
  },
  'HTMLButtonElement.form': async () => {
    const f = document.createElement('form'); f.id = 'probe-form';
    const b = document.createElement('button'); f.appendChild(b);
    document.getElementById('stage').appendChild(f);
    return b.form;
  },
  'CSSMathClamp.constructor': async () => String(new CSSMathClamp(CSS.px(1), CSS.px(2), CSS.px(3))),
  'ElementInternals.ariaSetSize': async () => {
    if (!customElements.get('probe-el')) customElements.define('probe-el', class extends HTMLElement {});
    const el = document.createElement('probe-el');
    const int = el.attachInternals();
    int.ariaSetSize = '3';
    return int.ariaSetSize;
  },
  'CSSNumericValue.min': async () => String(CSS.px(3).min(CSS.px(2), CSS.px(5))),
  'XMLHttpRequest.statusText': () => new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open('GET', 'nocharset.html');
    x.onload = () => res(x.statusText);
    x.onerror = () => rej(fail('XHRError', 'xhr failed'));
    x.send();
  }),
};

// The Debug build's audio service starts slowly; open the output path once before probing so the
// first authorization does not time out into the fake-output fallback (criteria.md, smoke-run fix 2).
async function warmUpAudio() {
  try {
    const ctx = new AudioContext();
    const t0 = performance.now();
    while (ctx.state !== 'running' && performance.now() - t0 < 10000) { await ctx.resume().catch(() => {}); await sleep(200); }
    await sleep(500);
    await ctx.close();
  } catch (e) { /* the probes report audio errors themselves */ }
}

const CANDIDATES = [{"api": "Navigator.presentation", "group": "top", "pos": 1, "rank": 6}, {"api": "NavigatorUAData.toJSON", "group": "top", "pos": 2, "rank": 8}, {"api": "ScreenDetailed.highDynamicRangeHeadroom", "group": "top", "pos": 3, "rank": 32}, {"api": "SVGTextContentElement.getNumberOfChars", "group": "top", "pos": 4, "rank": 37}, {"api": "Plugin.namedItem", "group": "top", "pos": 5, "rank": 39}, {"api": "MimeType.enabledPlugin", "group": "top", "pos": 6, "rank": 42}, {"api": "WorkerNavigator.deviceMemory", "group": "top", "pos": 7, "rank": 44}, {"api": "Navigator.requestMediaKeySystemAccess", "group": "top", "pos": 8, "rank": 46}, {"api": "SVGTextContentElement.getRotationOfChar", "group": "top", "pos": 9, "rank": 54}, {"api": "Window.restore", "group": "top", "pos": 10, "rank": 55}, {"api": "Window.maximize", "group": "top", "pos": 11, "rank": 59}, {"api": "CanvasCaptureMediaStreamTrack.canvas", "group": "top", "pos": 12, "rank": 60}, {"api": "ScreenDetailed.whitePointX", "group": "top", "pos": 13, "rank": 61}, {"api": "ScreenDetailed.redPrimaryX", "group": "top", "pos": 14, "rank": 62}, {"api": "Window.minimize", "group": "top", "pos": 15, "rank": 64}, {"api": "ImageData.colorSpace", "group": "top", "pos": 16, "rank": 65}, {"api": "ScreenDetailed.greenPrimaryY", "group": "top", "pos": 17, "rank": 68}, {"api": "ScreenDetailed.bluePrimaryY", "group": "top", "pos": 18, "rank": 70}, {"api": "ScreenDetailed.hdrHeadroom", "group": "top", "pos": 19, "rank": 71}, {"api": "ScreenDetailed.bluePrimaryX", "group": "top", "pos": 20, "rank": 72}, {"api": "ScreenDetailed.redPrimaryY", "group": "top", "pos": 21, "rank": 74}, {"api": "ScreenDetailed.whitePointY", "group": "top", "pos": 22, "rank": 76}, {"api": "SVGSVGElement.animationsPaused", "group": "top", "pos": 23, "rank": 77}, {"api": "ScreenDetailed.greenPrimaryX", "group": "top", "pos": 24, "rank": 79}, {"api": "PreferenceObject.value", "group": "top", "pos": 25, "rank": 81}, {"api": "HTMLCanvasElement.transferControlToOffscreen", "group": "top", "pos": 26, "rank": 82}, {"api": "Window.requestResize", "group": "top", "pos": 27, "rank": 83}, {"api": "RTCIceCandidate.sdpMLineIndex", "group": "top", "pos": 28, "rank": 84}, {"api": "RTCIceCandidate.priority", "group": "top", "pos": 29, "rank": 85}, {"api": "HTMLCanvasElement.configureHighDynamicRange", "group": "top", "pos": 30, "rank": 88}, {"api": "WheelEvent.momentum", "group": "top", "pos": 31, "rank": 89}, {"api": "RTCIceCandidate.foundation", "group": "top", "pos": 32, "rank": 90}, {"api": "CanvasRenderingContext2D.reset", "group": "top", "pos": 33, "rank": 91}, {"api": "RTCIceCandidate.url", "group": "top", "pos": 34, "rank": 93}, {"api": "PeriodicWave.constructor", "group": "top", "pos": 35, "rank": 95}, {"api": "RTCIceCandidate.sdpMid", "group": "top", "pos": 36, "rank": 96}, {"api": "RTCIceCandidate.usernameFragment", "group": "top", "pos": 37, "rank": 97}, {"api": "OffscreenCanvasRenderingContext2D.drawElementImage", "group": "top", "pos": 38, "rank": 99}, {"api": "AudioWorkletGlobalScope.currentTime", "group": "top", "pos": 39, "rank": 103}, {"api": "InputDeviceInfo.getCapabilities", "group": "top", "pos": 40, "rank": 104}, {"api": "CanvasRenderingContext2D.drawElementImage", "group": "top", "pos": 41, "rank": 106}, {"api": "IdleDetector.screenState", "group": "top", "pos": 42, "rank": 108}, {"api": "Document.inputEncoding", "group": "top", "pos": 43, "rank": 109}, {"api": "RTCIceCandidate.toJSON", "group": "top", "pos": 44, "rank": 110}, {"api": "CanvasRenderingContext2D.createImageData", "group": "top", "pos": 45, "rank": 113}, {"api": "MediaDeviceInfo.toJSON", "group": "top", "pos": 46, "rank": 114}, {"api": "WheelEvent.deltaX", "group": "top", "pos": 47, "rank": 117}, {"api": "Document.charset", "group": "top", "pos": 48, "rank": 121}, {"api": "Document.characterSet", "group": "top", "pos": 49, "rank": 122}, {"api": "BaseAudioContext.createPeriodicWave", "group": "top", "pos": 50, "rank": 123}, {"api": "ImageBitmapRenderingContext.canvas", "group": "top", "pos": 51, "rank": 125}, {"api": "WebGL2RenderingContext.getTexParameter", "group": "top", "pos": 52, "rank": 129}, {"api": "Element.scrollWidth", "group": "top", "pos": 53, "rank": 131}, {"api": "WebGLRenderingContext.getTexParameter", "group": "top", "pos": 54, "rank": 132}, {"api": "Element.scrollHeight", "group": "top", "pos": 55, "rank": 133}, {"api": "ImageData.constructor", "group": "top", "pos": 56, "rank": 134}, {"api": "WebGLShaderPixelLocalStorage.isCoherent", "group": "top", "pos": 57, "rank": 135}, {"api": "BackgroundFetchRegistration.result", "group": "top", "pos": 58, "rank": 136}, {"api": "TouchEvent.shiftKey", "group": "top", "pos": 59, "rank": 138}, {"api": "OffscreenCanvasRenderingContext2D.createImageData", "group": "top", "pos": 60, "rank": 139}, {"api": "CanvasRenderingContext2D.fillTextCluster", "group": "top", "pos": 61, "rank": 140}, {"api": "GPUDevice.adapterInfo", "group": "top", "pos": 62, "rank": 141}, {"api": "MLContext.lost", "group": "top", "pos": 63, "rank": 142}, {"api": "CanvasRenderingContext2D.strokeTextCluster", "group": "top", "pos": 64, "rank": 143}, {"api": "TouchEvent.metaKey", "group": "top", "pos": 65, "rank": 145}, {"api": "VideoPlaybackQuality.totalVideoFrames", "group": "top", "pos": 66, "rank": 146}, {"api": "WheelEvent.deltaY", "group": "top", "pos": 67, "rank": 148}, {"api": "ImageBitmap.width", "group": "top", "pos": 68, "rank": 149}, {"api": "TouchEvent.altKey", "group": "top", "pos": 69, "rank": 150}, {"api": "CanvasRenderingContext2D.drawFocusIfNeeded", "group": "top", "pos": 70, "rank": 151}, {"api": "AudioWorkletGlobalScope.sampleRate", "group": "top", "pos": 71, "rank": 152}, {"api": "ImageBitmapRenderingContext.transferFromImageBitmap", "group": "top", "pos": 72, "rank": 153}, {"api": "MediaDevices.selectAudioOutput", "group": "top", "pos": 73, "rank": 154}, {"api": "TouchEvent.ctrlKey", "group": "top", "pos": 74, "rank": 155}, {"api": "MediaKeySystemAccess.keySystem", "group": "top", "pos": 75, "rank": 156}, {"api": "BluetoothAdvertisingEvent.rssi", "group": "top", "pos": 76, "rank": 158}, {"api": "CanvasRenderingContext2D.resetTransform", "group": "top", "pos": 77, "rank": 159}, {"api": "Window.moveBy", "group": "top", "pos": 78, "rank": 160}, {"api": "Window.moveTo", "group": "top", "pos": 79, "rank": 161}, {"api": "CSSColorValue.parse", "group": "top", "pos": 80, "rank": 162}, {"api": "ImageBitmap.height", "group": "top", "pos": 81, "rank": 163}, {"api": "RTCPeerConnection.canTrickleIceCandidates", "group": "top", "pos": 82, "rank": 165}, {"api": "IntersectionObserver.thresholds", "group": "top", "pos": 83, "rank": 167}, {"api": "IntersectionObserver.trackVisibility", "group": "top", "pos": 84, "rank": 169}, {"api": "BluetoothAdvertisingEvent.uuids", "group": "top", "pos": 85, "rank": 171}, {"api": "MediaKeys.createSession", "group": "top", "pos": 86, "rank": 173}, {"api": "RTCPeerConnection.createAnswer", "group": "top", "pos": 87, "rank": 174}, {"api": "BluetoothLEScan.acceptAllAdvertisements", "group": "top", "pos": 88, "rank": 175}, {"api": "RemotePlayback.state", "group": "top", "pos": 89, "rank": 176}, {"api": "Element.scrollLeft", "group": "top", "pos": 90, "rank": 178}, {"api": "IntersectionObserver.delay", "group": "top", "pos": 91, "rank": 179}, {"api": "Touch.identifier", "group": "top", "pos": 92, "rank": 180}, {"api": "Window.createImageBitmap", "group": "top", "pos": 93, "rank": 181}, {"api": "ImageBitmap.close", "group": "top", "pos": 94, "rank": 184}, {"api": "USBIsochronousOutTransferPacket.constructor", "group": "top", "pos": 95, "rank": 186}, {"api": "BluetoothLEScan.keepRepeatedDevices", "group": "top", "pos": 96, "rank": 188}, {"api": "PopStateEvent.hasUAVisualTransition", "group": "top", "pos": 97, "rank": 189}, {"api": "RTCPeerConnection.setRemoteDescription", "group": "top", "pos": 98, "rank": 190}, {"api": "BackgroundFetchRegistration.uploadTotal", "group": "top", "pos": 99, "rank": 191}, {"api": "TextMetrics.emHeightDescent", "group": "top", "pos": 100, "rank": 194}, {"api": "Window.credentialless", "group": "control", "pos": 1217, "rank": 1523}, {"api": "PaymentAddress.organization", "group": "control", "pos": 1403, "rank": 1740}, {"api": "RtcTransport.setRemoteDtlsParameters", "group": "control", "pos": 1546, "rank": 1897}, {"api": "FetchEvent.clientId", "group": "control", "pos": 1681, "rank": 2037}, {"api": "WebGL2RenderingContext.colorMask", "group": "control", "pos": 1713, "rank": 2070}, {"api": "XRVisibilityMaskChangeEvent.eye", "group": "control", "pos": 1944, "rank": 2320}, {"api": "SharedStorage.entries", "group": "control", "pos": 2102, "rank": 2491}, {"api": "VirtualKeyboard.boundingRect", "group": "control", "pos": 2214, "rank": 2608}, {"api": "SVGFETurbulenceElement.numOctaves", "group": "control", "pos": 2680, "rank": 3101}, {"api": "XRSession.domOverlayState", "group": "control", "pos": 2818, "rank": 3244}, {"api": "MojoInterfaceRequestEvent.isTrusted", "group": "control", "pos": 3108, "rank": 3542}, {"api": "DataTransferItem.type", "group": "control", "pos": 3155, "rank": 3595}, {"api": "Selection.empty", "group": "control", "pos": 3171, "rank": 3611}, {"api": "SVGMatrix.d", "group": "control", "pos": 3243, "rank": 3684}, {"api": "SVGNumberList.removeItem", "group": "control", "pos": 3296, "rank": 3737}, {"api": "SVGLinearGradientElement.y1", "group": "control", "pos": 3402, "rank": 3843}, {"api": "CSSScale.constructor", "group": "control", "pos": 3719, "rank": 4167}, {"api": "GPUBindGroup.label", "group": "control", "pos": 3789, "rank": 4239}, {"api": "OpaqueRange.getBoundingClientRect", "group": "control", "pos": 3897, "rank": 4357}, {"api": "CSSPositionTryDescriptors.max-height", "group": "control", "pos": 3976, "rank": 4441}, {"api": "HTMLButtonElement.form", "group": "control", "pos": 3982, "rank": 4447}, {"api": "CSSMathClamp.constructor", "group": "control", "pos": 4124, "rank": 4596}, {"api": "ElementInternals.ariaSetSize", "group": "control", "pos": 4324, "rank": 4803}, {"api": "CSSNumericValue.min", "group": "control", "pos": 4476, "rank": 4959}, {"api": "XMLHttpRequest.statusText", "group": "control", "pos": 4905, "rank": 5408}];

// Cross-device PoC: the page's runner. analysis/web_poc.py builds probes.js from item 3.4's probes
// (out/experiments/3.4/pages/probe.js, the object P and its helpers, unchanged but for the service-worker path)
// followed by this file. Nothing is sent anywhere: the readings stay in the page until the visitor downloads them.
'use strict';

const SCHEMA = 'fptest/1';

// Readings that need the visitor's permission or action. Each runs from its own button, inside the click, so the
// browser sees a user gesture; 3.4 could not run them in an automated browser.
const GATED = {
  screen: {
    title: 'Screen details',
    help: 'Asks for the window-management permission and reads the colour space of your screen.',
    apis: ['ScreenDetailed.highDynamicRangeHeadroom', 'ScreenDetailed.hdrHeadroom', 'ScreenDetailed.whitePointX',
      'ScreenDetailed.whitePointY', 'ScreenDetailed.redPrimaryX', 'ScreenDetailed.redPrimaryY',
      'ScreenDetailed.greenPrimaryX', 'ScreenDetailed.greenPrimaryY', 'ScreenDetailed.bluePrimaryX',
      'ScreenDetailed.bluePrimaryY'],
    async run() {
      need(window.getScreenDetails, 'getScreenDetails');
      const s = (await window.getScreenDetails()).currentScreen;
      const out = {};
      for (const api of this.apis) out[api] = s[api.split('.')[1]];
      return out;
    },
  },
  media: {
    title: 'Camera and microphone',
    help: 'Asks for camera and microphone access, stops both at once, and reads the devices\' capabilities. No image or sound is kept.',
    apis: ['InputDeviceInfo.getCapabilities', 'MediaDeviceInfo.toJSON'],
    async run() {
      const out = {};
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
      } catch (e) {
        try { stream = await navigator.mediaDevices.getUserMedia({audio: true}); } catch (e2) { throw e; }
      } finally {
        if (stream) stream.getTracks().forEach((t) => t.stop());
      }
      const ds = await navigator.mediaDevices.enumerateDevices();
      out['InputDeviceInfo.getCapabilities'] = ds.filter((d) => typeof d.getCapabilities === 'function')
        .map((d) => d.getCapabilities());
      out['MediaDeviceInfo.toJSON'] = ds.map((d) => d.toJSON());
      return out;
    },
  },
  idle: {
    title: 'Idle detection',
    help: 'Asks for the idle-detection permission and reads whether the screen is locked.',
    apis: ['IdleDetector.screenState'],
    async run() {
      need(window.IdleDetector, 'IdleDetector');
      const st = await IdleDetector.requestPermission();
      if (st !== 'granted') throw fail('NotAllowedError', 'idle-detection permission is ' + st);
      const d = new IdleDetector();
      await d.start({threshold: 60000});
      return {'IdleDetector.screenState': d.screenState};
    },
  },
  audioOut: {
    title: 'Audio output',
    help: 'Opens the browser\'s speaker chooser; the device you pick is read.',
    apis: ['MediaDevices.selectAudioOutput'],
    async run() {
      need(navigator.mediaDevices && navigator.mediaDevices.selectAudioOutput, 'selectAudioOutput');
      return {'MediaDevices.selectAudioOutput': (await navigator.mediaDevices.selectAudioOutput()).toJSON()};
    },
  },
};

// Readings from the visitor's own input events (trusted events only).
const INPUT = {
  wheel: {apis: ['WheelEvent.deltaX', 'WheelEvent.deltaY', 'WheelEvent.momentum'], event: 'wheel',
    read: (e) => ({'WheelEvent.deltaX': e.deltaX, 'WheelEvent.deltaY': e.deltaY,
      'WheelEvent.momentum': 'momentum' in e ? e.momentum : {$missing: true}, deltaMode: e.deltaMode})},
  touch: {apis: ['TouchEvent.shiftKey', 'TouchEvent.metaKey', 'TouchEvent.altKey', 'TouchEvent.ctrlKey', 'Touch.identifier'],
    event: 'touchstart',
    read: (e) => ({'TouchEvent.shiftKey': e.shiftKey, 'TouchEvent.metaKey': e.metaKey, 'TouchEvent.altKey': e.altKey,
      'TouchEvent.ctrlKey': e.ctrlKey, 'Touch.identifier': e.changedTouches.length ? e.changedTouches[0].identifier : null})},
};

const record = {
  schema: SCHEMA, page: null, visit_id: null, device_label: '', started: null, finished: null,
  ua: navigator.userAgent, ua_low_entropy: null, env: null, auto: null, gated: {}, input: {},
};

function $(id) { return document.getElementById(id); }

function setStatus(text) { $('status').textContent = text; }

async function pageVersion() {
  const src = await (await fetch('probes.js', {cache: 'no-store'})).arrayBuffer();
  return {probes_sha256: await sha256(src), n_probes: Object.keys(P).length, candidates: CANDIDATES.length};
}

async function environment() {
  const env = {screen: [screen.width, screen.height], avail: [screen.availWidth, screen.availHeight],
    inner: [innerWidth, innerHeight], dpr: devicePixelRatio, colorDepth: screen.colorDepth,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone, lang: navigator.language, langs: navigator.languages,
    dark: matchMedia('(prefers-color-scheme: dark)').matches, motion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    cores: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? null,
    gamut: matchMedia('(color-gamut: p3)').matches, hdr: matchMedia('(dynamic-range: high)').matches,
    touch: navigator.maxTouchPoints, platform: navigator.platform};
  try { const ac = new AudioContext(); env.sampleRate = ac.sampleRate; await ac.close(); } catch (e) { env.sampleRate = e.name; }
  return env;
}

async function runAuto() {
  $('run').disabled = true;
  record.device_label = $('label').value.trim();
  record.visit_id = crypto.randomUUID();
  record.started = new Date().toISOString();
  record.page = await pageVersion();
  if (navigator.userAgentData) {
    record.ua_low_entropy = {brands: navigator.userAgentData.brands, mobile: navigator.userAgentData.mobile,
      platform: navigator.userAgentData.platform};
  }
  await warmUpAudio();
  const results = {};
  const last = ['Window.restore', 'Window.maximize', 'Window.minimize'];  // may change the window: run last
  const order = Object.keys(P).filter((k) => !last.includes(k)).concat(last);
  let i = 0;
  for (const api of order) {
    setStatus(`Reading ${++i} of ${order.length}: ${api}`);
    $('bar').value = i / order.length;
    const t0 = performance.now();
    try {
      const v = await Promise.race([Promise.resolve().then(P[api]),
        sleep(TIMEOUT_MS).then(() => { throw fail('Timeout', `no result in ${TIMEOUT_MS} ms`); })]);
      results[api] = {v: sortedJSON(await ser(v))};
    } catch (e) {
      results[api] = {error: e && e.name ? e.name : String(e), msg: String(e && e.message || '').slice(0, 200)};
    }
    results[api].ms = Math.round(performance.now() - t0);
  }
  await cleanUp();
  record.env = await environment();
  record.auto = results;
  record.finished = new Date().toISOString();
  const ok = Object.values(results).filter((r) => 'v' in r).length;
  setStatus(`Done: ${ok} of ${order.length} APIs returned a value. Optional readings below, then download.`);
  $('after').hidden = false;
  $('download').disabled = false;
  renderTable();
}

// The FetchEvent probe registers a service worker; remove it so the visit leaves nothing behind.
async function cleanUp() {
  try {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  } catch (e) { /* no service worker support */ }
}

async function runGated(key, button) {
  const g = GATED[key];
  const at = new Date().toISOString();
  button.disabled = true;
  try {
    const vals = await g.run();
    for (const api of g.apis) record.gated[api] = {v: sortedJSON(await ser(vals[api])), at};
    button.textContent = g.title + ': read';
  } catch (e) {
    for (const api of g.apis) record.gated[api] = {error: e && e.name ? e.name : String(e), msg: String(e && e.message || '').slice(0, 200), at};
    button.textContent = g.title + ': ' + (e && e.name ? e.name : 'failed');
  }
  renderTable();
}

function armInput(key) {
  const spec = INPUT[key];
  const area = $(key + '-area');
  area.addEventListener(spec.event, async (e) => {
    if (!e.isTrusted || record.input[spec.apis[0]]) return;
    const vals = spec.read(e);
    const at = new Date().toISOString();
    for (const [api, v] of Object.entries(vals)) record.input[api] = {v: sortedJSON(await ser(v)), at};
    area.classList.add('done');
    area.textContent = 'Read. Thank you.';
    renderTable();
  }, {passive: true});
}

function renderTable() {
  const rows = [];
  const all = Object.assign({}, record.auto || {}, record.gated, record.input);
  for (const c of CANDIDATES) {
    const r = all[c.api];
    if (!r) continue;
    const val = 'v' in r ? r.v : `(${r.error})`;
    rows.push(`<tr><td>${c.group === 'top' ? c.pos : 'control'}</td><td>${c.api}</td><td class="v">${escapeHTML(val.slice(0, 160))}${val.length > 160 ? '…' : ''}</td></tr>`);
  }
  $('table').innerHTML = rows.join('');
}

function escapeHTML(s) {
  return s.replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
}

function download() {
  const blob = new Blob([JSON.stringify(record, null, 1)], {type: 'application/json'});
  const a = document.createElement('a');
  const label = (record.device_label || 'device').replace(/[^\w.-]+/g, '_').slice(0, 40);
  a.href = URL.createObjectURL(blob);
  a.download = `fptest-${label}-${record.started.replace(/[:.]/g, '-')}-${record.visit_id.slice(0, 8)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

window.addEventListener('DOMContentLoaded', () => {
  $('run').addEventListener('click', runAuto);
  $('download').addEventListener('click', download);
  for (const [key, g] of Object.entries(GATED)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = g.title;
    b.title = g.help;
    b.addEventListener('click', () => runGated(key, b));
    const li = document.createElement('li');
    li.appendChild(b);
    li.appendChild(document.createTextNode(' ' + g.help));
    $('gated').appendChild(li);
  }
  armInput('wheel');
  armInput('touch');
});
