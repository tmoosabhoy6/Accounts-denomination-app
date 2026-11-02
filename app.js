/* ============================================================
   Cash Book — app logic
   Entries are kept in this browser and saved into a folder on this
   computer (one sub-folder per day). No online database.
   ============================================================ */
(() => {
  'use strict';

  // ---------- Settings ----------
  // Where the old online version kept its records (used once by "Import old records")
  const OLD_RECORDS_URL = 'https://raw.githubusercontent.com/tmoosabhoy6/Accounts-denomination-app/72afa1e62cd7058d502123995c1987f868e66bbc/data/entries.json';
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
    'Visa',
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
    'Visa':                       ['#0f766e', '#ccfbf1', '#134e4a'],
  };
  // Colours for departments added in the app, picked from the name
  const EXTRA_COLORS = [
    ['#be123c', '#ffe4e6', '#881337'], ['#4f46e5', '#e0e7ff', '#3730a3'], ['#65a30d', '#ecfccb', '#3f6212'],
    ['#c2410c', '#ffedd5', '#7c2d12'], ['#0369a1', '#e0f2fe', '#0c4a6e'], ['#a21caf', '#fae8ff', '#701a75'],
    ['#4d7c0f', '#f7fee7', '#365314'], ['#9f1239', '#fff1f2', '#881337'],
  ];
  function deptColors(name) {
    if (DEPT_COLORS[name]) return DEPT_COLORS[name];
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return EXTRA_COLORS[h % EXTRA_COLORS.length];
  }
  const KEY = {
    entries: 'cashbook.local.entries',  // entries made in this browser (kept until safely in the folder)
    unsaved: 'cashbook.local.unsaved',  // { id: updatedAt } not yet written to the folder
    draft: 'cashbook.draft',
    depts: 'cashbook.depts',
  };
  // Left over from the old online version: keep any entries it had not uploaded yet
  const OLD_PENDING = (() => { try { return JSON.parse(localStorage.getItem('cashbook.pending') || '[]'); } catch { return []; } })();
  ['cashbook.token', 'cashbook.tokenMeta', 'cashbook.entries', 'cashbook.pending', 'cashbook.deptPending'].forEach((k) => {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  });

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
    unsaved: store.get(KEY.unsaved, {}),
    folderEntries: [],                           // everything read back from the folder
    depts: store.get(KEY.depts, []),             // departments added in the app: { id, name, createdAt, updatedAt, removed? }
    dir: null,                                   // the chosen folder
    folderOk: false,                             // browser allows writing to it right now
    filters: { range: 'all' },
    openId: null,
  };

  // The counts and note list of the currency tab currently selected
  Object.defineProperty(state, 'counts', { get: () => state.countsBy[state.currency] });
  const denoms = () => CURRENCIES[state.currency];

  const persist = () => {
    store.set(KEY.entries, state.entries);
    store.set(KEY.unsaved, state.unsaved);
    store.set(KEY.depts, state.depts);
  };
  if (Array.isArray(OLD_PENDING) && OLD_PENDING.length) {
    state.entries = merge(state.entries, OLD_PENDING);
    for (const e of OLD_PENDING) if (e && e.id) state.unsaved[e.id] = e.updatedAt;
    persist();
  }
  // Forget "unsaved" marks for entries that are no longer kept here
  for (const id of Object.keys(state.unsaved)) if (!state.entries.some((e) => e.id === id)) delete state.unsaved[id];

  // ============================================================
  //  Saving: browser cache + a folder on this computer
  // ============================================================
  // Each entry is kept in this browser the moment it is saved, then written
  // into the chosen folder, one sub-folder per day:
  //   <folder>\2026\11 - November\2026-11-02\Cash Book 2026-11-02.csv          (opens in Excel)
  //   <folder>\2026\11 - November\2026-11-02\Cash Book 2026-11-02 - data.json  (read back by History)
  const FS_OK = typeof window.showDirectoryPicker === 'function';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dayParts = (date) => { const [y, m] = date.split('-'); return [y, `${m} - ${MONTHS[Number(m) - 1]}`, date]; };
  const csvName = (date) => `Cash Book ${date}.csv`;
  const dataName = (date) => `Cash Book ${date} - data.json`;
  const DEPT_FILE = 'Cash Book departments.json';

  // Combine lists of entries; the most recently updated copy of each entry wins.
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

  const allEntries = () => merge(state.folderEntries, state.entries);
  const unsavedCount = () => Object.keys(state.unsaved).length;
  const unsavedDates = () => [...new Set(state.entries.filter((e) => e.id in state.unsaved).map((e) => e.date))].sort();

  // Keep an entry in the browser and remember it still has to go into the folder
  function keepLocally(list) {
    state.entries = merge(state.entries, list);
    for (const e of list) state.unsaved[e.id] = e.updatedAt;
    persist();
  }

  // Remembers the chosen folder between visits
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('cashbook', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('handles');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('handles', mode);
        const req = fn(tx.objectStore('handles'));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
      };
    });
  }
  const idbGet = (k) => idb('readonly', (s) => s.get(k)).catch(() => null);
  const idbSet = (k, v) => idb('readwrite', (s) => s.put(v, k)).catch(() => {});

  async function folderPermission(ask = false) {
    if (!state.dir) return false;
    try {
      const opts = { mode: 'readwrite' };
      if ((await state.dir.queryPermission(opts)) === 'granted') return true;
      if (ask && (await state.dir.requestPermission(opts)) === 'granted') return true;
    } catch { /* folder moved or deleted */ }
    return false;
  }

  async function chooseFolder() {
    if (!FS_OK) { toast('Open this app in Chrome or Edge on a computer to save into a folder', 'warn'); return false; }
    try {
      const dir = await window.showDirectoryPicker({ id: 'cashbook', mode: 'readwrite', startIn: 'documents' });
      state.dir = dir;
      state.folderOk = true;
      await idbSet('root', dir);
      toast(`Saving into the "${dir.name}" folder`);
      await loadFolder();
      await saveDepartments();
      await saveAll();
      return true;
    } catch (err) {
      if (!err || err.name !== 'AbortError') toast('Could not use that folder. Please choose another one.', 'warn');
      return false;
    } finally {
      updateStatus();
    }
  }

  async function getDayDir(date, create) {
    let d = state.dir;
    for (const part of dayParts(date)) d = await d.getDirectoryHandle(part, { create });
    return d;
  }
  async function readJson(dir, name) {
    try { return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text()); }
    catch { return null; }
  }
  async function writeText(dir, name, text) {
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await w.write(text);
    await w.close();
  }

  // Read every saved day back from the folder (History shows these)
  async function loadFolder() {
    if (!state.folderOk) return;
    const found = [];
    try {
      for await (const [y, yDir] of state.dir.entries()) {
        if (yDir.kind !== 'directory' || !/^\d{4}$/.test(y)) continue;
        for await (const [, mDir] of yDir.entries()) {
          if (mDir.kind !== 'directory') continue;
          for await (const [day, dDir] of mDir.entries()) {
            if (dDir.kind !== 'directory' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
            const j = await readJson(dDir, dataName(day));
            if (j && Array.isArray(j.entries)) found.push(...j.entries);
          }
        }
      }
      const deps = await readJson(state.dir, DEPT_FILE);
      if (deps && Array.isArray(deps.departments)) state.depts = merge(state.depts, deps.departments);
    } catch { /* folder not readable right now */ }
    state.folderEntries = found;
    persist();
    renderDeptOptions();
    renderHistory();
    updateNameList();
  }

  // Write one day into its folder, merged with what is already there
  async function saveDay(date) {
    const dir = await getDayDir(date, true);
    const existing = (await readJson(dir, dataName(date)) || {}).entries || [];
    const merged = merge(existing, state.entries.filter((e) => e.date === date));
    await writeText(dir, dataName(date), JSON.stringify({ date, savedAt: new Date().toISOString(), entries: merged }, null, 2) + '\n');
    await writeText(dir, csvName(date), buildCsv(merged.filter((e) => !e.deleted)));
    state.folderEntries = merge(state.folderEntries.filter((e) => e.date !== date), merged);
  }

  // Browsers without folder access (phones, Safari, Firefox): download the day's files instead
  function downloadUnsaved() {
    const dates = unsavedDates();
    if (!dates.length) { toast('Everything is already saved'); return; }
    for (const date of dates) {
      downloadFile(csvName(date), buildCsv(state.entries.filter((e) => e.date === date && !e.deleted)), 'text/csv;charset=utf-8');
      const ids = state.entries.filter((e) => e.date === date).map((e) => e.id);
      ids.forEach((id) => delete state.unsaved[id]);
    }
    persist();
    updateStatus();
    renderHistory();
    toast(`Downloaded ${dates.length} day${dates.length === 1 ? '' : 's'} into Downloads`);
  }

  let saving = null;
  async function saveAll({ ask = false, quiet = true } = {}) {
    if (saving) return saving;
    saving = (async () => {
      const dates = unsavedDates();
      if (!dates.length) { if (!quiet) toast('Everything is already saved in the folder'); return true; }
      if (!FS_OK || !state.dir) return false;
      state.folderOk = await folderPermission(ask);
      if (!state.folderOk) return false;
      updateStatus('saving');
      try {
        for (const date of dates) {
          // Only clear what was actually written (an entry added meanwhile stays unsaved)
          const snap = state.entries.filter((e) => e.date === date && e.id in state.unsaved).map((e) => [e.id, e.updatedAt]);
          await saveDay(date);
          for (const [id, upd] of snap) if (state.unsaved[id] === upd) delete state.unsaved[id];
        }
        pruneCache();
        persist();
        if (!quiet) toast(`Saved into the "${state.dir.name}" folder`);
        return true;
      } catch {
        state.folderOk = await folderPermission(false);
        toast('Could not save into the folder. Check that it still exists, or choose it again.', 'warn');
        return false;
      }
    })();
    try { return await saving; } finally { saving = null; updateStatus(); renderHistory(); }
  }

  // Entries already in the folder don't need to stay in the browser for ever
  function pruneCache() {
    const cutoff = isoDate(new Date(Date.now() - 45 * 864e5));
    state.entries = state.entries.filter((e) => e.id in state.unsaved || e.date >= cutoff);
  }

  async function saveDepartments() {
    persist();
    if (!FS_OK || !state.dir || !(await folderPermission(false))) return;
    try { await writeText(state.dir, DEPT_FILE, JSON.stringify({ departments: state.depts }, null, 2) + '\n'); } catch { /* next time */ }
  }

  // ---------- Status pill + banner ----------
  function currentStatus() {
    const n = unsavedCount();
    if (!FS_OK) return n ? 'unsaved' : 'browser';
    if (!state.dir) return 'nofolder';
    if (!state.folderOk) return 'reconnect';
    return n ? 'unsaved' : 'saved';
  }
  function updateStatus(forced) {
    const st = forced || currentStatus();
    const n = unsavedCount();
    const pill = $('#syncPill');
    pill.dataset.state = st;
    $('.sync-text', pill).textContent = {
      saving: 'Saving…',
      saved: 'All saved to folder',
      unsaved: `${n} not saved yet`,
      nofolder: 'Choose save folder',
      reconnect: 'Allow folder access',
      browser: 'Saved in this browser',
    }[st];

    const banner = $('#folderBanner');
    let b = null;
    if (!FS_OK) {
      if (n) b = ['This browser cannot save into folders', 'Use Chrome or Edge on the accounts computer. Here, the button downloads the day\'s Excel file instead.', 'Download files', 'download'];
    } else if (!state.dir) {
      b = ['Choose where to save', 'Pick a folder on this computer, for example Documents › Cash Book. Every day is saved into its own dated folder.', 'Choose folder', 'choose'];
    } else if (!state.folderOk) {
      b = [`Allow saving to the "${state.dir.name}" folder`, 'The browser asks for permission each time the app opens. Press the button, then choose Allow.', 'Allow', 'allow'];
    } else if (n && st !== 'saving') {
      b = [`${n} entr${n === 1 ? 'y is' : 'ies are'} not saved to the folder yet`, 'Press Save now to write them into the folder.', 'Save now', 'save'];
    }
    banner.hidden = !b;
    if (b) {
      $('#bannerTitle').textContent = b[0];
      $('#bannerText').textContent = b[1];
      $('#bannerBtn').textContent = b[2];
      $('#bannerBtn').dataset.act = b[3];
    }
    renderConnStatus();
  }

  async function allowFolder() {
    state.folderOk = await folderPermission(true);
    updateStatus();
    if (state.folderOk) { await loadFolder(); await saveDepartments(); await saveAll({ quiet: false }); }
  }

  $('#bannerBtn').addEventListener('click', async () => {
    const act = $('#bannerBtn').dataset.act;
    if (act === 'choose') await chooseFolder();
    else if (act === 'allow') await allowFolder();
    else if (act === 'save') await saveAll({ ask: true, quiet: false });
    else if (act === 'download') downloadUnsaved();
  });

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

  // ---------- Departments ----------
  const ADD_DEPT = '__add__';
  const deptKey = (name) => name.trim().replace(/\s+/g, ' ').toLowerCase();
  const customDepts = () => state.depts.filter((d) => !d.removed && !DEPARTMENTS.some((b) => deptKey(b) === d.id));
  const allDepts = () => [...DEPARTMENTS, ...customDepts().map((d) => d.name)];

  function renderDeptOptions() {
    const opt = (d) => `<option value="${esc(d)}">${esc(d)}</option>`;
    const list = allDepts();
    // Main form
    const cur = deptSelect.value;
    deptSelect.innerHTML = `<option value="" disabled>Choose a department…</option>${list.map(opt).join('')}<option value="${ADD_DEPT}">＋ Add a new department…</option>`;
    if (cur && cur !== ADD_DEPT && !list.includes(cur)) deptSelect.insertAdjacentHTML('beforeend', opt(cur));
    deptSelect.value = cur && cur !== ADD_DEPT ? cur : '';
    deptSelect.classList.toggle('empty', !deptSelect.value);
    // History filter: also include departments found in old entries
    const f = $('#fDept');
    const fcur = f.value;
    const seen = new Set(list);
    const extra = [...new Set(activeEntries().map((e) => e.department))].filter((d) => d && !seen.has(d)).sort();
    f.innerHTML = `<option value="">All departments</option>${[...list, ...extra].map(opt).join('')}`;
    f.value = [...list, ...extra].includes(fcur) ? fcur : '';
    renderDeptManager();
  }

  let deptBefore = '';
  deptSelect.addEventListener('focus', () => { deptBefore = deptSelect.value === ADD_DEPT ? '' : deptSelect.value; });
  deptSelect.addEventListener('change', () => {
    if (deptSelect.value !== ADD_DEPT) { deptBefore = deptSelect.value; return; }
    deptSelect.value = deptBefore;
    deptSelect.classList.toggle('empty', !deptSelect.value);
    renderSummary(); saveDraft();
    openDeptDialog();
  });

  function openDeptDialog() {
    $('#deptName').value = '';
    $('#deptField2').classList.remove('invalid');
    renderDeptManager();
    $('#deptOverlay').hidden = false;
    setTimeout(() => $('#deptName').focus(), 50);
  }
  function closeDeptDialog() { $('#deptOverlay').hidden = true; }
  $('#deptOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'deptOverlay' || e.target.closest('[data-close]')) closeDeptDialog();
  });
  $('#openDeptManager').addEventListener('click', openDeptDialog);

  function addDepartment() {
    const name = $('#deptName').value.trim().replace(/\s+/g, ' ');
    const field = $('#deptField2');
    if (!name) { field.classList.add('invalid'); field.querySelector('.field-error').textContent = 'Please type the department name'; return; }
    const existing = allDepts().find((d) => deptKey(d) === deptKey(name));
    if (existing) {
      deptSelect.value = existing;
      deptSelect.classList.remove('empty');
      $('#deptField').classList.remove('invalid');
      closeDeptDialog();
      toast(`"${existing}" is already in the list — selected it for you`);
      renderSummary(); saveDraft();
      return;
    }
    const now = new Date().toISOString();
    const dep = { id: deptKey(name), name, createdAt: now, updatedAt: now };
    state.depts = merge(state.depts, [dep]);
    saveDepartments();
    renderDeptOptions();
    deptSelect.value = name;
    deptSelect.classList.remove('empty');
    $('#deptField').classList.remove('invalid');
    closeDeptDialog();
    renderSummary(); saveDraft();
    toast(`"${name}" added to the list`);
  }
  $('#deptAddBtn').addEventListener('click', addDepartment);
  $('#deptName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addDepartment(); } });
  $('#deptName').addEventListener('input', () => $('#deptField2').classList.remove('invalid'));

  function renderDeptManager() {
    const box = $('#customDeptList');
    if (!box) return;
    const list = customDepts();
    $('#customDeptWrap').hidden = !list.length;
    box.innerHTML = list.map((d) => {
      const [c, bg, fg] = deptColors(d.name);
      return `<li><span class="dept-pill" style="--pill-bg:${bg};--pill-fg:${fg}">${esc(d.name)}</span>
        <button class="link-del" type="button" data-remove-dept="${esc(d.id)}">Remove</button></li>`;
    }).join('');
  }
  $('#customDeptList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove-dept]');
    if (!b) return;
    const dep = state.depts.find((d) => d.id === b.dataset.removeDept);
    if (!dep) return;
    closeDeptDialog();
    confirmBox(`Remove "${dep.name}"?`, 'It will no longer be offered in the list on any device. Entries already saved under it are kept.', 'Remove', () => {
      const tomb = { ...dep, removed: true, updatedAt: new Date().toISOString() };
      state.depts = merge(state.depts, [tomb]);
      if (deptSelect.value === dep.name) deptSelect.value = '';
      saveDepartments();
      renderDeptOptions();
      toast(`"${dep.name}" removed`);
    });
  });

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
    if (d.dept && allDepts().includes(d.dept)) deptSelect.value = d.dept;
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
    keepLocally([entry]);
    showSuccess(entry);
    resetForm();
    renderHistory();
    updateNameList();
    updateStatus();
    saveAll({ ask: true });
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
  const activeEntries = () => allEntries().filter((e) => !e.deleted);
  const pendingIds = () => new Set(Object.keys(state.unsaved));

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
      const waiting = FS_OK && state.dir && !state.folderOk;
      listEl.innerHTML = `
        <div class="empty">
          <div class="empty-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v10a2 2 0 01-2 2H6a2 2 0 01-2-2V7zm0 0l2-3h12l2 3M9 11h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <h3>${all.length ? 'Nothing matches these filters' : waiting ? 'Press Allow to show your saved days' : 'No entries yet'}</h3>
          <p>${all.length ? 'Try clearing the filters to see everything.' : waiting ? 'Past days are read from your folder once the browser is allowed to open it.' : 'Saved entries will appear here.'}</p>
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
    const [av, pbg, pfg] = deptColors(e.department);
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
            <span>${isPending ? '<span class="pending-tag">● Not in folder yet</span>' : esc(timeOf(e.createdAt))}</span>
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
      const e = allEntries().find((x) => x.id === del.dataset.del);
      if (!e) return;
      confirmBox('Delete this entry?', `${money(curOf(e), e.total)} given to ${e.name} (${e.department}) will be removed from the history and from that day's files.`, 'Delete', () => {
        const tomb = { ...e, deleted: true, updatedAt: new Date().toISOString() };
        keepLocally([tomb]);
        state.openId = null;
        renderHistory();
        updateStatus();
        toast('Entry deleted');
        saveAll({ ask: true });
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
  // Excel-friendly CSV of a list of entries
  function buildCsv(list) {
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
    return '﻿' + lines.join('\r\n') + '\r\n';
  }
  function downloadFile(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $('#exportCsv').addEventListener('click', () => {
    const list = filtered();
    if (!list.length) return toast('There is nothing to download', 'warn');
    downloadFile(`Cash Book export ${isoDate()}.csv`, buildCsv(list), 'text/csv;charset=utf-8');
    toast('Downloaded — open it with Excel');
  });

  // ============================================================
  //  Tabs
  // ============================================================
  function showTab(tab) {
    $('.tabs-inner').dataset.active = tab;
    $$('.tab').forEach((t) => { const on = t.dataset.tab === tab; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
    $$('.view').forEach((v) => { const on = v.id === `view-${tab}`; v.hidden = !on; v.classList.toggle('active', on); });
    if (tab === 'history') { renderHistory(); if (state.folderOk) loadFolder(); }
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
  //  Save folder dialog
  // ============================================================
  function openSettings() {
    renderConnStatus();
    $('#settingsOverlay').hidden = false;
  }
  $('#syncPill').addEventListener('click', openSettings);
  $('#settingsOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'settingsOverlay' || e.target.closest('[data-close]')) $('#settingsOverlay').hidden = true;
  });

  function renderConnStatus() {
    const box = $('#connStatus');
    if (!box) return;
    const st = currentStatus();
    const n = unsavedCount();
    const name = state.dir ? state.dir.name : 'Cash Book';
    const t = isoDate();
    $('#pathExample').textContent = `${name}\\${dayParts(t).join('\\')}\\${csvName(t)}`;
    const msg = {
      saved: `Saving into the "${name}" folder · everything is saved`,
      unsaved: FS_OK ? `${n} entr${n === 1 ? 'y' : 'ies'} not saved to the "${name}" folder yet` : `${n} entr${n === 1 ? 'y' : 'ies'} only in this browser`,
      nofolder: 'No folder chosen yet — entries are kept in this browser until you choose one',
      reconnect: `Press "Save to folder now" and choose Allow to keep saving into "${name}"`,
      browser: 'This browser cannot save into folders. Use Chrome or Edge on the accounts computer.',
    }[st];
    box.className = `conn-status ${st === 'saved' ? 'ok' : 'no'}`;
    box.innerHTML = `<span class="dot"></span><span>${esc(msg)}</span>`;
    $('#chooseFolder').textContent = state.dir ? 'Change save folder' : 'Choose save folder';
    $('#chooseFolder').hidden = !FS_OK;
    $('#saveNow').textContent = FS_OK ? 'Save to folder now' : 'Download files';
  }

  $('#saveNow').addEventListener('click', async () => {
    if (!FS_OK) return downloadUnsaved();
    if (!state.dir) return chooseFolder();
    if (!state.folderOk) return allowFolder();
    await saveAll({ ask: true, quiet: false });
  });
  $('#chooseFolder').addEventListener('click', () => chooseFolder());

  // One-time copy of the records kept by the old online version of the app
  $('#importOld').addEventListener('click', async () => {
    const btn = $('#importOld');
    btn.disabled = true; btn.textContent = 'Importing…';
    try {
      const r = await fetch(OLD_RECORDS_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const list = (await r.json()).filter((e) => e && e.id && e.date);
      const known = new Map(allEntries().map((e) => [e.id, e.updatedAt]));
      const fresh = list.filter((e) => known.get(e.id) !== e.updatedAt);
      if (fresh.length) keepLocally(fresh);
      renderHistory();
      updateNameList();
      updateStatus();
      if (!fresh.length) toast('All old records are already here');
      else if (FS_OK && state.dir) { await saveAll({ ask: true }); toast(`Imported ${list.filter((e) => !e.deleted).length} old records into the folder`); }
      else toast(`Imported ${fresh.length} old records — now choose a save folder`);
    } catch {
      toast('The old records could not be found online (the old project may already be deleted).', 'warn');
    } finally {
      btn.disabled = false; btn.textContent = 'Import old records';
    }
  });

  // ============================================================
  //  Start up
  // ============================================================
  async function init() {
    $('#todayLabel').textContent = prettyDate(isoDate());
    renderDeptOptions();
    loadDraft();
    setCurrency(state.currency, { animate: false });
    deptSelect.classList.toggle('empty', !deptSelect.value);
    dateInput.value = isoDate();
    updateDateHint();
    renderCalc();
    renderHistory();
    updateNameList();
    if (window.matchMedia('(min-width: 900px)').matches) {
      $('#filtersMore').classList.add('open');
      $('#toggleFilters').setAttribute('aria-expanded', 'true');
    }
    if (location.hash === '#history') showTab('history');

    // Reconnect to the folder chosen on an earlier visit
    if (FS_OK) {
      state.dir = await idbGet('root');
      state.folderOk = await folderPermission(false);
    }
    updateStatus();
    if (state.folderOk) { await loadFolder(); await saveAll(); }

    // Keep trying to save anything left over (e.g. after the folder was unavailable)
    setInterval(() => { if (unsavedCount() && state.folderOk) saveAll(); }, 60000);
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden || !state.dir) return;
      state.folderOk = await folderPermission(false);
      updateStatus();
      if (state.folderOk && unsavedCount()) saveAll();
    });

    // Keep "today" fresh if the app stays open past midnight
    setInterval(() => {
      const t = isoDate();
      const prev = $('#todayLabel').dataset.day;
      if (prev !== t) {
        if (dateInput.value === prev) { dateInput.value = t; updateDateHint(); }
        $('#todayLabel').dataset.day = t;
        $('#todayLabel').textContent = prettyDate(t);
        updateStatus();
      }
    }, 60000);
    $('#todayLabel').dataset.day = isoDate();
  }

  init();
})();
