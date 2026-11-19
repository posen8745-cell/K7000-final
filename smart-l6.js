/* K7000 Level 6 智慧混合抽題：新字 40%／曾答錯 35%／舊字 25%
 * 2026-11-19
 * 此增補檔應載入於 app.js 之後。
 * 沿用 app.js 的 cache、words、wrong、session、pool、record() 等資料。
 * 不修改或清除任何既有 localStorage 資料。
 */
(() => {
  'use strict';

  // 若主程式未正確載入，就不替換任何功能。
  if (typeof start !== 'function' || typeof info !== 'function' ||
      typeof key !== 'function' || typeof beginRound !== 'function') {
    console.error('K7000：主程式 app.js 未載入，無法啟用 L6 智慧抽題。');
    return;
  }

  const LEVEL = 'Level 6';
  const RATIOS = { fresh: 0.40, mistakes: 0.35, review: 0.25 };
  const day = 86400000;
  const oldStart = start;
  const oldInfo = info;
  const random = () => Math.max(Number.MIN_VALUE, Math.random());

  // 與原 app.js 相同的詞條識別方式，確保舊紀錄可直接沿用。
  function status(item) {
    const entry = words[key(item)];
    if (!entry || (Number(entry.r || 0) + Number(entry.x || 0)) === 0) return 'fresh';
    if (Number(entry.x || 0) > 0) return 'mistakes';
    return 'review';
  }

  function ageInDays(entry) {
    if (!entry || !Number(entry.t)) return 30;
    return Math.max(0, (Date.now() - entry.t) / day);
  }

  // 加權隨機，不採固定排序，避免永遠都是同一批錯字、舊字。
  function priority(item, group) {
    if (group === 'fresh') return 1;
    const entry = words[key(item)] || {};
    const attempts = Number(entry.r || 0) + Number(entry.x || 0);
    const errorRate = attempts ? Number(entry.x || 0) / attempts : 0;
    const dueFactor = Math.min(ageInDays(entry) / 5, 3);
    if (group === 'mistakes') {
      const pending = wrong.some(w => key(w) === key(item));
      return 1 + 2 * errorRate + 1.5 * dueFactor + (pending ? 2 : 0);
    }
    return 1 + dueFactor;
  }

  // Efraimidis-Spirakis 類型的加權無放回抽樣。
  function weightedOrder(items, group) {
    return items.map(item => ({item, rank: -Math.log(random()) / priority(item, group)}))
      .sort((a, b) => a.rank - b.rank)
      .map(entry => entry.item);
  }

  function buildSmartSession(items, requested) {
    const buckets = {fresh: [], mistakes: [], review: []};
    for (const item of items) buckets[status(item)].push(item);
    for (const group of Object.keys(buckets)) buckets[group] = weightedOrder(buckets[group], group);

    const n = Math.min(requested, items.length);
    const targets = {
      fresh: Math.round(n * RATIOS.fresh),
      mistakes: Math.round(n * RATIOS.mistakes),
      review: 0
    };
    targets.review = n - targets.fresh - targets.mistakes;

    const selected = [], selectedKeys = new Set(), usedWords = new Set();
    const actual = {fresh: 0, mistakes: 0, review: 0};
    const normalizedWord = item => String(item.word).trim().toLowerCase();

    // 除非要求抽完全部，否則同一次避免相同英文拼字重複（如 attainment 的兩個詞義）。
    function take(group, howMany, allowSameSpelling = false) {
      let added = 0;
      for (const item of buckets[group]) {
        if (added >= howMany || selected.length >= n) break;
        const k = key(item), spelling = normalizedWord(item);
        if (selectedKeys.has(k) || (!allowSameSpelling && usedWords.has(spelling))) continue;
        selected.push(item);
        selectedKeys.add(k);
        usedWords.add(spelling);
        actual[group]++;
        added++;
      }
      return added;
    }

    take('fresh', targets.fresh);
    take('mistakes', targets.mistakes);
    take('review', targets.review);

    // 若錯字或舊字不足，按新字→錯字→舊字順序補足；不會降低原本設定題數。
    while (selected.length < n) {
      const before = selected.length;
      for (const group of ['fresh', 'mistakes', 'review']) take(group, n - selected.length);
      if (selected.length === before) break;
    }

    // 選「全部」時可涵蓋同拼字不同詞義的詞條；其他題數通常不會用到這步。
    if (selected.length < n) {
      for (const group of ['fresh', 'mistakes', 'review']) take(group, n - selected.length, true);
    }

    // 最終打散順序，避免前 40 題全部都是新字。
    return {items: shuffle(selected), actual, targets};
  }

  function getProgress() {
    const items = cache[LEVEL] || [];
    const practiced = items.filter(item => status(item) !== 'fresh');
    const seenSpelling = new Set(practiced.map(item => String(item.word).trim().toLowerCase()));
    const distinct = new Set(items.map(item => String(item.word).trim().toLowerCase()));
    return {total: items.length, practiced: practiced.length, wordCount: distinct.size,
      practicedWords: seenSpelling.size, remaining: items.length - practiced.length};
  }

  info = function() {
    oldInfo();
    if ($('level').value !== LEVEL) return;
    const p = getProgress();
    $('poolInfo').textContent = `L6 共 ${p.total} 筆詞條（${p.wordCount} 個不同拼字）；` +
      `目前已練 ${p.practiced} 筆、未練 ${p.remaining} 筆。` +
      `智慧抽題預設：新字 40%／曾答錯 35%／舊字 25%；本次優先不重複拼字。`;
  };

  start = function(review = false) {
    // 錯題本、錯最多 50 字、其他 Level：全部維持原本的邏輯。
    if (review || $('level').value !== LEVEL) return oldStart(review);
    if (active && !confirm('重新開始會結束這次測驗，要繼續嗎？')) return;

    pool = cache[LEVEL] || [];
    if (!pool.length) return;
    const setting = $('count').value;
    const requested = setting === 'all' ? pool.length : Number(setting);
    const result = buildSmartSession(pool, requested);
    if (!result.items.length) return;

    session = result.items;
    sessionMode = $('mode').value;
    autoReview = $('auto').checked;
    sourceLabel = LEVEL; // 與原本的成績統計分類完全一致。
    round = 0;
    firstResult = '';
    active = true;
    beginRound();

    const a = result.actual;
    $('poolInfo').textContent = `本次 ${session.length} 題：新字 ${a.fresh}、` +
      `曾答錯 ${a.mistakes}、舊字 ${a.review}；` +
      '類別不足時已自動補位。練習紀錄沿用原資料。';
  };

  // 原 app.js 以 .onchange = info 綁定舊函式，需要重新指向更新後的 info。
  $('level').onchange = info;
  // 頁面載入後先更新顯示；init() 尚在 fetch 時由原程式自行再次呼叫 info()。
  if (Array.isArray(cache[LEVEL])) info();
})();
