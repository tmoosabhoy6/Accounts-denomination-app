/* ============================================================
   Cash Book — app logic
   Uses the GitHub repository itself as the database:
   every entry is written to data/entries.json on the main branch.
   ============================================================ */
(() => {
  'use strict';

  // ---------- Settings ----------
  const CONFIG = {
    owner: 'tmoosabhoy6',
    repo: 'Accounts-denomination-app',
    branch: 'main',
    path: 'data/entries.json',
    // The access key is shared through this file so every device connects by itself
    sharedPath: 'data/app-config.json',
  };
  const SYNC_EVERY_MS = 30000;
  const CURRENCIES = {
    IQD: [50000, 25000, 10000, 5000, 1000, 500, 250],
    USD: [100, 50, 20, 10, 5, 1],
  };
  const curOf = (e) => (e && e.currency === 'USD' ? 'USD' : 'IQD'); // older entries are IQD
  const money = (cur, n) => `${cur} ${fmt(n)}`;
  const DEPARTMENTS = [
    'Mawaid',
    'Maintenance & Housekeeping',
    'Transport',
    'Accommodation',
    'Ziyarat Orientation',
    'HR',
    'Mannat Niyaz',
    'Amil Saheb Office',
  ];
  const DEPT_COLORS = {
    'Mawaid':                     ['#d97706', '#fef3c7', '#92400e'],
    'Maintenance & Housekeeping': ['#2563eb', '#dbeafe', '#1e40af'],
    'Transport':                  ['#0891b2', '#cffafe', '#155e75'],
    'Accommodation':              ['#7c3aed', '#ede9fe', '#5b21b6'],
    'Ziyarat Orientation':        ['#12614a', '#dcfce7', '#14532d'],
    'HR':                         ['#db2777', '#fce7f3', '#9d174d'],
    'Mannat Niyaz':               ['#b45309', '#ffedd5', '#7c2d12'],
    'Amil Saheb Office':          ['#475569', '#e2e8f0', '#1e293b'],
  };
  const KEY = {
    token: 'cashbook.token',
    tokenMeta: 'cashbook.tokenMeta',
    entries: 'cashbook.entries',
    pending: 'cashbook.pending',
    draft: 'cashbook.draft',
  };

  // ---------- Small helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const digits = (s) => String(s ?? '').replace(/[^\d]/g, '');
  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const prettyDate = (s, opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) =>
    parseDate(s).toLocaleDateString('en-GB', opts);
  const timeOf = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  // ---------- State ----------
  const state = {
    currency: 'IQD',
    countsBy: {
      IQD: Object.fromEntries(CURRENCIES.IQD.map((d) => [d, 0])),
      USD: Object.fromEntries(CURRENCIES.USD.map((d) => [d, 0])),
    },
    entries: store.get(KEY.entries, []),
    pending: store.get(KEY.pending, []),
    token: store.get(KEY.token, ''),
    tokenMeta: store.get(KEY.tokenMeta, null), // { source: 'manual' | 'shared', setAt }
    checkedShared: false,
    syncing: false,
    syncState: 'idle',
    lastSync: null,
    lastError: '',
    filters: { range: 'all' },
    openId: null,
  };

  // The counts and note list of the currency tab currently selected
  Object.defineProperty(state, 'counts', { get: () => state.countsBy[state.currency] });
  const denoms = () => CURRENCIES[state.currency];

  const persist = () => {
    store.set(KEY.entries, state.entries);
    store.set(KEY.pending, state.pending);
  };

  // ============================================================
  //  GitHub storage
  // ============================================================
  const API = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}`;
  const RAW = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${CONFIG.path}`;

  function b64ToText(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  function textToB64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function ghHeaders(token = state.token) {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
  function parseList(text) {
    try { const v = JSON.parse(text || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  }

  async function readRemote() {
    if (!state.token) {
      // Public read, no key needed
      const r = await fetch(`${RAW}?t=${Date.now()}`, { cache: 'no-store' });
      if (r.status === 404) return { entries: [], sha: null };
      if (!r.ok) throw httpError(r);
      return { entries: parseList(await r.text()), sha: null };
    }
    const r = await fetch(`${API}/contents/${CONFIG.path}?ref=${CONFIG.branch}&t=${Date.now()}`, { headers: ghHeaders(), cache: 'no-store' });
    if (r.status === 404) return { entries: [], sha: null };
    if (!r.ok) throw httpError(r);
    const meta = await r.json();
    let text;
    if (meta.content && meta.encoding === 'base64') {
      text = b64ToText(meta.content);
    } else {
      // Files over 1 MB: fetch the blob directly
      const b = await fetch(`${API}/git/blobs/${meta.sha}`, { headers: ghHeaders(), cache: 'no-store' });
      if (!b.ok) throw httpError(b);
      text = b64ToText((await b.json()).content);
    }
    return { entries: parseList(text), sha: meta.sha };
  }

  async function writeRemote(entries, sha, message) {
    const body = {
      message,
      content: textToB64(JSON.stringify(entries, null, 2) + '\n'),
      branch: CONFIG.branch,
    };
    if (sha) body.sha = sha;
    const r = await fetch(`${API}/contents/${CONFIG.path}`, {
      method: 'PUT',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw httpError(r);
    return r.json();
  }

  function httpError(r) {
    const e = new Error(`HTTP ${r.status}`);
    e.status = r.status;
    return e;
  }

  // ---------- Shared access key ----------
  // A key entered once on any device is saved (encoded) in data/app-config.json,
  // and every other phone or computer picks it up from there automatically.
  const SHARED_RAW = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${CONFIG.sharedPath}`;
  const encodeKey = (t) => 'v1.' + btoa(t.split('').reverse().join(''));
  const decodeKey = (s) => {
    try { return typeof s === 'string' && s.startsWith('v1.') ? atob(s.slice(3)).split('').reverse().join('') : ''; }
    catch { return ''; }
  };

  function setToken(token, meta) {
    state.token = token;
    state.tokenMeta = meta;
    store.set(KEY.token, token);
    store.set(KEY.tokenMeta, meta);
  }

  async function readShared() {
    try {
      const r = await fetch(`${SHARED_RAW}?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json();
      const token = decodeKey(j.key);
      return token ? { token, setAt: Number(j.setAt) || 0 } : null;
    } catch { return null; }
  }

  async function publishShared(token, setAt) {
    let sha;
    const g = await fetch(`${API}/contents/${CONFIG.sharedPath}?ref=${CONFIG.branch}&t=${Date.now()}`, { headers: ghHeaders(token), cache: 'no-store' });
    if (g.ok) {
      const meta = await g.json();
      sha = meta.sha;
      try {
        const cur = JSON.parse(b64ToText(meta.content || ''));
        if (decodeKey(cur.key) === token) return true;           // already shared
        if ((Number(cur.setAt) || 0) > setAt) return false;      // a newer key is already shared
      } catch { /* unreadable file: overwrite it */ }
    } else if (g.status !== 404) {
      throw httpError(g);
    }
    const body = {
      message: 'Update the shared access key for Cash Book devices',
      content: textToB64(JSON.stringify({
        about: 'Managed by the Cash Book app so every device can save entries without entering a key.',
        key: encodeKey(token),
        setAt,
      }, null, 2) + '\n'),
      branch: CONFIG.branch,
    };
    if (sha) body.sha = sha;
    const p = await fetch(`${API}/contents/${CONFIG.sharedPath}`, {
      method: 'PUT',
      headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!p.ok) throw httpError(p);
    return true;
  }

  // Make sure this device has the newest shared key, or shares its own key if it has a newer one.
  let lastSharedCheck = 0;
  async function ensureSharedKey() {
    lastSharedCheck = Date.now();
    const shared = await readShared();
    const meta = state.tokenMeta || (state.token ? { source: 'manual', setAt: 0 } : null);
    try {
      if (shared && (!state.token || meta.source === 'shared' || shared.setAt > (meta.setAt || 0))) {
        if (shared.token !== state.token || meta.source !== 'shared') setToken(shared.token, { source: 'shared', setAt: shared.setAt });
      } else if (state.token && meta.source === 'manual' && (!shared || shared.token !== state.token)) {
        if (!meta.setAt) setToken(state.token, { source: 'manual', setAt: Date.now() });
        await publishShared(state.token, state.tokenMeta.setAt);
      }
    } catch { /* try again next time */ }
    state.checkedShared = true;
    setSyncState(state.syncState);
  }

  // Combine two lists of entries; the most recently updated copy of each entry wins.
  function merge(...lists) {
    const map = new Map();
    for (const list of lists) {
      for (const e of list || []) {
        if (!e || !e.id) continue;
        const cur = map.get(e.id);
        if (!cur || (e.updatedAt || '') >= (cur.updatedAt || '')) map.set(e.id, e);
      }
    }
    return [...map.values()].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }

  function commitMessage(items) {
    if (items.length === 1) {
      const e = items[0];
      return e.deleted
        ? `Delete entry: ${money(curOf(e), e.total)} - ${e.name} (${e.department})`
        : `Add entry: ${money(curOf(e), e.total)} - ${e.name} (${e.department}) on ${e.date}`;
    }
    return `Sync ${items.length} entries from Cash Book`;
  }

  async function sync({ quiet = true } = {}) {
    if (state.syncing) return;
    state.syncing = true;
    setSyncState('syncing');
    try {
      let done = false;
      for (let attempt = 0; attempt < 4 && !done; attempt++) {
        const remote = await readRemote();
        const sending = state.pending.slice();
        const merged = merge(remote.entries, sending);

        if (sending.length && state.token) {
          try {
            await writeRemote(merged, remote.sha, commitMessage(sending));
          } catch (err) {
            // Someone else saved at the same moment: re-read and try again
            if (err.status === 409 || err.status === 422) { await wait(600 + attempt * 700); continue; }
            throw err;
          }
          const sentIds = new Set(sending.map((p) => p.id + '|' + p.updatedAt));
          state.pending = state.pending.filter((p) => !sentIds.has(p.id + '|' + p.updatedAt));
        }
        state.entries = merge(merged, state.pending);
        done = true;
      }
      persist();
      state.lastSync = new Date();
      state.lastError = '';
      setSyncState(!state.token ? 'local' : state.pending.length ? 'offline' : 'synced');
      if (!quiet) toast(state.pending.length ? 'Saved on this device' : 'Everything is up to date');
    } catch (err) {
      state.lastError = err.message;
      if (err.status === 401 || err.status === 403) {
        setSyncState('error');
        // The key may have been replaced on another device: pick up the new one
        if (Date.now() - lastSharedCheck > 60000) {
          const before = state.token;
          ensureSharedKey().then(() => { if (state.token !== before) sync(); });
        }
        if (!quiet) toast('The access key is not working — enter a new one in Connection.', 'warn');
      } else {
        setSyncState(state.pending.length || !navigator.onLine ? 'offline' : 'error');
      }
    } finally {
      state.syncing = false;
      renderHistory();
      updateNameList();
    }
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ============================================================
  //  Sync indicator
  // ============================================================
  function setSyncState(s) {
    state.syncState = s;
    const pill = $('#syncPill');
    pill.dataset.state = s;
    const n = state.pending.length;
    const text = {
      idle: 'Starting…',
      syncing: 'Syncing…',
      synced: 'All saved',
      local: n ? `${n} waiting to upload` : 'Not connected',
      offline: n ? `${n} waiting · retrying` : 'Offline',
      error: state.token ? 'Key not working' : 'Not connected',
    }[s];
    $('.sync-text', pill).textContent = text;
    $('#connectBanner').hidden = !!state.token || !state.checkedShared;
    renderConnStatus();
  }

  // ============================================================
  //  Calculator
  // ============================================================
  const rowsEl = $('#rows');

  function buildRows() {
    const cur = state.currency;
    const sym = cur === 'USD' ? '$' : '';
    rowsEl.innerHTML = denoms().map((d) => `
      <div class="row" data-d="${d}">
        <div class="denom"><span class="note note-${cur}-${d}">${sym}${fmt(d)}</span></div>
        <div class="stepper">
          <button class="step minus" data-act="minus" type="button" aria-label="One less ${fmt(d)} note">−</button>
          <input class="count" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" placeholder="0" aria-label="Number of ${fmt(d)} notes" autocomplete="off">
          <button class="step plus" data-act="plus" type="button" aria-label="One more ${fmt(d)} note">+</button>
        </div>
        <div class="sub"><output>0</output></div>
      </div>`).join('');
  }

  function totals(counts = state.counts, list = denoms()) {
    let total = 0, notes = 0;
    for (const d of list) { const c = Number(counts[d]) || 0; total += c * d; notes += c; }
    return { total, notes };
  }

  function renderCalc({ bumpDenom } = {}) {
    for (const row of $$('.row', rowsEl)) {
      const d = Number(row.dataset.d);
      const c = state.counts[d] || 0;
      const input = $('.count', row);
      if (document.activeElement !== input) input.value = c ? String(c) : '';
      $('output', row).textContent = fmt(c * d);
      row.classList.toggle('has', c > 0);
      if (bumpDenom === d) { row.classList.remove('bump'); void row.offsetWidth; row.classList.add('bump'); }
    }
    const { total, notes } = totals();
    $('#totalCur').textContent = state.currency;
    tween($('#grandTotal'), total);
    $('#notesCount').textContent = `${fmt(notes)} note${notes === 1 ? '' : 's'}`;
    renderSummary();
    saveDraft();
  }

  function tween(el, to) {
    const from = Number(el.dataset.v || 0);
    el.dataset.v = to;
    if (from === to) { el.textContent = fmt(to); return; }
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    const start = performance.now(), dur = 380;
    cancelAnimationFrame(el._raf);
    const step = (t) => {
      const k = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  rowsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.step');
    if (!btn) return;
    const d = Number(btn.closest('.row').dataset.d);
    const cur = state.counts[d] || 0;
    state.counts[d] = btn.dataset.act === 'plus' ? Math.min(99999, cur + 1) : Math.max(0, cur - 1);
    if (navigator.vibrate) try { navigator.vibrate(8); } catch { /* ignore */ }
    renderCalc({ bumpDenom: d });
  });
  rowsEl.addEventListener('input', (e) => {
    if (!e.target.classList.contains('count')) return;
    const clean = digits(e.target.value).slice(0, 5);
    if (clean !== e.target.value) e.target.value = clean;
    const d = Number(e.target.closest('.row').dataset.d);
    state.counts[d] = Number(clean) || 0;
    renderCalc();
  });
  rowsEl.addEventListener('focusin', (e) => { if (e.target.classList.contains('count')) e.target.select(); });
  rowsEl.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('count') || e.key !== 'Enter') return;
    e.preventDefault();
    const inputs = $$('.count', rowsEl);
    const i = inputs.indexOf(e.target);
    if (inputs[i + 1]) inputs[i + 1].focus(); else $('#nameInput').focus();
  });
  rowsEl.addEventListener('focusout', () => renderCalc());

  $('#clearCounts').addEventListener('click', () => {
    denoms().forEach((d) => (state.counts[d] = 0));
    renderCalc();
  });

  // ---------- Currency tabs ----------
  function setCurrency(cur, { animate = true } = {}) {
    if (!CURRENCIES[cur]) cur = 'IQD';
    state.currency = cur;
    const sw = $('#curSwitch');
    sw.dataset.active = cur;
    $('#calcCard').dataset.cur = cur;
    $$('.cur-tab', sw).forEach((t) => { const on = t.dataset.cur === cur; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
    buildRows();
    if (animate) { rowsEl.classList.remove('swap'); void rowsEl.offsetWidth; rowsEl.classList.add('swap'); }
    $('#grandTotal').dataset.v = totals().total; // switch the total instantly, no count-up
    renderCalc();
  }
  $('#curSwitch').addEventListener('click', (e) => {
    const t = e.target.closest('.cur-tab');
    if (t && t.dataset.cur !== state.currency) setCurrency(t.dataset.cur);
  });

  // ---------- Details form ----------
  const nameInput = $('#nameInput');
  const deptSelect = $('#deptSelect');
  const dateInput = $('#dateInput');

  function fillDepartments() {
    deptSelect.insertAdjacentHTML('beforeend', DEPARTMENTS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join(''));
    $('#fDept').insertAdjacentHTML('beforeend', DEPARTMENTS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join(''));
  }

  function updateDateHint() {
    const v = dateInput.value;
    $('#dateHint').textContent = v === isoDate() ? '(today)' : v ? `(${prettyDate(v, { weekday: 'short', day: 'numeric', month: 'short' })})` : '';
  }

  function renderSummary() {
    const { total } = totals();
    const name = nameInput.value.trim();
    const dept = deptSelect.value;
    const el = $('#summaryLine');
    if (!total && !name) { el.textContent = 'Enter notes and details above'; return; }
    el.innerHTML = `<b>${money(state.currency, total)}</b>${name ? ` to <b>${esc(name)}</b>` : ''}${dept ? ` · ${esc(dept)}` : ''}`;
  }

  [nameInput, deptSelect].forEach((el) => el.addEventListener('input', () => {
    el.closest('.field').classList.remove('invalid');
    deptSelect.classList.toggle('empty', !deptSelect.value);
    renderSummary();
    saveDraft();
  }));
  deptSelect.addEventListener('change', () => { deptSelect.classList.toggle('empty', !deptSelect.value); });
  dateInput.addEventListener('change', () => { if (!dateInput.value) dateInput.value = isoDate(); updateDateHint(); });

  function saveDraft() {
    store.set(KEY.draft, { currency: state.currency, countsBy: state.countsBy, name: nameInput.value, dept: deptSelect.value, day: isoDate() });
  }
  function loadDraft() {
    const d = store.get(KEY.draft, null);
    if (!d) return;
    const saved = d.countsBy || (d.counts ? { IQD: d.counts } : {});
    for (const cur of Object.keys(CURRENCIES)) {
      for (const k of CURRENCIES[cur]) state.countsBy[cur][k] = Number(saved[cur] && saved[cur][k]) || 0;
    }
    if (CURRENCIES[d.currency]) state.currency = d.currency;
    nameInput.value = d.name || '';
    if (d.dept && DEPARTMENTS.includes(d.dept)) deptSelect.value = d.dept;
  }

  function resetForm() {
    for (const cur of Object.keys(CURRENCIES)) CURRENCIES[cur].forEach((d) => (state.countsBy[cur][d] = 0));
    nameInput.value = '';
    deptSelect.value = '';
    deptSelect.classList.add('empty');
    dateInput.value = isoDate();
    $$('.field.invalid').forEach((f) => f.classList.remove('invalid'));
    updateDateHint();
    renderCalc();
  }

  $('#resetAll').addEventListener('click', () => {
    const { total } = totals();
    if (!total && !nameInput.value.trim()) return resetForm();
    confirmBox('Start over?', 'This clears the counts and details you have entered. Nothing saved will be affected.', 'Clear', resetForm);
  });

  // ---------- Save ----------
  $('#saveBtn').addEventListener('click', () => {
    const { total, notes } = totals();
    const name = nameInput.value.trim().replace(/\s+/g, ' ');
    const dept = deptSelect.value;

    if (!total) {
      shake($('#calcCard'));
      toast('Please count at least one note first', 'warn');
      $('.count', rowsEl).focus();
      return;
    }
    let bad = null;
    if (!name) { $('#nameField').classList.add('invalid'); bad = bad || nameInput; }
    if (!dept) { $('#deptField').classList.add('invalid'); bad = bad || deptSelect; }
    if (bad) {
      shake(bad.closest('.card'));
      bad.focus();
      return;
    }

    const now = new Date().toISOString();
    const counts = {};
    for (const d of denoms()) if (state.counts[d]) counts[d] = state.counts[d];
    const entry = {
      id: uid(),
      currency: state.currency,
      date: dateInput.value || isoDate(),
      name,
      department: dept,
      counts,
      notes,
      total,
      createdAt: now,
      updatedAt: now,
    };
    state.entries = merge(state.entries, [entry]);
    state.pending.push(entry);
    persist();
    showSuccess(entry);
    resetForm();
    renderHistory();
    updateNameList();
    sync();
  });

  function shake(el) {
    if (!el) return;
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
  }

  let successTimer;
  function showSuccess(e) {
    $('#successCur').textContent = curOf(e);
    $('#successAmount').textContent = fmt(e.total);
    $('#successWho').textContent = `given to ${e.name} · ${e.department}`;
    $('#successOverlay').hidden = false;
    clearTimeout(successTimer);
    successTimer = setTimeout(hideSuccess, 3200);
  }
  function hideSuccess() { $('#successOverlay').hidden = true; }
  $('#successClose').addEventListener('click', hideSuccess);
  $('#successOverlay').addEventListener('click', (e) => { if (e.target.id === 'successOverlay') hideSuccess(); });

  function updateNameList() {
    const names = [...new Set(activeEntries().map((e) => e.name))].sort((a, b) => a.localeCompare(b));
    $('#nameList').innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join('');
  }

  // ============================================================
  //  History
  // ============================================================
  const activeEntries = () => state.entries.filter((e) => !e.deleted);
  const pendingIds = () => new Set(state.pending.map((p) => p.id));

  function readFilters() {
    return {
      name: $('#fName').value.trim().toLowerCase(),
      dept: $('#fDept').value,
      cur: state.filters.cur || '',
      from: $('#fFrom').value,
      to: $('#fTo').value,
      min: digits($('#fMin').value) ? Number(digits($('#fMin').value)) : null,
      max: digits($('#fMax').value) ? Number(digits($('#fMax').value)) : null,
    };
  }

  function filtered() {
    const f = readFilters();
    return activeEntries().filter((e) =>
      (!f.name || e.name.toLowerCase().includes(f.name)) &&
      (!f.dept || e.department === f.dept) &&
      (!f.cur || curOf(e) === f.cur) &&
      (!f.from || e.date >= f.from) &&
      (!f.to || e.date <= f.to) &&
      (f.min == null || e.total >= f.min) &&
      (f.max == null || e.total <= f.max)
    ).sort((a, b) => (b.date.localeCompare(a.date)) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  function renderHistory() {
    const list = filtered();
    const all = activeEntries();
    const listEl = $('#historyList');
    const f = readFilters();
    const extra = [f.dept, f.from || f.to, f.min != null, f.max != null].filter(Boolean).length;
    $('#filterCount').hidden = !extra;
    $('#filterCount').textContent = extra;

    const sums = sumByCurrency(list);
    const statEl = $('#statTotal');
    statEl.classList.toggle('two', sums.length > 1);
    statEl.innerHTML = (sums.length ? sums : [['IQD', 0]]).map(([c, v]) => `<span><small>${c}</small><b>${fmt(v)}</b></span>`).join('');
    $('#statCount').textContent = fmt(list.length);
    const badge = $('#historyBadge');
    badge.hidden = !all.length;
    badge.textContent = all.length > 999 ? '999+' : all.length;

    if (!list.length) {
      listEl.innerHTML = `
        <div class="empty">
          <div class="empty-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v10a2 2 0 01-2 2H6a2 2 0 01-2-2V7zm0 0l2-3h12l2 3M9 11h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <h3>${all.length ? 'Nothing matches these filters' : 'No entries yet'}</h3>
          <p>${all.length ? 'Try clearing the filters to see everything.' : 'Saved entries will appear here.'}</p>
        </div>`;
      return;
    }

    const pend = pendingIds();
    const groups = new Map();
    for (const e of list) { if (!groups.has(e.date)) groups.set(e.date, []); groups.get(e.date).push(e); }
    const today = isoDate();
    const yesterday = isoDate(new Date(Date.now() - 864e5));

    let html = '';
    let i = 0;
    for (const [date, items] of groups) {
      const label = date === today ? 'Today' : date === yesterday ? 'Yesterday' : prettyDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const dayTotals = sumByCurrency(items).map(([c, v]) => `<span>${money(c, v)}</span>`).join('');
      html += `<div class="day-group" style="animation-delay:${Math.min(i++, 8) * 40}ms">
        <div class="day-head"><h3>${esc(label)}</h3><div class="day-totals">${dayTotals}</div></div>
        ${items.map((e) => entryCard(e, pend.has(e.id))).join('')}
      </div>`;
    }
    listEl.innerHTML = html;
  }

  // [['IQD', total], ['USD', total]] — only the currencies that appear
  function sumByCurrency(list) {
    const sums = {};
    for (const e of list) { const c = curOf(e); sums[c] = (sums[c] || 0) + e.total; }
    return Object.keys(CURRENCIES).filter((c) => c in sums).map((c) => [c, sums[c]]);
  }

  function entryCard(e, isPending) {
    const [av, pbg, pfg] = DEPT_COLORS[e.department] || ['#12614a', '#e5f2ec', '#12614a'];
    const cur = curOf(e);
    const sym = cur === 'USD' ? '$' : '';
    const d0 = parseDate(e.date);
    const rows = CURRENCIES[cur].filter((d) => e.counts && e.counts[d]).map((d) => `
      <div class="bd-row"><span class="note note-${cur}-${d}">${sym}${fmt(d)}</span><span class="x">× ${fmt(e.counts[d])}</span><span class="v">${fmt(d * e.counts[d])}</span></div>`).join('');
    const open = state.openId === e.id;
    return `
      <article class="entry${open ? ' open' : ''}" data-id="${esc(e.id)}">
        <button class="entry-main" type="button" aria-expanded="${open}">
          <span class="date-tile" style="--tile:${av}" aria-label="${esc(prettyDate(e.date))}">
            <span class="dt-month">${esc(d0.toLocaleDateString('en-GB', { month: 'short' }))}</span>
            <span class="dt-day">${d0.getDate()}</span>
            <span class="dt-week">${esc(d0.toLocaleDateString('en-GB', { weekday: 'short' }))}</span>
          </span>
          <span class="who">
            <strong>${esc(e.name)}</strong>
            <span class="when">${esc(prettyDate(e.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</span>
            <span class="dept-pill" style="--pill-bg:${pbg};--pill-fg:${pfg}">${esc(e.department)}</span>
          </span>
          <span class="amt">
            <b class="${cur === 'USD' ? 'usd' : ''}"><small>${cur}</small>${fmt(e.total)}</b>
            <span>${isPending ? '<span class="pending-tag">● Waiting to upload</span>' : esc(timeOf(e.createdAt))}</span>
          </span>
        </button>
        <div class="entry-detail"><div><div class="detail-inner">
          <div class="breakdown">
            ${rows}
            <div class="bd-total"><span>Total · ${fmt(e.notes || 0)} notes</span><span>${money(cur, e.total)}</span></div>
          </div>
          <div class="detail-foot">
            <small>Saved ${esc(prettyDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' }))} at ${esc(timeOf(e.createdAt))}</small>
            <button class="del-btn" data-del="${esc(e.id)}" type="button">Delete</button>
          </div>
        </div></div></div>
      </article>`;
  }

  $('#historyList').addEventListener('click', (ev) => {
    const del = ev.target.closest('[data-del]');
    if (del) {
      const e = state.entries.find((x) => x.id === del.dataset.del);
      if (!e) return;
      confirmBox('Delete this entry?', `${money(curOf(e), e.total)} given to ${e.name} (${e.department}) will be removed from the history for everyone.`, 'Delete', () => {
        const tomb = { ...e, deleted: true, updatedAt: new Date().toISOString() };
        state.entries = merge(state.entries, [tomb]);
        state.pending.push(tomb);
        state.openId = null;
        persist();
        renderHistory();
        toast('Entry deleted');
        sync();
      });
      return;
    }
    const main = ev.target.closest('.entry-main');
    if (!main) return;
    const card = main.closest('.entry');
    const id = card.dataset.id;
    const willOpen = !card.classList.contains('open');
    $$('.entry.open').forEach((c) => { c.classList.remove('open'); $('.entry-main', c).setAttribute('aria-expanded', 'false'); });
    if (willOpen) { card.classList.add('open'); main.setAttribute('aria-expanded', 'true'); }
    state.openId = willOpen ? id : null;
  });

  // ---------- Filters ----------
  function setRange(range) {
    state.filters.range = range;
    $$('#quickDates .chip').forEach((c) => c.classList.toggle('active', c.dataset.range === range));
    const t = new Date();
    if (range === 'today') { $('#fFrom').value = isoDate(t); $('#fTo').value = isoDate(t); }
    else if (range === 'week') { $('#fFrom').value = isoDate(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 6)); $('#fTo').value = isoDate(t); }
    else if (range === 'month') { $('#fFrom').value = isoDate(new Date(t.getFullYear(), t.getMonth(), 1)); $('#fTo').value = isoDate(t); }
    else if (range === 'all') { $('#fFrom').value = ''; $('#fTo').value = ''; }
    renderHistory();
  }
  $('#quickDates').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) setRange(c.dataset.range); });
  ['#fFrom', '#fTo'].forEach((s) => $(s).addEventListener('change', () => {
    $$('#quickDates .chip').forEach((c) => c.classList.toggle('active', !$('#fFrom').value && !$('#fTo').value && c.dataset.range === 'all'));
    renderHistory();
  }));
  ['#fName', '#fDept'].forEach((s) => $(s).addEventListener('input', renderHistory));
  $$('.money-input').forEach((el) => el.addEventListener('input', () => {
    const d = digits(el.value).slice(0, 12);
    el.value = d ? fmt(Number(d)) : '';
    renderHistory();
  }));
  function setCurFilter(cur) {
    state.filters.cur = cur;
    $$('#curFilter .seg').forEach((b) => b.classList.toggle('active', b.dataset.cur === cur));
    renderHistory();
  }
  $('#curFilter').addEventListener('click', (e) => { const b = e.target.closest('.seg'); if (b) setCurFilter(b.dataset.cur); });
  $('#clearFilters').addEventListener('click', () => {
    setCurFilter('');
    ['#fName', '#fFrom', '#fTo', '#fMin', '#fMax'].forEach((s) => ($(s).value = ''));
    $('#fDept').value = '';
    setRange('all');
  });
  $('#toggleFilters').addEventListener('click', () => {
    const more = $('#filtersMore');
    const open = !more.classList.contains('open');
    more.classList.toggle('open', open);
    $('#toggleFilters').setAttribute('aria-expanded', String(open));
  });

  // ---------- Export ----------
  $('#exportCsv').addEventListener('click', () => {
    const list = filtered();
    if (!list.length) return toast('There is nothing to download', 'warn');
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    // Only include note columns for the currencies in the list
    const curs = sumByCurrency(list).map(([c]) => c);
    const cols = curs.flatMap((c) => CURRENCIES[c].map((d) => [c, d]));
    const head = ['Date', 'Name', 'Department', 'Currency', ...cols.map(([c, d]) => `${c} ${fmt(d)} notes`), 'Total notes', 'Total amount', 'Saved at'];
    const blank = cols.map(() => '');
    const lines = [head.map(q).join(',')];
    for (const e of list) {
      const c = curOf(e);
      lines.push([e.date, e.name, e.department, c, ...cols.map(([cc, d]) => (cc === c && e.counts && e.counts[d]) || ''), e.notes || 0, e.total, new Date(e.createdAt).toLocaleString()].map(q).join(','));
    }
    for (const [c, v] of sumByCurrency(list)) lines.push(['', '', `TOTAL ${c}`, c, ...blank, '', v, ''].map(q).join(','));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cash-book-${isoDate()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Downloaded — open it with Excel');
  });

  // ============================================================
  //  Tabs
  // ============================================================
  function showTab(tab) {
    $('.tabs-inner').dataset.active = tab;
    $$('.tab').forEach((t) => { const on = t.dataset.tab === tab; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
    $$('.view').forEach((v) => { const on = v.id === `view-${tab}`; v.hidden = !on; v.classList.toggle('active', on); });
    if (tab === 'history') { renderHistory(); sync(); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    try { history.replaceState(null, '', tab === 'history' ? '#history' : location.pathname + location.search); } catch { /* ignore */ }
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  // ============================================================
  //  Dialogs, toast
  // ============================================================
  let confirmCb = null;
  function confirmBox(title, text, yes, cb) {
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmYes').textContent = yes;
    confirmCb = cb;
    $('#confirmOverlay').hidden = false;
    $('#confirmNo').focus();
  }
  $('#confirmNo').addEventListener('click', () => ($('#confirmOverlay').hidden = true));
  $('#confirmYes').addEventListener('click', () => { $('#confirmOverlay').hidden = true; const cb = confirmCb; confirmCb = null; cb && cb(); });
  $('#confirmOverlay').addEventListener('click', (e) => { if (e.target.id === 'confirmOverlay') e.target.hidden = true; });

  let toastTimer;
  function toast(msg, kind = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = 'toast'), 2800);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    $$('.overlay').forEach((o) => (o.hidden = true));
  });

  // ============================================================
  //  Connection settings
  // ============================================================
  function openSettings() {
    state.replacing = false;
    renderConnStatus();
    $('#settingsOverlay').hidden = false;
  }
  $('#syncPill').addEventListener('click', openSettings);
  $$('[data-open="settings"]').forEach((b) => b.addEventListener('click', openSettings));
  $('#settingsOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'settingsOverlay' || e.target.closest('[data-close]')) $('#settingsOverlay').hidden = true;
  });

  function renderConnStatus() {
    const box = $('#connStatus');
    if (!box) return;
    const connected = !!state.token;
    $('#connectedBox').hidden = !connected;
    let msg;
    const askKey = !connected || state.replacing || state.syncState === 'error';
    $('#connectBox').hidden = !askKey;
    $('#replaceKey').hidden = askKey;
    if (!connected) msg = 'Not connected — entries are kept on this device only';
    else if (state.syncState === 'error') msg = 'The access key is not working (it may have expired). Enter a new one below — every device will pick it up.';
    else if (state.pending.length) msg = `Connected · ${state.pending.length} entr${state.pending.length === 1 ? 'y' : 'ies'} waiting to upload`;
    else msg = `Connected · all entries saved${state.lastSync ? ` (checked ${timeOf(state.lastSync.toISOString())})` : ''}`;
    box.className = `conn-status ${connected && state.syncState !== 'error' ? 'ok' : 'no'}`;
    box.innerHTML = `<span class="dot"></span><span>${esc(msg)}</span>`;
  }

  async function connect(token, { silent = false } = {}) {
    token = token.trim();
    if (!token) { toast('Please paste the access key', 'warn'); return false; }
    const btn = $('#connectBtn');
    btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const r = await fetch(API, { headers: ghHeaders(token), cache: 'no-store' });
      if (!r.ok) throw httpError(r);
      const setAt = Date.now();
      setToken(token, { source: 'manual', setAt });
      state.replacing = false;
      $('#tokenInput').value = '';
      $('#settingsOverlay').hidden = true;
      let shared = false;
      try { shared = await publishShared(token, setAt); } catch { /* shared again on next start */ }
      if (!silent) toast(shared ? 'Connected! Every phone and computer will now connect by itself.' : 'Connected! Uploading entries…');
      await sync();
      return true;
    } catch (err) {
      toast(err.status === 401 || err.status === 404 ? 'That key did not work. Please check it and try again.' : 'Could not reach GitHub. Check the internet.', 'warn');
      return false;
    } finally {
      btn.disabled = false; btn.textContent = 'Connect';
    }
  }
  $('#connectBtn').addEventListener('click', () => connect($('#tokenInput').value));
  $('#tokenInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(e.target.value); });
  $('#syncNow').addEventListener('click', () => sync({ quiet: false }));
  $('#replaceKey').addEventListener('click', () => {
    state.replacing = true;
    renderConnStatus();
    $('#tokenInput').focus();
  });

  // ============================================================
  //  Start up
  // ============================================================
  function init() {
    $('#todayLabel').textContent = prettyDate(isoDate());
    $('#repoNameLabel').textContent = CONFIG.repo;
    fillDepartments();
    loadDraft();
    setCurrency(state.currency, { animate: false });
    deptSelect.classList.toggle('empty', !deptSelect.value);
    dateInput.value = isoDate();
    updateDateHint();
    renderCalc();
    renderHistory();
    updateNameList();
    setSyncState(state.token ? 'idle' : 'local');
    if (window.matchMedia('(min-width: 900px)').matches) {
      $('#filtersMore').classList.add('open');
      $('#toggleFilters').setAttribute('aria-expanded', 'true');
    }

    // One-tap setup link: …/#connect=KEY
    const handleLink = () => {
      const m = location.hash.match(/^#connect=(.+)$/);
      if (!m) return false;
      try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
      connect(decodeURIComponent(m[1]));
      return true;
    };
    window.addEventListener('hashchange', handleLink);
    if (!handleLink()) {
      if (location.hash === '#history') showTab('history');
      ensureSharedKey().finally(() => sync());
    }

    setInterval(async () => {
      // A device with no key keeps looking for the shared one
      if (!state.token) await ensureSharedKey();
      sync();
    }, SYNC_EVERY_MS);
    window.addEventListener('online', () => sync());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });

    // Keep "today" fresh if the app stays open past midnight
    setInterval(() => {
      const t = isoDate();
      const prev = $('#todayLabel').dataset.day;
      if (prev !== t) {
        if (dateInput.value === prev) { dateInput.value = t; updateDateHint(); }
        $('#todayLabel').dataset.day = t;
        $('#todayLabel').textContent = prettyDate(t);
      }
    }, 60000);
    $('#todayLabel').dataset.day = isoDate();
  }

  init();
})();
