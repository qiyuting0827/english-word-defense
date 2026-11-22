/* English Kids — 鲁教版五四制 grades 3–5.
   Vocabulary is imported from the user-provided workbook
   "五四学制英语_单词表汇总.xlsx" via the generated vocabulary.js file.
   Coverage: 5 books / 33 units / 721 rows. The workbook has no grade-5-lower
   volume, so that book is intentionally empty. Emoji are automatically derived
   placeholders, not textbook illustrations.

   Required script order: vocabulary.js -> data.js -> game.js. */
(function (root) {
  'use strict';

  /** @typedef {{word:string, meaning:string, emoji:string}} Word */
  /** @typedef {{id:string, title:string, subtitle?:string, emoji?:string, hue?:number, bookId?:string, grade?:number, words:Word[]}} Unit */
  /** @typedef {{id:string, gradeId:string, grade:number, semester:'upper'|'lower', label:string, title:string, sourceLabel?:string|null, note?:string|null, units:Unit[]}} Book */
  /** @typedef {{id:string, grade:number, label:string, books:Book[]}} GradeLevel */

  var SCHEMA_VERSION = 2;

  /* Browser order is vocabulary.js -> data.js. The Node fallback keeps tests
     and tooling simple without changing the browser contract. */
  if (!root.EnglishKidsWordLists && typeof require === 'function') {
    try { root.EnglishKidsWordLists = require('./vocabulary.js'); } catch (err) {}
  }

  var CURRICULUM = {
    id: 'lujiao-wusi',
    label: '鲁教版五四制',
    grades: [3, 4, 5],
    workbookSheet: '按单元',
    workbookVocabularyIncluded: false,
    emojiArtwork: false
  };

  /* Six book placeholders. Real units are attached below from vocabulary.js. */
  var GRADE_LEVELS = [
    {
      id: 'grade-3',
      grade: 3,
      label: '三年级',
      books: [
        { id: 'grade-3-upper', gradeId: 'grade-3', grade: 3, semester: 'upper', label: '上册', title: '三年级上册', sourceLabel: null, note: null, units: [] },
        { id: 'grade-3-lower', gradeId: 'grade-3', grade: 3, semester: 'lower', label: '下册', title: '三年级下册', sourceLabel: null, note: null, units: [] }
      ]
    },
    {
      id: 'grade-4',
      grade: 4,
      label: '四年级',
      books: [
        { id: 'grade-4-upper', gradeId: 'grade-4', grade: 4, semester: 'upper', label: '上册', title: '四年级上册', sourceLabel: null, note: null, units: [] },
        { id: 'grade-4-lower', gradeId: 'grade-4', grade: 4, semester: 'lower', label: '下册', title: '四年级下册', sourceLabel: null, note: null, units: [] }
      ]
    },
    {
      id: 'grade-5',
      grade: 5,
      label: '五年级',
      books: [
        { id: 'grade-5-upper', gradeId: 'grade-5', grade: 5, semester: 'upper', label: '上册', title: '五年级上册', sourceLabel: null, note: null, units: [] },
        { id: 'grade-5-lower', gradeId: 'grade-5', grade: 5, semester: 'lower', label: '下册', title: '五年级下册', sourceLabel: null, note: null, units: [] }
      ]
    }
  ];

  /* ------------------------------------------------------------------ */
  /* Derived emoji placeholders (not authored textbook illustrations)    */
  /* ------------------------------------------------------------------ */

  var EMOJI_EXACT = {
    '一': '1️⃣', '二': '2️⃣', '三': '3️⃣', '四': '4️⃣', '五': '5️⃣',
    '六': '6️⃣', '七': '7️⃣', '八': '8️⃣', '九': '9️⃣', '十': '🔟',
    '十一': '1️⃣1️⃣', '十二': '1️⃣2️⃣', '十三': '1️⃣3️⃣', '十四': '1️⃣4️⃣', '十五': '1️⃣5️⃣',
    '二十': '2️⃣0️⃣', '三十': '3️⃣0️⃣', '四十': '4️⃣0️⃣', '五十': '5️⃣0️⃣', '百': '💯',
    '第一（的）': '🥇', '第二（的）': '🥈', '第三（的）': '🥉', '第四': '4️⃣',
    '一月': '❄️', '二月': '🧧', '三月': '🌷', '四月': '🌱', '五月': '🌸', '六月': '☀️',
    '七月': '🏖️', '八月': '🌊', '九月': '🍂', '十月': '🎃', '十一月': '🍁', '十二月': '🎄',
    '父（母）亲': '👨‍👩‍👧', '（外）祖父、母': '👴'
  };

  /* Longest keys are tested first so 书包/书桌/图书馆 beat plain 书. */
  var EMOJI_KEYWORDS = [
    ['苹果', '🍎'], ['香蕉', '🍌'], ['橙', '🍊'], ['柑橘', '🍊'], ['梨', '🍐'], ['葡萄', '🍇'],
    ['西瓜', '🍉'], ['草莓', '🍓'], ['桃', '🍑'], ['水果', '🍎'], ['果汁', '🧃'], ['汁', '🧃'],
    ['牛奶', '🥛'], ['奶', '🥛'], ['咖啡', '☕'], ['茶', '🍵'], ['水', '💧'], ['饮料', '🥤'],
    ['面包', '🍞'], ['蛋糕', '🍰'], ['糕饼', '🍰'], ['蛋', '🥚'], ['鸡蛋', '🥚'], ['米饭', '🍚'],
    ['大米', '🍚'], ['面条', '🍜'], ['汤', '🍲'], ['沙拉', '🥗'], ['比萨', '🍕'], ['派', '🥧'],
    ['蔬菜', '🥬'], ['西红柿', '🍅'], ['土豆', '🥔'], ['黄瓜', '🥒'], ['卷心菜', '🥬'], ['甘蓝', '🥬'],
    ['豆腐', '🧈'], ['牛肉', '🥩'], ['肉类', '🥩'], ['鸡肉', '🍗'], ['鸡', '🐔'], ['鱼', '🐟'],
    ['食物', '🍽️'], ['食品', '🍽️'], ['早餐', '🥣'], ['午餐', '🍱'], ['晚饭', '🍽️'], ['晚餐', '🍽️'],
    ['正餐', '🍽️'], ['菜肴', '🍽️'], ['咖啡', '☕'], ['糖果', '🍬'], ['冰淇淋', '🍦'],

    ['猫', '🐱'], ['狗', '🐶'], ['小狗', '🐶'], ['幼犬', '🐶'], ['汪汪', '🐶'], ['鸟', '🐦'],
    ['鸭子', '🦆'], ['兔子', '🐰'], ['青蛙', '🐸'], ['熊', '🐻'], ['狮子', '🦁'], ['老虎', '🐯'],
    ['大象', '🐘'], ['猴子', '🐒'], ['熊猫', '🐼'], ['马', '🐴'], ['赛马', '🏇'], ['奶牛', '🐄'],
    ['牛', '🐄'], ['动物', '🐾'], ['尾巴', '🐾'], ['翅膀', '🪽'],

    ['祖父', '👴'], ['祖母', '👵'], ['妈妈', '👩'], ['母亲', '👩'], ['爸爸', '👨'], ['父亲', '👨'],
    ['兄', '👦'], ['弟', '👦'], ['姐', '👧'], ['妹', '👧'], ['宝贝', '👶'], ['婴儿', '👶'],
    ['家庭', '👨‍👩‍👧'], ['家', '🏠'], ['亲戚', '👥'], ['亲属', '👥'], ['朋友', '🧑‍🤝‍🧑'],
    ['人们', '👥'], ['男人', '👨'], ['女人', '👩'], ['男孩', '👦'], ['女孩', '👧'], ['儿童', '🧒'],
    ['同班同学', '🧑‍🎓'], ['学生', '🧑‍🎓'], ['老师', '👩‍🏫'], ['教师', '👩‍🏫'], ['医生', '👨‍⚕️'],
    ['护士', '👩‍⚕️'], ['厨师', '👨‍🍳'], ['司机', '🚗'], ['警察', '👮'], ['农民', '👨‍🌾'],
    ['园丁', '🌱'], ['艺术家', '🎨'], ['商人', '💼'], ['企业家', '💼'], ['科学家', '🔬'],
    ['志愿者', '🙋'], ['舞者', '💃'], ['演员', '🎭'], ['青少年', '🧑'],

    ['头', '👤'], ['头发', '💇'], ['身体', '🧍'], ['胳膊', '💪'], ['腿', '🦵'], ['脚', '🦶'],
    ['鼻子', '👃'], ['眼睛', '👁️'], ['嘴', '👄'], ['脸', '🙂'], ['耳朵', '👂'], ['手', '✋'],
    ['心', '❤️'], ['翅膀', '🪽'],

    ['衣服', '👕'], ['服装', '👕'], ['毛衣', '🧥'], ['帽子', '🧢'], ['连衣裙', '👗'], ['恤衫', '👕'],
    ['女裙', '👗'], ['半身裙', '👗'], ['外套', '🧥'], ['衬衫', '👔'], ['裤子', '👖'], ['夹克', '🧥'],
    ['短袜', '🧦'], ['袜', '🧦'], ['鞋', '👟'], ['旗袍', '👘'],

    ['学校', '🏫'], ['教室', '🏫'], ['操场', '🏟️'], ['实验室', '🧪'], ['图书馆', '📚'], ['图书室', '📚'],
    ['办公室', '🏢'], ['书桌', '🪑'], ['桌子', '🪑'], ['椅子', '🪑'], ['书包', '🎒'], ['铅笔盒', '🧰'],
    ['钢笔', '🖊️'], ['铅笔', '✏️'], ['橡皮', '🧽'], ['尺子', '📏'], ['书', '📖'], ['彩色铅笔', '🖍️'],
    ['蜡笔', '🖍️'], ['粉笔', '🖍️'], ['卡片', '🎴'], ['电子卡片', '💳'], ['图片', '🖼️'], ['照片', '🖼️'],
    ['纸', '📄'], ['作业', '📝'], ['故事', '📖'], ['信', '✉️'], ['函', '✉️'], ['电子邮件', '📧'],

    ['卧室', '🛏️'], ['床', '🛏️'], ['客厅', '🛋️'], ['厨房', '🍳'], ['浴室', '🛁'], ['卫生间', '🛁'],
    ['饭厅', '🍽️'], ['餐厅', '🍽️'], ['门', '🚪'], ['窗户', '🪟'], ['房间', '🚪'], ['花园', '🌷'],
    ['公园', '🌳'], ['房子', '🏠'], ['村庄', '🏘️'], ['乡村', '🏡'], ['果园', '🍎'], ['田', '🌾'],
    ['土地', '🌱'], ['河', '🏞️'], ['大海', '🌊'], ['海洋', '🌊'], ['天空', '🌤️'], ['城市', '🏙️'],
    ['博物馆', '🏛️'], ['超市', '🛒'], ['电影院', '🎬'], ['体育场', '🏟️'], ['医院', '🏥'],
    ['警察局', '🚓'], ['宾馆', '🏨'], ['站', '🚉'], ['局', '🏢'],

    ['足球', '⚽'], ['篮球', '🏀'], ['排球', '🏐'], ['乒乓球', '🏓'], ['球门', '🥅'], ['球', '⚽'],
    ['跳绳', '🤸'], ['游泳', '🏊'], ['滑雪', '⛷️'], ['跑步', '🏃'], ['跑', '🏃'], ['跳', '🤸'],
    ['踢足球', '⚽'], ['运动', '🏃'], ['比赛', '🏆'], ['获胜', '🏆'], ['赢', '🏆'], ['团队', '👥'],
    ['队', '👥'], ['游戏', '🎮'], ['玩', '🎮'], ['派对', '🎉'], ['聚会', '🎉'], ['野餐', '🧺'],
    ['旅行', '🧳'], ['假日', '🏖️'], ['生日', '🎂'], ['礼物', '🎁'], ['蜡烛', '🕯️'], ['许愿', '🌠'],

    ['唱歌', '🎤'], ['唱', '🎤'], ['跳舞', '💃'], ['舞蹈', '💃'], ['钢琴', '🎹'], ['小提琴', '🎻'],
    ['鼓', '🥁'], ['音乐', '🎵'], ['歌曲', '🎵'], ['美术', '🎨'], ['艺术', '🎨'], ['绘画', '🎨'],
    ['画', '🎨'], ['功夫', '🥋'], ['相声', '🎭'], ['电影', '🎬'], ['拍照', '📷'], ['摄像机', '📹'],

    ['晴朗', '☀️'], ['阳光', '☀️'], ['多云', '⛅'], ['阴天', '☁️'], ['风', '🌬️'], ['雪', '❄️'],
    ['下雪', '❄️'], ['雨', '🌧️'], ['下雨', '🌧️'], ['雾', '🌫️'], ['天气', '🌤️'], ['冷', '🥶'],
    ['热', '🥵'], ['凉', '😎'], ['暖和', '🌤️'], ['温暖', '🌤️'], ['彩虹', '🌈'], ['春天', '🌸'],
    ['春季', '🌸'], ['夏天', '☀️'], ['夏季', '☀️'], ['秋天', '🍂'], ['秋季', '🍂'], ['冬天', '❄️'],
    ['冬季', '❄️'], ['季节', '🍂'], ['花', '🌸'], ['树', '🌳'], ['植物', '🌿'], ['种植', '🌱'],
    ['日出', '🌅'], ['早晨', '🌅'], ['上午', '🌅'], ['下午', '🌇'],

    ['红色', '🔴'], ['黄色', '🟡'], ['橙色', '🟠'], ['白色', '⚪'], ['绿色', '🟢'], ['蓝色', '🔵'],
    ['紫色', '🟣'], ['黑色', '⚫'], ['棕色', '🟤'], ['粉色', '🌸'], ['灰色', '🩶'], ['颜色', '🎨'],

    ['中国', '🇨🇳'], ['加拿大', '🇨🇦'], ['美国', '🇺🇸'], ['英国', '🇬🇧'], ['澳大利亚', '🇦🇺'],
    ['法国', '🇫🇷'], ['印度', '🇮🇳'], ['伦敦', '🏙️'], ['纽约', '🗽'], ['渥太华', '🏛️'],
    ['悉尼', '🎭'], ['哈尔滨', '❄️'], ['拉萨', '🏔️'], ['泰山', '⛰️'], ['伦敦眼', '🎡'],

    ['公共汽车', '🚌'], ['汽车', '🚗'], ['火车', '🚂'], ['船', '🚢'], ['轮船', '🚢'], ['自行车', '🚲'],
    ['飞机', '✈️'], ['出租车', '🚕'], ['机器', '⚙️'], ['机器人', '🤖'], ['电视', '📺'], ['计算机', '💻'],
    ['电话', '📞'], ['手机', '📱'],

    ['吃', '🍽️'], ['喝', '🥤'], ['烹饪', '🍳'], ['烹调', '🍳'], ['做家务', '🧹'], ['打扫', '🧹'],
    ['清扫', '🧹'], ['洗', '🧼'], ['整理', '🧺'], ['起床', '⏰'], ['睡觉', '😴'], ['读', '📖'],
    ['读书', '📖'], ['阅读', '📖'], ['写', '✍️'], ['学习', '📚'], ['教', '👩‍🏫'], ['知道', '💡'],
    ['帮助', '🤝'], ['分享', '🤲'], ['打开', '🔓'], ['找到', '🔍'], ['发现', '🔍'], ['抓', '🤏'],
    ['采', '🧺'], ['摘', '🍎'], ['传递', '🤲'], ['投篮', '🏀'], ['购物', '🛍️'], ['买', '🛒'],
    ['工作', '💼'], ['努力', '💪'], ['成功', '🏆'], ['开始', '🚀'], ['结束', '🏁'], ['邀请', '💌'],
    ['拜访', '🚪'], ['等待', '⏳'], ['等', '⏳'], ['喂养', '🍽️'], ['使用', '🛠️'], ['展示', '🎭'],
    ['尝试', '🧪'], ['猜', '🤔'], ['数数', '🔢'], ['唱', '🎤'], ['说', '💬'], ['讲', '💬'],
    ['呼叫', '📞'], ['发送', '📤'], ['交流', '💬'], ['居住', '🏠'], ['来自', '🌍'], ['旅行', '🧳'],

    ['快乐的', '😊'], ['幸福', '😊'], ['高兴', '😄'], ['愉快', '😄'], ['有趣', '😄'], ['生气', '😠'],
    ['愤怒', '😠'], ['伤心', '😢'], ['难过', '😢'], ['担心', '😟'], ['担忧', '😟'], ['兴奋', '🤩'],
    ['激动', '🤩'], ['惊讶', '😲'], ['惊奇', '😲'], ['友好', '🤝'], ['爱', '❤️'], ['喜欢', '❤️'],
    ['聪明', '🧠'], ['酷', '😎'], ['漂亮', '🌸'], ['美丽', '🌸'], ['英俊', '🤵'], ['强壮', '💪'],
    ['健康', '💪'], ['严格', '😤'], ['瘦', '🧍'], ['高', '📏'], ['快', '💨'], ['慢', '🐢'],
    ['容易', '✅'], ['不同', '🔀'], ['新的', '✨'], ['干净', '🧼'], ['整洁', '🧼'],

    ['生日', '🎂'], ['元旦', '🎊'], ['春节', '🧧'], ['圣诞节', '🎄'], ['教师节', '🍎'],
    ['节日', '🎊'], ['烟花', '🎆'], ['烟火', '🎆'], ['压岁钱', '🧧'], ['春联', '🧧'],
    ['对联', '🧧'], ['钱', '💰'], ['钞票', '💰'], ['草药', '🌿'], ['医学', '🩺'], ['传统', '🏮']
  ];

  EMOJI_KEYWORDS.sort(function (a, b) { return b[0].length - a[0].length; });

  var FALLBACK_EMOJIS = [
    '🔹', '🔸', '🔺', '🔻', '🔶', '🔷', '🟣', '🟢',
    '🟡', '🟠', '🟤', '⚫', '⚪', '🔴', '🔵', '💠'
  ];

  function hashText(value) {
    var hash = 0;
    var text = String(value || '');
    for (var i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  function emojiForWord(word, meaning) {
    var text = String(meaning == null ? '' : meaning);
    if (EMOJI_EXACT[text]) return EMOJI_EXACT[text];
    for (var i = 0; i < EMOJI_KEYWORDS.length; i += 1) {
      if (text.indexOf(EMOJI_KEYWORDS[i][0]) !== -1) return EMOJI_KEYWORDS[i][1];
    }
    return FALLBACK_EMOJIS[hashText(word || text) % FALLBACK_EMOJIS.length];
  }

  /* ------------------------------------------------------------------ */
  /* Import user-provided workbook rows from vocabulary.js               */
  /* ------------------------------------------------------------------ */

  function asText(value) {
    return value == null ? '' : String(value);
  }

  function unitSlug(title, index) {
    var slug = asText(title).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug || ('unit-' + (index + 1));
  }

  function importBook(bookId) {
    var lists = root.EnglishKidsWordLists;
    var payload = lists && lists[bookId];
    if (!payload) return { sourceLabel: null, note: null, units: [] };

    var rawUnits = Array.isArray(payload) ? payload : payload.units;
    if (!Array.isArray(rawUnits)) rawUnits = [];

    var units = rawUnits.map(function (rawUnit, unitIndex) {
      if (!rawUnit) return null;
      var title = asText(rawUnit.title || rawUnit.unit || ('Unit ' + (unitIndex + 1)));
      var rawWords = Array.isArray(rawUnit.words) ? rawUnit.words : [];
      var words = [];
      rawWords.forEach(function (rawWord) {
        if (!rawWord) return;
        var word = typeof rawWord === 'string' ? rawWord : asText(rawWord.word);
        var meaning = typeof rawWord === 'string' ? '' : asText(rawWord.meaning);
        if (!word) return;
        words.push({
          word: word,
          meaning: meaning,
          emoji: asText(rawWord.emoji) || emojiForWord(word, meaning)
        });
      });
      return {
        id: bookId + '-' + unitSlug(title, unitIndex),
        title: title,
        subtitle: words.length + ' 个单词',
        bookId: bookId,
        words: words,
        wordCount: words.length,
        emoji: (words[0] && words[0].emoji) || '📘'
      };
    }).filter(function (unit) { return unit && unit.words.length > 0; });

    return {
      sourceLabel: asText(payload.sourceLabel) || null,
      note: asText(payload.note) || null,
      units: units
    };
  }

  GRADE_LEVELS.forEach(function (grade) {
    grade.books.forEach(function (book) {
      var imported = importBook(book.id);
      book.units = imported.units;
      book.sourceLabel = imported.sourceLabel;
      book.note = imported.note;
      book.grade = grade.grade;
      book.gradeId = grade.id;
      book.unitCount = imported.units.length;
      book.wordCount = imported.units.reduce(function (total, unit) {
        return total + unit.words.length;
      }, 0);
    });
  });

  var BOOKS = [];
  var WORD_UNITS = [];
  GRADE_LEVELS.forEach(function (grade) {
    grade.books.forEach(function (book) {
      BOOKS.push(book);
      WORD_UNITS.push.apply(WORD_UNITS, book.units);
    });
  });

  var TOTAL_WORDS = WORD_UNITS.reduce(function (total, unit) {
    return total + unit.words.length;
  }, 0);
  var TOTAL_UNITS = WORD_UNITS.length;
  var EMPTY_BOOKS = BOOKS.filter(function (book) { return book.wordCount === 0; });
  var EMPTY_BOOK_IDS = EMPTY_BOOKS.map(function (book) { return book.id; });
  var EMPTY_BOOK_LABELS = EMPTY_BOOKS.map(function (book) { return book.title; });

  CURRICULUM.workbookVocabularyIncluded = TOTAL_WORDS > 0;
  CURRICULUM.workbookWordCount = TOTAL_WORDS;
  CURRICULUM.booksWithVocabulary = BOOKS.length - EMPTY_BOOKS.length;

  var CONTENT_STATUS = {
    state: TOTAL_WORDS === 0 ? 'empty' : (EMPTY_BOOKS.length ? 'partial' : 'imported'),
    wordCount: TOTAL_WORDS,
    unitCount: TOTAL_UNITS,
    bookCount: BOOKS.length,
    importedBookCount: BOOKS.length - EMPTY_BOOKS.length,
    emptyBookIds: EMPTY_BOOK_IDS,
    emptyBookLabels: EMPTY_BOOK_LABELS,
    sourceWorkbook: '五四学制英语_单词表汇总.xlsx',
    sourceSheet: '按单元',
    emojiArtwork: false,
    message: TOTAL_WORDS === 0
      ? '单词表待导入：请确认 vocabulary.js 已在 data.js 之前加载。'
      : (EMPTY_BOOKS.length
        ? '已导入 ' + TOTAL_WORDS + ' 个用户提供的词条；' +
          EMPTY_BOOK_LABELS.join('、') + '在源工作簿中没有词汇，暂留为空。'
        : '已导入 ' + TOTAL_WORDS + ' 个用户提供的词条。')
  };

  /* ------------------------------------------------------------------ */
  /* Public lookup API                                                   */
  /* ------------------------------------------------------------------ */

  function getGrade(id) {
    for (var i = 0; i < GRADE_LEVELS.length; i += 1) {
      if (GRADE_LEVELS[i].id === id || String(GRADE_LEVELS[i].grade) === String(id)) {
        return GRADE_LEVELS[i];
      }
    }
    return null;
  }

  function getBook(id) {
    for (var i = 0; i < BOOKS.length; i += 1) {
      if (BOOKS[i].id === id) return BOOKS[i];
    }
    return null;
  }

  function getUnitsForBook(bookOrId) {
    var book = typeof bookOrId === 'string' ? getBook(bookOrId) : bookOrId;
    return book && Array.isArray(book.units) ? book.units.slice() : [];
  }

  function getUnitsForGrade(gradeOrId) {
    var grade = typeof gradeOrId === 'string' || typeof gradeOrId === 'number'
      ? getGrade(gradeOrId)
      : gradeOrId;
    if (!grade || !Array.isArray(grade.books)) return [];
    var units = [];
    grade.books.forEach(function (book) {
      if (Array.isArray(book.units)) units.push.apply(units, book.units);
    });
    return units;
  }

  function getAllUnits() {
    var units = [];
    BOOKS.forEach(function (book) {
      if (Array.isArray(book.units)) units.push.apply(units, book.units);
    });
    return units;
  }

  function getUnit(id) {
    var units = getAllUnits();
    for (var i = 0; i < units.length; i += 1) {
      if (units[i] && units[i].id === id) return units[i];
    }
    return null;
  }

  function getWords(unitOrId) {
    var unit = typeof unitOrId === 'string' ? getUnit(unitOrId) : unitOrId;
    return unit && Array.isArray(unit.words) ? unit.words.slice() : [];
  }

  function getWordCount(unitOrId) {
    return getWords(unitOrId).filter(function (word) {
      return word && word.word;
    }).length;
  }

  function getWordCountForBook(bookOrId) {
    return getUnitsForBook(bookOrId).reduce(function (total, unit) {
      return total + getWordCount(unit);
    }, 0);
  }

  function getWordCountForGrade(gradeOrId) {
    return getUnitsForGrade(gradeOrId).reduce(function (total, unit) {
      return total + getWordCount(unit);
    }, 0);
  }

  function unitsForScope(scope) {
    if (!scope) return getAllUnits();
    if (typeof scope === 'string') {
      var book = getBook(scope);
      if (book) return getUnitsForBook(book);
      var grade = getGrade(scope);
      if (grade) return getUnitsForGrade(grade);
      return [];
    }
    if (Array.isArray(scope.books)) return getUnitsForGrade(scope);
    if (Array.isArray(scope.units)) return getUnitsForBook(scope);
    return [];
  }

  function hasVocabulary(scope) {
    return unitsForScope(scope).some(function (unit) {
      return unit && getWordCount(unit) > 0;
    });
  }

  function getFirstPlayableUnit(bookOrGradeId) {
    var units = bookOrGradeId ? unitsForScope(bookOrGradeId) : getAllUnits();
    for (var i = 0; i < units.length; i += 1) {
      if (units[i] && getWordCount(units[i]) > 0) return units[i];
    }
    return null;
  }

  var CONFIG = {
    lanes: 4,
    cellsPerLane: 8,
    startingLives: 3,
    totalWaves: 4,
    waveSizes: [3, 3, 4, 4],
    hints: 5,
    spawnGapMs: 2300,
    spawnJitterMs: 700,
    waveGapMs: 2000,
    enemySpeed: 0.62,        // cells per second
    fireIntervalMs: 900,     // defender shot cooldown
    cardCooldownMs: 2400,    // same card recharge time
    mismatchPenalty: 3,
    killScore: 10,
    lifeBonus: 20,
    hintBonus: 5
  };

  function shuffle(list, rng) {
    var random = typeof rng === 'function' ? rng : Math.random;
    var copy = list.slice();
    for (var i = copy.length - 1; i > 0; i -= 1) {
      var j = Math.floor(random() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  var api = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    CURRICULUM: CURRICULUM,
    CONTENT_STATUS: CONTENT_STATUS,
    GRADE_LEVELS: GRADE_LEVELS,
    BOOKS: BOOKS,
    WORD_UNITS: WORD_UNITS,
    CONFIG: CONFIG,
    getGrade: getGrade,
    getBook: getBook,
    getUnitsForBook: getUnitsForBook,
    getUnitsForGrade: getUnitsForGrade,
    getAllUnits: getAllUnits,
    getUnit: getUnit,
    getWords: getWords,
    getWordCount: getWordCount,
    getWordCountForBook: getWordCountForBook,
    getWordCountForGrade: getWordCountForGrade,
    hasVocabulary: hasVocabulary,
    getFirstPlayableUnit: getFirstPlayableUnit,
    emojiForWord: emojiForWord,
    shuffle: shuffle
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.EnglishKidsData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
