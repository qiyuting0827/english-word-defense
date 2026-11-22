'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MODULE = path.join(__dirname, 'progress-sync.js');
const PROGRESS_KEY = 'english-kids:progress:v1';
const SYNC_KEY = 'english-kids:sync:v1';
const CODE_PREFIX = 'word-defense:';

const ORIGINALS = {
  document: globalThis.document,
  localStorage: globalThis.localStorage,
  EnglishKidsGame: globalThis.EnglishKidsGame,
  fetch: globalThis.fetch
};
const NAVIGATOR_DESCRIPTOR = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

test.afterEach(() => {
  for (const [name, value] of Object.entries(ORIGINALS)) {
    if (value === undefined) delete globalThis[name];
    else globalThis[name] = value;
  }
  if (NAVIGATOR_DESCRIPTOR) Object.defineProperty(globalThis, 'navigator', NAVIGATOR_DESCRIPTOR);
  else delete globalThis.navigator;
});

function createStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    clear() { map.clear(); },
    map
  };
}

function createDocument() {
  const target = new EventTarget();
  return {
    readyState: 'complete',
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) {
      return {
        tagName: tag,
        children: [],
        appendChild(child) { this.children.push(child); }
      };
    }
  };
}

function gameState(overrides) {
  return Object.assign({
    unitId: 'u-3-1',
    gradeId: 'g3',
    bookId: 'b3a',
    score: 120,
    lives: 2,
    wave: 4,
    kills: 7,
    hintsLeft: 1,
    learned: ['book', 'book', 'apple'],
    roundWords: ['book', 'apple', 'pear', 'cat'],
    roundSize: 6,
    screen: 'result',
    enemies: [{ word: 'pear', lane: 1, pos: 2 }]
  }, overrides || {});
}

function record(overrides) {
  return Object.assign({
    id: 'remote-a',
    schemaVersion: 1,
    curriculumId: 'lujiao-wusi',
    finishedAt: '2026-01-01T00:00:00.000Z',
    createdAt: 1767225600000,
    won: true,
    unitId: 'u-remote',
    gradeId: 'g4',
    bookId: 'b4a',
    score: 40,
    lives: 1,
    wave: 3,
    kills: 5,
    hintsLeft: 0,
    learned: ['dog'],
    roundWords: ['dog', 'cat']
  }, overrides || {});
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  };
}

function loadModule(options) {
  const opts = options || {};
  const storage = opts.storage || createStorage();
  const doc = opts.document || createDocument();
  const calls = [];

  delete require.cache[require.resolve(MODULE)];
  globalThis.document = doc;
  globalThis.localStorage = storage;
  globalThis.EnglishKidsGame = opts.game === undefined
    ? { getState: () => gameState() }
    : opts.game;
  globalThis.fetch = async (url, init) => {
    calls.push({
      url,
      init,
      body: init && init.body ? JSON.parse(init.body) : null
    });
    if (!opts.fetchImpl) throw new Error('unexpected network call');
    return opts.fetchImpl(url, init);
  };

  const api = require(MODULE);
  return { api, storage, doc, calls };
}

function finish(doc, detail) {
  doc.dispatchEvent(new CustomEvent('english-kids:finish', {
    detail: detail || { won: true }
  }));
}

test('finish stores one immutable local record with no network before opt-in', () => {
  const { api, storage, doc, calls } = loadModule();
  const progressEvents = [];
  doc.addEventListener('english-kids:progress-updated', (event) => {
    progressEvents.push(event.detail);
  });

  doc.dispatchEvent(new CustomEvent('english-kids:start', { detail: { unitId: 'u-3-1' } }));
  doc.dispatchEvent(new CustomEvent('english-kids:kill', { detail: { word: 'pear' } }));
  finish(doc, { won: true, score: 120 });

  const records = api.getRecords();
  assert.equal(records.length, 1);
  const saved = records[0];
  assert.equal(saved.schemaVersion, 1);
  assert.equal(saved.curriculumId, 'lujiao-wusi');
  assert.equal(saved.won, true);
  assert.equal(saved.unitId, 'u-3-1');
  assert.equal(saved.gradeId, 'g3');
  assert.equal(saved.bookId, 'b3a');
  assert.equal(saved.score, 120);
  assert.equal(saved.lives, 2);
  assert.equal(saved.wave, 4);
  assert.equal(saved.kills, 7);
  assert.equal(saved.hintsLeft, 1);
  assert.deepEqual(saved.learned, ['book', 'apple', 'pear']);
  assert.deepEqual(saved.roundWords, ['book', 'apple', 'pear', 'cat']);
  assert.equal('roundSize' in saved, false);
  assert.equal('screen' in saved, false);
  assert.equal('enemies' in saved, false);
  assert.equal('studentName' in saved, false);
  assert.equal('deviceId' in saved, false);

  assert.equal(calls.length, 0, 'no network call without a sync code');
  assert.ok(storage.getItem(PROGRESS_KEY), 'progress saved locally');
  assert.equal(storage.getItem(SYNC_KEY), null, 'sync config is not created until opt-in');
  assert.equal(progressEvents.length, 1);
  assert.equal(progressEvents[0].total, 1);

  const frozen = api.__test.sanitizeRecord(saved);
  assert.ok(Object.isFrozen(frozen));
  assert.ok(Object.isFrozen(frozen.learned));
});

