// fp.js — local-only snapshot collector for /fp
(async function () {
  // Only run on /fp or /fp/
  const allowedPaths = ['/fp', '/fp/'];
  if (!allowedPaths.includes(location.pathname)) {
    // do nothing if not on /fp
    console.warn('fp.js loaded but path is not /fp — not running.');
    return;
  }

  const status = document.getElementById('status');
  const output = document.getElementById('output');
  const refreshBtn = document.getElementById('refresh');
  const copyBtn = document.getElementById('copy');

  refreshBtn?.addEventListener('click', () => run());
  copyBtn?.addEventListener('click', () => {
    if (!lastResult) return;
    navigator.clipboard?.writeText(JSON.stringify(lastResult, null, 2))
      .then(() => alert('Copied JSON to clipboard'))
      .catch(() => alert('Clipboard copy failed'));
  });

  let lastResult = null;

  async function safe(fn, fallback = null) {
    try {
      return await fn();
    } catch (e) {
      return { error: String(e) };
    }
  }

  function hasStorage(type) {
    try {
      if (type === 'localStorage') {
        localStorage.setItem('__fp_test','1');
        localStorage.removeItem('__fp_test');
        return true;
      }
      if (type === 'sessionStorage') {
        sessionStorage.setItem('__fp_test','1');
        sessionStorage.removeItem('__fp_test');
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function readPlugins() {
    try {
      const p = navigator.plugins || [];
      return Array.from(p).map(pl => ({
        name: pl.name,
        filename: pl.filename,
        description: pl.description,
        length: pl.length
      }));
    } catch (e) {
      return { error: String(e) };
    }
  }

  function readMimeTypes() {
    try {
      const m = navigator.mimeTypes || [];
      return Array.from(m).map(mt => ({ type: mt.type, description: mt.description, suffixes: mt.suffixes }));
    } catch (e) {
      return { error: String(e) };
    }
  }

  async function getBattery() {
    if (!('getBattery' in navigator)) return null;
    return await navigator.getBattery();
  }

  async function enumerateMediaDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return null;
    return await navigator.mediaDevices.enumerateDevices();
  }

  function canvasFingerprintDataURL() {
    try {
      const c = document.createElement('canvas');
      c.width = 200;
      c.height = 60;
      const ctx = c.getContext('2d');
      // background
      ctx.fillStyle = '#f6f8fa';
      ctx.fillRect(0, 0, c.width, c.height);
      // text with different styles
      ctx.textBaseline = 'top';
      ctx.font = '14px "Arial"';
      ctx.fillStyle = '#111';
      ctx.fillText('hello — ABC.com/fp', 2, 2);
      ctx.fillStyle = 'rgba(255,0,0,0.7)';
      ctx.fillRect(10, 30, 50, 10);
      // draw a circle
      ctx.beginPath();
      ctx.arc(160, 40, 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgb(10,120,200)';
      ctx.fill();
      // return data URL
      return c.toDataURL();
    } catch (e) {
      return { error: String(e) };
    }
  }

  function webglInfo() {
    try {
      const canvas = document.createElement('canvas');
      // try webgl2 first
      let gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return null;
      const info = {
        version: gl.getParameter(gl.VERSION),
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION)
      };
      // try to get unmasked renderer using extension (may be blocked)
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        info.unmaskedVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
        info.unmaskedRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
      }
      return info;
    } catch (e) {
      return { error: String(e) };
    }
  }

  async function queryPermission(name) {
    try {
      if (!navigator.permissions || !navigator.permissions.query) return null;
      const res = await navigator.permissions.query({ name });
      return { state: res.state };
    } catch (e) {
      return { error: String(e) };
    }
  }

  async function run() {
    status.textContent = 'Collecting data…';
    status.classList.add('loading');

    const start = Date.now();

    const result = {
      timestamp: new Date().toISOString(),
      location: {
        href: location.href,
        pathname: location.pathname,
        host: location.host,
        protocol: location.protocol
      },
      navigator: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        product: navigator.product,
        vendor: navigator.vendor,
        language: navigator.language,
        languages: navigator.languages,
        cookieEnabled: navigator.cookieEnabled,
        doNotTrack: navigator.doNotTrack,
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        deviceMemory: navigator.deviceMemory || null,
        webdriver: navigator.webdriver || false,
        productSub: navigator.productSub || null,
        appName: navigator.appName || null,
        appVersion: navigator.appVersion || null
      },
      screen: {
        width: screen.width,
        height: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        colorDepth: screen.colorDepth,
        pixelDepth: screen.pixelDepth,
        orientation: (screen.orientation && screen.orientation.type) || null
      },
      time: {
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        timeZone: (typeof Intl !== 'undefined' && Intl.DateTimeFormat) ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
        locale: typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : null
      },
      storage: {
        localStorage: hasStorage('localStorage'),
        sessionStorage: hasStorage('sessionStorage'),
        indexedDB: !!window.indexedDB
      },
      plugins: readPlugins(),
      mimeTypes: readMimeTypes(),
      canvas: {
        dataURL: canvasFingerprintDataURL()
      },
      webgl: webglInfo(),
      connection: (function(){
        try { return navigator.connection ? {
          effectiveType: navigator.connection.effectiveType,
          downlink: navigator.connection.downlink,
          rtt: navigator.connection.rtt,
          saveData: navigator.connection.saveData
        } : null; } catch(e) { return { error: String(e) } }
      })(),
      touch: {
        maxTouchPoints: navigator.maxTouchPoints || 0,
        touchEvent: ( 'ontouchstart' in window ) || false
      },
      features: {
        serviceWorker: 'serviceWorker' in navigator,
        cookieStore: 'cookieStore' in window,
        fetch: 'fetch' in window,
        WebAssembly: 'WebAssembly' in window
      },
      permissions: {
        // permission names vary by browser; some may throw if not supported, so use safe wrapper
        notifications: await safe(()=>queryPermission('notifications')),
        geolocation: await safe(()=>queryPermission('geolocation')),
        camera: await safe(()=>queryPermission('camera')),
        microphone: await safe(()=>queryPermission('microphone'))
      },
      battery: await safe(async () => {
        const b = await getBattery();
        if (!b) return null;
        return {
          charging: b.charging,
          chargingTime: b.chargingTime,
          dischargingTime: b.dischargingTime,
          level: b.level
        };
      }),
      mediaDevices: await safe(async () => {
        const devices = await enumerateMediaDevices();
        if (!devices) return null;
        return devices.map(d => ({
          kind: d.kind,
          label: d.label || null,
          deviceId: d.deviceId || null,
          groupId: d.groupId || null
        }));
      })
    };

    const took = Date.now() - start;
    result._meta = { collectionTimeMs: took };

    lastResult = result;
    render(result);
    status.textContent = 'Collection complete';
    status.classList.remove('loading');
  }

  function render(obj) {
    // pretty table render
    output.innerHTML = '';
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(obj, null, 2);
    output.appendChild(pre);

    // Also create a readable key/value table for main items
    const sections = ['navigator','screen','time','storage','connection','features','touch','webgl'];
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');

    sections.forEach(sec => {
      if (!obj[sec]) return;
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = sec;
      const td = document.createElement('td');
      td.textContent = JSON.stringify(obj[sec], null, 2);
      tr.appendChild(th);
      tr.appendChild(td);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    output.appendChild(table);
  }

  // initial run
  await run();
})();
