(() => {
  const statusEl = document.getElementById('status');
  const outputEl = document.getElementById('output');
  const refreshBtn = document.getElementById('refresh');
  const copyBtn = document.getElementById('copy');

  function setStatus(t,c){ if(statusEl){ statusEl.textContent=t; statusEl.className=c||'' } }
  function showJson(o){ if(!outputEl) return; outputEl.innerHTML = '<pre>'+JSON.stringify(o,null,2)+'</pre>'; }
  function showSummary(html){
    if(!outputEl) return;
    let s = document.getElementById('fp-key-summary');
    if(!s){
      s = document.createElement('div');
      s.id = 'fp-key-summary';
      s.style.background='#fff8dc';
      s.style.border='1px solid #f0e68c';
      s.style.padding='0.6em';
      s.style.marginBottom='0.8em';
      s.style.borderRadius='6px';
      outputEl.parentNode.insertBefore(s, outputEl);
    }
    s.innerHTML = html;
  }
  async function safeCall(fn){ try{ return await fn() }catch(e){ return { error:String(e) } } }

  async function callCollector(name){
    if(window.fpDemo && typeof window.fpDemo[name]==='function') return await safeCall(()=>window.fpDemo[name]());
    if(typeof window[name]==='function') return await safeCall(()=>window[name]());
    return { error:'collector not found' };
  }

  function summarizeVector(result){
    if(!result) return '<em>no result</em>';
    const d = result.data || result;
    if(d.webgpu || d.webgl) return '<strong>GPU feature:</strong> '+(d.webgpu? 'webgpu-present':'webgpu-absent') +', webgl-'+(d.webgl && d.webgl.supported? 'present':'absent');
    if(d.offlineAudio) return '<strong>OfflineAudio:</strong> supported';
    if(d.cache_support!==undefined) return '<strong>Cache API:</strong> '+(d.cache_support? 'present':'absent')+', <strong>File API:</strong> '+((d.file_api && d.file_api.supported)?'present':'absent');
    if(d.cssUnitValue_supported!==undefined) return '<strong>CSS Typed OM:</strong> '+(d.cssUnitValue_supported? 'present':'absent')+', <strong>DOMMatrix:</strong> '+(d.domMatrix? 'present':'absent');
    if(d.subtle_supported!==undefined) return '<strong>SubtleCrypto:</strong> '+(d.subtle_supported? 'present':'absent')+', <strong>TextEncoder:</strong> '+(d.encoding_len? 'present':'present');
    if(d.serviceWorker_supported!==undefined) return '<strong>ServiceWorker:</strong> '+(d.serviceWorker_supported? 'present':'absent')+', <strong>Cache count known:</strong> '+(d.cache_count!=null? 'yes':'no');
    if(d.permissions) return '<strong>Permissions API:</strong> available';
    if(d.webTransport||d.ml) return '<strong>Feature flags:</strong> webTransport-'+(d.webTransport||'absent')+'; webgpu-'+(d.webgpu? 'present':'absent')+'; ml-'+(d.ml && d.ml.supported? 'present':'absent');
    if(d.imageCapture_supported!==undefined) return '<strong>Media/file pickers:</strong> imageCapture-'+(d.imageCapture_supported? 'present':'absent')+'; filePicker-'+(d.filePicker_supported? 'present':'absent');
    return '<em>no safe summary available</em>';
  }

  const pageCollector = (function(){
    const b = document.body;
    if(b && b.dataset && b.dataset.collector) return b.dataset.collector;
    const p = location.pathname.split('/').pop() || '';
    const map = {
      'sw-cache.html':'collect_serviceworker_and_cache_behavior',
      'os-files.html':'collect_os_files_and_cache',
      'gpu-info.html':'collect_gpu_and_useragent',
      'perf-audio.html':'collect_perf_and_offline_audio',
      'css-dommatrix.html':'collect_css_typed_and_dommatrix',
      'crypto-text.html':'collect_crypto_and_text_behavior',
      'error-signatures.html':'collect_error_message_signatures',
      'permissions.html':'collect_permissions_geolocation_notifications',
      'features.html':'collect_feature_flags',
      'media-file.html':'collect_media_and_file_selection_demo',
      'input-clipboard.html':'collect_input_and_clipboard_demo'
    };
    return map[p] || null;
  })();

  async function runCollector(){
    if(!pageCollector){ setStatus('No collector configured',''); return; }
    setStatus('Collecting…','loading');
    const res = await callCollector(pageCollector);
    window.fpDemo && window.fpDemo._setLast && window.fpDemo._setLast(res || {});
    showJson(res || { note:'collector executed' });
    showSummary(summarizeVector(res));
    setStatus('Collection complete','');
  }

  if(refreshBtn) refreshBtn.addEventListener('click', runCollector);
  else window.addEventListener('load', ()=>setTimeout(runCollector,50));

  if(copyBtn) copyBtn.addEventListener('click', async ()=>{
    try{ const pre = outputEl && outputEl.querySelector('pre'); if(!pre) return alert('No JSON'); await navigator.clipboard.writeText(pre.textContent); alert('Copied'); }catch(e){ alert('Copy failed: '+e) }
  });

  if(!window.fpDemo) window.fpDemo = {};
  window.fpDemo._setLast = function(o){ window.fpDemo._lastResult = o };

  window.fpSummarySafe = { runCollector, summarizeVector };
})();