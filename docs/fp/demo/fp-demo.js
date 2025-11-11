(() => {
  const statusEl = document.getElementById('status');
  const outputEl = document.getElementById('output');
  const refreshBtn = document.getElementById('refresh');
  const copyBtn = document.getElementById('copy');

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = cls || '';
  }

  function show(obj) {
    outputEl.innerHTML = `<pre>${JSON.stringify(obj, null, 2)}</pre>`;
    setStatus('Collection complete', '');
  }

  async function safeCall(fn, fallback = null) {
    try { return await fn(); }
    catch (e) { return { error: String(e) }; }
  }

  /***************************************************************************
   * 1(a) Operating system level information
   *    SubCategory: Reading or Exposing System-File / OS Resource Info
   *    Demo uses: File System handles (via showOpenFilePicker if present) +
   *               CacheStorage enumeration (availability & sizes)
   *
   *    Notes: showOpenFilePicker is user-gesture gated; this demo attempts feature
   *    detection and summarizes what is available. It does NOT read file contents
   *    unless the user selects a file (the selected file's name & size shown only).
   ***************************************************************************/
  async function collect_os_files_and_cache() {
    setStatus('Collecting OS/file & cache signals…', 'loading');
    const result = { vector: 'os-files-cache', timestamp: Date.now(), data: {} };

    result.data.cache_support = !!(window.caches && caches.keys);
    result.data.cache_names = await safeCall(async () => {
      if (!window.caches || !caches.keys) return null;
      const keys = await caches.keys();
      return keys.slice(0, 50);
    });

    result.data.file_api = {
      supported: !!window.showOpenFilePicker
    };

    result.data.last_selected = null;
    show(result);
  }

  /***************************************************************************
   * 1(b) Operating system level information
   *    SubCategory: Platform Implementation Differences
   *    Demo uses: navigator.userAgent + WebGPU / GPU adapter info (if available)
   *
   *    Notes: WebGPU is experimental; we use feature-detection and summarize adapter info.
   ***************************************************************************/
  async function collect_gpu_and_useragent() {
    setStatus('Collecting GPU & UA signals…', 'loading');
    const result = { vector: 'gpu-ua', timestamp: Date.now(), data: {} };

    result.data.userAgent = navigator.userAgent || null;
    result.data.platform = navigator.platform || null;

    result.data.webgpu = { supported: !!(navigator.gpu) };
    if (navigator.gpu && navigator.gpu.requestAdapter) {
      const adapter = await safeCall(() => navigator.gpu.requestAdapter());
      if (adapter && typeof adapter.name === 'string') {
        result.data.webgpu.adapterName = adapter.name;
        result.data.webgpu.limits = adapter.limits || null;
      } else {
        result.data.webgpu.adapter = adapter ? { toString: String(adapter) } : null;
      }
    }

    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        result.data.webgl = {
          supported: true,
          vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
          renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
        };
      } else {
        result.data.webgl = { supported: false };
      }
    } catch (e) {
      result.data.webgl = { error: String(e) };
    }

    show(result);
  }

  /***************************************************************************
   * 1(c) Operating system level information
   *    SubCategory: Computation or Timing Differences
   *    Demo uses: Performance timing + WebAudio offline rendering duration (OfflineAudioContext)
   *
   *    Notes: OfflineAudioContext lets us run audio processing deterministically and measure
   *    processing time differences across platforms/implementations.
   ***************************************************************************/
  async function collect_perf_and_offline_audio() {
    setStatus('Collecting perf & offline audio timing…', 'loading');
    const result = { vector: 'perf-offline-audio', timestamp: Date.now(), data: {} };

    result.data.timing_now = performance.now();
    result.data.navigation = performance.getEntriesByType('navigation')[0] || null;

    if (window.OfflineAudioContext) {
      try {
        const ctx = new OfflineAudioContext(1, 4410, 44100);
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 440;
        osc.connect(ctx.destination);
        osc.start(0);
        const t0 = performance.now();
        const buffer = await ctx.startRendering();
        const t1 = performance.now();
        result.data.offlineAudio = { renderMs: t1 - t0, length: buffer.length, sampleRate: buffer.sampleRate };
      } catch (e) {
        result.data.offlineAudio = { error: String(e) };
      }
    } else {
      result.data.offlineAudio = { supported: false };
    }

    show(result);
  }

  /***************************************************************************
   * 2(a) Browser implementation difference
   *     SubCategory: Control Flow or Case-Handling Differences
   *     Demo uses: ServiceWorker registration availability + CacheStorage behaviors
   *
   *     Notes: Different engines implement registration/lifecycle details differently; presence
   *     and returned states can differ.
   ***************************************************************************/
  async function collect_serviceworker_and_cache_behavior() {
    setStatus('Collecting service-worker & cache behavior…', 'loading');
    const result = { vector: 'sw-cache', timestamp: Date.now(), data: {} };

    result.data.serviceWorker_supported = 'serviceWorker' in navigator;
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        result.data.serviceWorker_registration_present = !!reg;
        result.data.serviceWorker_scope = reg ? reg.scope : null;
      } catch (e) {
        result.data.serviceWorker_error = String(e);
      }
    }

    try {
      if (window.caches && caches.keys) {
        const keys = await caches.keys();
        result.data.cache_count = keys.length;
        result.data.cache_names = keys.slice(0, 10);
      } else {
        result.data.cache_supported = false;
      }
    } catch (e) {
      result.data.cache_error = String(e);
    }

    show(result);
  }

  /***************************************************************************
   * 2(b) Browser implementation difference
   *     SubCategory: Different Constants or Enumerations
   *     Demo uses: CSS typed-OM values + DOMMatrix properties
   *
   *     Notes: CSS Typed OM and DOMMatrix may expose numeric formats and defaults that vary.
   ***************************************************************************/
  function collect_css_typed_and_dommatrix() {
    setStatus('Collecting CSS Typed OM & DOMMatrix signals…', 'loading');
    const result = { vector: 'css-dommatrix', timestamp: Date.now(), data: {} };

    try {
      if (window.CSS && CSS.unit) {
        result.data.cssUnitValue_supported = !!window.CSSUnitValue;
        if (window.CSSUnitValue) {
          result.data.css_example = { value: 12, unit: 'px', toString: CSSUnitValue ? new CSSUnitValue(12, 'px').toString() : null };
        }
      } else {
        result.data.css_typed_supported = false;
      }
    } catch (e) {
      result.data.css_error = String(e);
    }

    try {
      const m = new DOMMatrix([1, 0, 0, 1, 0, 0]);
      result.data.domMatrix = {
        is2D: m.is2D,
        a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f
      };
    } catch (e) {
      result.data.domMatrix = { error: String(e) };
    }

    show(result);
  }

  /***************************************************************************
   * 2(c) Browser implementation difference
   *     SubCategory: Linked Native Libraries or JS Engine Behavior
   *     Demo uses: SubtleCrypto + Text encoding micro-behavior (subtle + bigint)
   *
   *     Notes: subtle.crypto implementations may rely on native providers and behave differently;
   *     we avoid exposing real keys — only measure available algorithms and a deterministic hashing run time.
   ***************************************************************************/
  async function collect_crypto_and_text_behavior() {
    setStatus('Collecting SubtleCrypto & text-behavior signals…', 'loading');
    const result = { vector: 'crypto-text-bench', timestamp: Date.now(), data: {} };

    try {
      if (window.crypto && crypto.subtle && crypto.subtle.digest) {
        result.data.subtle_supported = true;
        const enc = new TextEncoder();
        const input = enc.encode('test-string-for-hash');
        const t0 = performance.now();
        const digest = await crypto.subtle.digest('SHA-256', input);
        const t1 = performance.now();
        result.data.subtle_digest_time_ms = t1 - t0;
        result.data.subtle_digest_len = digest.byteLength;
      } else {
        result.data.subtle_supported = false;
      }
    } catch (e) {
      result.data.subtle_error = String(e);
    }

    try {
      const te = new TextEncoder();
      const td = new TextDecoder();
      const sample = '𝌆 Unicode test 🤖 — long-ish string to measure';
      const t0 = performance.now();
      const encoded = te.encode(sample);
      const decoded = td.decode(encoded);
      const t1 = performance.now();
      result.data.text_roundtrip_ms = t1 - t0;
      result.data.text_roundtrip_ok = decoded === sample;
      result.data.encoding_len = encoded.length;
    } catch (e) {
      result.data.text_error = String(e);
    }

    show(result);
  }

  /***************************************************************************
   * 2(d) Browser implementation difference
   *     SubCategory: Warning / Error Message Differences
   *     Demo uses: Promise rejection handling + Worker error/reporting differences
   *
   *     Notes: We only create local thrown errors and capture their string contents, stack traces,
   *     and message shapes for comparison (no external reporting).
   ***************************************************************************/
  async function collect_error_message_signatures() {
    setStatus('Collecting error/warning message signatures…', 'loading');
    const result = { vector: 'error-msg-signatures', timestamp: Date.now(), data: {} };

    try {
      function thrower() { throw new Error('fp-demo-error'); }
      try {
        thrower();
      } catch (e) {
        result.data.sync_error = { message: e.message, stackStartsWith: (e.stack || '').slice(0, 200) };
      }
    } catch (e) {
      result.data.sync_error = { error: String(e) };
    }

    try {
      const p = Promise.reject(new Error('fp-demo-promise'));
      await p.catch(e => {
        result.data.promise_reject = { message: e.message, stackSnippet: (e.stack || '').slice(0, 200) };
      });
    } catch (e) {
      result.data.promise_reject = { error: String(e) };
    }

    show(result);
  }

  /***************************************************************************
   * 3(a) Browser configurations
   *     SubCategory: Requires Specific Permission
   *     Demo uses: Geolocation + Notification permission states
   *
   *     Notes: Reading permission states reveals configuration differences.
   ***************************************************************************/
  async function collect_permissions_geolocation_notifications() {
    setStatus('Collecting permissions: geolocation & notifications…', 'loading');
    const result = { vector: 'permissions-geo-notif', timestamp: Date.now(), data: {} };

    try {
      if (navigator.permissions && navigator.permissions.query) {
        const geo = await navigator.permissions.query({ name: 'geolocation' });
        const notif = await navigator.permissions.query({ name: 'notifications' });
        result.data.permissions = {
          geolocation: geo.state,
          notifications: notif.state
        };
      } else {
        result.data.permissions = { supported: false };
      }
    } catch (e) {
      result.data.permissions_error = String(e);
    }

    result.data.geolocation_supported = 'geolocation' in navigator;

    show(result);
  }

  /***************************************************************************
   * 3(b) Browser configurations
   *     SubCategory: Requires Specific Runtime Feature or Secure Context
   *     Demo uses: WebTransport / WebGPU feature detection + ML API detection
   *
   *     Notes: We only detect presence and minimal properties (no network).
   ***************************************************************************/
  async function collect_feature_flags() {
    setStatus('Collecting runtime-feature presence (WebTransport/WebGPU/ML)…', 'loading');
    const result = { vector: 'feature-flags', timestamp: Date.now(), data: {} };

    result.data.webTransport = typeof window.WebTransport === 'function' ? 'present' : 'absent';

    result.data.webgpu = !!(navigator.gpu && navigator.gpu.requestAdapter);

    result.data.ml = { supported: 'ml' in window || 'ML' in window || 'MLGraphBuilder' in window };

    show(result);
  }

  /***************************************************************************
   * 4(a) Requires User Interaction
   *     SubCategory: Input / Gesture Driven
   *     Demo uses: Clipboard (write/read on gesture) + Pointer event timing
   *
   *     Notes: Clipboard read is gated by user gesture; we will only perform actions
   *     on explicit button click. Pointer timing gives event latencies.
   ***************************************************************************/
  function collect_input_and_clipboard_demo() {
    setStatus('Waiting for user gesture to collect clipboard & pointer-timing…', '');
    let lastPointer = null;
    function onPointer(e) {
      lastPointer = { type: e.type, clientX: e.clientX, clientY: e.clientY, time: e.timeStamp };
      window.removeEventListener('pointerdown', onPointer);
    }
    window.addEventListener('pointerdown', onPointer);

    setStatus('Please click "Re-run collection" to perform clipboard test (consent required)', '');
    outputEl.innerHTML = `<pre>Ready. Perform a pointer gesture on the page, then press "Re-run collection" to continue. (Clipboard ops require your click.)</pre>`;

  }

  /***************************************************************************
   * 4(b) Requires User Interaction
   *     SubCategory: File or Media Selection
   *     Demo uses: ImageCapture (requires media permission) + showOpenFilePicker (file selection)
   *
   *     Notes: These flows require explicit user permission/selection. We probe support and
   *     show instructions to the user; we do not trigger camera/mic without consent.
   ***************************************************************************/
  async function collect_media_and_file_selection_demo() {
    setStatus('Collecting media/file-selection signals (requires user actions)…', 'loading');
    const result = { vector: 'media-file-selection', timestamp: Date.now(), data: {} };

    result.data.imageCapture_supported = !!window.ImageCapture;

    result.data.filePicker_supported = !!window.showOpenFilePicker;

    show(result);
  }

  async function copyOutputToClipboard() {
    try {
      const pre = outputEl.querySelector('pre');
      if (!pre) return alert('No data to copy');
      await navigator.clipboard.writeText(pre.textContent);
      alert('JSON copied to clipboard (local).');
    } catch (e) {
      alert('Clipboard copy failed: ' + e);
    }
  }

  async function runAll() {
    setStatus('Running selected collectors…', 'loading');

    const outputs = {};
    outputs.gpu_ua = await safeCall(collect_gpu_and_useragent);
    outputs.perf_offline_audio = await safeCall(collect_perf_and_offline_audio);
    outputs.css_dommatrix = await safeCall(collect_css_typed_and_dommatrix);
    outputs.crypto_text = await safeCall(collect_crypto_and_text_behavior);
    outputs.permissions = await safeCall(collect_permissions_geolocation_notifications);
    outputs.sw_cache = await safeCall(collect_serviceworker_and_cache_behavior);
    outputs.error_signatures = await safeCall(collect_error_message_signatures);

    show({ meta: { note: 'Local-only; no network.' , time: Date.now() }, outputs });
  }

  refreshBtn.addEventListener('click', async () => {
    await runAll();

    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const clipText = await navigator.clipboard.readText().catch(e => null);
        const pre = outputEl.querySelector('pre');
        const obj = pre ? JSON.parse(pre.textContent) : {};
        obj.clipboard_probe = clipText ? { success: true, length: clipText.length } : { success: false };
        outputEl.innerHTML = `<pre>${JSON.stringify(obj, null, 2)}</pre>`;
      }
    } catch (e) {
      // ignore
    }
  });

  copyBtn.addEventListener('click', async () => {
    await copyOutputToClipboard();
  });

  setStatus('Ready — press "Re-run collection" to start (consent required for gesture-gated tests).', '');
  outputEl.innerHTML = '<pre>Press "Re-run collection" to collect sample signals. See page for notes.</pre>';

  window.fpDemo = {
    collect_os_files_and_cache,
    collect_gpu_and_useragent,
    collect_perf_and_offline_audio,
    collect_serviceworker_and_cache_behavior,
    collect_css_typed_and_dommatrix,
    collect_crypto_and_text_behavior,
    collect_error_message_signatures,
    collect_permissions_geolocation_notifications,
    collect_feature_flags,
    collect_input_and_clipboard_demo,
    collect_media_and_file_selection_demo,
    runAll
  };
})();