test('each finish appends a distinct record and merge de-duplicates by id', () => {
  const { api, doc } = loadModule();
  finish(doc, { won: true });
  finish(doc, { won: false });
  const records = api.getRecords();
  assert.equal(records.length, 2);
  assert.notEqual(records[0].id, records[1].id);

  const first = record({ id: 'dup', createdAt: 1000, finishedAt: '2026-01-01T00:00:01.000Z' });
  const again = record({ id: 'dup', createdAt: 1000, finishedAt: '2026-01-01T00:00:01.000Z' });
  const merged = api.__test.mergeRecords([first, again], []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'dup');
});

test('merge keeps the newest 500 records', () => {
  const { api } = loadModule();
  const list = [];
  for (let i = 0; i < 620; i += 1) {
    list.push(record({
      id: 'rec-' + i,
      createdAt: 1000 + i,
      finishedAt: new Date(1000 + i).toISOString()
    }));
  }
  const merged = api.__test.mergeRecords(list, []);
  assert.equal(merged.length, 500);
  assert.equal(merged[0].id, 'rec-619');
  assert.equal(merged[499].id, 'rec-120');
  assert.equal(merged.some((item) => item.id === 'rec-0'), false);
});

test('opt-in sync fetches, merges by id, and uploads the schema payload', async () => {
  const local = record({ id: 'local-1', score: 120, learned: ['book'] });
  const storage = createStorage({
    [PROGRESS_KEY]: JSON.stringify({ schemaVersion: 1, records: [local] })
  });
  const remoteA = record({ id: 'remote-a', learned: ['dog'] });
  const conflictingLocal = record({ id: 'local-1', score: 1, learned: ['wrong'] });
  const code = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const puts = [];

  const { api, calls } = loadModule({
    storage,
    fetchImpl: async (url) => {
      if (url.includes('pvz_sync_get')) {
        return response(200, {
          p_payload: {
            schemaVersion: 1,
            curriculumId: 'lujiao-wusi',
            records: [remoteA, conflictingLocal]
          },
          p_revision: 3
        });
      }
      puts.push(url);
      return response(200, { p_revision: 4 });
    }
  });
  const statuses = [];
  globalThis.document.addEventListener('english-kids:sync-status', (event) => {
    statuses.push(event.detail.status);
  });

  const result = await api.connect(code);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);

  const getCall = calls[0];
  assert.equal(getCall.url, 'https://lz-sync.pages.dev/?p=/rest/v1/rpc/pvz_sync_get');
  assert.equal(getCall.body.p_code, CODE_PREFIX + code);
  assert.equal(getCall.init.method, 'POST');
  assert.match(getCall.init.headers.apikey, /^sb_publishable_/);
  assert.equal(getCall.init.headers.Authorization, 'Bearer ' + getCall.init.headers.apikey);
  assert.equal(getCall.init.credentials, 'omit');

  const putCall = calls[1];
  assert.equal(putCall.url, 'https://lz-sync.pages.dev/?p=/rest/v1/rpc/pvz_sync_put');
  assert.equal(putCall.body.p_code, CODE_PREFIX + code);
  assert.equal(putCall.body.p_revision, 3);
  assert.equal(putCall.body.p_payload.schemaVersion, 1);
  assert.equal(putCall.body.p_payload.curriculumId, 'lujiao-wusi');
  assert.deepEqual(
    putCall.body.p_payload.records.map((item) => item.id).sort(),
    ['local-1', 'remote-a']
  );
  assert.equal(puts.length, 1);

  const saved = api.getRecords();
  assert.equal(saved.length, 2);
  const localRecord = saved.find((item) => item.id === 'local-1');
  assert.equal(localRecord.score, 120, 'local copy wins for a duplicate id');
  assert.deepEqual(localRecord.learned, ['book']);

  const info = api.getSyncInfo();
  assert.equal(info.enabled, true);
  assert.equal(info.revision, 4);
  assert.ok(info.lastSyncedAt);
  assert.deepEqual(statuses, ['local', 'syncing', 'synced']);
});

