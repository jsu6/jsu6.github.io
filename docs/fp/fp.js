(async function () {
  const statusEl = document.getElementById('status');
  const outputEl = document.getElementById('output');
  const refreshBtn = document.getElementById('refresh');
  const copyBtn = document.getElementById('copy');
  let lastResult = null;

  function setStatus(text, cls) {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.className = cls || '';
    }
  }

  function show(obj) {
    if (!outputEl) return;
    outputEl.innerHTML = `<pre>${JSON.stringify(obj, null, 2)}</pre>`;
    setStatus('Collection complete', '');
  }

  async function safeCall(fn) {
    try {
      return await fn();
    } catch (e) {
      return { error: String(e) };
    }
  }

  /*****************************************************************
   * Collectors
   *****************************************************************/

  async function collect_os_files_and_cache() {
    setStatus('Collecting OS/file & cache signals…', 'loading');
    const result = { vector: 'os-files-cache', timestamp: Date.now(), data: {} };

    result.data.cache_support = !!(window.caches && caches.keys);
    result.data.cache_names = await safeCall(async () => {
      if (!window.caches || !caches.keys) return null;
      const keys = await caches.keys();
      return keys.slice(0, 20);
    });

    result.data.file_api = { supported: !!window.showOpenFilePicker };
    show(result);
    return result;
  }

  async function collect_gpu_and_useragent() {
    setStatus('Collecting GPU & UA signals…', 'loading');
    const result = { vector: 'gpu-ua', timestamp: Date.now(), data: {} };

    result.data.userAgent = navigator.userAgent || null;
    result.data.platform = navigator.platform || null;

    result.data.webgpu = { supported: !!navigator.gpu };
    if (navigator.gpu && navigator.gpu.requestAdapter) {
      const adapter = await safeCall(() => navigator.gpu.requestAdapter());
      if (adapter && adapter.name) {
        result.data.webgpu.adapterName = adapter.name;
        result.data.webgpu.limits = adapter.limits || null;
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
      } else result.data.webgl = { supported: false };
    } catch (e) {
      result.data.webgl = { error: String(e) };
    }

    show(result);
    return result;
  }

  async function collect_perf_and_offline_audio() {
    setStatus('Collecting perf & offline audio timing…', 'loading');
    const result = { vector: 'perf-offline-audio', timestamp: Date.now(), data: {} };

    result.data.timing_now = performance.now();
    if (window.OfflineAudioContext) {
      try {
        const ctx = new OfflineAudioContext(1, 4410, 44100);
        const osc = ctx.createOscillator();
        osc.connect(ctx.destination);
        osc.start(0);
        const t0 = performance.now();
        const buffer = await ctx.startRendering();
        const t1 = performance.now();
        result.data.offlineAudio = { renderMs: t1 - t0, length: buffer.length };
      } catch (e) {
        result.data.offlineAudio = { error: String(e) };
      }
    } else result.data.offlineAudio = { supported: false };

    show(result);
    return result;
  }

  async function collect_serviceworker_and_cache_behavior() {
    setStatus('Collecting service-worker & cache behavior…', 'loading');
    const result = { vector: 'sw-cache', timestamp: Date.now(), data: {} };

    result.data.serviceWorker_supported = 'serviceWorker' in navigator;
    if ('serviceWorker' in navigator) {
      const reg = await safeCall(() => navigator.serviceWorker.getRegistration());
      result.data.serviceWorker_registration_present = !!reg;
      result.data.serviceWorker_scope = reg ? reg.scope : null;
    }

    try {
      if (window.caches && caches.keys) {
        const keys = await caches.keys();
        result.data.cache_count = keys.length;
      } else result.data.cache_supported = false;
    } catch (e) {
      result.data.cache_error = String(e);
    }

    show(result);
    return result;
  }

  function collect_css_typed_and_dommatrix() {
    setStatus('Collecting CSS Typed OM & DOMMatrix signals…', 'loading');
    const result = { vector: 'css-dommatrix', timestamp: Date.now(), data: {} };

    try {
      result.data.cssUnitValue_supported = !!window.CSSUnitValue;
      if (window.CSSUnitValue)
        result.data.css_example = { value: 12, unit: 'px', toString: new CSSUnitValue(12, 'px').toString() };
      const m = new DOMMatrix([1, 0, 0, 1, 0, 0]);
      result.data.domMatrix = { is2D: m.is2D, a: m.a, d: m.d };
    } catch (e) {
      result.data.domMatrix = { error: String(e) };
    }

    show(result);
    return result;
  }

  async function collect_crypto_and_text_behavior() {
    setStatus('Collecting SubtleCrypto & text-behavior signals…', 'loading');
    const result = { vector: 'crypto-text-bench', timestamp: Date.now(), data: {} };

    try {
      if (crypto.subtle) {
        const enc = new TextEncoder();
        const input = enc.encode('test');
        const t0 = performance.now();
        const digest = await crypto.subtle.digest('SHA-256', input);
        const t1 = performance.now();
        result.data.subtle_digest_time_ms = t1 - t0;
        result.data.subtle_digest_len = digest.byteLength;
      }

      const te = new TextEncoder(),
        td = new TextDecoder();
      const sample = 'Fingerprint test string 🤖';
      const t0 = performance.now();
      const decoded = td.decode(te.encode(sample));
      const t1 = performance.now();
      result.data.text_roundtrip_ok = decoded === sample;
      result.data.text_roundtrip_ms = t1 - t0;
    } catch (e) {
      result.data.text_error = String(e);
    }

    show(result);
    return result;
  }

  async function collect_error_message_signatures() {
    setStatus('Collecting error message signatures…', 'loading');
    const result = { vector: 'error-msg-signatures', timestamp: Date.now(), data: {} };

    try {
      try {
        throw new Error('fp-demo-error');
      } catch (e) {
        result.data.sync_error = { message: e.message, stack: e.stack?.slice(0, 100) };
      }

      const p = Promise.reject(new Error('fp-demo-promise'));
      await p.catch(
        (e) => (result.data.promise_reject = { message: e.message, stack: e.stack?.slice(0, 100) })
      );
    } catch (e) {
      result.data.sync_error = { error: String(e) };
    }

    show(result);
    return result;
  }

  async function collect_permissions_geolocation_notifications() {
    setStatus('Collecting permissions…', 'loading');
    const result = { vector: 'permissions', timestamp: Date.now(), data: {} };

    try {
      if (navigator.permissions) {
        const geo = await navigator.permissions.query({ name: 'geolocation' });
        const notif = await navigator.permissions.query({ name: 'notifications' });
        result.data.permissions = { geolocation: geo.state, notifications: notif.state };
      }
    } catch (e) {
      result.data.permissions_error = String(e);
    }

    show(result);
    return result;
  }

  async function collect_feature_flags() {
    setStatus('Collecting runtime features…', 'loading');
    const result = { vector: 'feature-flags', timestamp: Date.now(), data: {} };

    result.data.webTransport = typeof WebTransport === 'function';
    result.data.webgpu = !!(navigator.gpu && navigator.gpu.requestAdapter);
    result.data.ml = 'MLGraphBuilder' in window;

    show(result);
    return result;
  }

  function collect_input_and_clipboard_demo() {
    setStatus('Waiting for user gesture for clipboard demo…', '');
    outputEl.innerHTML = `<pre>Click inside the page then press "Run Collector" again to allow clipboard ops.</pre>`;
    return { note: 'gesture required' };
  }

  async function collect_media_and_file_selection_demo() {
    setStatus('Collecting media/file-selection signals…', 'loading');
    const result = { vector: 'media-file-selection', timestamp: Date.now(), data: {} };
    result.data.imageCapture_supported = !!window.ImageCapture;
    result.data.filePicker_supported = !!window.showOpenFilePicker;
    show(result);
    return result;
  }

  /*****************************************************************
   * Controller Logic
   *****************************************************************/
  async function runCollector(fnName) {
    const fn = window[fnName] || (window.fpDemo && window.fpDemo[fnName]);
    if (typeof fn !== 'function') {
      setStatus(`Collector "${fnName}" not found`, '');
      return;
    }
    setStatus('Collecting data…', 'loading');
    const result = await fn();
    lastResult = result;
    setStatus('Collection complete', '');
  }

  refreshBtn?.addEventListener('click', async () => {
    const fnName = refreshBtn.dataset.collector;
    if (!fnName) {
      alert('No collector specified for this page');
      return;
    }
    await runCollector(fnName);
  });

  // expose collectors globally
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
  };

  setStatus('Ready — click “Run Collector” to start.', '');
})();
