// RQ2 proofs of concept: shared page plumbing. No fingerprinting API is called here; each page's own
// <script> holds the API calls, and the page prints that code with showCode().
'use strict';

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);

// Print functions' source on the page, so the code shown is exactly the code that runs.
function showCode(el, ...fns) { el.textContent = fns.map((f) => f.toString()).join('\n\n'); }

const fmt = (v) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// One proof of concept. what: the information. rows: [{api, bypass}] (a protected API and the API that circumvents
// it, both returning the same kind of value) or [{api, field}] (an API whose value passes a hook unchanged). read(): a
// promise of {api: value}; selfCheck(values): a sentence that needs no pasted readings. Once readings from an
// unprotected browser are pasted: is the protected value changed, and does the circumvention return the true one?
function poc(what, rows, read, selfCheck) {
  let mine = null;
  const render = (truth) => {
    const verdict = (r) => {
      if (!truth) return '';
      const t = truth[r.api];
      if (r.field) return same(mine[r.api], t) ? '<span class="bad">same: passes the hook unchanged</span>'
        : '<span class="muted">differs: changed here</span>';
      if (same(mine[r.api], t)) return '<span class="muted">same: not protected here</span>';
      return same(mine[r.bypass], t) ? '<span class="bad">protected, but the circumvention returns the true value: bypassed</span>'
        : '<span class="ok">protected, and the circumvention differs too: not bypassed here</span>';
    };
    $('result').innerHTML = `<p>${what}</p><div class="scroll"><table class="four"><thead><tr><th>protected API</th>` +
      (truth ? '<th>unprotected (pasted)</th>' : '') + '<th>this browser</th><th>circumvention in this browser</th>' +
      (truth ? '<th></th>' : '') + '</tr></thead><tbody>' + rows.map((r) => `<tr><td class="k">${r.api}</td>` +
        (truth ? `<td class="v">${fmt(truth[r.api])}</td>` : '') + `<td class="v">${fmt(mine[r.api])}</td>` +
        (r.bypass ? `<td><div class="k">${r.bypass}</div><div class="v">${fmt(mine[r.bypass])}</div></td>`
          : `<td class="muted">${r.field}</td>`) +
        (truth ? `<td>${verdict(r)}</td>` : '') + '</tr>').join('') + '</tbody></table></div>' +
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
