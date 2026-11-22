/* English Kids — local learning-record log + opt-in cloud sync.
   Contract:
   - Listens for english-kids:start / kill / finish on document.
   - On finish, snapshots window.EnglishKidsGame.getState() and appends one
     immutable completed-round record to localStorage.
   - Stores only learning/game aggregates; no names, student identity,
     device ids, UI preferences or mid-round state.
   - Cloud sync stays off until a sync code is created or entered.
   - The sync code is the data key; anyone with it can read/write the data.
   No external code or assets. */
(function (root) {
  'use strict';

  var PROGRESS_KEY = 'english-kids:progress:v1';
  var SYNC_KEY = 'english-kids:sync:v1';
  var SCHEMA_VERSION = 1;
  var CURRICULUM_ID = 'lujiao-wusi';
  var MAX_RECORDS = 500;
  var CODE_PREFIX = 'word-defense:';
  var PCODE_MAX_LENGTH = 128;
  var MAX_CODE_LENGTH = PCODE_MAX_LENGTH - CODE_PREFIX.length;
  var RELAY_BASE = 'https://lz-sync.pages.dev/';
  var RPC_GET = 'pvz_sync_get';
  var RPC_PUT = 'pvz_sync_put';
  var PUBLISHABLE_KEY = 'sb_publishable_XSUF6UfFcymamNqBdJwWkQ_YPieFolG';
  var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var CODE_LENGTH = 32;
  var MIN_CODE_LENGTH = 25;
  var SYNC_STATUSES = {
    local: '仅保存在本机',
    syncing: '正在同步',
    synced: '已同步',
    offline: '离线',
    error: '同步失败'
  };

  var memory = Object.create(null);
  var syncInfo = null;
  var uiStatus = 'local';
  var statusNote = null;
  var lastError = null;
  var initialized = false;
  var bound = false;
  var syncing = false;
  var syncPromise = null;
  var statusAt = null;
  var currentRun = null;
  var autoSyncTimer = null;

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function storage() {
    try { return root.localStorage || null; } catch (err) { return null; }
  }

  function readJson(key) {
    var store = storage();
    if (store) {
      try {
        var raw = store.getItem(key);
        if (raw == null) return null;
        return JSON.parse(raw);
      } catch (err) {
        /* fall through to the in-memory copy */
      }
    }
    return memory[key] === undefined ? null : memory[key];
  }

  function writeJson(key, value) {
    memory[key] = value;
    var store = storage();
    if (!store) return;
    try { store.setItem(key, JSON.stringify(value)); } catch (err) { /* private mode */ }
  }

  function byId(id) {
    var doc = root.document;
    if (!doc) return null;
    if (typeof doc.getElementById === 'function') return doc.getElementById(id);
    return null;
  }

  function setText(id, text) {
    var node = byId(id);
    if (node && node.textContent !== String(text)) node.textContent = String(text);
  }

  function emit(name, detail) {
    var doc = root.document;
    if (!doc || typeof doc.dispatchEvent !== 'function' || typeof root.CustomEvent !== 'function') return;
    try { doc.dispatchEvent(new root.CustomEvent(name, { detail: detail || {} })); } catch (err) { /* noop */ }
  }

  function parseJson(text) {
    if (text == null || text === '') return null;
    if (typeof text === 'object') return text;
    try { return JSON.parse(text); } catch (err) { return null; }
  }

  function toTimestamp(value) {
    if (typeof value === 'number') return isFinite(value) && value > 0 ? Math.floor(value) : null;
    if (typeof value !== 'string' || !value) return null;
    var parsed = Date.parse(value);
    return isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function toInt(value, fallback) {
    var num = typeof value === 'number' ? value : parseInt(value, 10);
    return isFinite(num) ? Math.floor(num) : fallback;
  }

  function clampInt(value, min, max) {
    var num = toInt(value, min);
    return Math.max(min, Math.min(max, num));
  }

  function textOrNull(value, max) {
    if (typeof value !== 'string') return null;
    var text = value.trim();
    if (!text) return null;
    return text.slice(0, max || 80);
  }

  function isoOrNull(value) {
    var ts = toTimestamp(value);
    return ts == null ? null : new Date(ts).toISOString();
  }

  function formatDate(value) {
    var ts = toTimestamp(value);
    if (ts == null) return '—';
    try {
      return new Date(ts).toLocaleString('zh-CN', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch (err) {
      return new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
    }
  }

  function randomString(length) {
    var out = '';
    var cryptoObj = root.crypto;
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      var bytes = new Uint8Array(length);
      cryptoObj.getRandomValues(bytes);
      for (var i = 0; i < length; i += 1) {
        out += CODE_ALPHABET.charAt(bytes[i] % CODE_ALPHABET.length);
      }
      return out;
    }
    for (var j = 0; j < length; j += 1) {
      out += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
    }
    return out;
  }

  function newRunId() {
    return 'r-' + Date.now().toString(36) + '-' + randomString(10);
  }

  function normalizeCode(value) {
    if (typeof value !== 'string') return null;
    var code = value.replace(/[\s-]+/g, '').toUpperCase();
    if (code.length < MIN_CODE_LENGTH || code.length > MAX_CODE_LENGTH) return null;
    if (!/^[A-Z0-9_]+$/.test(code)) return null;
    return code;
  }

  function pcodeFor(code) {
    return CODE_PREFIX + code;
  }

  function uniqueWords(value, limit) {
    var list = [];
    if (Array.isArray(value)) {
      list = value;
    } else if (value && typeof value.forEach === 'function' && typeof value !== 'string') {
      value.forEach(function (item) { list.push(item); });
    } else if (typeof value === 'string') {
      list = [value];
    }
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < list.length && out.length < (limit || 200); i += 1) {
      if (typeof list[i] !== 'string') continue;
      var word = list[i].trim().slice(0, 64);
      if (!word) continue;
      var key = word.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      out.push(word);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Record schema (strict allow-list, no identity / mid-round data)     */
  /* ------------------------------------------------------------------ */

  function sanitizeRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = textOrNull(raw.id, 80);
    if (!id) return null;

    var createdAt = toTimestamp(raw.createdAt);
    var finishedAt = isoOrNull(raw.finishedAt);
    if (createdAt == null && finishedAt) createdAt = toTimestamp(finishedAt);
    if (createdAt == null) return null;
    if (!finishedAt) finishedAt = new Date(createdAt).toISOString();

    var record = {
      id: id,
      schemaVersion: SCHEMA_VERSION,
      curriculumId: CURRICULUM_ID,
      finishedAt: finishedAt,
      createdAt: createdAt,
      won: raw.won === true,
      unitId: textOrNull(raw.unitId, 64),
      gradeId: textOrNull(raw.gradeId, 32),
      bookId: textOrNull(raw.bookId, 32),
      score: clampInt(raw.score, 0, 100000000),
      lives: clampInt(raw.lives, 0, 99),
      wave: clampInt(raw.wave, 0, 999),
      kills: clampInt(raw.kills, 0, 100000),
      hintsLeft: clampInt(raw.hintsLeft, 0, 99),
      learned: uniqueWords(raw.learned, 200),
      roundWords: uniqueWords(raw.roundWords, 200)
    };
    var matchMode = textOrNull(raw.matchMode, 32);
    if (matchMode) record.matchMode = matchMode;

    if (Object.freeze) {
      Object.freeze(record.learned);
      Object.freeze(record.roundWords);
      Object.freeze(record);
    }
    return record;
  }

  function cloneRecord(record) {
    var copy = {
      id: record.id,
      schemaVersion: record.schemaVersion,
      curriculumId: record.curriculumId,
      finishedAt: record.finishedAt,
      createdAt: record.createdAt,
      won: record.won,
      unitId: record.unitId,
      gradeId: record.gradeId,
      bookId: record.bookId,
      score: record.score,
      lives: record.lives,
      wave: record.wave,
      kills: record.kills,
      hintsLeft: record.hintsLeft,
      learned: record.learned.slice(),
      roundWords: record.roundWords.slice()
    };
    if (record.matchMode) copy.matchMode = record.matchMode;
    return copy;
  }

  function compareRecords(a, b) {
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
    if (a.id === b.id) return 0;
    return a.id < b.id ? 1 : -1;
  }

  function mergeRecords(first, second) {
    var seen = Object.create(null);
    var out = [];
    [first, second].forEach(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (item) {
        var record = sanitizeRecord(item);
        if (!record || seen[record.id]) return;
        seen[record.id] = true;
        out.push(record);
      });
    });
    out.sort(compareRecords);
    return out.slice(0, MAX_RECORDS);
  }

  function readRecords() {
    var raw = readJson(PROGRESS_KEY);
    var list = [];
    if (Array.isArray(raw)) list = raw;
    else if (raw && Array.isArray(raw.records)) list = raw.records;
    return mergeRecords(list, []);
  }

  function saveRecords(list) {
    var cleaned = mergeRecords(list, []);
    writeJson(PROGRESS_KEY, { schemaVersion: SCHEMA_VERSION, records: cleaned });
    emitProgress();
    render();
    return cleaned;
  }

  function getRecords() {
    return readRecords().map(cloneRecord);
  }

  function getSummary() {
    var list = readRecords();
    var words = Object.create(null);
    var matched = 0;
    list.forEach(function (record) {
      record.learned.forEach(function (word) {
        var key = word.toLowerCase();
        if (!words[key]) { words[key] = true; matched += 1; }
      });
    });
    var latest = list.length ? list[0] : null;
    return {
      total: list.length,
      matchedWords: matched,
      latest: latest ? cloneRecord(latest) : null
    };
  }

  function summaryText(list) {
    var words = Object.create(null);
    list.forEach(function (record) {
      record.learned.forEach(function (word) { words[word.toLowerCase()] = true; });
    });
    var count = Object.keys(words).length;
    var text = '本机记录 ' + list.length + ' 局 · 匹配 ' + count + ' 个词';
    if (list.length) text += ' · 最近 ' + formatDate(list[0].finishedAt);
    return text;
  }

  /* ------------------------------------------------------------------ */
  /* Sync settings                                                       */
  /* ------------------------------------------------------------------ */

  function readSyncInfo() {
    var raw = readJson(SYNC_KEY);
    if (!raw || typeof raw !== 'object') raw = {};
    var code = normalizeCode(raw.code);
    return {
      code: code,
      enabled: !!(code && raw.enabled),
      revision: clampInt(raw.revision, 0, 1000000000),
      lastSyncedAt: isoOrNull(raw.lastSyncedAt)
    };
  }

  function saveSyncInfo() {
    writeJson(SYNC_KEY, {
      code: syncInfo.code || null,
      enabled: !!syncInfo.enabled,
      revision: clampInt(syncInfo.revision, 0, 1000000000),
      lastSyncedAt: syncInfo.lastSyncedAt || null
    });
  }

  function statusText() {
    if (statusNote) return statusNote;
    if (uiStatus === 'syncing') return '正在同步学习记录…';
    if (uiStatus === 'synced') {
      return '已同步。同步码就是这份学习记录的数据钥匙，请妥善保管。';
    }
    if (uiStatus === 'offline') {
      return '当前离线，记录已保存在本机；联网后可再次同步。同步码就是数据钥匙。';
    }
    if (uiStatus === 'error') {
      return '同步失败，学习记录仍保存在本机。' +
        (lastError ? '（' + lastError + '）' : '') + ' 同步码就是数据钥匙。';
    }
    if (!syncInfo.code) {
      return '仅保存在本机。生成或输入同步码后才会云端同步；同步码就是数据钥匙，请妥善保管。';
    }
    if (!syncInfo.enabled) {
      return '云端同步已关闭，学习记录仍保存在本机。同步码就是数据钥匙。';
    }
    return '已开启云端同步。同步码就是数据钥匙，请妥善保管。';
  }

  function setStatus(status, message, error) {
    uiStatus = status;
    statusNote = message || null;
    lastError = error ? String(error).slice(0, 200) : null;
    statusAt = new Date().toISOString();
    render();
    emitStatus(message);
  }

  function emitStatus(message) {
    emit('english-kids:sync-status', {
      status: uiStatus,
      label: SYNC_STATUSES[uiStatus] || uiStatus,
      message: message || statusText(),
      code: syncInfo && syncInfo.code ? syncInfo.code : null,
      enabled: !!(syncInfo && syncInfo.enabled),
      revision: syncInfo ? syncInfo.revision : 0,
      lastSyncedAt: syncInfo ? syncInfo.lastSyncedAt : null,
      error: lastError,
      at: statusAt
    });
  }

  function emitProgress() {
    var list = readRecords();
    emit('english-kids:progress-updated', {
      total: list.length,
      summary: summaryText(list),
      latest: list.length ? cloneRecord(list[0]) : null
    });
  }

  /* ------------------------------------------------------------------ */
  /* Rendering (all nodes optional)                                      */
  /* ------------------------------------------------------------------ */

  function renderRecordList(list) {
    var doc = root.document;
    var container = byId('record-list');
    if (!doc || !container || typeof doc.createElement !== 'function') return;

    while (container.firstChild) container.removeChild(container.firstChild);
    if (!list.length) {
      var empty = doc.createElement('li');
      empty.textContent = '还没有记录，完成一局后会自动保存。';
      container.appendChild(empty);
      return;
    }
    list.slice(0, 20).forEach(function (record) {
      var item = doc.createElement('li');
      var words = record.learned.length
        ? '匹配：' + record.learned.slice(0, 5).join('、') +
          (record.learned.length > 5 ? '…' : '')
        : '未匹配到单词';
      item.textContent = formatDate(record.finishedAt) + ' · ' +
        (record.unitId || '未知单元') + ' · ' + record.score + ' 分 · ' + words;
      container.appendChild(item);
    });
  }

  function render() {
    if (!syncInfo) syncInfo = readSyncInfo();
    var list = readRecords();

    setText('sync-code-display', syncInfo.code || '未创建');
    setText('progress-summary', summaryText(list));
    setText('sync-last-at', syncInfo.lastSyncedAt
      ? '上次同步：' + formatDate(syncInfo.lastSyncedAt)
      : '上次同步：尚未同步');
    setText('sync-status', statusText());
    renderRecordList(list);

    var display = byId('sync-code-display');
    if (display && syncInfo.code && display.title !== '同步码就是数据钥匙') {
      display.title = '同步码就是数据钥匙';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Cloud transport (relay only; publishable key only)                  */
  /* ------------------------------------------------------------------ */

  function relayUrl(rpc) {
    return RELAY_BASE + '?p=/rest/v1/rpc/' + rpc;
  }

  function requestHeaders() {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      apikey: PUBLISHABLE_KEY,
      Authorization: 'Bearer ' + PUBLISHABLE_KEY
    };
  }

  function networkError(err) {
    if (!err) return true;
    if (err.code === 'offline' || err.name === 'TypeError') return true;
    return !(err.status > 0);
  }

  function isConflict(err) {
    if (!err || !err.status) return false;
    if (err.conflict) return true;
    return err.status === 400 || err.status === 409 || err.status === 412;
  }

  function readRevision(raw, fallback) {
    if (Array.isArray(raw)) raw = raw.length ? raw[0] : null;
    if (typeof raw === 'number') return toInt(raw, fallback);
    if (typeof raw === 'string') return toInt(raw, fallback);
    if (!raw || typeof raw !== 'object') return fallback;
    var candidates = [raw.p_revision, raw.revision, raw.rev, raw.version];
    for (var i = 0; i < candidates.length; i += 1) {
      var value = toInt(candidates[i], null);
      if (value != null) return value;
    }
    return fallback;
  }

  async function performRpc(rpc, body) {
    var fetchFn = root.fetch;
    if (typeof fetchFn !== 'function') {
      var unavailable = new Error('fetch unavailable');
      unavailable.code = 'offline';
      throw unavailable;
    }
    var response = await fetchFn(relayUrl(rpc), {
      method: 'POST',
      headers: requestHeaders(),
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit'
    });
    var text = typeof response.text === 'function' ? await response.text() : '';
    var data = parseJson(text);
    if (!response.ok) {
      var err = new Error('HTTP ' + response.status);
      err.status = response.status;
      err.conflict = isConflict(err);
      var detail = data && (data.message || data.error || data.code);
      if (typeof detail === 'string' && /conflict|revision/i.test(detail)) err.conflict = true;
      err.detail = data;
      throw err;
    }
    return data;
  }

  function normalizePayload(value) {
    var payload = parseJson(value);
    if (!payload || typeof payload !== 'object') payload = {};
    var list = Array.isArray(payload.records) ? payload.records : [];
    var filtered = list.filter(function (item) {
      return !!item && typeof item === 'object' &&
        (!item.curriculumId || item.curriculumId === CURRICULUM_ID);
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      curriculumId: CURRICULUM_ID,
      records: mergeRecords(filtered, [])
    };
  }

  function normalizeRemote(raw) {
    if (Array.isArray(raw)) raw = raw.length ? raw[0] : null;
    raw = parseJson(raw);
    if (!raw || typeof raw !== 'object') {
      return { records: [], revision: 0, exists: false };
    }

    /* Some relays return the stored payload itself. */
    if (Array.isArray(raw.records) || raw.schemaVersion) {
      return {
        records: normalizePayload(raw).records,
        revision: readRevision(raw, 0),
        exists: true
      };
    }

    var body = raw.p_payload;
    if (body === undefined) body = raw.payload;
    if (body === undefined) body = raw.data;
    if (body === undefined) body = raw.doc;
    if (body === undefined) body = raw.value;
    return {
      records: normalizePayload(body).records,
      revision: readRevision(raw, 0),
      exists: body != null
    };
  }

  function buildPayload(list) {
    return {
      schemaVersion: SCHEMA_VERSION,
      curriculumId: CURRICULUM_ID,
      records: list.map(cloneRecord)
    };
  }

  async function getRemote(code) {
    var raw = await performRpc(RPC_GET, { p_code: pcodeFor(code) });
    return normalizeRemote(raw);
  }

  async function putRemote(code, payload, revision) {
    var raw = await performRpc(RPC_PUT, {
      p_code: pcodeFor(code),
      p_payload: payload,
      p_revision: revision
    });
    return { revision: readRevision(raw, revision + 1), raw: raw };
  }

  function isOffline() {
    return !!(root.navigator && root.navigator.onLine === false);
  }

  function isOptedIn() {
    return !!(syncInfo && syncInfo.enabled && syncInfo.code);
  }

  function abortIfChanged(code) {
    if (!syncInfo || !syncInfo.enabled || syncInfo.code !== code) {
      var err = new Error('sync settings changed');
      err.code = 'aborted';
      throw err;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Sync orchestration                                                  */
  /* ------------------------------------------------------------------ */

  function syncNow() {
    ensureInit();
    if (!isOptedIn()) {
      setStatus('local', '尚未开启云端同步：先生成或输入同步码；本机记录已保存。');
      return Promise.resolve({ ok: false, reason: 'opt-in-required' });
    }
    if (syncPromise) return syncPromise;
    if (isOffline()) {
      setStatus('offline');
      return Promise.resolve({ ok: false, reason: 'offline' });
    }

    syncPromise = (async function () {
      var code = syncInfo.code;
      syncing = true;
      setStatus('syncing');
      try {
        var remote = await getRemote(code);
        abortIfChanged(code);

        var merged = mergeRecords(readRecords(), remote.records);
        saveRecords(merged);
        var result;

        try {
          result = await putRemote(code, buildPayload(merged), remote.revision);
        } catch (putError) {
          if (!isConflict(putError)) throw putError;

          /* One conflict retry: re-read, merge, upload again. */
          remote = await getRemote(code);
          abortIfChanged(code);
          merged = mergeRecords(merged, remote.records);
          saveRecords(merged);
          result = await putRemote(code, buildPayload(merged), remote.revision);
        }

        abortIfChanged(code);
        syncInfo.revision = result.revision;
        syncInfo.lastSyncedAt = new Date().toISOString();
        saveSyncInfo();
        setStatus('synced');
        return {
          ok: true,
          total: merged.length,
          revision: result.revision,
          lastSyncedAt: syncInfo.lastSyncedAt
        };
      } catch (err) {
        if (err && err.code === 'aborted') {
          setStatus('local', '同步设置已更改，本次同步已停止；本机记录已保存。');
          return { ok: false, reason: 'aborted' };
        }
        var offline = networkError(err);
        setStatus(offline ? 'offline' : 'error', null, err && err.message);
        return {
          ok: false,
          reason: offline ? 'offline' : 'error',
          error: err && err.message ? err.message : 'network'
        };
      } finally {
        syncing = false;
        syncPromise = null;
      }
    })();

    return syncPromise;
  }

  function scheduleAutoSync() {
    if (!isOptedIn() || autoSyncTimer) return;
    var setter = root.setTimeout;
    if (typeof setter !== 'function') return;
    autoSyncTimer = setter(function () {
      autoSyncTimer = null;
      void syncNow();
    }, 1200);
    if (autoSyncTimer && typeof autoSyncTimer.unref === 'function') autoSyncTimer.unref();
  }

  /* ------------------------------------------------------------------ */
  /* Game event capture                                                  */
  /* ------------------------------------------------------------------ */

  function stateSnapshot() {
    var game = root.EnglishKidsGame;
    if (!game || typeof game.getState !== 'function') return {};
    try { return game.getState() || {}; } catch (err) { return {}; }
  }

  function onStart(event) {
    var detail = event && event.detail ? event.detail : {};
    currentRun = {
      id: newRunId(),
      words: [],
      matchMode: textOrNull(detail.matchMode, 32)
    };
  }

  function onKill(event) {
    if (!currentRun) return;
    var detail = event && event.detail ? event.detail : {};
    if (typeof detail.word === 'string' && detail.word.trim()) {
      currentRun.words.push(detail.word.trim());
    }
  }

  function onFinish(event) {
    var detail = event && event.detail ? event.detail : {};
    var state = stateSnapshot();
    var run = currentRun || { id: newRunId(), words: [], matchMode: null };

    var learned = uniqueWords([].concat(
      uniqueWords(state.learned, 200),
      uniqueWords(run.words, 200)
    ), 200);
    var roundWords = uniqueWords(state.roundWords, 200);

    var record = sanitizeRecord({
      id: run.id,
      schemaVersion: SCHEMA_VERSION,
      curriculumId: CURRICULUM_ID,
      finishedAt: new Date().toISOString(),
      createdAt: Date.now(),
      won: detail.won === true,
      unitId: state.unitId,
      gradeId: state.gradeId,
      bookId: state.bookId,
      score: state.score != null ? state.score : detail.score,
      lives: state.lives,
      wave: state.wave,
      kills: state.kills,
      hintsLeft: state.hintsLeft,
      learned: learned,
      roundWords: roundWords,
      matchMode: textOrNull(state.matchMode, 32) ||
        textOrNull(detail.matchMode, 32) ||
        textOrNull(run.matchMode, 32)
    });

    currentRun = null;
    if (!record) return;

    var existing = readRecords();
    if (!existing.some(function (item) { return item.id === record.id; })) {
      saveRecords(existing.concat([record]));
    }
    scheduleAutoSync();
  }

  function onHome() {
    currentRun = null;
  }

  /* ------------------------------------------------------------------ */
  /* UI actions                                                          */
  /* ------------------------------------------------------------------ */

  function findActionNode(node) {
    var doc = root.document;
    while (node && node !== doc) {
      if (node.getAttribute) {
        var action = node.getAttribute('data-action');
        if (action) return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  function onClick(event) {
    var node = findActionNode(event && event.target);
    if (!node) return;
    var action = node.getAttribute('data-action');

    if (action === 'create-sync-code') {
      var code = createSyncCode();
      var input = byId('sync-code-input');
      if (input && typeof input.value === 'string') input.value = code;
      void syncNow();
      return;
    }
    if (action === 'connect-sync-code') {
      var field = byId('sync-code-input');
      void connect(field && typeof field.value === 'string' ? field.value : '');
      return;
    }
    if (action === 'copy-sync-code') {
      void copySyncCode();
      return;
    }
    if (action === 'sync-now') {
      void syncNow();
      return;
    }
    if (action === 'disconnect-sync') {
      disconnect();
    }
  }

  function onStorage(event) {
    if (event && event.key && event.key !== PROGRESS_KEY && event.key !== SYNC_KEY) return;
    syncInfo = readSyncInfo();
    render();
    emitProgress();
  }

  function onOnline() {
    if (isOptedIn()) void syncNow();
  }

  function bind() {
    if (bound) return;
    var doc = root.document;
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('click', onClick, false);
      doc.addEventListener('english-kids:start', onStart, false);
      doc.addEventListener('english-kids:kill', onKill, false);
      doc.addEventListener('english-kids:finish', onFinish, false);
      doc.addEventListener('english-kids:home', onHome, false);
    }
    if (typeof root.addEventListener === 'function') {
      root.addEventListener('storage', onStorage, false);
      root.addEventListener('online', onOnline, false);
    }
    bound = true;
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  function ensureInit() {
    if (!initialized) init();
  }

  function init() {
    if (initialized) return api;
    initialized = true;
    syncInfo = readSyncInfo();
    uiStatus = syncInfo.enabled && syncInfo.lastSyncedAt ? 'synced' : 'local';
    bind();
    render();
    /* Existing opt-in continues across reloads: pull/merge remote history
       and upload any local-only records. No code means no network. */
    if (isOptedIn()) void syncNow();
    return api;
  }

  function createSyncCode() {
    ensureInit();
    var code = randomString(CODE_LENGTH);
    syncInfo = {
      code: code,
      enabled: true,
      revision: 0,
      lastSyncedAt: null
    };
    saveSyncInfo();
    setStatus('local');
    return code;
  }

  function connect(code) {
    ensureInit();
    var normalized = normalizeCode(code);
    if (!normalized) {
      setStatus('error', '同步码无效：用户同步码长度需为 ' + MIN_CODE_LENGTH + '–' + MAX_CODE_LENGTH +
        ' 位；加上 ' + CODE_PREFIX + ' 前缀后总长度不能超过 ' + PCODE_MAX_LENGTH + ' 位。');
      return Promise.resolve({ ok: false, reason: 'invalid-code' });
    }
    var previous = syncInfo || readSyncInfo();
    var changed = previous.code !== normalized;
    syncInfo = {
      code: normalized,
      enabled: true,
      revision: changed ? 0 : previous.revision,
      lastSyncedAt: changed ? null : previous.lastSyncedAt
    };
    saveSyncInfo();
    render();
    emitStatus('同步码已保存。同步码就是数据钥匙，请妥善保管。');
    return syncNow();
  }

  function disconnect() {
    ensureInit();
    if (!syncInfo) syncInfo = readSyncInfo();
    var hadConfig = !!(syncInfo.code || syncInfo.enabled || syncInfo.lastSyncedAt);
    syncInfo.enabled = false;
    if (hadConfig) saveSyncInfo();
    if (autoSyncTimer) {
      var cancel = root.clearTimeout;
      if (typeof cancel === 'function') cancel(autoSyncTimer);
      autoSyncTimer = null;
    }
    setStatus('local', '已关闭云端同步；本机学习记录保留。同步码就是数据钥匙。');
    return true;
  }

  async function copySyncCode() {
    ensureInit();
    if (!syncInfo || !syncInfo.code) {
      setStatus('local', '还没有同步码，请先生成同步码。');
      return false;
    }
    var code = syncInfo.code;
    try {
      var nav = root.navigator;
      if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        await nav.clipboard.writeText(code);
        setStatus(uiStatus === 'syncing' ? 'syncing' : uiStatus, '同步码已复制。请妥善保管。');
        return true;
      }
    } catch (err) { /* fall back below */ }

    try {
      var input = byId('sync-code-input');
      var doc = root.document;
      if (input && typeof input.select === 'function') {
        input.value = code;
        input.select();
        if (doc && typeof doc.execCommand === 'function' && doc.execCommand('copy')) {
          setStatus(uiStatus === 'syncing' ? 'syncing' : uiStatus, '同步码已复制。请妥善保管。');
          return true;
        }
      }
    } catch (err) { /* fall back below */ }

    setStatus('error', '复制失败，请手动选择同步码。');
    return false;
  }

  function getSyncInfo() {
    ensureInit();
    return {
      code: syncInfo.code,
      enabled: !!syncInfo.enabled,
      revision: syncInfo.revision,
      lastSyncedAt: syncInfo.lastSyncedAt,
      status: uiStatus,
      syncing: syncing,
      error: lastError
    };
  }

  var api = {
    init: init,
    getRecords: getRecords,
    getSummary: getSummary,
    getSyncInfo: getSyncInfo,
    createSyncCode: createSyncCode,
    connect: connect,
    syncNow: syncNow,
    disconnect: disconnect,
    copySyncCode: copySyncCode,
    render: render,
    normalizeCode: normalizeCode,
    __test: {
      storageKeys: { progress: PROGRESS_KEY, sync: SYNC_KEY },
      maxRecords: MAX_RECORDS,
      minCodeLength: MIN_CODE_LENGTH,
      maxCodeLength: MAX_CODE_LENGTH,
      pcodeMaxLength: PCODE_MAX_LENGTH,
      codePrefix: CODE_PREFIX,
      mergeRecords: mergeRecords,
      sanitizeRecord: sanitizeRecord,
      buildPayload: buildPayload,
      normalizeRemote: normalizeRemote,
      normalizeCode: normalizeCode,
      randomString: randomString,
      cancelAutoSync: function () {
        if (autoSyncTimer) {
          var cancel = root.clearTimeout;
          if (typeof cancel === 'function') cancel(autoSyncTimer);
          autoSyncTimer = null;
        }
      }
    }
  };

  root.EnglishKidsProgress = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (root.document) {
    if (root.document.readyState === 'loading' &&
        typeof root.document.addEventListener === 'function') {
      root.document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
