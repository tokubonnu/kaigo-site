/*
 * 介護の見積もり整理 — 画面の配線（入力を読む → 計算核 → 結果を描く → 印刷）
 * 通信しない・保存しない・URLに数字を載せない。
 */
(function () {
  'use strict';
  var K = window.KaigoCalc, R = window.KaigoReport, DEMO = window.KaigoDemo;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var uid = 0;

  /* ---------- 施設カード ---------- */
  function addFacility(name) {
    var tpl = $('#tpl-facility').content.cloneNode(true);
    var card = tpl.querySelector('[data-fac]');
    var items = card.querySelector('.items');
    K.ITEM_DEFS.forEach(function (def) {
      var it = $('#tpl-item').content.cloneNode(true).querySelector('[data-item]');
      it.dataset.key = def.key;
      it.querySelector('.item-label').textContent = def.label;
      if (def.unit === 'visit') {
        it.querySelector('.amt-label').innerHTML = '1回の料金<span class="unit">円／回</span>';
        it.querySelector('.visits').hidden = false;
      }
      items.appendChild(it);
    });
    card.querySelector('[data-f="name"]').value = name;
    // label と入力をつなぐ（読み上げ・タップ範囲のため）
    $$('.field', card).forEach(function (fd) {
      var lab = fd.querySelector('label'), inp = fd.querySelector('input,select');
      if (lab && inp) { inp.id = 'f' + (++uid); lab.htmlFor = inp.id; }
    });
    $$('.item-row', card).forEach(function (row) {
      var sel = row.querySelector('select');
      sel.id = 'f' + (++uid);
      row.querySelector('label').htmlFor = sel.id;
    });
    card.querySelector('[data-remove]').addEventListener('click', function () {
      card.remove(); syncFacilityUi(); update();
    });
    $('#facilities').appendChild(card);
    syncFacilityUi();
    return card;
  }

  function syncFacilityUi() {
    var cards = $$('[data-fac]');
    cards.forEach(function (c, i) {
      c.querySelector('.fac-title').textContent = (c.querySelector('[data-f="name"]').value || (i ? 'B施設' : 'A施設'));
      c.querySelector('[data-remove]').hidden = cards.length < 2;
    });
    $('#btn-add').hidden = cards.length >= 2;
  }

  /* ---------- 入力を読む ---------- */
  var hasError = false;
  function readAmount(inp) {
    var unit = inp.dataset.unit === 'man' ? 'man' : 'yen';
    var r = inp.dataset.i === 'visits' ? K.parseAmount(inp.value, 'yen') : K.parseAmount(inp.value, unit);
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

  function readInput() {
    hasError = false;
    var facilities = $$('[data-fac]').map(function (card, i) {
      var f = {
        name: (card.querySelector('[data-f="name"]').value.trim() || (i ? 'B施設' : 'A施設')),
        quoteDate: card.querySelector('[data-f="quoteDate"]').value || '',
        monthlyQuote: readAmount(card.querySelector('[data-f="monthlyQuote"]')),
        entryFee: readAmount(card.querySelector('[data-f="entryFee"]')),
        items: {}
      };
      $$('[data-item]', card).forEach(function (it) {
        var inc = it.querySelector('[data-i="inclusion"]').value;
        it.querySelector('.item-sep').hidden = inc !== 'separate';
        var rec = { inclusion: inc };
        if (inc === 'separate') {
          rec.amount = readAmount(it.querySelector('[data-i="amount"]'));
          rec.amountHigh = readAmount(it.querySelector('[data-i="amountHigh"]'));
          rec.visits = readAmount(it.querySelector('[data-i="visits"]'));
          rec.certainty = it.querySelector('[data-i="certainty"]').value;
        }
        f.items[it.dataset.key] = rec;
      });
      return f;
    });
    // 画面では手取りをいつも「分けて」入れる（本人の手取りだけで答えが出る。残りは「もう少し細かく計算する」の中）
    var hh = { mode: 'detail', periodYears: Number($('input[name="hh-period"]:checked').value) };
    $$('[data-hh]').forEach(function (inp) { hh[inp.dataset.hh] = readAmount(inp); });
    return { facilities: facilities, household: hh };
  }

  /* ---------- 描く ---------- */
  var current = null;
  function update() {
    syncFacilityUi();
    current = readInput();
    var hi = K.householdIncome(current.household);
    var hh = current.household;
    $('#hh-i-line').textContent = hi.spouseHeld
      ? '家族の手取りは、まだ計算に加えていません。生活費も入れると、家の暮らしに必要な分を先に取って計算できます。'
      : (hi.livingKnown && hi.I !== null
        ? '本人の手取り' + R.yen(hh.incomeSelf) + '＋家族の手取り' + R.yen(hh.incomeSpouse || 0) + '−家族の生活費' + R.yen(hh.spouseLiving) + '＝毎月介護に使える手取り' + R.yen(hi.I)
        : '');
    var errLine = hasError ? '<p class="warn"><strong>！のある欄は、今の結果に含まれていません。</strong>修正すると反映されます。</p>' : '';
    $('#budget-result').innerHTML = errLine + R.renderBudget(current);
    $('#budget-echo').textContent = R.renderBudgetEcho(current);
    var sp = $('.stepper'); // 進み具合（1入力→2結果→3施設を探す）：予算が出たら「2 結果」まで進める
    if (sp) sp.dataset.at = K.budget(current.household).ready ? '2' : '1';
    $('#result').innerHTML = errLine + R.renderScreen(current);
  }

  /* ---------- 架空の例・全部消す ---------- */
  function setVal(el, v, unit) {
    if (v === null || v === undefined) { el.value = ''; return; }
    el.value = unit === 'man' ? String(v / 10000) : String(v);
  }
  function loadDemo() {
    clearAll(true);
    $$('[data-fac]').forEach(function (c) { c.remove(); });
    DEMO.facilities.forEach(function (df) {
      var card = addFacility(df.name);
      card.querySelector('[data-f="quoteDate"]').value = df.quoteDate;
      setVal(card.querySelector('[data-f="monthlyQuote"]'), df.monthlyQuote, 'yen');
      setVal(card.querySelector('[data-f="entryFee"]'), df.entryFee, 'man');
      $$('[data-item]', card).forEach(function (it) {
        var d = df.items[it.dataset.key] || { inclusion: 'unknown' };
        it.querySelector('[data-i="inclusion"]').value = d.inclusion;
        setVal(it.querySelector('[data-i="amount"]'), d.amount, 'yen');
        setVal(it.querySelector('[data-i="amountHigh"]'), d.amountHigh, 'yen');
        setVal(it.querySelector('[data-i="visits"]'), d.visits, 'yen');
        if (d.certainty) it.querySelector('[data-i="certainty"]').value = d.certainty;
      });
    });
    var h = DEMO.household;
    $('#more-box').open = true; // 例では「あれば入れる」の中身も見えるように開く
    $('input[name="hh-period"][value="' + h.periodYears + '"]').checked = true;
    $$('[data-hh]').forEach(function (inp) { setVal(inp, h[inp.dataset.hh], inp.dataset.unit); });
    $('#quotes').open = true; // 例では見積もりの比較も見えるように開く
    update();
  }
  function clearAll(silent) {
    $$('[data-fac]').forEach(function (c) { c.remove(); });
    addFacility('A施設');
    $$('[data-hh]').forEach(function (inp) { inp.value = inp.dataset.hh === 'support' ? '0' : ''; });
    $('#more-box').open = false;
    $('#quotes').open = false;
    $('input[name="hh-period"][value="10"]').checked = true;
    closePreview();
    if (!silent) update();
  }

  /* ---------- 印刷 ---------- */
  var MODE_TITLE = { family: '家族用・印刷前の確認', facility: '施設確認用・印刷前の確認', checklist: '見学で聞くこと・印刷前の確認' };
  var previewMode = null;
  function fillSheet(mode) {
    update();
    var sheet = $('#print-sheet');
    sheet.innerHTML = R.renderSheet(current, mode);
    sheet.dataset.mode = mode;
    document.body.dataset.print = mode;
  }
  function doPrint(mode) { fillSheet(mode); window.print(); }
  function openPreview(mode) {
    fillSheet(mode);
    previewMode = mode;
    document.body.classList.add('previewing');
    $('#print-sheet').setAttribute('aria-hidden', 'false');
    $('#preview-bar').hidden = false;
    $('#preview-title').textContent = MODE_TITLE[mode];
    window.scrollTo(0, 0);
    $('#btn-preview-close').focus();
  }
  function closePreview() {
    previewMode = null;
    document.body.classList.remove('previewing');
    $('#print-sheet').setAttribute('aria-hidden', 'true');
    $('#preview-bar').hidden = true;
  }

  /* ---------- つなぐ ---------- */
  document.addEventListener('input', function (e) { if (e.target.closest('#app')) update(); });
  document.addEventListener('change', function (e) { if (e.target.closest('#app')) update(); });
  $('#btn-add').addEventListener('click', function () { addFacility('B施設'); update(); });
  $('#btn-demo').addEventListener('click', loadDemo);
  $('#btn-reset').addEventListener('click', function () { clearAll(false); });
  $$('[data-print]').forEach(function (b) { b.addEventListener('click', function () { doPrint(b.dataset.print); }); });
  $$('[data-preview]').forEach(function (b) { b.addEventListener('click', function () { openPreview(b.dataset.preview); }); });
  $('#btn-preview-print').addEventListener('click', function () { if (previewMode) doPrint(previewMode); });
  $('#btn-preview-close').addEventListener('click', closePreview);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && previewMode) closePreview(); });

  $('#method').innerHTML = R.renderSheet({ facilities: [], household: { mode: 'simple' } }, 'family').match(/<div class="formula">[\s\S]*?<\/div>/)[0];
  // 計算の版の印（式 v2）は、BUBU 2026-10-16 の決定で画面に出さない（フッターから外した）
  $('#checklist').innerHTML = R.renderChecklist();
  clearAll(false);

  // 入口のページから「#more-box」で来た時は、「もう少し細かく計算する」を開いて見せる（数字は持ち込まない）
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

  // 検算用の入口（画面の操作と同じ処理を呼ぶだけ）
  window.KaigoApp = { loadDemo: loadDemo, clearAll: clearAll, openPreview: openPreview, closePreview: closePreview, fillSheet: fillSheet, current: function () { return current; } };
})();