test('startup with an enabled code pulls remote history and uploads local-only records', async () => {
  const code = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const local = record({ id: 'local-only', learned: ['book'] });
  const remote = record({ id: 'remote-only', learned: ['dog'] });
  const storage = createStorage({
    [PROGRESS_KEY]: JSON.stringify({ schemaVersion: 1, records: [local] }),
    [SYNC_KEY]: JSON.stringify({
      code: code,
      enabled: true,
      revision: 4,
      lastSyncedAt: null
    })
  });
  let putBody = null;

  const { api, calls } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      if (url.includes('pvz_sync_get')) {
        return response(200, {
          p_payload: {
            schemaVersion: 1,
            curriculumId: 'lujiao-wusi',
            records: [remote, local]
          },
          p_revision: 4
        });
      }
      putBody = JSON.parse(init.body);
      return response(200, { p_revision: 5 });
    }
  });

  const result = await api.syncNow();
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2, 'startup sync should fetch once and upload once');
  assert.equal(calls[0].body.p_code, CODE_PREFIX + code);
  assert.equal(calls[1].body.p_revision, 4);
  assert.deepEqual(
    putBody.p_payload.records.map((item) => item.id).sort(),
    ['local-only', 'remote-only']
  );
  assert.deepEqual(
    api.getRecords().map((item) => item.id).sort(),
    ['local-only', 'remote-only']
  );
  assert.equal(api.getSyncInfo().revision, 5);
});

test('startup sync keeps local records when the browser is offline', async () => {
  const code = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const local = record({ id: 'offline-local' });
  const storage = createStorage({
    [PROGRESS_KEY]: JSON.stringify({ schemaVersion: 1, records: [local] }),
    [SYNC_KEY]: JSON.stringify({
      code: code,
      enabled: true,
      revision: 2,
      lastSyncedAt: null
    })
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: false },
    configurable: true
  });

  const { api, calls } = loadModule({ storage });
  const result = await api.syncNow();

  assert.equal(result.reason, 'offline');
  assert.equal(calls.length, 0);
  assert.equal(api.getSyncInfo().status, 'offline');
  assert.deepEqual(api.getRecords().map((item) => item.id), ['offline-local']);
});

test('sync code length limits account for the word-defense prefix', async () => {
  const doc = createDocument();
  const statusNode = { textContent: '' };
  doc.getElementById = (id) => (id === 'sync-status' ? statusNode : null);

  const { api, calls } = loadModule({
    document: doc,
    fetchImpl: async (url) => {
      if (url.includes('pvz_sync_get')) return response(200, null);
      return response(200, { p_revision: 1 });
    }
  });

  assert.equal(api.__test.pcodeMaxLength, 128);
  assert.equal(api.__test.codePrefix, CODE_PREFIX);
  assert.equal(api.__test.maxCodeLength, 128 - CODE_PREFIX.length);
  assert.equal(api.__test.minCodeLength, 25);

  const max = 'A'.repeat(api.__test.maxCodeLength);
  assert.equal(api.normalizeCode(max), max);
  assert.equal(api.normalizeCode(max + 'A'), null);
  assert.equal(api.normalizeCode('A'.repeat(24)), null);
  assert.equal(api.normalizeCode('A'.repeat(25)), 'A'.repeat(25));

  const tooLong = await api.connect(max + 'A');
  assert.equal(tooLong.reason, 'invalid-code');
  assert.equal(calls.length, 0);
  assert.match(statusNode.textContent, /25/);
  assert.match(statusNode.textContent, new RegExp(String(api.__test.maxCodeLength)));
  assert.match(statusNode.textContent, /128/);

  const accepted = await api.connect(max);
  assert.equal(accepted.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.p_code, CODE_PREFIX + max);
  assert.equal(calls[0].body.p_code.length, 128);
});

test('one conflict retry re-reads, merges, and uploads again', async () => {
  const local = record({ id: 'local-1' });
  const storage = createStorage({
    [PROGRESS_KEY]: JSON.stringify({ schemaVersion: 1, records: [local] })
  });
  const code = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let getCount = 0;
  let putCount = 0;

  const { api, calls } = loadModule({
    storage,
    fetchImpl: async (url) => {
      if (url.includes('pvz_sync_get')) {
        getCount += 1;
        if (getCount === 1) {
          return response(200, {
            p_payload: { schemaVersion: 1, curriculumId: 'lujiao-wusi', records: [record({ id: 'remote-a' })] },
            p_revision: 1
          });
        }
        return response(200, {
          p_payload: { schemaVersion: 1, curriculumId: 'lujiao-wusi', records: [record({ id: 'remote-b' })] },
          p_revision: 2
        });
      }
      putCount += 1;
      if (putCount === 1) return response(409, { message: 'revision conflict' });
      return response(200, { p_revision: 3 });
    }
  });

  const result = await api.connect(code);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 4);
  assert.equal(getCount, 2);
  assert.equal(putCount, 2);
  assert.equal(calls[1].body.p_revision, 1);
  assert.equal(calls[3].body.p_revision, 2);
  assert.deepEqual(
    calls[3].body.p_payload.records.map((item) => item.id).sort(),
    ['local-1', 'remote-a', 'remote-b']
  );
  assert.equal(api.getSyncInfo().revision, 3);
});

