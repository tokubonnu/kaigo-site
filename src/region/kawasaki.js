/*
 * 川崎市のページの配線：予算（計算核 core.js の budget をそのまま使う）→ 川崎市で比べる（compare.js）
 * 通信しない・保存しない・URLに数字を載せない（ほかのページと同じ）。広告の設定は読まない。
 */
(function () {
  'use strict';
  var K = window.KaigoCalc, R = window.KaigoReport, C = window.KaigoCompare, D = window.KaigoKawasakiData;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  if (!K || !R || !C || !D || !$('#kawasaki-result')) return;

  var hasError = false;
  function readAmount(inp) {
    var r = K.parseAmount(inp.value, inp.dataset.unit === 'man' ? 'man' : 'yen');
    var err = inp.parentNode.querySelector('.err');
    if (!r.ok) {
      hasError = true;
      inp.setAttribute('aria-invalid', 'true');
      if (err) err.textContent = r.error;
      return null;
    }
    inp.removeAttribute('aria-invalid');
    if (err) err.textContent = '';
    return r.value;
  }

  function household() {
    hasError = false;
    var per = $('input[name="k-period"]:checked');
    var hh = { mode: 'detail', support: 0, periodYears: per ? Number(per.value) : 10 };
    $$('[data-k]').forEach(function (inp) { hh[inp.dataset.k] = readAmount(inp); });
    return hh;
  }

  // 比べる金額：選んだ期間の「施設に回せるお金」（施設以外のお金を入れた時）か「介護にかけられるお金」
  function budgetFor(hh) {
    var b = K.budget(hh);
    if (!b.ready) return { budget: null, kind: null };
    if (b.state === 'initial_short') return { budget: -1, kind: 'entryShort' };
    var row = b.rows.filter(function (r) { return r.years === hh.periodYears; })[0] || b.rows[1];
    return { budget: b.otherKnown ? row.cap : row.careTotal, kind: b.otherKnown ? 'facility' : 'care' };
  }

  function update() {
    var hh = household();
    var errLine = hasError ? '<p class="warn"><strong>！のある欄は、今の結果に含まれていません。</strong>修正すると反映されます。</p>' : '';
    $('#budget-result').innerHTML = errLine + R.renderBudget({ facilities: [], household: hh });
    $('#budget-echo').textContent = R.renderBudgetEcho({ facilities: [], household: hh });
    var sp = $('.stepper'); // 進み具合：予算が出たら「2 結果」まで進める
    if (sp) sp.dataset.at = K.budget(hh).ready ? '2' : '1';
    var bf = budgetFor(hh);
    var r = C.compare(D, { budget: bf.budget, kind: bf.kind, entry: hh.entryBudget, ward: $('#k-ward').value, level: $('#k-level').value, today: new Date() });
    $('#kawasaki-result').innerHTML = C.render(D, r);
  }

  function setAll(v) {
    $$('[data-k]').forEach(function (inp) { inp.value = v[inp.dataset.k] === undefined ? '' : v[inp.dataset.k]; });
  }
  $('#btn-demo').addEventListener('click', function () {
    setAll({ incomeSelf: '150000', funds: '800' });
    $('input[name="k-period"][value="10"]').checked = true;
    update();
  });
  $('#btn-reset').addEventListener('click', function () {
    setAll({});
    $('input[name="k-period"][value="10"]').checked = true;
    $('#k-ward').value = '';
    $('#k-level').value = '0';
    $('#more-box').open = false;
    update();
  });
  document.addEventListener('input', function (e) { if (e.target.closest('#app')) update(); });
  document.addEventListener('change', function (e) { if (e.target.closest('#app')) update(); });
  function openFromHash() {
    if (location.hash === '#more-box') { $('#more-box').open = true; $('#more-box').scrollIntoView(); }
  }
  openFromHash();
  window.addEventListener('hashchange', openFromHash);

  // 結果の箱の「おむつ代・医療費を入れる」：入力の所の「あれば入れる」を開いて、最初の欄（施設以外にかかるお金）へ
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-open-other]');
    if (!a || a.getAttribute('href') !== '#more-box') return;
    e.preventDefault();
    var box = $('#more-box');
    box.open = true;
    box.scrollIntoView({ block: 'start' });
    var first = box.querySelector('input');
    if (first) first.focus({ preventScroll: true });
  });
  // 冒頭のまとめの特養の目安：期限（2027年4月の介護報酬の見直し）を過ぎたら隠して「確認中」を出す（作り直す前の HTML でも止まる）
  if (C.expired(D, new Date())) {
    $$('.answer [data-until]').forEach(function (e) { e.hidden = true; });
    $$('.answer [data-stopped]').forEach(function (e) { e.hidden = false; });
  }
  update();
})();
