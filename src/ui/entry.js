/*
 * 入口のページ（1つの問いに答えるページ）の配線。計算は計算核（core.js）の関数をそのまま使う。
 * 通信しない・保存しない・URLに数字を載せない（トップページと同じ）。
 * どのページかは <body data-entry="…"> で決まる：nokoru（家に残る側）／chokin（早見表）／harae（払えなくなる月）
 */
(function () {
  'use strict';
  var K = window.KaigoCalc, R = window.KaigoReport;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var page = document.body.dataset.entry;
  var out = $('#entry-result');
  if (!page || !out) return;

  // 欄を読む：{ 名前: 円 | null }。打ち間違いの欄は null にして、下にひとこと出す
  var hasError = false;
  function read() {
    hasError = false;
    var v = {};
    $$('[data-v]').forEach(function (inp) {
      var r = K.parseAmount(inp.value, inp.dataset.unit === 'man' ? 'man' : 'yen');
      var err = inp.parentNode.querySelector('.err');
      if (!r.ok) {
        hasError = true;
        inp.setAttribute('aria-invalid', 'true');
        if (err) err.textContent = r.error;
        v[inp.dataset.v] = null;
        return;
      }
      inp.removeAttribute('aria-invalid');
      if (err) err.textContent = '';
      v[inp.dataset.v] = r.value;
    });
    var per = $('input[name="period"]:checked');
    v.periodYears = per ? Number(per.value) : 10;
    return v;
  }
  function wait(names) { return '<p class="wait">「' + names.join('」と「') + '」を入れると、ここに結果が出ます。</p>'; }
  function ym(o) { return o.year + '年' + o.month + '月'; }

  /* ---------- ① 家に残る側の生活費 ---------- */
  function nokoru(v) {
    var hh = { mode: 'detail', incomeSelf: v.self, incomeSpouse: v.spouse, spouseLiving: v.living, funds: v.funds, periodYears: v.periodYears, support: 0 };
    var h = [];
    if (v.living !== null) {
      var left = (v.spouse || 0) - v.living;
      h.push(left >= 0
        ? '<p class="step-line">家の生活費は家族の手取りで払えます。月' + R.yen(left) + '残る分は、施設の費用に使えます。</p>'
        : '<p class="step-line">家族の手取りだけでは、生活費が<strong>月' + R.yen(-left) + '足りません</strong>。足りない分は、施設に入る本人の手取りから先に確保します。</p>');
      if (v.self !== null) {
        h.push('<p class="calc-line"><span class="nw">本人の手取り' + R.yen(v.self) + '</span>＋<span class="nw">家族の手取り' + R.yen(v.spouse || 0) + '</span>−<span class="nw">家族の生活費' + R.yen(v.living) + '</span><br>＝<span class="nw">毎月介護に使える手取り<strong>' + R.yen(v.self + (v.spouse || 0) - v.living) + '</strong></span></p>');
      }
    }
    // 「おむつ代・医療費を入れる」は、その欄があるトップページへ（このページには無い欄なので）
    h.push(R.renderBudget({ facilities: [], household: hh }, { otherHref: './#more-box', otherLabel: 'トップページで費用を追加して計算する' }));
    // 生活費を先に取らなかった時との違い（取らないと、どれだけ多く見えるか）
    var b = K.budget(hh);
    if (b.ready && b.state === 'ok' && v.living > 0) {
      var naive = K.budget(Object.assign({}, hh, { spouseLiving: 0 }));
      var want = v.periodYears;
      var a = b.rows.filter(function (r) { return r.years === want; })[0];
      var n = naive.rows.filter(function (r) { return r.years === want; })[0];
      h.push('<div class="note"><p><strong>家の生活費を引かないと？</strong></p><p>家の生活費を引かなければ、' + want + '年分で<strong class="nw">月 約' + R.yen(n.careTotal) + '</strong>と出ます（今の結果より<strong>' + R.yen(n.careTotal - a.careTotal) + '多い</strong>）。</p>' +
        '<p>ただ、その金額を施設に使うと、家の生活費が毎月' + R.yen(v.living) + '不足します。今の結果は、家の生活費を先に確保したあとの金額です。</p></div>');
    }
    return h.join('');
  }

  /* ---------- ② 早見表（自分の数字） ---------- */
  function chokin(v) {
    var miss = [];
    if (v.funds === null) miss.push('介護に使えるお金');
    if (v.short === null) miss.push('毎月、貯金から払う金額');
    if (miss.length) return wait(miss);
    var p = K.plan({ S: v.funds, R: 0, F: v.entry || 0, I: 0, Q: v.short, E: 0 });
    if (p.state === 'initial_short') {
      return '<p class="warn">入居時の支払いが、介護に使えるお金を<strong>' + R.yen(p.initialShort) + '上回っています</strong>。</p>';
    }
    if (p.state === 'no_drawdown') {
      return '<div class="res-main"><p class="headline">今の金額なら毎月の支払いをまかなえるため、貯金を取り崩しません。</p></div>';
    }
    var ymText = R.yearsMonths(p.fullMonths);
    var h = ['<div class="res-main"><p class="headline"><strong class="cap-num">' + ymText + (p.fullMonths >= 360 ? '' : '分') + '</strong></p>'];
    // 「◯か月分（◯年◯か月）払え」の形（2026-10-17 ちゃっトク）
    var yy = Math.floor(p.fullMonths / 12), mm = p.fullMonths % 12;
    h.push('<p class="headline-sub">' + p.fullMonths + 'か月分' + (yy ? '（' + yy + '年' + (mm ? mm + 'か月' : '') + '）' : '') + '払え、' + p.shortMonth + 'か月目から不足します。</p></div>');
    if (v.entry) h.push('<p class="basis">貯金' + R.yen(v.funds) + 'から入居時の支払い' + R.yen(v.entry) + 'を引き、毎月足りない' + R.yen(v.short) + 'を何か月払えるかを出しています。</p>');
    else h.push('<p class="basis">貯金' + R.yen(v.funds) + 'から、毎月足りない' + R.yen(v.short) + 'を何か月払えるかを出しています。</p>');
    return h.join('');
  }

  /* ---------- ③ 払えなくなる月 ---------- */
  var OTHER_EMPTY = '病院代や薬代などはまだ含まれていません。その分を入れると、払える期間は短くなります。';
  function harae(v) {
    var miss = [];
    if (v.funds === null) miss.push('介護に使えるお金');
    if (v.facility === null) miss.push('施設に毎月払っている金額');
    if (v.income === null) miss.push('本人の毎月の手取り（年金など）');
    if (miss.length) return wait(miss);
    var p = K.plan({ S: v.funds, R: 0, F: 0, I: v.income, Q: v.facility, E: v.other || 0 });
    var h = [];
    if (p.state === 'no_drawdown') {
      h.push('<div class="res-main"><p class="headline">今の手取りで毎月の支払いをまかなえ、<strong>月' + R.yen(p.monthlySurplus) + '残ります。</strong></p></div>');
    } else {
      var now = new Date();
      var y = now.getFullYear(), m = now.getMonth() + 1;
      // 大きな答えは「◯年◯月ごろまで」＝払える最後の月（来月を1か月目として fullMonths か月目）。足りなくなる月（shortMonth）はその翌月
      var last = K.monthAfter(y, m, p.fullMonths);
      h.push('<div class="res-main"><p class="headline"><strong class="cap-num">' + ym(last) + '<wbr><span class="nw">ごろまで</span></strong></p>');
      h.push('<p class="headline-sub">今の金額なら' + R.months(p.fullMonths) + '分払え、' + p.shortMonth + 'か月目から不足します。</p>');
      h.push('<p class="headline-sub">毎月' + R.yen(p.D) + 'を貯金から補うことになります。期間は来月の支払いから数えています。</p></div>');
      if (v.other === null) h.push('<p class="note">' + OTHER_EMPTY + '</p>');
      if (p.fullMonths > 12) {
        h.push('<p class="assume">支払いに使える貯金が残り1年分になるのは、<strong>' + ym(K.monthAfter(y, m, p.shortMonth - 12)) + 'ごろ</strong>。それまでに相談先や負担を軽くする制度を確認できます。</p>');
      } else {
        h.push('<p class="assume">下の相談先の<strong>1と2</strong>から、早めに確認を。</p>');
      }
    }
    if (p.state === 'no_drawdown' && v.other === null) h.push('<p class="note">' + OTHER_EMPTY + '</p>');
    // 2026-10-17：手取りで足りている時（no_drawdown）は割る物が無い＝出さない（前は「足りないのに割っている」食い違いの文が出ていた）
    if (p.state !== 'no_drawdown') h.push('<p class="basis">施設に払う' + R.yen(v.facility) + (v.other ? 'と、そのほかにかかる' + R.yen(v.other) : '') + 'から、手取り' + R.yen(v.income) + 'を引いた分を、貯金' + R.yen(v.funds) + 'で何か月まかなえるかを出しています。</p>');
    return h.join('');
  }

  var RENDER = { nokoru: nokoru, chokin: chokin, harae: harae };
  function update() {
    var v = read();
    // 家に残る側のページは書き直し版 §11f の文、早見表・払えなくなる月のページはトップページと同じ文（§12e・§13d）
    var errLine = !hasError ? '' : '<p class="warn"><strong>！のある欄は、今の結果に含まれていません。</strong>修正すると反映されます。</p>';
    out.innerHTML = errLine + RENDER[page](v);
  }
  document.addEventListener('input', update);
  document.addEventListener('change', update);
  update();
})();