test('a failed upload keeps local records and reports an error', async () => {
  const local = record({ id: 'local-keep' });
  const storage = createStorage({
    [PROGRESS_KEY]: JSON.stringify({ schemaVersion: 1, records: [local] })
  });
  const code = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const { api, calls } = loadModule({
    storage,
    fetchImpl: async (url) => {
      if (url.includes('pvz_sync_get')) {
        return response(200, { p_payload: { schemaVersion: 1, curriculumId: 'lujiao-wusi', records: [] }, p_revision: 1 });
      }
      return response(500, { message: 'boom' });
    }
  });

  const result = await api.connect(code);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'error');
  assert.equal(calls.length, 2);
  assert.deepEqual(api.getRecords().map((item) => item.id), ['local-keep']);
  assert.equal(api.getSyncInfo().status, 'error');
  assert.equal(api.getSyncInfo().enabled, true);
  const stored = JSON.parse(storage.getItem(PROGRESS_KEY));
  assert.deepEqual(stored.records.map((item) => item.id), ['local-keep']);
});

test('nothing is uploaded or fetched before a code is created or entered', async () => {
  const { api, storage, calls, doc } = loadModule();

  const result = await api.syncNow();
  assert.equal(result.reason, 'opt-in-required');
  assert.equal(api.disconnect(), true);
  const invalid = await api.connect('too-short');
  assert.equal(invalid.reason, 'invalid-code');
  finish(doc, { won: true });

  assert.equal(calls.length, 0);
  assert.equal(storage.getItem(SYNC_KEY), null);
  assert.equal(api.getRecords().length, 1);
});

test('createSyncCode generates a 32-character safe code and enables opt-in', () => {
  const { api, storage, calls } = loadModule();
  const code = api.createSyncCode();

  assert.match(code, /^[A-HJ-NP-Z2-9]{32}$/);
  assert.ok(code.length >= 25);
  assert.equal(api.normalizeCode(code), code);
  assert.equal(api.getSyncInfo().enabled, true);
  assert.equal(api.getSyncInfo().code, code);
  assert.notEqual(code, api.createSyncCode());
  assert.ok(storage.getItem(SYNC_KEY));
  assert.equal(calls.length, 0);
});

test('records are sanitized to the allow-list and remote extras are dropped', async () => {
  const tainted = {
    id: 'tainted-1',
    schemaVersion: 1,
    curriculumId: 'lujiao-wusi',
    finishedAt: '2026-01-01T00:00:00.000Z',
    createdAt: 1767225600000,
    won: true,
    unitId: 'u-1',
    gradeId: 'g3',
    bookId: 'b3a',
    score: 10,
    lives: 1,
    wave: 2,
    kills: 3,
    hintsLeft: 1,
    learned: ['apple'],
    roundWords: ['apple'],
    roundSize: 10,
    studentName: 'Secret',
    deviceId: 'device-123',
    name: 'Secret',
    notes: 'mid-round'
  };
  const storage = createStorage({
    [PROGRESS_KEY]: JSON.stringify({ schemaVersion: 1, records: [tainted] })
  });
  const code = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const remoteWithExtras = Object.assign({}, tainted, { id: 'remote-tainted' });

  const { api } = loadModule({
    storage,
    fetchImpl: async (url) => {
      if (url.includes('pvz_sync_get')) {
        return response(200, {
          p_payload: {
            schemaVersion: 1,
            curriculumId: 'lujiao-wusi',
            records: [remoteWithExtras]
          },
          p_revision: 0
        });
      }
      return response(200, { p_revision: 1 });
    }
  });

  const local = api.getRecords()[0];
  for (const key of ['roundSize', 'studentName', 'deviceId', 'name', 'notes']) {
    assert.equal(key in local, false, 'local record drops ' + key);
  }

  await api.connect(code);
  const raw = storage.getItem(PROGRESS_KEY);
  for (const key of ['roundSize', 'studentName', 'deviceId', 'notes']) {
    assert.equal(raw.includes('"' + key + '"'), false, 'stored JSON drops ' + key);
  }
  assert.equal(api.getRecords().length, 2);
});

test('matchMode is included only when the game exposes it', () => {
  const without = loadModule();
  finish(without.doc, { won: true });
  assert.equal('matchMode' in without.api.getRecords()[0], false);

  const withMode = loadModule({ game: { getState: () => gameState({ matchMode: 'picture' }) } });
  finish(withMode.doc, { won: true });
  assert.equal(withMode.api.getRecords()[0].matchMode, 'picture');
});
