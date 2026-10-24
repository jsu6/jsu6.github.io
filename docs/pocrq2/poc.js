// RQ2 proofs of concept: shared page plumbing. No fingerprinting API is called here; each page's own
// <script> holds the API calls, and the page prints that code with showCode().
'use strict';

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);

// Print functions' source on the page, so the code shown is exactly the code that runs.
function showCode(el, ...fns) { el.textContent = fns.map((f) => f.toString()).join('\n\n'); }

const fmt = (v) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// One proof of concept. rows: [{what, protectedApi, bypassApi}]; read(): a promise of {api: value}; selfCheck(values):
// a sentence that needs no pasted readings. Shows this browser's values; Copy puts them on the clipboard; pasting the
// values copied with protection off adds the comparison.
function poc(rows, read, selfCheck) {
  let mine = null;
  const render = (truth) => {
    const cell = (api, isBypass) => {
      const v = mine[api];
      let mark = '';
      if (truth) {
        const eq = same(v, truth[api]);
        mark = isBypass
          ? `<div class="${eq ? 'bad' : 'muted'}">${eq ? 'same as protection off: leaks' : 'differs: does not leak here'}</div>`
          : `<div class="${eq ? 'muted' : 'ok'}">${eq ? 'same as protection off: not protected here' : 'differs: protected'}</div>`;
      }
      return `<td><div class="k">${api}</div><div class="v">${fmt(v)}</div>${mark}</td>`;
    };
    $('result').innerHTML = '<div class="scroll"><table class="three"><thead><tr><th>information</th>' +
      (truth ? '<th>protection off (pasted)</th>' : '') + '<th>protected API</th><th>circumventing API</th></tr></thead><tbody>' +
      rows.map((r) => `<tr><td>${r.what}</td>` +
        (truth ? `<td><div class="k">${r.bypassApi}</div><div class="v">${fmt(truth[r.bypassApi])}</div></td>` : '') +
        cell(r.protectedApi, false) + cell(r.bypassApi, true) + '</tr>').join('') + '</tbody></table></div>' +
      (selfCheck ? `<p class="verdict">${selfCheck(mine)}</p>` : '');
  };
  read().then((values) => {
    mine = values;
    render(null);
    $('copy').disabled = false;
    if (Q.get('report') === '1') {  // local verification only (analysis/rq2/poc_verify.py); on github.io nothing is sent
      fetch('/report', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({run: Q.get('run') || 'none', host: location.hostname, readings: mine})});
    }
  }, (e) => { $('result').textContent = 'error: ' + e; });
  $('copy').onclick = () => {
    const out = $('out');
    out.hidden = false;
    out.value = JSON.stringify(mine);
    out.select();
    if (navigator.clipboard) navigator.clipboard.writeText(out.value).catch(() => {});
  };
  $('compare').onclick = () => {
    try { render(JSON.parse($('paste').value)); } catch (e) { $('result').textContent = 'cannot read the pasted text: ' + e.message; }
  };
}
