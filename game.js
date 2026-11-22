/* English Kids — original lane-defense vocabulary game logic.
   Contract: screens use .is-active; HUD/container/action ids are documented in README.
   No external code, audio, or assets; visuals are CSS classes + emoji from data.js. */
(function (root) {
  'use strict';

  var Data = root.EnglishKidsData;
  if (!Data && typeof require === 'function') {
    try { Data = require('./data.js'); } catch (err) { Data = null; }
  }
  if (!Data) {
    if (root.console) root.console.error('[EnglishKids] data.js must load before game.js');
    return;
  }

  var CFG = Data.CONFIG;
  /* Generic, original monster glyph. It must never be a vocabulary emoji. */
  var CREATURE_ICON = '👾';
  var ROUND_SIZE_DEFAULT = 6;
  var ROUND_SIZE_STORAGE_KEY = 'english-kids:round-size';
  var MATCH_MODE_DEFAULT = 'classic';
  var MATCH_MODE_STORAGE_KEY = 'english-kids:match-mode';
  var MATCH_MODES = ['classic', 'zh-to-en', 'en-to-zh'];
  /* Pace is a multiplier: 0.2 is the slowest supported speed, 1 is the
     original speed. The range input exposes it as 20–100 in steps of 5. */
  var GAME_PACE_DEFAULT = 0.4;
  var GAME_PACE_MIN = 0.2;
  var GAME_PACE_MAX = 1;
  var GAME_PACE_STEP = 0.05;
  var GAME_PACE_STORAGE_KEY = 'english-kids:game-pace:v2';
  var state = {
    unit: null,
    unitId: null,
    lastUnitId: null,
    gradeId: null,
    bookId: null,
    screen: 'home',
    running: false,
    paused: false,
    finished: false,
    score: 0,
    lives: CFG.startingLives,
    wave: 1,
    totalWaves: CFG.totalWaves,
    elapsed: 0,
    spawnQueue: [],
    spawnIndex: 0,
    enemies: [],
    defenders: [],
    cards: [],
    selectedWord: null,
    soundOn: true,
    speechAvailable: false,
    speechWarned: false,
    hintsLeft: CFG.hints,
    combo: 0,
    kills: 0,
    learned: new Set(),
    roundSize: ROUND_SIZE_DEFAULT,
    matchMode: MATCH_MODE_DEFAULT,
    gamePace: GAME_PACE_DEFAULT,
    roundPace: GAME_PACE_DEFAULT,
    activeWords: [],
    roundPool: [],
    roundPoolKey: null,
    loopId: null,
    lastFrame: 0,
    reducedMotion: false,
    uid: 0,
    initialized: false,
    eventsBound: false
  };

  var cellsByLane = [];
  var laneIdOffset = null;
  var audioCtx = null;
  var toastTimer = null;
  var timeouts = new Set();

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function now() {
    return root.performance && typeof root.performance.now === 'function'
      ? root.performance.now()
      : Date.now();
  }

  function $(selector) {
    return root.document ? root.document.querySelector(selector) : null;
  }

  function $$(selector) {
    return root.document ? Array.prototype.slice.call(root.document.querySelectorAll(selector)) : [];
  }

  function make(tag, className, text) {
    var node = root.document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function later(fn, delay) {
    var id = root.setTimeout(function () {
      timeouts.delete(id);
      fn();
    }, delay);
    timeouts.add(id);
    return id;
  }

  function clearLater() {
    timeouts.forEach(function (id) { root.clearTimeout(id); });
    timeouts.clear();
  }

  function setText(selector, text) {
    var node = $(selector);
    if (node && node.textContent !== String(text)) node.textContent = String(text);
  }

  function emit(name, detail) {
    if (!root.document || typeof root.CustomEvent !== 'function') return;
    root.document.dispatchEvent(new root.CustomEvent(name, { detail: detail || {} }));
  }

  function hueFor(word) {
    var hue = 0;
    var text = String(word || '');
    for (var i = 0; i < text.length; i += 1) hue = (hue * 31 + text.charCodeAt(i)) % 360;
    return hue;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeRoundSize(value) {
    var parsed = parseInt(value, 10);
    return isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function loadRoundSize() {
    try {
      var stored = root.localStorage && root.localStorage.getItem(ROUND_SIZE_STORAGE_KEY);
      var parsed = normalizeRoundSize(stored);
      if (parsed) state.roundSize = parsed;
    } catch (err) { /* storage is optional */ }
  }

  function saveRoundSize(size) {
    try {
      if (root.localStorage) {
        root.localStorage.setItem(ROUND_SIZE_STORAGE_KEY, String(size));
      }
    } catch (err) { /* storage is optional */ }
  }

  function normalizeMatchMode(value) {
    return MATCH_MODES.indexOf(value) >= 0 ? value : null;
  }

  function loadMatchMode() {
    try {
      var stored = root.localStorage && root.localStorage.getItem(MATCH_MODE_STORAGE_KEY);
      var mode = normalizeMatchMode(stored);
      if (mode) state.matchMode = mode;
    } catch (err) { /* storage is optional */ }
  }

  function saveMatchMode(mode) {
    try {
      if (root.localStorage) {
        root.localStorage.setItem(MATCH_MODE_STORAGE_KEY, mode);
      }
    } catch (err) { /* storage is optional */ }
  }

  /* Accept either a multiplier (0.5–1) or a percentage (50–100), clamp it to
     the supported range, and snap it to the slider's 5% steps. */
  function normalizeGamePace(value) {
    var numeric = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(numeric)) return null;
    if (numeric >= 10) numeric = numeric / 100;
    var percent = clamp(Math.round(numeric * 100), GAME_PACE_MIN * 100, GAME_PACE_MAX * 100);
    percent = Math.round(percent / (GAME_PACE_STEP * 100)) * (GAME_PACE_STEP * 100);
    return percent / 100;
  }

  function loadGamePace() {
    try {
      var stored = root.localStorage && root.localStorage.getItem(GAME_PACE_STORAGE_KEY);
      var pace = normalizeGamePace(stored);
      if (pace != null) state.gamePace = pace;
      else state.gamePace = GAME_PACE_DEFAULT;
    } catch (err) {
      state.gamePace = GAME_PACE_DEFAULT;
    }
    if (state.gamePace < GAME_PACE_MIN || state.gamePace > GAME_PACE_MAX) {
      state.gamePace = GAME_PACE_DEFAULT;
    }
    return state.gamePace;
  }

  function saveGamePace(pace) {
    try {
      if (root.localStorage) {
        root.localStorage.setItem(GAME_PACE_STORAGE_KEY, String(pace));
      }
    } catch (err) { /* storage is optional */ }
  }

  /* Canonical identity always stays word.word / word.meaning. These helpers
     only choose which language is visible for the current mode. */
  function cardLabelFor(word) {
    if (!word) return '';
    return state.matchMode === 'en-to-zh' ? word.meaning : word.word;
  }

  function enemyClueFor(word) {
    if (!word) return '';
    return state.matchMode === 'zh-to-en' ? word.meaning : word.word;
  }

  function cardAriaLabelFor(word) {
    if (!word) return '';
    if (state.matchMode === 'zh-to-en') return '英语卡片：' + word.word;
    if (state.matchMode === 'en-to-zh') return '中文卡片：' + word.meaning;
    return '图片卡片：' + word.meaning + '（' + word.word + '）';
  }

  function enemyAriaLabelFor(word) {
    return '单词敌人：' + enemyClueFor(word);
  }

  function matchModeHintText() {
    if (state.matchMode === 'zh-to-en') {
      return '汉译英：敌人只显示中文意思，卡片只显示英语单词。';
    }
    if (state.matchMode === 'en-to-zh') {
      return '英译汉：敌人只显示英语单词，卡片只显示中文意思。';
    }
    return '经典：敌人显示英语单词，卡片是图片（含英语标签）。';
  }

  function matchModeInstruction() {
    if (state.matchMode === 'zh-to-en') {
      return '敌人显示中文意思，请把对应的英语卡片放到同一行，守住右边的基地！点“提示”可以找线索。';
    }
    if (state.matchMode === 'en-to-zh') {
      return '敌人显示英语单词，请把对应的中文卡片放到同一行，守住右边的基地！点“提示”可以找线索。';
    }
    return '把和敌人单词相同的卡片放到同一行，守住右边的基地！点“提示”可以找答案。';
  }

  function matchModePreviewStatus() {
    if (state.matchMode === 'zh-to-en') {
      return '先读一读单词。开始后敌人出中文意思，你选对应的英语卡片。';
    }
    if (state.matchMode === 'en-to-zh') {
      return '先读一读单词。开始后敌人出英语单词，你选对应的中文卡片。';
    }
    return '先读一读单词，点击卡片可以听发音。准备好了就点“开始游戏”。';
  }

  /* Distinct, valid words from a unit, in curriculum order. */
  function getUnitWords(unit) {
    var words = unit && Array.isArray(unit.words) ? unit.words : [];
    var seen = Object.create(null);
    return words.filter(function (word) {
      if (!word || !word.word || seen[word.word]) return false;
      seen[word.word] = true;
      return true;
    });
  }

  /* Pick the pool for one battle without mutating the curriculum data. */
  function pickRoundWords(unit, rng) {
    var words = getUnitWords(unit);
    if (!words.length) return [];
    var random = typeof rng === 'function' ? rng : Math.random;
    var size = Math.min(state.roundSize, words.length);
    return Data.shuffle(words, random).slice(0, size);
  }

  /* The preview pool is sampled once per unit + round size, so changing match
     mode or pace never reshuffles the words the player is preparing for. */
  function roundPoolKeyFor(unit) {
    if (!unit) return null;
    return String(unit.id || '') + '::' + state.roundSize;
  }

  function sampleRoundPool(unit, rng) {
    state.roundPool = pickRoundWords(unit, rng);
    state.roundPoolKey = roundPoolKeyFor(unit);
    return state.roundPool;
  }

  function ensureRoundPool(unit, force, rng) {
    var key = roundPoolKeyFor(unit);
    if (force || state.roundPoolKey !== key) return sampleRoundPool(unit, rng);
    return state.roundPool;
  }

  var HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };

  /* Workbook strings are data, never markup. */
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return HTML_ESCAPES[character];
    });
  }

  function contentStatusMessage() {
    if (!Data.hasVocabulary()) {
      return Data.CONTENT_STATUS.message || '单词表待导入。';
    }
    return Data.CONTENT_STATUS.message ||
      ('已导入 ' + Data.CONTENT_STATUS.wordCount + ' 个用户提供的词条。');
  }

  /* ------------------------------------------------------------------ */
  /* Audio + speech (graceful fallbacks)                                 */
  /* ------------------------------------------------------------------ */

  function beep(frequency, durationMs) {
    if (!state.soundOn) return;
    try {
      var Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended' && audioCtx.resume) {
        audioCtx.resume().catch(function () {});
      }
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      var seconds = Math.max(0.03, (durationMs || 80) / 1000);
      osc.type = 'sine';
      osc.frequency.value = frequency || 660;
      gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0008, audioCtx.currentTime + seconds);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + seconds);
    } catch (err) { /* audio is optional */ }
  }

  function speak(word) {
    if (!state.soundOn) return;
    if (!root.speechSynthesis || typeof root.SpeechSynthesisUtterance !== 'function') {
      state.speechAvailable = false;
      if (!state.speechWarned) {
        state.speechWarned = true;
        toast('🔈 浏览器没有语音朗读，跟着单词读一读吧！', 'info');
      }
      return;
    }
    try {
      root.speechSynthesis.cancel();
      var utter = new root.SpeechSynthesisUtterance(String(word));
      utter.lang = 'en-US';
      utter.rate = 0.82;
      utter.pitch = 1.08;
      if (typeof root.speechSynthesis.getVoices === 'function') {
        var voices = root.speechSynthesis.getVoices() || [];
        for (var i = 0; i < voices.length; i += 1) {
          if (/^en/i.test(voices[i].lang || '')) { utter.voice = voices[i]; break; }
        }
      }
      root.speechSynthesis.speak(utter);
    } catch (err) {
      toast('🔈 朗读暂时不可用，试着自己读一读吧！', 'info');
    }
  }

  function updateSoundButton() {
    $$("[data-action='toggle-sound']").forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(state.soundOn));
      btn.setAttribute('title', state.soundOn ? '关闭声音' : '打开声音');
      btn.dataset.sound = state.soundOn ? 'on' : 'off';
      btn.classList.toggle('is-off', !state.soundOn);
      var label = btn.querySelector('[data-sound-label]');
      if (label) label.textContent = state.soundOn ? '声音：开' : '声音：关';
    });
    var legacyLabel = root.document ? root.document.getElementById('sound-label') : null;
    if (legacyLabel) legacyLabel.textContent = state.soundOn ? '音效：开' : '音效：关';
  }

  function toggleSound() {
    state.soundOn = !state.soundOn;
    if (!state.soundOn && root.speechSynthesis) {
      try { root.speechSynthesis.cancel(); } catch (err) {}
    }
    updateSoundButton();
    if (state.soundOn) {
      beep(760, 80);
      setStatus('🔊 声音已打开。');
    } else {
      setStatus('🔇 声音已关闭。');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Feedback                                                            */
  /* ------------------------------------------------------------------ */

  function setStatus(message) {
    var node = $('#status-message') || $('#tray-hint');
    if (!node) { toast(message, 'info'); return; }
    node.textContent = message;
    if (!state.reducedMotion) {
      node.classList.remove('is-pulse');
      void node.offsetWidth;
      node.classList.add('is-pulse');
      later(function () { node.classList.remove('is-pulse'); }, 650);
    }
  }

  function toast(message, tone) {
    var node = $('#toast') || $('#battle-toast');
    if (!node) return;
    node.textContent = message;
    node.dataset.tone = tone || 'info';
    node.hidden = false;
    node.classList.add('is-visible', 'is-show');
    if (toastTimer) {
      root.clearTimeout(toastTimer);
      toastTimer = null;
    }
    toastTimer = root.setTimeout(function () {
      node.classList.remove('is-visible', 'is-show');
      if (node.id === 'battle-toast') node.hidden = true;
      toastTimer = null;
    }, 2000);
  }

  /* ------------------------------------------------------------------ */
  /* Screens + DOM scaffolding                                           */
  /* ------------------------------------------------------------------ */

  function hideResultModals() {
    if (!root.document) return;
    ['modal-result', 'modal-pause'].forEach(function (id) {
      var modal = root.document.getElementById(id);
      if (modal) modal.hidden = true;
    });
  }

  function showScreen(id, opts) {
    opts = opts || {};
    if (!opts.keepGame && id !== 'screen-game' && state.running) stopGame();
    var target = root.document
      ? (root.document.getElementById(id) ||
         (id === 'screen-result' ? root.document.getElementById('modal-result') : null))
      : null;
    if (id !== 'screen-result') hideResultModals();
    if (!target) { state.screen = id; return; }
    if (target.classList.contains('screen')) {
      $$('.screen').forEach(function (screen) {
        var active = screen === target;
        screen.classList.toggle('is-active', active);
        screen.hidden = !active;
        screen.setAttribute('aria-hidden', String(!active));
      });
    } else {
      target.hidden = false;
      target.classList.add('is-active');
      target.setAttribute('aria-hidden', 'false');
    }
    state.screen = id;
  }

  function getLane(laneIndex) {
    if (!root.document) return null;
    if (laneIdOffset == null) {
      if (root.document.getElementById('lane-0')) laneIdOffset = 0;
      else if (root.document.getElementById('lane-1')) laneIdOffset = 1;
      else laneIdOffset = 0;
    }
    return root.document.getElementById('lane-' + (laneIndex + laneIdOffset));
  }

  function getCell(laneIndex, cellIndex) {
    return cellsByLane[laneIndex] ? cellsByLane[laneIndex][cellIndex] || null : null;
  }

  function closestCell(target) {
    if (!target || !target.closest) return null;
    return target.closest('#game-board .cell[data-cell]') ||
      target.closest('#battlefield .cell[data-cell]') ||
      target.closest('.cell[data-cell]');
  }

  function ensureBoard() {
    if (!root.document) return;
    laneIdOffset = null;
    var board = $('#game-board') || $('#battlefield');
    var firstLane = getLane(0);
    var host = board || (firstLane && firstLane.parentElement) || $('#screen-game');
    if (!host) return;
    if (board) {
      board.dataset.lanes = String(CFG.lanes);
      board.dataset.cells = String(CFG.cellsPerLane);
      board.dataset.base = 'right';
    }

    cellsByLane = [];
    for (var laneIndex = 0; laneIndex < CFG.lanes; laneIndex += 1) {
      var lane = getLane(laneIndex);
      if (!lane) {
        lane = make('div', 'lane');
        lane.id = 'lane-' + laneIndex;
        host.appendChild(lane);
      }
      lane.classList.add('lane');
      lane.dataset.lane = String(laneIndex);
      lane.dataset.cells = String(CFG.cellsPerLane);

      /* The designer scaffold uses a continuous .lane__track; the original
         contract uses direct [data-cell] children. Support both. */
      var cellHost = lane.querySelector('.lane__track') || lane;
      var cells = Array.prototype.slice.call(cellHost.querySelectorAll('[data-cell]'));
      if (!cells.length) cells = Array.prototype.slice.call(cellHost.querySelectorAll('.cell'));
      if (cellHost !== lane && !cells.length) {
        cellHost.style.display = 'grid';
        cellHost.style.gridTemplateColumns = 'repeat(' + CFG.cellsPerLane + ', minmax(0, 1fr))';
        cellHost.style.alignItems = 'center';
      }
      while (cells.length < CFG.cellsPerLane) {
        var created = make('div', 'cell');
        created.dataset.cell = String(cells.length);
        cellHost.appendChild(created);
        cells.push(created);
      }
      cells = cells.slice(0, CFG.cellsPerLane);

      cells.forEach(function (cell, cellIndex) {
        cell.dataset.lane = String(laneIndex);
        cell.dataset.cell = String(cellIndex);
        cell.classList.add('cell');
        if (!cell.hasAttribute('tabindex')) cell.tabIndex = 0;
        if (!cell.hasAttribute('role')) cell.setAttribute('role', 'button');
        if (!cell.hasAttribute('aria-label')) {
          cell.setAttribute('aria-label', '第 ' + (laneIndex + 1) + ' 行第 ' + (cellIndex + 1) + ' 格');
        }
      });
      cellsByLane.push(cells);

      Array.prototype.slice.call(lane.querySelectorAll('.creature--demo, [data-demo="true"]'))
        .forEach(function (demo) { demo.remove(); });
    }
  }

  function clearTokens() {
    if (root.document) {
      $$('.enemy-token, .defender-token, .shot-token, .score-pop').forEach(function (node) {
        node.remove();
      });
      $$('.cell.is-zapped, .cell.is-hinted, .lane.is-danger').forEach(function (node) {
        node.classList.remove('is-zapped', 'is-hinted', 'is-danger');
      });
      var battleToast = root.document.getElementById('battle-toast');
      if (battleToast) {
        battleToast.hidden = true;
        battleToast.classList.remove('is-visible', 'is-show');
      }
    }
    if (toastTimer) {
      root.clearTimeout(toastTimer);
      toastTimer = null;
    }
  }

  function clearHighlights() {
    $$('.is-hinted').forEach(function (node) { node.classList.remove('is-hinted'); });
  }

  /* ------------------------------------------------------------------ */
  /* Home + preview rendering                                            */
  /* ------------------------------------------------------------------ */

  function renderEmptyState(container, title, message) {
    container.innerHTML = '';
    var box = make('div', 'home-empty');
    if (container.id === 'unit-grid') box.classList.add('unit-card');
    box.dataset.empty = 'true';
    box.setAttribute('role', 'status');
    var icon = make('span', 'home-empty__icon', '📥');
    icon.setAttribute('aria-hidden', 'true');
    box.appendChild(icon);
    box.appendChild(make('strong', 'home-empty__title', title));
    box.appendChild(make('p', 'home-empty__message', message));
    container.appendChild(box);
  }

  function renderHome() {
    var grade = Data.getGrade(state.gradeId);
    if (!grade) state.gradeId = null;
    var book = Data.getBook(state.bookId);
    if (book && (!state.gradeId || book.gradeId !== state.gradeId)) state.bookId = null;
    renderGradeList();
    renderBookList();
    renderUnitList();
  }

  function chipHost() {
    return $('#screen-units .book-filter');
  }

  function renderGradeList() {
    var list = $('#grade-list');
    if (list) {
      list.innerHTML = '';
      Data.GRADE_LEVELS.forEach(function (grade) {
        var selected = state.gradeId === grade.id;
        var wordCount = Data.getWordCountForGrade ? Data.getWordCountForGrade(grade) : 0;
        var card = make('button', 'grade-card');
        card.type = 'button';
        card.dataset.action = 'select-grade';
        card.dataset.gradeId = grade.id;
        card.classList.toggle('is-selected', selected);
        card.setAttribute('aria-pressed', String(selected));
        card.setAttribute('aria-label', '选择' + grade.label);
        card.innerHTML =
          '<span class="grade-card__label">' + escapeHtml(grade.label) + '</span>' +
          '<span class="grade-card__meta">' + grade.books.length + ' 册' +
            (wordCount ? ' · ' + wordCount + ' 词' : '') + '</span>';
        list.appendChild(card);
      });
      return;
    }

    /* Designer fallback: one chip row for grades, then books once a grade is chosen. */
    var host = chipHost();
    if (!host) return;
    host.innerHTML = '';
    Data.GRADE_LEVELS.forEach(function (grade) {
      var selected = state.gradeId === grade.id;
      var wordCount = Data.getWordCountForGrade ? Data.getWordCountForGrade(grade) : 0;
      var chip = make('button', 'chip');
      chip.type = 'button';
      chip.dataset.action = 'select-grade';
      chip.dataset.gradeId = grade.id;
      chip.setAttribute('role', 'tab');
      chip.setAttribute('aria-selected', String(selected));
      chip.classList.toggle('is-active', selected);
      chip.textContent = grade.label + (wordCount ? ' · ' + wordCount + ' 词' : '');
      host.appendChild(chip);
    });
    var grade = Data.getGrade(state.gradeId);
    if (grade) {
      grade.books.forEach(function (book) {
        var selected = state.bookId === book.id;
        var wordCount = Data.getWordCountForBook ? Data.getWordCountForBook(book) : 0;
        var chip = make('button', 'chip');
        chip.type = 'button';
        chip.dataset.action = 'select-book';
        chip.dataset.bookId = book.id;
        chip.setAttribute('role', 'tab');
        chip.setAttribute('aria-selected', String(selected));
        chip.classList.toggle('is-active', selected);
        chip.textContent = book.title + (wordCount ? ' · ' + wordCount + ' 词' : '');
        host.appendChild(chip);
      });
    }
  }

  function renderBookList() {
    var list = $('#book-list');
    if (!list) return; // fallback chips are handled by renderGradeList
    var grade = Data.getGrade(state.gradeId);
    if (!grade) {
      list.innerHTML = '';
      list.appendChild(make('p', 'home-hint', '先选择年级，再选择上册或下册。'));
      return;
    }
    list.innerHTML = '';
    grade.books.forEach(function (book) {
      var selected = state.bookId === book.id;
      var unitCount = Array.isArray(book.units) ? book.units.length : 0;
      var wordCount = Data.getWordCountForBook ? Data.getWordCountForBook(book) : 0;
      var card = make('button', 'book-card');
      card.type = 'button';
      card.dataset.action = 'select-book';
      card.dataset.bookId = book.id;
      card.classList.toggle('is-selected', selected);
      card.setAttribute('aria-pressed', String(selected));
      card.setAttribute('aria-label', '选择' + book.title);
      card.innerHTML =
        '<span class="book-card__label">' + escapeHtml(book.label) + '</span>' +
        '<span class="book-card__meta">' + unitCount + ' 个单元' +
          (wordCount ? ' · ' + wordCount + ' 词' : '') + '</span>';
      list.appendChild(card);
    });
  }

  function renderUnitCard(unit) {
    if (!unit) return null;
    var words = Array.isArray(unit.words) ? unit.words : [];
    var wordCount = Data.getWordCount ? Data.getWordCount(unit) : words.length;
    var title = unit.title || unit.id || '未命名单元';
    var emoji = unit.emoji || (words[0] && words[0].emoji) || '📘';
    var subtitle = unit.subtitle || (wordCount ? wordCount + ' 个单词' : '单词待导入');
    var card = make('button', 'unit-card');
    card.type = 'button';
    card.dataset.action = 'show-preview';
    card.dataset.unitId = unit.id;
    card.style.setProperty('--unit-hue', String(unit.hue || hueFor(title)));
    card.setAttribute('aria-label', '学习 ' + title + '，' + wordCount + ' 个单词');
    card.innerHTML =
      '<span class="unit-card__emoji" aria-hidden="true">' + escapeHtml(emoji) + '</span>' +
      '<span class="unit-card__name unit-card__title">' + escapeHtml(title) + '</span>' +
      '<span class="unit-card__meta unit-card__subtitle">' + escapeHtml(subtitle) + '</span>' +
      '<span class="unit-card__words">' +
        words.slice(0, 4).map(function (word) {
          return '<span class="word-chip">' + escapeHtml(word.emoji) + ' ' + escapeHtml(word.word) + '</span>';
        }).join('') +
      '</span>' +
      '<span class="unit-card__cta">开始学习 →</span>';
    return card;
  }

  function renderUnitList() {
    var list = $('#unit-list') || $('#unit-grid');
    if (!list) return;
    var grade = Data.getGrade(state.gradeId);
    var book = Data.getBook(state.bookId);
    var hasGradePicker = !!$('#grade-list') || !!chipHost();
    var hasBookPicker = !!$('#book-list') || !!chipHost();

    if (!hasGradePicker && !hasBookPicker) {
      if (Data.hasVocabulary()) {
        renderEmptyState(list, '选择区未就绪',
          '已导入 ' + Data.CONTENT_STATUS.wordCount +
          ' 个词条，但页面还缺少年级/册次选择区，暂时无法显示单元。');
      } else {
        renderEmptyState(list, '单词表待导入',
          '当前还没有导入任何单词。目录结构准备好后，这里会显示单元和单词。');
      }
      return;
    }
    if (!grade) {
      renderEmptyState(list, '先选择年级', '请选择三年级、四年级或五年级。');
      return;
    }
    if (!hasBookPicker) {
      var gradeWordCount = Data.getWordCountForGrade ? Data.getWordCountForGrade(grade) : 0;
      renderEmptyState(list,
        gradeWordCount ? '选择区未就绪' : '单词表待导入',
        gradeWordCount
          ? ('已导入 ' + gradeWordCount + ' 个词条，但页面还缺少册次选择区。')
          : (grade.label + '还没有导入单元和单词。'));
      return;
    }
    if (!book || book.gradeId !== grade.id) {
      renderEmptyState(list, '请选择册次', grade.label + '分为上册和下册，选一册查看单元。');
      return;
    }

    var units = Data.getUnitsForBook(book.id);
    if (!units.length) {
      renderEmptyState(list,
        book.note ? '本册暂无词汇' : '单词表待导入',
        book.note || (book.title + '还没有导入单元和单词。导入后会显示在这里。'));
      return;
    }

    list.innerHTML = '';
    units.forEach(function (unit) {
      var card = renderUnitCard(unit);
      if (card) list.appendChild(card);
    });
  }

  function selectGrade(gradeId) {
    var grade = Data.getGrade(gradeId);
    if (!grade) return;
    state.gradeId = grade.id;
    state.bookId = null;
    state.unit = null;
    state.unitId = null;
    renderHome();
    setStatus('已选择' + grade.label + '，请选择上册或下册。');
    beep(600, 60);
    emit('english-kids:select-grade', { gradeId: grade.id });
  }

  function selectBook(bookId) {
    var book = Data.getBook(bookId);
    if (!book) return;
    state.gradeId = book.gradeId;
    state.bookId = book.id;
    state.unit = null;
    state.unitId = null;
    renderHome();
    var wordCount = Data.getWordCountForBook ? Data.getWordCountForBook(book) : 0;
    if (Data.hasVocabulary(book)) {
      setStatus('已选择' + book.title + '，共 ' + Data.getUnitsForBook(book).length +
        ' 个单元、' + wordCount + ' 个词条。请选择一个单元开始学习。');
    } else {
      setStatus(book.note || (book.title + '的单词表待导入，导入后就能开始游戏。'));
    }
    beep(640, 70);
    emit('english-kids:select-book', { bookId: book.id, gradeId: book.gradeId });
  }

  function openUnitsScreen() {
    renderHome();
    if ($('#screen-units')) {
      showScreen('screen-units');
      setStatus(contentStatusMessage());
    } else {
      showScreen('screen-home');
    }
  }

  function openNextUnit() {
    var book = Data.getBook(state.bookId);
    if (!book) { openUnitsScreen(); return; }
    var units = Data.getUnitsForBook(book.id);
    var index = -1;
    for (var i = 0; i < units.length; i += 1) {
      if (units[i].id === state.unitId) { index = i; break; }
    }
    if (index >= 0 && index + 1 < units.length) openPreview(units[index + 1].id);
    else openUnitsScreen();
  }

  function renderRoundWordPreview() {
    var list = $('#round-word-preview-list');
    var countNode = $('#round-word-preview-count');
    var words = Array.isArray(state.roundPool) ? state.roundPool : [];
    if (countNode) {
      countNode.dataset.count = String(words.length);
      var countText = '本关 ' + words.length + ' 个单词';
      if (countNode.textContent !== countText) countNode.textContent = countText;
    }
    if (!list) return;
    list.innerHTML = '';
    var asListItems = list.tagName === 'UL' || list.tagName === 'OL';
    words.forEach(function (word) {
      var item = make(asListItems ? 'li' : 'div', 'round-word-preview__item');
      item.dataset.word = word.word;
      item.setAttribute('aria-label', word.word + '，' + word.meaning);
      item.innerHTML =
        '<span class="round-word-preview__word">' + escapeHtml(word.word) + '</span>' +
        '<span class="round-word-preview__meaning">' + escapeHtml(word.meaning) + '</span>';
      list.appendChild(item);
    });
  }

  function renderPreview(unit) {
    var list = $('#preview-list');
    if (!list) return;
    var words = Array.isArray(unit.words) ? unit.words : [];
    var title = unit.title || unit.id || '单词预览';
    list.innerHTML = '';
    setText('#preview-title', title);
    setText('[data-preview-title]', title);
    updateMatchModeControls();
    updateRoundSizeControls(unit);

    var hasHeading = !!$('#preview-title') || !!$('#screen-preview .preview-heading');
    if (!hasHeading) {
      var heading = make('div', 'preview-heading');
      heading.innerHTML =
        '<span class="preview-heading__emoji" aria-hidden="true">' + escapeHtml(unit.emoji || '📘') + '</span>' +
        '<span class="preview-heading__title">' + escapeHtml(title) + '</span>' +
        '<span class="preview-heading__subtitle">' +
          escapeHtml(unit.subtitle || (words.length ? '点单词听发音' : '单词表待导入')) +
        '</span>';
      list.appendChild(heading);
    }

    if (!words.length) {
      var empty = make('div', 'preview-empty');
      empty.dataset.empty = 'true';
      empty.setAttribute('role', 'status');
      empty.appendChild(make('strong', 'preview-empty__title', '这个单元还没有单词'));
      empty.appendChild(make('p', 'preview-empty__message',
        '请等待单词表导入后再来预览。现在可以先选择其他年级或册次。'));
      list.appendChild(empty);
      setPreviewStartEnabled(false);
      return;
    }

    setPreviewStartEnabled(true);
    words.forEach(function (word) {
      var card = make('button', 'preview-card word-tile');
      card.type = 'button';
      card.dataset.word = word.word;
      card.style.setProperty('--word-hue', String(hueFor(word.word)));
      card.setAttribute('aria-label', word.word + '，' + word.meaning + '，点击听发音');
      card.innerHTML =
        '<span class="preview-card__emoji word-tile__emoji" aria-hidden="true">' + escapeHtml(word.emoji) + '</span>' +
        '<span class="preview-card__word word-tile__en">' + escapeHtml(word.word) + '</span>' +
        '<span class="preview-card__meaning word-tile__zh">' + escapeHtml(word.meaning) + '</span>' +
        '<span class="word-tile__speak" aria-hidden="true">🔈</span>';
      if (list.tagName === 'UL' || list.tagName === 'OL') {
        var item = make('li');
        item.appendChild(card);
        list.appendChild(item);
      } else {
        list.appendChild(card);
      }
    });
  }

  function setPreviewStartEnabled(enabled) {
    $$("#screen-preview [data-action='start-game']").forEach(function (button) {
      button.disabled = !enabled;
      button.setAttribute('aria-disabled', String(!enabled));
      button.classList.toggle('is-disabled', !enabled);
    });
  }

  function updateRoundSizeHint(available, effective) {
    var node = root.document ? root.document.getElementById('round-size-hint') : null;
    if (!node) return;
    var text;
    if (!available) {
      text = '这个单元还没有单词，暂时不能选择每关单词数量。';
    } else if (state.roundSize > available) {
      text = '本单元只有 ' + available + ' 个单词，这一关会全部用上（' + effective +
        ' 个）。下方预告就是本局词表；切换单元或词数会重新抽取。';
    } else {
      text = '每关从本单元 ' + available + ' 个单词里随机选 ' + effective +
        ' 个，卡片和敌人都是这 ' + effective + ' 个。下方预告就是本局词表；切换单元或词数会重新抽取。';
    }
    if (node.textContent !== text) node.textContent = text;
  }

  function updateRoundSizeControls(unit) {
    var targetUnit = unit || state.unit;
    var available = getUnitWords(targetUnit).length;
    var effective = available ? Math.min(state.roundSize, available) : state.roundSize;
    $$("[data-action='select-round-size']").forEach(function (button) {
      var size = normalizeRoundSize(button.dataset.roundSize);
      if (!size) return;
      var unavailable = available > 0 && size > available;
      var selected = size === state.roundSize;
      button.disabled = unavailable;
      button.setAttribute('aria-disabled', String(unavailable));
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
      button.classList.toggle('is-active', selected);
      button.classList.toggle('is-disabled', unavailable);
      button.dataset.selected = selected ? 'true' : 'false';
      button.dataset.available = String(available ? Math.min(size, available) : size);
    });
    updateRoundSizeHint(available, effective);
  }

  function selectRoundSize(value) {
    var size = normalizeRoundSize(value);
    if (!size || size === state.roundSize) {
      if (size) updateRoundSizeControls(state.unit);
      return;
    }
    state.roundSize = size;
    saveRoundSize(size);
    if (state.unit) {
      ensureRoundPool(state.unit, true);
      renderRoundWordPreview();
    }
    updateRoundSizeControls(state.unit);

    var available = getUnitWords(state.unit).length;
    if (!available) {
      setStatus('已选择每关 ' + size + ' 个单词。');
    } else if (size > available) {
      setStatus('已选择每关 ' + size + ' 个单词；本单元只有 ' + available +
        ' 个，这一关会全部用上。');
    } else {
      setStatus('已重新抽取本局词组，请查看下方单词预告。');
    }
    beep(700, 60);
    emit('english-kids:select-round-size', {
      unitId: state.unitId,
      roundSize: size,
      available: available,
      actualCount: available ? Math.min(size, available) : size
    });
  }

  function updateBattleGuide() {
    var node = root.document ? root.document.getElementById('battle-guide') : null;
    if (!node) return;
    var steps;
    if (state.matchMode === 'zh-to-en') {
      steps = ['1️⃣ 读中文意思', '2️⃣ 点对应英语卡', '3️⃣ 点小路'];
    } else if (state.matchMode === 'en-to-zh') {
      steps = ['1️⃣ 读英语单词', '2️⃣ 点对应中文卡', '3️⃣ 点小路'];
    } else {
      steps = ['1️⃣ 读敌人单词', '2️⃣ 点相同图片卡', '3️⃣ 点小路'];
    }
    node.innerHTML =
      '<span class="battle-guide__step">' + steps[0] + '</span>' +
      '<span class="battle-guide__arrow" aria-hidden="true">›</span>' +
      '<span class="battle-guide__step">' + steps[1] + '</span>' +
      '<span class="battle-guide__arrow" aria-hidden="true">›</span>' +
      '<span class="battle-guide__step">' + steps[2] + '</span>';
  }

  function applyMatchModeUi() {
    if (!root.document) return;
    var targets = [
      root.document.documentElement,
      root.document.body,
      $('#screen-preview'),
      $('#screen-game'),
      $('#screen-result')
    ];
    targets.forEach(function (node) {
      if (node) node.dataset.matchMode = state.matchMode;
    });

    var tray = $('#card-tray');
    if (tray) {
      if (state.matchMode === 'zh-to-en') tray.setAttribute('aria-label', '英语卡片卡槽');
      else if (state.matchMode === 'en-to-zh') tray.setAttribute('aria-label', '中文卡片卡槽');
      else tray.setAttribute('aria-label', '图片卡槽');
    }
    updateBattleGuide();
  }

  function updateMatchModeControls() {
    $$("[data-action='select-match-mode']").forEach(function (button) {
      var mode = normalizeMatchMode(button.dataset.matchMode);
      if (!mode) return;
      var selected = mode === state.matchMode;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
      button.classList.toggle('is-active', selected);
      button.dataset.selected = selected ? 'true' : 'false';
    });
    applyMatchModeUi();
    var hint = root.document ? root.document.getElementById('match-mode-hint') : null;
    if (hint) {
      var text = matchModeHintText();
      if (hint.textContent !== text) hint.textContent = text;
    }
  }

  function updateGamePaceControls() {
    var percent = Math.round(state.gamePace * 100);
    var input = root.document ? root.document.getElementById('game-pace-input') : null;
    if (input) {
      input.min = String(GAME_PACE_MIN * 100);
      input.max = String(GAME_PACE_MAX * 100);
      input.step = String(GAME_PACE_STEP * 100);
      if (String(input.value) !== String(percent)) input.value = String(percent);
      input.setAttribute('aria-valuetext', percent + '%');
    }
    setText('#game-pace-value', percent + '%');
  }

  function selectGamePace(value) {
    var pace = normalizeGamePace(value);
    if (pace == null) {
      updateGamePaceControls();
      return state.gamePace;
    }
    var changed = pace !== state.gamePace;
    state.gamePace = pace;
    saveGamePace(pace);
    updateGamePaceControls();
    if (changed) {
      setStatus('怪物速度：' + Math.round(pace * 100) + '%。开始新一关后生效。');
      emit('english-kids:select-game-pace', {
        pace: pace,
        percent: Math.round(pace * 100)
      });
    }
    return pace;
  }

  function handleGamePaceInput(event) {
    var target = event.target;
    if (!target || target.id !== 'game-pace-input') return;
    selectGamePace(target.value);
  }

  function refreshMatchModePresentation() {
    applyMatchModeUi();
    state.cards.forEach(function (card) { renderCardElement(card); });
    state.enemies.forEach(function (enemy) { renderEnemyElement(enemy); });
    state.defenders.forEach(function (defender) { renderDefenderElement(defender); });
    updateCardStates();
  }

  function selectMatchMode(value) {
    var mode = normalizeMatchMode(value);
    if (!mode) return;
    if (mode === state.matchMode) {
      updateMatchModeControls();
      return;
    }
    state.matchMode = mode;
    saveMatchMode(mode);
    refreshMatchModePresentation();
    updateMatchModeControls();

    if (state.running) setStatus(matchModeInstruction());
    else if (state.screen === 'screen-preview') setStatus(matchModePreviewStatus());
    else setStatus(matchModeHintText());

    beep(680, 60);
    emit('english-kids:select-match-mode', {
      unitId: state.unitId,
      matchMode: mode
    });
  }

  function ensurePreviewControls() {
    var screen = $('#screen-preview');
    if (!screen) return;
    var actions = screen.querySelector('.preview-actions');
    if (!screen.querySelector("[data-action='start-game']")) {
      if (!actions) { actions = make('div', 'preview-actions'); screen.appendChild(actions); }
      var start = make('button', 'btn btn--primary', '开始游戏');
      start.type = 'button';
      start.dataset.action = 'start-game';
      actions.appendChild(start);
    }
    if (!screen.querySelector("[data-action='back-home']")) {
      if (!actions) { actions = make('div', 'preview-actions'); screen.appendChild(actions); }
      var back = make('button', 'btn', '返回首页');
      back.type = 'button';
      back.dataset.action = 'back-home';
      actions.appendChild(back);
    }
  }

  function ensureResultControls() {
    var screen = $('#screen-result');
    if (!screen) return;
    var actions = screen.querySelector('.result-actions');
    if (!screen.querySelector("[data-action='play-again']")) {
      if (!actions) { actions = make('div', 'result-actions'); screen.appendChild(actions); }
      var again = make('button', 'btn btn--primary', '再玩一次');
      again.type = 'button';
      again.dataset.action = 'play-again';
      actions.appendChild(again);
    }
    if (!screen.querySelector("[data-action='back-home']")) {
      if (!actions) { actions = make('div', 'result-actions'); screen.appendChild(actions); }
      var home = make('button', 'btn', '回到首页');
      home.type = 'button';
      home.dataset.action = 'back-home';
      actions.appendChild(home);
    }
  }

  function openPreview(unitId) {
    var unit = Data.getUnit(unitId);
    if (!unit && state.unit) unit = Data.getUnit(state.unit.id);
    if (!unit) {
      setStatus(Data.hasVocabulary()
        ? '请先选择年级、册次和单元。'
        : '单词表待导入：暂时没有可以预览的单元。请先选择年级和册次。');
      toast(Data.hasVocabulary() ? '请先选择一个单元' : '还没有可预览的单元', 'info');
      return;
    }
    state.unit = unit;
    state.unitId = unit.id;
    state.lastUnitId = unit.id;
    var count = Data.getWordCount(unit);
    ensureRoundPool(unit);
    ensurePreviewControls();
    renderPreview(unit);
    renderRoundWordPreview();
    updateMatchModeControls();
    showScreen('screen-preview');
    setStatus(count
      ? matchModePreviewStatus()
      : '这个单元还没有单词，等单词表导入后再来预览吧。');
    emit('english-kids:preview', {
      unitId: unit.id,
      wordCount: count,
      matchMode: state.matchMode
    });
  }

  /* ------------------------------------------------------------------ */
  /* Cards                                                               */
  /* ------------------------------------------------------------------ */

  function renderCardElement(card) {
    if (!card || !card.el) return;
    var button = card.el;
    /* data-card-word is canonical English identity; data-card-label is only
       the visible language for the selected match mode. */
    button.dataset.cardWord = card.word;
    button.dataset.cardLabel = cardLabelFor(card);
    button.dataset.matchMode = state.matchMode;
    button.setAttribute('aria-label', cardAriaLabelFor(card));
    if (state.matchMode === 'classic') {
      button.innerHTML =
        '<span class="game-card__emoji game-card__image word-card__emoji" aria-hidden="true">' +
          escapeHtml(card.emoji) + '</span>';
    } else {
      /* Designer CSS shows ::after { content: attr(data-card-label) } and
         hides .game-card__emoji in translation modes. */
      button.innerHTML = '';
    }
  }

  function buildCards(wordsOrUnit) {
    var tray = $('#card-tray');
    if (tray) {
      Array.prototype.slice.call(tray.querySelectorAll('.game-card, .word-card')).forEach(function (node) {
        node.remove();
      });
    }
    var words = Array.isArray(wordsOrUnit)
      ? wordsOrUnit
      : getUnitWords(wordsOrUnit);
    state.cards = [];
    words.forEach(function (word) {
      var card = {
        word: word.word,
        meaning: word.meaning,
        emoji: word.emoji,
        cooldownUntil: 0,
        cooling: false,
        el: null
      };
      if (tray) {
        var button = make('button', 'game-card word-card game-card--image');
        button.type = 'button';
        button.style.setProperty('--word-hue', String(hueFor(word.word)));
        card.el = button;
        renderCardElement(card);
        tray.appendChild(button);
      }
      state.cards.push(card);
    });
    updateCardStates();
  }

  function findCard(word) {
    for (var i = 0; i < state.cards.length; i += 1) {
      if (state.cards[i].word === word) return state.cards[i];
    }
    return null;
  }

  function updateCardStates() {
    var timestamp = now();
    state.cards.forEach(function (card) {
      if (!card.el) return;
      var cooling = state.running && card.cooldownUntil > timestamp;
      var selected = state.selectedWord === card.word && !cooling;
      card.el.classList.toggle('is-selected', selected);
      card.el.classList.toggle('is-cooling', cooling);
      card.el.dataset.state = cooling ? 'used' : (selected ? 'selected' : 'idle');
      card.el.setAttribute('aria-pressed', String(selected));
      card.el.disabled = !state.running || cooling;
      card.el.setAttribute('aria-disabled', String(!state.running || cooling));
      if (cooling) card.el.dataset.cooldown = 'true';
      else delete card.el.dataset.cooldown;
    });
  }

  function updateCardTimers(timestamp) {
    var changed = false;
    state.cards.forEach(function (card) {
      var cooling = card.cooldownUntil > timestamp;
      if (card.cooling !== cooling) {
        card.cooling = cooling;
        changed = true;
      }
    });
    if (changed) updateCardStates();
  }

  function selectCard(word) {
    if (!state.running) { setStatus('先点“开始游戏”吧！'); return; }
    var card = findCard(word);
    if (!card) return;
    if (card.cooldownUntil > now()) {
      toast('这张卡片还在休息，再等一小会儿。', 'info');
      return;
    }
    if (state.selectedWord === word) {
      state.selectedWord = null;
      updateCardStates();
      setStatus('已取消选择。');
      return;
    }
    state.selectedWord = word;
    updateCardStates();
    if (state.matchMode !== 'en-to-zh') speak(word);
    beep(720, 70);
    if (state.matchMode === 'zh-to-en') {
      setStatus('已选英语卡片 “' + cardLabelFor(card) + '”。点一个空格子放上去！');
    } else if (state.matchMode === 'en-to-zh') {
      setStatus('已选中文卡片 “' + cardLabelFor(card) + '”。点一个空格子放上去！');
    } else {
      setStatus('已选 “' + word + '”（' + card.meaning + '）。点一个空格子放上去！');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Game board tokens                                                   */
  /* ------------------------------------------------------------------ */

  function renderEnemyElement(enemy) {
    if (!enemy || !enemy.el) return;
    var clue = enemyClueFor(enemy);
    enemy.el.dataset.word = enemy.word;
    enemy.el.dataset.clue = clue;
    enemy.el.dataset.matchMode = state.matchMode;
    /* Enemies show only the clue language for the current mode. Never render
       enemy.emoji or the answer language here. */
    enemy.el.setAttribute('title', '单词敌人：' + clue);
    enemy.el.setAttribute('aria-label', enemyAriaLabelFor(enemy));
    enemy.el.innerHTML =
      '<span class="enemy-token__creature enemy-token__emoji" aria-hidden="true">' + CREATURE_ICON + '</span>' +
      '<span class="enemy-token__word">' + escapeHtml(clue) + '</span>';
  }

  function syncEnemyElement(enemy) {
    if (!enemy.el) {
      enemy.el = make('div', 'enemy-token');
      enemy.el.style.setProperty('--word-hue', String(hueFor(enemy.word)));
      renderEnemyElement(enemy);
    }
    var cellIndex = clamp(Math.floor(enemy.pos), 0, CFG.cellsPerLane - 1);
    var cell = getCell(enemy.lane, cellIndex);
    if (cell && enemy.el.parentElement !== cell) cell.appendChild(enemy.el);
    enemy.el.dataset.cell = String(cellIndex);
    enemy.el.style.setProperty('--cell-progress', (enemy.pos - cellIndex).toFixed(2));
  }

  function renderDefenderElement(defender) {
    if (!defender || !defender.el) return;
    var label = cardLabelFor(defender);
    defender.el.dataset.word = defender.word;
    defender.el.dataset.cardLabel = label;
    defender.el.dataset.matchMode = state.matchMode;
    if (state.matchMode === 'classic') {
      defender.el.removeAttribute('aria-label');
      defender.el.setAttribute('title', defender.word + ' · ' + defender.meaning);
      defender.el.innerHTML =
        '<span class="defender-token__emoji" aria-hidden="true">' + escapeHtml(defender.emoji) + '</span>' +
        '<span class="defender-token__word">' + escapeHtml(defender.word) + '</span>';
    } else {
      defender.el.setAttribute('title', '已放置：' + label);
      defender.el.setAttribute('aria-label', '已放置：' + label);
      defender.el.innerHTML =
        '<span class="defender-token__word">' + escapeHtml(label) + '</span>';
    }
  }

  function createDefenderElement(defender) {
    var cell = getCell(defender.lane, defender.cell);
    if (!cell) return;
    var node = make('div', 'defender-token');
    node.style.setProperty('--word-hue', String(hueFor(defender.word)));
    cell.appendChild(node);
    defender.el = node;
    renderDefenderElement(defender);
  }

  function showShot(defender) {
    var cell = getCell(defender.lane, defender.cell);
    if (!cell) return;
    var shot = make('span', 'shot-token');
    shot.style.setProperty('--word-hue', String(hueFor(defender.word)));
    cell.appendChild(shot);
    later(function () {
      shot.remove();
      cell.classList.remove('is-zapped');
    }, state.reducedMotion ? 80 : 320);
    cell.classList.add('is-zapped');
  }

  function showScorePop(lane, cellIndex, text) {
    var cell = getCell(lane, cellIndex);
    if (!cell) return;
    var pop = make('span', 'score-pop', text);
    cell.appendChild(pop);
    later(function () { pop.remove(); }, state.reducedMotion ? 220 : 750);
  }

  function flashLane(laneIndex) {
    var lane = getLane(laneIndex);
    if (!lane) return;
    lane.classList.add('is-danger');
    later(function () { lane.classList.remove('is-danger'); }, state.reducedMotion ? 180 : 650);
  }

  /* ------------------------------------------------------------------ */
  /* Wave schedule (pure; exported for validation)                       */
  /* ------------------------------------------------------------------ */

  function buildWaveSchedule(unit, rng, pace) {
    var random = typeof rng === 'function' ? rng : Math.random;
    var speed = normalizeGamePace(pace == null ? state.gamePace : pace);
    if (speed == null) speed = GAME_PACE_DEFAULT;
    var queue = [];
    var words = Array.isArray(unit) ? getUnitWords({ words: unit }) : getUnitWords(unit);
    if (!words.length) return queue;

    var pool = [];
    var lastWord = '';
    function drawWord() {
      if (!pool.length) {
        pool = Data.shuffle(words, random);
        if (pool.length > 1 && pool[pool.length - 1].word === lastWord) {
          pool.unshift(pool.pop());
        }
      }
      var picked = pool.pop();
      lastWord = picked.word;
      return picked;
    }

    var t = Math.round(1200 / speed);
    var lastLane = -1;
    var sizes = (CFG.waveSizes || [3, 3, 4, 4]).slice();
    var baseTotal = sizes.reduce(function (total, size) { return total + size; }, 0);
    /* Every word must spawn at least once. The first shuffled cycle covers all
       distinct words, so only wave sizes below the word count need extending. */
    if (words.length > baseTotal) {
      var extra = words.length - baseTotal;
      for (var e = 0; e < extra; e += 1) {
        sizes[e % sizes.length] += 1;
      }
    }
    for (var waveIndex = 0; waveIndex < sizes.length; waveIndex += 1) {
      for (var i = 0; i < sizes[waveIndex]; i += 1) {
        var lane = Math.floor(random() * CFG.lanes);
        if (lane === lastLane && CFG.lanes > 1) {
          lane = (lane + 1 + Math.floor(random() * (CFG.lanes - 1))) % CFG.lanes;
        }
        lastLane = lane;
        var word = drawWord();
        queue.push({
          time: t,
          lane: lane,
          wave: waveIndex + 1,
          word: word.word,
          meaning: word.meaning,
          emoji: word.emoji
        });
        t += Math.round((CFG.spawnGapMs + Math.floor(random() * CFG.spawnJitterMs)) / speed);
      }
      t += Math.round(CFG.waveGapMs / speed);
    }
    return queue;
  }

  /* One battle round: cards and wave schedule share exactly this word pool. */
  function prepareRound(unit, rng, pace) {
    var words = ensureRoundPool(unit, false, rng);
    return {
      words: words,
      schedule: buildWaveSchedule({ words: words }, rng, pace)
    };
  }

  /* ------------------------------------------------------------------ */
  /* Gameplay                                                            */
  /* ------------------------------------------------------------------ */

  /* Enemies spawn on the left and walk right toward the base, so a defender
     covers enemies that have not yet passed its own cell. The closest one is
     first so the most urgent target is handled first. */
  function enemiesInRange(laneIndex, cellIndex) {
    return state.enemies.filter(function (enemy) {
      return enemy.lane === laneIndex && enemy.pos <= cellIndex + 0.7;
    }).sort(function (a, b) { return b.pos - a.pos; });
  }

  function hasDefender(laneIndex, cellIndex) {
    return state.defenders.some(function (defender) {
      return defender.lane === laneIndex && defender.cell === cellIndex;
    });
  }

  function applyMismatch(defender, target) {
    state.score = Math.max(0, state.score - CFG.mismatchPenalty);
    state.combo = 0;
    defender.stunnedUntil = now() + 1300;
    if (defender.el) defender.el.classList.add('is-stunned');
    later(function () {
      if (defender.el) defender.el.classList.remove('is-stunned');
    }, 1300);
    if (state.matchMode === 'classic') {
      setStatus('❌ “' + defender.word + '” 挡不住 “' + target.word + '”，-' +
        CFG.mismatchPenalty + ' 分。换一张卡片试试！');
    } else {
      setStatus('❌ 这张卡片和 “' + enemyClueFor(target) + '” 对不上，-' +
        CFG.mismatchPenalty + ' 分。换一张卡片试试！');
    }
    toast(state.matchMode === 'classic'
      ? '单词不匹配，-' + CFG.mismatchPenalty + ' 分'
      : '配对不正确，-' + CFG.mismatchPenalty + ' 分', 'error');
    beep(170, 170);
    renderHud();
  }

  function placeDefender(laneIndex, cellIndex) {
    if (!state.running) { setStatus('先点“开始游戏”吧！'); return; }
    if (!getCell(laneIndex, cellIndex)) return;
    if (!state.selectedWord) {
      if (state.matchMode === 'classic') {
        setStatus('先点一张单词卡片，再点格子。');
        toast('先选一张单词卡片', 'info');
      } else {
        setStatus('先点一张卡片，再点格子。');
        toast('先选一张卡片', 'info');
      }
      return;
    }
    var card = findCard(state.selectedWord);
    if (!card) return;
    if (card.cooldownUntil > now()) {
      toast('这张卡片还在休息，再等一小会儿。', 'info');
      return;
    }
    if (hasDefender(laneIndex, cellIndex)) {
      toast('这个格子已经有守卫啦。', 'info');
      return;
    }

    var defender = {
      id: ++state.uid,
      lane: laneIndex,
      cell: cellIndex,
      word: card.word,
      meaning: card.meaning,
      emoji: card.emoji,
      cooldown: 260,
      stunnedUntil: 0,
      el: null
    };
    state.defenders.push(defender);
    createDefenderElement(defender);

    var ahead = enemiesInRange(laneIndex, cellIndex);
    var matched = null;
    for (var i = 0; i < ahead.length; i += 1) {
      if (ahead[i].word === defender.word) { matched = ahead[i]; break; }
    }

    if (ahead.length && !matched) {
      applyMismatch(defender, ahead[0]);
    } else if (matched) {
      beep(880, 90);
      if (state.matchMode === 'classic') {
        setStatus('✅ “' + defender.word + '” 对上了 ' + matched.emoji + ' ' + matched.word + '！');
      } else {
        setStatus('✅ 配对成功：“' + cardLabelFor(card) + '” ↔ “' +
          enemyClueFor(matched) + '”！');
      }
      showScorePop(laneIndex, cellIndex, '✓');
    } else {
      beep(520, 60);
      setStatus('守卫已就位，等敌人出现吧！');
    }

    card.cooldownUntil = now() + CFG.cardCooldownMs;
    state.selectedWord = null;
    updateCardStates();
    renderHud();
  }

  function spawnEnemy(event) {
    var enemy = {
      id: ++state.uid,
      lane: event.lane,
      pos: 0,
      word: event.word,
      meaning: event.meaning,
      emoji: event.emoji,
      wave: event.wave,
      el: null
    };
    state.enemies.push(enemy);
    state.wave = Math.max(state.wave, event.wave || 1);
    syncEnemyElement(enemy);
    if (state.matchMode === 'zh-to-en') {
      setStatus('新的单词敌人：' + enemy.meaning + '，快找对应的英语卡片！');
    } else if (state.matchMode === 'en-to-zh') {
      setStatus('新的单词敌人：' + enemy.word + '，快找对应的中文卡片！');
    } else {
      setStatus('新的单词敌人：' + enemy.word + '，快找它的图片卡片！');
    }
    beep(330, 60);
    emit('english-kids:spawn', {
      word: enemy.word,
      lane: enemy.lane,
      wave: enemy.wave
    });
  }

  function killEnemy(enemy, defender) {
    var index = state.enemies.indexOf(enemy);
    if (index < 0) return;
    state.enemies.splice(index, 1);
    if (enemy.el) enemy.el.remove();

    state.combo += 1;
    var gain = CFG.killScore + Math.min(10, (state.combo - 1) * 2);
    state.score += gain;
    state.kills += 1;
    state.learned.add(enemy.word);
    showScorePop(enemy.lane, Math.floor(enemy.pos), '+' + gain);
    if (state.matchMode === 'classic') {
      setStatus('✅ “' + enemy.word + '” 被挡住了！+' + gain + ' 分');
    } else {
      setStatus('✅ “' + enemyClueFor(enemy) + '” 被挡住了！+' + gain + ' 分');
    }
    if (state.combo > 0 && state.combo % 3 === 0) {
      toast('🔥 连续挡住 ' + state.combo + ' 个单词敌人！', 'success');
    }
    beep(920, 90);
    renderHud();
    emit('english-kids:kill', {
      word: enemy.word,
      lane: enemy.lane,
      cell: Math.floor(enemy.pos),
      gain: gain,
      by: defender ? defender.word : null
    });
  }

  function leakEnemy(enemy) {
    var index = state.enemies.indexOf(enemy);
    if (index < 0) return;
    state.enemies.splice(index, 1);
    if (enemy.el) enemy.el.remove();
    state.lives -= 1;
    state.combo = 0;
    flashLane(enemy.lane);
    beep(150, 240);
    if (state.matchMode === 'classic') {
      setStatus('😟 “' + enemy.word + '” 到达基地，生命 -1。');
    } else {
      setStatus('😟 “' + enemyClueFor(enemy) + '” 到达基地，生命 -1。');
    }
    toast('敌人突破防线，生命 -1', 'error');
    renderHud();
    emit('english-kids:leak', { word: enemy.word, lane: enemy.lane, lives: state.lives });
    if (state.lives <= 0) finishGame(false);
  }

  function fireAt(defender, target) {
    showShot(defender);
    killEnemy(target, defender);
  }

  /* Enemy travel speed in cells per second for a pace multiplier. */
  function enemySpeedFor(pace) {
    var speed = normalizeGamePace(pace == null ? state.roundPace : pace);
    if (speed == null) speed = GAME_PACE_DEFAULT;
    return CFG.enemySpeed * speed;
  }

  function updateEnemies(dt) {
    var step = enemySpeedFor(state.roundPace) * dt;
    for (var i = state.enemies.length - 1; i >= 0; i -= 1) {
      var enemy = state.enemies[i];
      enemy.pos += step;
      if (enemy.pos >= CFG.cellsPerLane) {
        leakEnemy(enemy);
        if (!state.running) return;
        continue;
      }
      syncEnemyElement(enemy);
    }
  }

  function updateDefenders(dt, timestamp) {
    var elapsedMs = dt * 1000;
    for (var i = 0; i < state.defenders.length; i += 1) {
      var defender = state.defenders[i];
      if (timestamp < defender.stunnedUntil) continue;

      var ahead = enemiesInRange(defender.lane, defender.cell);
      var target = null;
      for (var j = 0; j < ahead.length; j += 1) {
        if (ahead[j].word === defender.word) { target = ahead[j]; break; }
      }

      if (!target) {
        if (defender.el) defender.el.classList.toggle('is-mismatch', ahead.length > 0);
        continue;
      }
      if (defender.el) defender.el.classList.remove('is-mismatch');

      defender.cooldown -= elapsedMs;
      if (defender.cooldown <= 0) {
        defender.cooldown = CFG.fireIntervalMs;
        fireAt(defender, target);
      }
    }
  }

  function checkWin() {
    if (!state.running) return;
    if (state.spawnIndex >= state.spawnQueue.length && state.enemies.length === 0) {
      finishGame(true);
    }
  }

  /* ------------------------------------------------------------------ */
  /* HUD + result                                                        */
  /* ------------------------------------------------------------------ */

  function updateHintButton() {
    $$("[data-action='use-hint']").forEach(function (btn) {
      btn.dataset.hints = String(state.hintsLeft);
      btn.setAttribute('aria-label', '使用提示，还剩 ' + state.hintsLeft + ' 次');
      btn.classList.toggle('is-empty', state.hintsLeft <= 0);
      var count = btn.querySelector('[data-hint-count]');
      if (count) count.textContent = String(state.hintsLeft);
    });
  }

  function renderHud() {
    var total = CFG.startingLives;
    var full = clamp(state.lives, 0, total);
    var hearts = '';
    for (var i = 0; i < total; i += 1) hearts += i < full ? '❤️' : '🤍';

    setText('#score-label', '得分 ' + state.score);
    setText('#wave-label', '波次 ' + state.wave + '/' + state.totalWaves);
    setText('#lives-label', '生命 ' + hearts);
    setText('#hud-score', String(state.score));
    setText('#hud-wave', state.wave + ' / ' + state.totalWaves);
    setText('#hud-hearts', hearts);

    var scoreNode = $('#score-label');
    if (scoreNode) scoreNode.dataset.value = String(state.score);
    var waveNode = $('#wave-label');
    if (waveNode) waveNode.dataset.value = String(state.wave);
    var livesNode = $('#lives-label');
    if (livesNode) livesNode.dataset.value = String(state.lives);
  }

  function renderResult(won, bonus) {
    var learned = Array.from(state.learned);
    var stars = won
      ? (state.lives >= 3 ? '⭐⭐⭐' : (state.lives >= 2 ? '⭐⭐' : '⭐'))
      : '⭐';
    var title = won ? '🎉 守住了！' : '💪 再来一次吧！';
    var message = won
      ? '你挡住了所有单词敌人，得分 ' + state.score + ' 分' +
        (bonus ? '（生命与提示奖励 +' + bonus + '）' : '') + '。'
      : '基地的心用完了。你已经认识 ' + learned.length + ' 个单词，再试一次一定行！';

    setText('#result-title', title);
    setText('#result-score', String(state.score));
    setText('#result-message', message);
    setText('#result-stars', stars);
    setText('#result-emoji', won ? '🎉' : '💪');
    setText('#result-correct', state.kills + ' / ' + Math.max(state.kills, state.spawnIndex));
    $$('#screen-result [data-result="title"]').forEach(function (node) { node.textContent = title; });
    $$('#screen-result [data-result="score"]').forEach(function (node) { node.textContent = '得分 ' + state.score; });
    $$('#screen-result [data-result="message"]').forEach(function (node) { node.textContent = message; });
    $$('#screen-result [data-result="stars"]').forEach(function (node) { node.textContent = stars; });

    var screen = $('#screen-result');
    if (screen) {
      screen.dataset.result = won ? 'win' : 'lose';
      var hasDedicated = !!($('#result-title') || $('#result-score') || $('#result-message'));
      if (!hasDedicated) {
        var old = screen.querySelector('.result-summary');
        if (old) old.remove();
        var panel = make('div', 'result-summary');
        var chips = learned.map(function (word) {
          return '<span class="word-chip">' + escapeHtml(word) + '</span>';
        }).join('');
        panel.innerHTML =
          '<div class="result-summary__stars" aria-hidden="true">' + escapeHtml(stars) + '</div>' +
          '<h2 class="result-summary__title">' + escapeHtml(title) + '</h2>' +
          '<p class="result-summary__message">' + escapeHtml(message) + '</p>' +
          (chips ? '<div class="result-summary__words">' + chips + '</div>' : '');
        screen.insertBefore(panel, screen.firstChild);
      }
      ensureResultControls();
    }
    updateCardStates();
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  function startLoop() {
    stopLoop();
    state.lastFrame = now();
    state.loopId = root.setInterval(tick, 100);
  }

  function stopLoop() {
    if (state.loopId != null) {
      root.clearInterval(state.loopId);
      state.loopId = null;
    }
  }

  function pauseGame() {
    if (!state.running || state.finished) return;
    state.paused = true;
    var modal = root.document ? root.document.getElementById('modal-pause') : null;
    if (modal) modal.hidden = false;
    setStatus('游戏已暂停，点“继续游戏”回来。');
  }

  function resumeGame() {
    if (!state.running || state.finished) return;
    state.paused = false;
    state.lastFrame = now();
    var modal = root.document ? root.document.getElementById('modal-pause') : null;
    if (modal) modal.hidden = true;
    setStatus('继续守卫基地！');
  }

  function tick() {
    if (!state.running) return;
    var timestamp = now();
    var dt = (timestamp - state.lastFrame) / 1000;
    state.lastFrame = timestamp;
    if (root.document && root.document.hidden) return;
    if (state.paused) return;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.25);
    state.elapsed += dt * 1000;

    while (state.spawnIndex < state.spawnQueue.length &&
           state.elapsed >= state.spawnQueue[state.spawnIndex].time) {
      var next = state.spawnQueue[state.spawnIndex];
      state.spawnIndex += 1;
      spawnEnemy(next);
    }

    updateEnemies(dt);
    if (!state.running) return;
    updateDefenders(dt, timestamp);
    updateCardTimers(timestamp);
    renderHud();
    checkWin();
  }

  function stopGame() {
    state.running = false;
    state.paused = false;
    state.selectedWord = null;
    stopLoop();
    clearLater();
    clearHighlights();
    clearTokens();
    state.enemies = [];
    state.defenders = [];
    state.spawnQueue = [];
    state.spawnIndex = 0;
    state.cards.forEach(function (card) {
      if (card.el) card.el.remove();
    });
    state.cards = [];
    state.activeWords = [];
    var tray = $('#card-tray');
    if (tray) {
      Array.prototype.slice.call(tray.querySelectorAll('.game-card, .word-card')).forEach(function (node) {
        node.remove();
      });
    }
  }

  function startGame(unitId) {
    var unit = Data.getUnit(unitId);
    if (!unit && state.unit) unit = Data.getUnit(state.unit.id);
    if (!unit) {
      setStatus(Data.hasVocabulary()
        ? '请先选择一个单元，再开始游戏。'
        : '单词表待导入，暂时不能开始游戏。请先导入单元和单词。');
      toast(Data.hasVocabulary() ? '请先选择一个单元' : '还没有可用的单词表', 'info');
      return;
    }
    if (Data.getWordCount(unit) === 0) {
      setStatus('这个单元还没有单词，等词表导入后再来玩吧。');
      toast('这个单元还没有单词', 'info');
      return;
    }
    var round = prepareRound(unit, null, state.gamePace);
    if (!round.words.length || !round.schedule.length) {
      setStatus('这个单元还没有可玩的单词，等词表导入后再试。');
      toast('没有可玩的单词', 'info');
      return;
    }

    stopGame();
    state.unit = unit;
    state.unitId = unit.id;
    state.lastUnitId = unit.id;
    state.roundPace = state.gamePace;
    state.running = true;
    state.paused = false;
    state.finished = false;
    state.score = 0;
    state.lives = CFG.startingLives;
    state.wave = 1;
    state.totalWaves = CFG.totalWaves;
    state.elapsed = 0;
    state.spawnQueue = round.schedule;
    state.spawnIndex = 0;
    state.combo = 0;
    state.kills = 0;
    state.learned = new Set();
    state.hintsLeft = CFG.hints;
    state.activeWords = round.words;

    ensureBoard();
    clearTokens();
    applyMatchModeUi();
    buildCards(round.words);
    updateHintButton();
    renderHud();
    showScreen('screen-game');
    setStatus(matchModeInstruction());
    beep(660, 90);
    startLoop();
    emit('english-kids:start', {
      unitId: unit.id,
      roundSize: state.roundSize,
      wordCount: round.words.length,
      matchMode: state.matchMode,
      pace: state.roundPace
    });
  }

  function finishGame(won) {
    if (state.finished) return;
    state.finished = true;
    state.running = false;
    state.paused = false;
    stopLoop();

    var bonus = 0;
    if (won) {
      bonus = state.lives * CFG.lifeBonus + state.hintsLeft * CFG.hintBonus;
      state.score += bonus;
    }
    clearLater();
    renderHud();
    renderResult(won, bonus);
    showScreen('screen-result');
    setStatus(won ? '🎉 胜利！你守住了基地！' : '💪 游戏结束，再试一次吧！');
    beep(won ? 1040 : 160, won ? 280 : 420);
    emit('english-kids:finish', {
      won: won,
      score: state.score,
      bonus: bonus,
      matchMode: state.matchMode
    });
  }

  function goHome() {
    stopGame();
    showScreen('screen-home');
    renderHome();
    updateSoundButton();
    setStatus(contentStatusMessage());
    emit('english-kids:home', {});
  }

  function useHint() {
    if (!state.running) { setStatus('开始游戏后才能用提示哦。'); return; }
    if (state.hintsLeft <= 0) {
      toast('提示用完了，试着自己记住单词吧！', 'info');
      return;
    }
    if (!state.enemies.length) {
      toast('现在没有敌人，先放好守卫吧！', 'info');
      return;
    }

    var target = state.enemies.slice().sort(function (a, b) { return b.pos - a.pos; })[0];
    var card = findCard(target.word);
    clearHighlights();

    if (target.el) {
      target.el.classList.add('is-hinted');
    }
    var cell = getCell(target.lane, Math.floor(target.pos));
    if (cell) cell.classList.add('is-hinted');
    if (card && card.el) card.el.classList.add('is-hinted');
    var cardCooling = !!(card && card.cooldownUntil > now());

    state.hintsLeft -= 1;
    updateHintButton();
    if (state.matchMode === 'zh-to-en') {
      setStatus('💡 第 ' + (target.lane + 1) + ' 行需要一张表示 “' +
        target.meaning + '” 的英语卡片！' +
        (cardCooling ? ' 卡片正在冷却，稍等一下。' : '') +
        ' 提示还剩 ' + state.hintsLeft + ' 次。');
      toast('💡 第 ' + (target.lane + 1) + ' 行需要表示 “' + target.meaning +
        '” 的英语卡片', 'info');
    } else if (state.matchMode === 'en-to-zh') {
      setStatus('💡 第 ' + (target.lane + 1) + ' 行需要 “' +
        target.word + '” 的中文卡片！' +
        (cardCooling ? ' 卡片正在冷却，稍等一下。' : '') +
        ' 提示还剩 ' + state.hintsLeft + ' 次。');
      toast('💡 第 ' + (target.lane + 1) + ' 行需要 “' + target.word +
        '” 的中文卡片', 'info');
      speak(target.word);
    } else {
      setStatus('💡 第 ' + (target.lane + 1) + ' 行需要 “' + target.word + '”（' +
        target.meaning + '）的图片卡片！' +
        (cardCooling ? ' 卡片正在冷却，稍等一下。' : '') +
        ' 提示还剩 ' + state.hintsLeft + ' 次。');
      toast('💡 第 ' + (target.lane + 1) + ' 行需要 “' + target.word + '” 的图片卡片', 'info');
      speak(target.word);
    }
    beep(820, 70);

    later(clearHighlights, state.reducedMotion ? 700 : 2400);
    emit('english-kids:hint', {
      word: target.word,
      lane: target.lane,
      hintsLeft: state.hintsLeft,
      matchMode: state.matchMode
    });
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  function handleClick(event) {
    var target = event.target;
    if (!target || !target.closest) return;

    var actionEl = target.closest('[data-action]');
    if (actionEl) {
      var action = actionEl.dataset.action;
      event.preventDefault();
      if (action === 'drop-target') {
        var dropCell = closestCell(target);
        if (dropCell) {
          placeDefender(Number(dropCell.dataset.lane), Number(dropCell.dataset.cell));
        } else {
          var laneIndex = Number(actionEl.dataset.lane);
          var laneCells = cellsByLane[laneIndex] || [];
          for (var c = 0; c < laneCells.length; c += 1) {
            if (!hasDefender(laneIndex, c)) {
              placeDefender(laneIndex, c);
              break;
            }
          }
        }
      } else if (action === 'select-card') {
        var cardWord = actionEl.dataset.cardWord || actionEl.dataset.word;
        if (cardWord) selectCard(cardWord);
      } else if (action === 'pause') {
        pauseGame();
      } else if (action === 'resume') {
        resumeGame();
      } else if (action === 'show-preview') {
        var previewUnitId = actionEl.dataset.unitId || actionEl.dataset.unit || state.unitId;
        if (!previewUnitId && state.bookId) {
          var firstPreviewUnit = Data.getFirstPlayableUnit(state.bookId);
          if (firstPreviewUnit) previewUnitId = firstPreviewUnit.id;
        }
        openPreview(previewUnitId);
      } else if (action === 'start') {
        openUnitsScreen();
      } else if (action === 'select-grade') {
        selectGrade(actionEl.dataset.gradeId || actionEl.dataset.grade);
      } else if (action === 'select-book') {
        selectBook(actionEl.dataset.bookId || actionEl.dataset.book);
      } else if (action === 'select-unit') {
        openPreview(actionEl.dataset.unitId || actionEl.dataset.unit || state.unitId);
      } else if (action === 'select-round-size') {
        selectRoundSize(actionEl.dataset.roundSize || actionEl.dataset.size);
      } else if (action === 'select-match-mode') {
        selectMatchMode(actionEl.dataset.matchMode || actionEl.dataset.mode);
      } else if (action === 'start-game') {
        var startUnitId = actionEl.dataset.unitId || state.unitId;
        if (!startUnitId && state.bookId) {
          var firstStartUnit = Data.getFirstPlayableUnit(state.bookId);
          if (firstStartUnit) startUnitId = firstStartUnit.id;
        }
        startGame(startUnitId);
      } else if (action === 'back-home' || action === 'quit-home') {
        goHome();
      } else if (action === 'back-units') {
        openUnitsScreen();
      } else if (action === 'play-again' || action === 'retry' || action === 'restart') {
        startGame(state.lastUnitId || state.unitId);
      } else if (action === 'next-unit') {
        openNextUnit();
      } else if (action === 'play-word') {
        if (actionEl.dataset.word) speak(actionEl.dataset.word);
      } else if (action === 'use-hint') {
        useHint();
      } else if (action === 'toggle-sound') {
        toggleSound();
      }
      return;
    }

    var unitEl = target.closest('#unit-list [data-unit-id], #unit-grid [data-unit-id]');
    if (unitEl) { openPreview(unitEl.dataset.unitId); return; }

    var cardEl = target.closest('#card-tray [data-card-word]');
    if (cardEl) { selectCard(cardEl.dataset.cardWord); return; }

    var previewEl = target.closest('#preview-list [data-word], #round-word-preview-list [data-word]');
    if (previewEl) {
      speak(previewEl.dataset.word);
      setStatus('🔈 跟读：“' + previewEl.dataset.word + '”');
      return;
    }

    var cellEl = closestCell(target);
    if (cellEl) {
      placeDefender(Number(cellEl.dataset.lane), Number(cellEl.dataset.cell));
    }
  }

  function handleKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    var target = event.target;
    var cellEl = closestCell(target);
    if (!cellEl) return;
    event.preventDefault();
    placeDefender(Number(cellEl.dataset.lane), Number(cellEl.dataset.cell));
  }

  function handleDragStart(event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var cardEl = target.closest('#card-tray [data-card-word]');
    if (!cardEl) return;
    if (!state.running) { event.preventDefault(); return; }
    var card = findCard(cardEl.dataset.cardWord);
    if (!card || card.cooldownUntil > now()) { event.preventDefault(); return; }
    state.selectedWord = card.word;
    updateCardStates();
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', card.word);
      event.dataTransfer.effectAllowed = 'copy';
    }
  }

  function handleDragOver(event) {
    if (closestCell(event.target)) event.preventDefault();
  }

  function handleDrop(event) {
    var cellEl = closestCell(event.target);
    if (!cellEl) return;
    event.preventDefault();
    placeDefender(Number(cellEl.dataset.lane), Number(cellEl.dataset.cell));
  }

  function bindEvents() {
    if (state.eventsBound) return;
    state.eventsBound = true;
    root.document.addEventListener('click', handleClick);
    root.document.addEventListener('keydown', handleKeydown);
    root.document.addEventListener('dragstart', handleDragStart);
    root.document.addEventListener('dragover', handleDragOver);
    root.document.addEventListener('drop', handleDrop);
    root.document.addEventListener('input', handleGamePaceInput);
    root.document.addEventListener('change', handleGamePaceInput);
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */

  function init() {
    if (state.initialized || !root.document) return;
    state.initialized = true;
    loadRoundSize();
    loadMatchMode();
    loadGamePace();
    state.speechAvailable = !!(root.speechSynthesis &&
      typeof root.SpeechSynthesisUtterance === 'function');

    var mq = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
    state.reducedMotion = !!(mq && mq.matches);
    if (mq) {
      if (mq.addEventListener) {
        mq.addEventListener('change', function (event) {
          state.reducedMotion = !!event.matches;
        });
      } else if (mq.addListener) {
        mq.addListener(function (event) {
          state.reducedMotion = !!event.matches;
        });
      }
    }

    ensureBoard();
    bindEvents();
    renderHome();
    updateRoundSizeControls();
    updateMatchModeControls();
    updateGamePaceControls();
    updateSoundButton();
    updateHintButton();
    renderHud();
    if (!root.document.querySelector('.screen.is-active') &&
        root.document.getElementById('screen-home')) {
      showScreen('screen-home');
    }
    setStatus(contentStatusMessage());
    emit('english-kids:ready', { speech: state.speechAvailable, hasVocabulary: Data.hasVocabulary() });
  }

  var api = {
    state: state,
    config: CFG,
    init: init,
    startGame: startGame,
    openPreview: openPreview,
    selectGrade: selectGrade,
    selectBook: selectBook,
    renderHome: renderHome,
    goHome: goHome,
    useHint: useHint,
    toggleSound: toggleSound,
    showScreen: showScreen,
    buildWaveSchedule: buildWaveSchedule,
    prepareRound: prepareRound,
    enemySpeedFor: enemySpeedFor,
    renderRoundWordPreview: renderRoundWordPreview,
    selectRoundSize: selectRoundSize,
    selectMatchMode: selectMatchMode,
    selectGamePace: selectGamePace,
    loadGamePace: loadGamePace,
    normalizeGamePace: normalizeGamePace,
    cardLabelFor: cardLabelFor,
    enemyClueFor: enemyClueFor,
    hueFor: hueFor,
    getState: function () {
      return {
        screen: state.screen,
        running: state.running,
        paused: state.paused,
        finished: state.finished,
        gradeId: state.gradeId,
        bookId: state.bookId,
        unitId: state.unitId,
        wordCount: state.unit ? Data.getWordCount(state.unit) : 0,
        roundSize: state.roundSize,
        matchMode: state.matchMode,
        gamePace: state.gamePace,
        roundPace: state.roundPace,
        roundWordCount: state.activeWords.length,
        roundWords: state.activeWords.map(function (word) { return word.word; }),
        contentEmpty: !Data.hasVocabulary(),
        score: state.score,
        lives: state.lives,
        wave: state.wave,
        totalWaves: state.totalWaves,
        enemies: state.enemies.map(function (enemy) {
          return { word: enemy.word, lane: enemy.lane, pos: enemy.pos, wave: enemy.wave };
        }),
        defenders: state.defenders.map(function (defender) {
          return { word: defender.word, lane: defender.lane, cell: defender.cell };
        }),
        selectedWord: state.selectedWord,
        hintsLeft: state.hintsLeft,
        soundOn: state.soundOn,
        learned: Array.from(state.learned),
        kills: state.kills
      };
    }
  };

  root.EnglishKidsGame = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
