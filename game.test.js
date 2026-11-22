'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MODULE = path.join(__dirname, 'game.js');
const PACE_KEY = 'english-kids:game-pace';

const ORIGINALS = {
  document: globalThis.document,
  localStorage: globalThis.localStorage
};

test.afterEach(() => {
  for (const [name, value] of Object.entries(ORIGINALS)) {
    if (value === undefined) delete globalThis[name];
    else globalThis[name] = value;
  }
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

function freshGame(seed) {
  delete require.cache[require.resolve(MODULE)];
  const storage = createStorage(seed);
  globalThis.localStorage = storage;
  const api = require(MODULE);
  return { api, storage };
}

function makeUnit(id, count) {
  const words = [];
  for (let i = 0; i < count; i += 1) {
    words.push({ word: 'word-' + i, meaning: '意思-' + i, emoji: '🍎' });
  }
  return { id, title: id, words };
}

function makeFakeElement(tagName) {
  return {
    tagName: String(tagName).toUpperCase(),
    className: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    children: [],
    appendChild(child) { this.children.push(child); },
    setAttribute(name, value) { this[name] = String(value); }
  };
}

function fixedRng(seed) {
  let value = seed || 1;
  return () => {
    value = (value * 16807) % 2147483647;
    return value / 2147483647;
  };
}

function wordSet(items) {
  return new Set(items.map((item) => item.word || item));
}

test('pace normalizes percentages and clamps to the 50–100 range', () => {
  const { api } = freshGame();

  assert.equal(api.normalizeGamePace(0.6), 0.6);
  assert.equal(api.normalizeGamePace('50'), 0.5);
  assert.equal(api.normalizeGamePace('100'), 1);
  assert.equal(api.normalizeGamePace('85'), 0.85);
  assert.equal(api.normalizeGamePace('10'), 0.5);
  assert.equal(api.normalizeGamePace('150'), 1);
  assert.equal(api.normalizeGamePace(1.5), 1);
  assert.equal(api.normalizeGamePace(2), 1);
  assert.equal(api.normalizeGamePace('0.73'), 0.75);
  assert.equal(api.normalizeGamePace('nope'), null);
  assert.equal(api.normalizeGamePace(), null);
  assert.equal(api.state.gamePace, 0.6);
});

test('pace persists under a namespaced key and loads with a safe default', () => {
  const { api, storage } = freshGame({ [PACE_KEY]: '0.55' });
  assert.equal(api.loadGamePace(), 0.55);
  assert.equal(api.state.gamePace, 0.55);

  assert.equal(api.selectGamePace('85'), 0.85);
  assert.equal(api.state.gamePace, 0.85);
  assert.equal(storage.getItem(PACE_KEY), '0.85');

  assert.equal(api.selectGamePace('10'), 0.5);
  assert.equal(storage.getItem(PACE_KEY), '0.5');

  const invalid = freshGame({ [PACE_KEY]: 'fast' });
  assert.equal(invalid.api.loadGamePace(), 0.6);
  assert.equal(invalid.api.state.gamePace, 0.6);

  const missing = freshGame();
  assert.equal(missing.api.loadGamePace(), 0.6);
});

test('round pool is sampled once and reused by cards and schedule', () => {
  const { api } = freshGame();
  const unit = makeUnit('unit-a', 20);
  const other = makeUnit('unit-b', 20);
  const rng = fixedRng(7);

  api.selectRoundSize(6);
  const first = api.prepareRound(unit, rng, 0.6);
  assert.equal(first.words.length, 6);
  assert.equal(api.state.roundPool, first.words);
  assert.deepEqual(wordSet(first.schedule), wordSet(first.words));
  assert.ok(first.schedule.length > first.words.length);

  /* Match mode and pace changes must not reshuffle a prepared round. */
  api.selectMatchMode('zh-to-en');
  api.selectGamePace('90');
  const second = api.prepareRound(unit, fixedRng(99), 1);
  assert.equal(second.words, first.words);
  assert.deepEqual(wordSet(second.schedule), wordSet(first.words));

  /* Changing the selected round size resamples. */
  api.selectRoundSize(10);
  const third = api.prepareRound(unit, fixedRng(3), 0.6);
  assert.notEqual(third.words, first.words);
  assert.equal(third.words.length, 10);
  assert.deepEqual(wordSet(third.schedule), wordSet(third.words));

  /* Changing units resamples as well. */
  const fourth = api.prepareRound(other, fixedRng(4), 0.6);
  assert.notEqual(fourth.words, third.words);
  assert.match(api.state.roundPoolKey, /^unit-b::10$/);
});

test('a unit smaller than the round size uses every word exactly once', () => {
  const { api } = freshGame();
  const small = makeUnit('unit-small', 4);

  api.selectRoundSize(10);
  const round = api.prepareRound(small, fixedRng(11), 0.6);

  assert.equal(round.words.length, 4);
  assert.deepEqual(wordSet(round.words), wordSet(small.words));
  assert.deepEqual(wordSet(round.schedule), wordSet(small.words));
});

test('preview list renders the sampled English and Chinese pool with its count', () => {
  const { api } = freshGame();
  const list = makeFakeElement('ul');
  const count = makeFakeElement('p');
  globalThis.document = {
    querySelector(selector) {
      if (selector === '#round-word-preview-list') return list;
      if (selector === '#round-word-preview-count') return count;
      return null;
    },
    createElement: makeFakeElement
  };

  api.state.roundPool = makeUnit('unit-render', 3).words;
  api.renderRoundWordPreview();

  assert.equal(count.textContent, '本关 3 个单词');
  assert.equal(count.dataset.count, '3');
  assert.equal(list.children.length, 3);
  assert.match(list.children[0].innerHTML, /word-0/);
  assert.match(list.children[0].innerHTML, /意思-0/);
  assert.equal(list.children[0].dataset.word, 'word-0');
});

test('slower pace scales movement and every arrival interval consistently', () => {
  const { api } = freshGame();
  const words = makeUnit('unit-pace', 8).words;
  const rng = () => 0;

  const fast = api.buildWaveSchedule(words, rng, 1);
  const slow = api.buildWaveSchedule(words, rng, 0.5);

  assert.equal(slow.length, fast.length);
  assert.equal(fast[0].time, 1200);
  assert.equal(slow[0].time, 2400);
  for (let i = 0; i < fast.length; i += 1) {
    assert.equal(slow[i].time, fast[i].time * 2);
  }

  assert.equal(api.enemySpeedFor(1), api.config.enemySpeed);
  assert.equal(api.enemySpeedFor(0.5), api.config.enemySpeed * 0.5);
  assert.equal(api.enemySpeedFor(0.6), api.config.enemySpeed * 0.6);
});
