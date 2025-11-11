(async function () {
  const status = document.getElementById('status');
  const output = document.getElementById('output');
  const refreshBtn = document.getElementById('refresh');
  const copyBtn = document.getElementById('copy');

  let lastResult = null;

  function setStatus(text, cls) {
    if (!status) return;
    status.textContent = text;
    status.className = cls || '';
  }

  function render(obj) {
    if (!output) return;
    output.innerHTML = `<pre>${JSON.stringify(obj, null, 2)}</pre>`;
  }

  async function runCollector(fnName) {
    if (!window.fpDemo || typeof window.fpDemo[fnName] !== 'function') {
      setStatus(`Collector "${fnName}" not found`, '');
      return;
    }
    setStatus('Collecting data…', 'loading');

    try {
      const result = await window.fpDemo[fnName]();
      lastResult = result;
      render(result);
      setStatus('Collection complete', '');
    } catch (e) {
      render({ error: String(e) });
      setStatus('Error during collection', '');
    }
  }

  refreshBtn?.addEventListener('click', async () => {
    const fnName = refreshBtn.dataset.collector;
    if (!fnName) {
      alert('No collector function specified for this page.');
      return;
    }
    await runCollector(fnName);
  });

  copyBtn?.addEventListener('click', async () => {
    if (!lastResult) {
      alert('No data to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(lastResult, null, 2));
      alert('Copied JSON to clipboard.');
    } catch (e) {
      alert('Clipboard copy failed: ' + e);
    }
  });

  setStatus('Ready — click “Run Collector” to start.', '');
})();
