// FProot proofs of concept: shared helpers. Nothing here reads a fingerprinting API; each page's
// own <script> holds the API calls, and the page prints that code with showCode().
'use strict';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const Q = new URLSearchParams(location.search);

// Print functions' source on the page, so the code shown is exactly the code that runs.
function showCode(el, ...fns) { el.textContent = fns.map((f) => f.toString()).join('\n\n'); }

function browserName() {
  if (navigator.brave) return 'Brave';
  const b = navigator.userAgentData ? navigator.userAgentData.brands.map((x) => x.brand).filter((x) => !/Not.?A.?Brand/i.test(x)) : [];
  return b.length ? b[b.length - 1] : navigator.userAgent.split(' ').slice(-2).join(' ');
}

// Readings of this visit, keyed by API; copy them as JSON, or paste another browser's to compare.
const MINE = {};
function setReading(key, value) { MINE[key] = value; }
function copyReadings(textarea) {
  textarea.value = JSON.stringify({browser: browserName(), readings: MINE}, null, 1);
  textarea.select();
  navigator.clipboard && navigator.clipboard.writeText(textarea.value).catch(() => {});
}
function parsePasted(text) {
  const o = JSON.parse(text);
  if (!o.readings) throw new Error('pasted text has no "readings"');
  return o;
}
const fmt = (v) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));

// Render rows [{api, gt, mine, same, note}] as a table into el.
function renderTable(el, rows, gtName, myName) {
  el.innerHTML = `<div class="scroll"><table><thead><tr><th>API</th><th>${gtName}</th><th>${myName}</th><th>same?</th><th></th></tr></thead><tbody>` +
    rows.map((r) => `<tr><td>${r.api}</td><td class="v">${fmt(r.gt)}</td><td class="v">${fmt(r.mine)}</td>` +
      `<td class="${r.same ? 'ok' : 'bad'}">${r.gt === undefined ? '' : r.same ? 'same' : 'differs'}</td><td class="muted">${r.note || ''}</td></tr>`).join('') +
    '</tbody></table></div>';
}

// The three-column comparison: per piece of information, Chromium's value (the ground truth, pasted), this browser's
// value of the API Brave protects, and this browser's value of the API that circumvents the protection.
// pairs: [{info, protectedKey, bypassKey, gtKey (Chromium reading the bypass is compared with; default bypassKey),
//          tol (numeric tolerance; default exact)}]
const same = (a, b, tol) => (tol && typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < tol
  : JSON.stringify(a) === JSON.stringify(b));
function renderThree(el, pairs, G, gtName) {
  const cell = (key, v, ok, yes, no) => key ? `<div class="k">${key}</div><div class="v">${fmt(v)}</div>` +
    (v === undefined ? '' : `<div class="${ok ? 'ok' : 'bad'}">${ok ? yes : no}</div>`) : '<div class="muted">none found</div>';
  el.innerHTML = '<div class="scroll"><table class="three"><thead><tr><th>information</th>' +
    `<th>${gtName} (ground truth)</th><th>${browserName()}: protected API</th><th>${browserName()}: circumvention</th></tr></thead><tbody>` +
    pairs.map((p) => {
      const gk = p.gtKey || p.bypassKey || p.protectedKey;
      const farbled = p.protectedKey && !same(MINE[p.protectedKey], G[p.protectedKey]);
      const leaks = p.bypassKey && same(MINE[p.bypassKey], G[gk], p.tol);
      return `<tr><td>${p.info}</td><td><div class="k">${gk}</div><div class="v">${fmt(G[gk])}</div></td>` +
        `<td>${cell(p.protectedKey, MINE[p.protectedKey], farbled, 'differs from Chromium: protected', 'same as Chromium: not protected here')}</td>` +
        `<td>${cell(p.bypassKey, MINE[p.bypassKey], leaks, 'same as Chromium: leaks', 'differs: not circumvented here')}</td></tr>`;
    }).join('') + '</tbody></table></div>';
}

// Local verification only (?report=1): post to the experiment server; on github.io nothing is sent.
async function report(rec) {
  if (Q.get('report') !== '1') return;
  await fetch('/report', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(Object.assign({run: Q.get('run') || 'none', host: location.hostname, browser: browserName()}, rec))});
}
