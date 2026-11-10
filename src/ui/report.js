/*
 * 施設のお金を整理する — 結果と印刷票の文面を作る（DOMを触らない・文字列を返すだけ）
 * 画面の結果・家族用の印刷・施設確認用の印刷の3つを同じ計算結果から作る。
 * 施設確認用には家計（資金・収入・残す資金）を一切入れない。
 */
(function (root, factory) {
  var api = factory(root.KaigoCalc || (typeof require === 'function' ? require('../calc/core.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KaigoReport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (K) {
  'use strict';

  var FORMULA_VERSION = '式 v2（2026-10-14）';

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function yen(n) {
    if (n === null || n === undefined) return '未確認';
    var neg = n < 0;
    var s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s + '円';
  }
  function man(n) { // 大きな額の読みやすい言い方（約◯万円）
    var v = Math.round(n / 1000) / 10;
    return '約' + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '万円';
  }
  function yenMan(n) { return n >= 100000 ? yen(n) + '（' + man(n) + '）' : yen(n); }
  function months(n) {
    var y = Math.floor(n / 12), m = n % 12;
    var tail = y ? '（' + y + '年' + (m ? m + 'か月' : '') + '）' : '';
    return n + 'か月' + tail;
  }
  function periodLabel(T) { return T % 12 === 0 ? (T / 12) + '年' : T + 'か月'; }

  var INC_LABEL = { included: '月額に含む', separate: '別料金', unknown: 'まだ不明' };

  /* ---------- 計算結果をまとめる ---------- */
  function build(input) {
    var T = (input.household.periodYears || 10) * 12;
    var periods = [12, 60, 120];
    var facs = input.facilities.map(function (f) {
      var ev = K.evaluate(f, input.household, periods);
      var cap = null;
      if (ev.ready) cap = K.monthlyCap(ev.income.I, ev.plan.L, ev.monthly.E, T);
      return { f: f, ev: ev, cap: cap };
    });
    var cmp = facs.length === 2 ? K.compare(facs[0].ev.monthly, facs[1].ev.monthly) : null;
    return {
      T: T,
      facs: facs,
      cmp: cmp,
      questions: K.nextQuestions(input, 3),
      facilityQuestions: K.nextQuestions(input, 50).filter(function (q) { return q.to === 'facility'; }).slice(0, 6) // 施設確認用の紙は6問まで
    };
  }

  /* ---------- 部品 ---------- */
  // 主役（施設に毎月いくらまで払える？）で待つ時の欄の名前（画面の欄名と同じ）
  function blockerText(b) {
    return {
      quote: '見積書の月額',
      entry: '入居時に払うお金（なければ0）',
      funds: '介護に使えるお金',
      income: '本人の毎月の手取り（年金など）'
    }[b];
  }
  // 見積もりの結果（② 総額と、お金が足りる期間）で待つ時の名前
  function planBlockerText(b) {
    return {
      quote: '月額',
      entry: '入居時に払うお金（なければ0）',
      funds: '介護に使えるお金',
      income: '毎月介護に使える手取り'
    }[b];
  }

  function monthlyBlock(x, withHousehold) {
    var m = x.ev.monthly, h = [];
    h.push('<h3>' + esc(x.f.name) + '</h3>');
    if (!m.quoteKnown) {
      h.push('<p class="warn"><strong>見積書の月額を入れると、毎月の合計が出ます。</strong></p>');
      return h.join('');
    }
    var label = m.unknown.length ? '分かっている費用だけの合計' : '毎月の合計';
    h.push('<dl class="kv">');
    h.push('<dt>見積書の月額</dt><dd>' + yen(m.Q) + '</dd>');
    h.push('<dt>月額のほかにかかる費用（確認できた分）</dt><dd>' + yen(m.E) + (m.hasRange ? '〜' + yen(m.EHigh) : '') + '</dd>');
    h.push('<dt><strong>' + label + '</strong></dt><dd><strong>' + yen(m.C) + (m.hasRange ? '〜' + yen(m.CHigh) : '') + '</strong></dd>');
    h.push('<dt>入居時に払うお金</dt><dd>' + (m.entryKnown ? yen(m.F) : 'まだ不明') + '</dd>');
    h.push('</dl>');
    if (m.unknown.length) {
      h.push('<p class="warn"><strong>未確認の費用：' + m.unknown.length + '件（' +
        m.unknown.map(function (u) { return esc(u.label); }).join('、') +
        '）。</strong>その分が加わると、実際の支払いは高くなる場合があります。</p>');
    }
    if (withHousehold && x.ev.ready) {
      var d = x.ev.plan.D;
      h.push('<p class="note">' + (d > 0 ? '年金などの手取りでは、毎月' + yen(d) + '足りません。毎月足りない分は、貯金から補うことになります。' : '年金などの手取りから毎月' + yen(-d) + '残ります。') + '</p>');
    }
    if (m.provisional.length) {
      h.push('<p class="note">仮に入れた金額：' + m.provisional.map(function (p) { return esc(p.label) + ' ' + yen(p.amount); }).join('、') + '</p>');
    }
    return h.join('');
  }

  function planBlock(x, T) {
    var ev = x.ev, h = [];
    h.push('<h3>' + esc(x.f.name) + '</h3>');
    if (!ev.ready) {
      h.push('<p class="warn">' + ev.blockers.map(planBlockerText).join('・') + 'を入れると、ここに結果が出ます。</p>');
      return h.join('');
    }
    var cond = ev.knownOnly ? '<p class="cond"><strong>今分かっている費用だけで出した期間です。</strong></p>' : '';
    h.push(cond);
    var p = ev.plan;
    if (p.state === 'initial_short') {
      h.push('<p class="big">入居時の支払いが<strong>' + yen(p.initialShort) + '</strong>足りません。</p>');
      h.push('<p class="note">介護に使えるお金から、手元に残す分を引いた金額で比べています。</p>');
    } else if (p.state === 'no_drawdown') {
      h.push('<p class="big">毎月' + yen(p.monthlySurplus) + '残るため、<strong>この条件では貯金を取り崩しません。</strong></p>');
    } else {
      // 2026-10-17 ちゃっトク：「計算に使えるお金」という名前を付けず、引いた後の額（L）をそのまま言う
      h.push('<p class="big">介護に使えるお金から、手元に残す分と入居時の支払いを引くと' + yenMan(p.L) + '。<br>' +
        '毎月' + yen(p.D) + 'ずつ使うと、<strong>' + months(p.fullMonths) + '分</strong>。<strong>' + p.shortMonth + 'か月目</strong>から不足します。</p>');
    }
    if (ev.planHigh && ev.planHigh.state === 'drawdown' && p.state !== 'initial_short') {
      h.push('<p class="note">別料金が多い月の金額で計算すると、' + months(ev.planHigh.fullMonths) + '分です。</p>');
    }
    if (ev.planSupport) {
      var s = ev.planSupport;
      h.push('<p class="note">家族から月' + yen(ev.income.support) + 'の援助がある場合は、' +
        (s.state === 'drawdown' ? months(s.fullMonths) + '分' :
         s.state === 'no_drawdown' ? '毎月の取り崩しなし' : '入居時に不足') + 'です。家族からの援助は上の金額には含めず、別に計算しています。</p>');
    }
    // 総支出
    h.push('<table class="tbl plan"><thead><tr><th>期間</th><th>そこまでに払う合計</th><th>その時の残り</th></tr></thead><tbody>');
    ev.totals.forEach(function (t) {
      h.push('<tr><td>' + periodLabel(t.T) + '</td><td>' + yenMan(t.spend) + (t.spendHigh !== null ? '<br><span class="note">多い方：' + yenMan(t.spendHigh) + '</span>' : '') +
        '</td><td>' + (p.state === 'initial_short' ? '—' : (t.balance < 0 ? '<span class="neg">' + yen(t.balance) + '（' + yen(-t.balance) + '足りない）</span>' : yen(t.balance))) + '</td></tr>');
    });
    h.push('</tbody></table>');
    return h.join('');
  }

  /* ---------- 主役：施設に毎月いくらまで払えるか ---------- */
  // 2026-10-16 BUBU 決4：結果の後で「まだ反映されていない項目があります」と言う断り書き（後出し）をやめ、
  // 「介護にかけられるお金」と「この中から払うもの」の内訳の形にした。残すお金・家族の生活費・入居時のお金は、入力の所の「あれば入れる」に先に並べてある。
  // 「施設以外にかかるお金」（医療費・おむつ代など）を入れた時だけ、そこから引いた「施設に回せるお金」を大きく出す。計算は変えていない（文と並びだけ）
  var PAY_FROM = ['施設に払う月額', '病院代・薬代', 'おむつ代・日用品など'];
  // opt.print＝印刷の紙（畳まずに全部出す・ボタンは出さない）。opt.otherHref＝「おむつ代・医療費を入れる」の行き先（既定＝同じページの「あれば入れる」）
  function budgetBlock(input, opt) {
    var forPrint = !!(opt && opt.print);
    var otherHref = (opt && opt.otherHref) || '#more-box';
    var otherLabel = (opt && opt.otherLabel) || 'おむつ代・医療費を入れる';
    var b = K.budget(input.household);
    var h = [];
    if (!b.ready) {
      // 画面の欄の並び（本人の手取り → 介護に使えるお金）で、足りない欄の名前だけ出す
      var miss = ['income', 'funds'].filter(function (k) { return b.blockers.indexOf(k) >= 0; });
      h.push('<p class="wait">「' + miss.map(blockerText).join('」と「') + '」を入れると、ここに月の目安が出ます。</p>');
      return h.join('');
    }
    if (b.state === 'initial_short') {
      h.push('<p class="warn"><strong>入居時の支払いが' + yenMan(b.initialShort) + '不足しています。</strong>手元に残す分は除いています。入居金を減らすと再計算できます。</p>');
      return h.join('');
    }
    var mid = budgetMid(input, b);
    function amount(r) { return b.otherKnown ? r.cap : r.careTotal; }
    var lead = '<span class="hl-k">' + mid.years + '年分での目安</span>';
    h.push('<div class="res-main">');
    if (amount(mid) < 0) {
      h.push('<p class="headline"><strong>今の金額では、施設の費用に充てられるお金が残りません。</strong></p>');
    } else if (b.otherKnown) {
      h.push('<p class="headline">' + lead + '施設の費用に使える金額<br><strong class="cap-num">月 約' + yen(mid.cap) + '</strong></p>');
      h.push('<div class="pay-from"><ul class="pf-calc">' +
        '<li><span>介護にかけられるお金</span><span>月 約' + yen(mid.careTotal) + '</span></li>' +
        '<li><span>施設以外にかかるお金</span><span>− 月 ' + yen(b.E) + '</span></li>' +
        '<li><span>施設の費用に使える金額</span><span>＝ 月 約' + yen(mid.cap) + '</span></li>' +
        '</ul></div>');
    } else {
      h.push('<p class="headline">' + lead + '介護にかけられるお金<br><strong class="cap-num">月 約' + yen(mid.careTotal) + '</strong></p>');
      // 見出し「この中から払うもの」とボタン「おむつ代・医療費を入れる」は BUBU 2026-10-16 決4 の形のまま（ちゃっトク案「この金額に含まれる費用」「施設以外にかかるお金を入れる」より優先）
      h.push('<div class="pay-from"><p class="pf-title">この中から払うもの</p><ul class="pf-list">' +
        PAY_FROM.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>' +
        '<p class="pf-next">施設代も、病院代や日用品代もこの金額から。施設以外の費用を入れると、施設に使える額も分かります。</p>' +
        (forPrint ? '' : '<a class="btn-line" href="' + esc(otherHref) + '" data-open-other>' + esc(otherLabel) + '<span class="arr" aria-hidden="true">›</span></a>') +
        '</div>');
    }
    h.push('</div>');
    h.push('<div class="caps">');
    b.rows.forEach(function (r) {
      var v = amount(r);
      h.push('<div class="cap-box' + (r === mid ? ' is-mid' : '') + '"><span class="cap-y">' + r.years + '年分</span>' +
        (v < 0 ? '<span class="cap-v neg">施設に充てる分なし</span>' : '<span class="cap-v">月 約' + yen(v) + '</span>') + '</div>');
    });
    h.push('</div>');
    if (b.rowsSupport) {
      h.push('<p class="note"><strong>家族から月' + yen(b.income.support) + 'の援助がある場合</strong><br>' +
        b.rowsSupport.map(function (r) { var v = amount(r); return r.years + '年分 ' + (v < 0 ? '施設に充てる分なし' : '月 約' + yen(v)); }).join('／') +
        '（上の結果は援助なし）</p>');
    }
    if (b.income.spouseHeld) {
      h.push('<p class="note">家族の手取りは、まだ計算に加えていません。生活費も入れると、家の暮らしに必要な分を先に取って計算できます。</p>');
    }
    if (!forPrint) h.push('<details class="fold"><summary>この金額はどう出したの？</summary>');
    h.push('<p class="basis">介護に使えるお金を選んだ年数で月割りし、手取りに足します。手元に残すお金や入居金は先に引き、病院代なども入力があれば差し引きます。</p>');
    h.push('<p class="note">計算する年数が長いほど、月の金額は小さくなります。</p>');
    if (!forPrint) h.push('</details>');
    return h.join('');
  }
  function budgetMid(input, b) {
    var want = input.household.periodYears || 10; // 選んだ長さを真ん中に出す（初期は10年）
    return b.rows.filter(function (r) { return r.years === want; })[0] || b.rows[1] || b.rows[0];
  }
  // 「もう少し細かく計算する」の中に出す、今の答えの短い控え（入れながら上まで戻らずに済むように）
  function budgetEcho(input) {
    var b = K.budget(input.household);
    if (!b.ready) return '上の2つを入れると、ここに金額が出ます。';
    if (b.state === 'initial_short') return '入居時の支払いが' + yenMan(b.initialShort) + '足りません。';
    var mid = budgetMid(input, b);
    var v = b.otherKnown ? mid.cap : mid.careTotal;
    if (v < 0) return '施設の費用に充てられるお金がありません。';
    return b.otherKnown
      ? mid.years + '年分で、施設の費用に使える金額：月 約' + yen(v)
      : mid.years + '年分で、介護にかけられるお金：月 約' + yen(v) + '（施設代などを含む）';
  }

  // 見積もりの毎月の支出を、主役の上限（5・10・15年）と並べる
  function capCompareBlock(x, input) {
    var m = x.ev.monthly;
    if (!m.quoteKnown) return '';
    var b = K.budget(input.household);
    if (!b.ready || b.state !== 'ok') {
      return '<p class="note">先に月の予算を計算すると、差も表示されます。</p>';
    }
    var h = ['<div class="vs"><p class="vs-title"><strong>月の予算と比べる</strong><br>この施設の毎月の費用は ' + yen(m.C) + (m.hasRange ? '（多い月は ' + yen(m.CHigh) + '）' : '') + 'です。</p>'];
    h.push('<table class="tbl"><thead><tr><th>何年分</th><th>月の目安</th><th>この施設の費用は</th></tr></thead><tbody>');
    b.rows.forEach(function (r) {
      var v = b.otherKnown ? r.cap : r.careTotal;
      var diff = m.C - v;
      h.push('<tr><td>' + r.years + '年</td><td>約' + yen(v) + '</td><td>' +
        (diff > 0 ? '<span class="neg">目安より ' + yen(diff) + ' 高い</span>' : diff < 0 ? '目安より ' + yen(-diff) + ' 低い' : '目安と同じ') + '</td></tr>');
    });
    h.push('</tbody></table>');
    var notes = [];
    if (!b.otherKnown) notes.push('上の目安は病院代やおむつ代などを引く前の金額です。');
    if (m.unknown.length) notes.push('未確認の費用' + m.unknown.length + '件は、この金額に含まれていません。');
    if (m.entryKnown && m.F !== b.F) notes.push('この施設の入居時の支払いは' + yen(m.F) + '。月の目安は上で入れた' + yen(b.F) + 'で計算しています。');
    if (b.otherKnown && m.E > 0) notes.push('「施設以外にかかるお金」と「別料金」に同じ費用を入れると二重になります。');
    if (notes.length) h.push('<p class="note">' + notes.join('') + '</p>');
    h.push('</div>');
    return h.join('');
  }

  /* ---------- 入口のページ：早見表 ---------- */
  // 「8年4か月」の形（表のマスに入れる短い言い方）。30年以上は「30年以上」にまとめる
  var LONG_MONTHS = 360;
  function yearsMonths(n, breakable) {
    if (n >= LONG_MONTHS) return '30年' + (breakable ? '<wbr>' : '') + '以上';
    var y = Math.floor(n / 12), m = n % 12;
    if (!y) return m + 'か月';
    return y + '年' + (m ? (breakable ? '<wbr>' : '') + m + 'か月' : '');
  }
  function savingsTableBlock(t) {
    var h = ['<table class="tbl quick"><caption>貯金で払える期間</caption><thead><tr><th scope="col">貯金 ／<wbr>毎月<wbr>足りない額</th>'];
    t.shorts.forEach(function (s) { h.push('<th scope="col">月' + s + '<wbr>万円</th>'); }); // 狭い画面でも字が重ならないよう、折れ目を置く
    h.push('</tr></thead><tbody>');
    t.rows.forEach(function (r) {
      h.push('<tr><th scope="row">' + r.fundsMan.toLocaleString('en-US') + '<wbr>万円</th>');
      r.cells.forEach(function (c) { h.push('<td>' + yearsMonths(c.fullMonths, true) + '</td>'); });
      h.push('</tr>');
    });
    h.push('</tbody></table>');
    return h.join('');
  }

  /* ---------- 施設に聞いておきたいこと ---------- */
  function checklistBlock() {
    var h = ['<ol class="checklist">'];
    K.facilityChecklist().forEach(function (q) { h.push('<li>' + esc(q.text) + '<span class="answer">回答・メモ：</span></li>'); });
    h.push('</ol>');
    return h.join('');
  }

  function compareBlock(r) {
    if (!r.cmp) return '';
    var a = r.facs[0].f.name, b = r.facs[1].f.name, c = r.cmp;
    var t;
    if (c.kind === 'missing_quote') t = 'まだ月額が入っていない施設があるため、比べられません。';
    else if (c.kind === 'need_check') t = '<strong>' + esc(a) + 'に' + c.unknownA + '件、' + esc(b) + 'に' + c.unknownB + '件、未確認の費用があります。</strong>金額が分かるまでは、安い方を出していません。';
    else if (c.kind === 'same') t = '入力した金額では、毎月の費用は同じです。';
    else if (c.kind === 'range_overlap') t = '別料金に幅があるため、今はどちらが安いか決められません。';
    else {
      var md = c.monthlyDiff, ed = c.entryDiff;
      t = '毎月の費用は' + (md === 0 ? '同じで' : (md < 0 ? esc(a) : esc(b)) + 'の方が' + yen(Math.abs(md)) + '少なく') +
        '、入居時の支払いは' + (ed === 0 ? '同じです。' : (ed < 0 ? esc(a) : esc(b)) + 'の方が' + yen(Math.abs(ed)) + '少なくなります。');
    }
    return '<div class="compare"><h3>2つの施設を比べる</h3><p>' + t + '</p><p class="note">ここで比べられるのは費用です。本人に合うかどうかは、見学で確かめてください。</p></div>';
  }

  function questionsBlock(qs, title) {
    var h = ['<div class="questions">' + (title ? '<h3>' + title + '</h3>' : '') + '<ol>'];
    qs.forEach(function (q) { h.push('<li>' + esc(q.text) + '<span class="answer">確認できたこと：</span></li>'); });
    h.push('</ol></div>');
    return h.join('');
  }

  function quoteTable(input, forStaff) {
    var defs = K.ITEM_DEFS;
    var h = ['<table class="tbl quote"><thead><tr><th>費用の項目</th>'];
    input.facilities.forEach(function (f) { h.push('<th>' + esc(f.name) + '</th>'); });
    h.push('</tr></thead><tbody>');
    function cell(f, def) {
      var it = (f.items && f.items[def.key]) || { inclusion: 'unknown' };
      if (it.inclusion === 'included') return '月額に含む';
      if (it.inclusion === 'separate') {
        if (it.amount === null || it.amount === undefined) return '<span class="unk">別料金・金額はまだ不明</span>' + (forStaff ? '<span class="fill">月　　　　円</span>' : '');
        var s = '別料金 ' + yen(it.amount) + (def.unit === 'visit' ? '／回 × ' + (it.visits === null || it.visits === undefined ? '<span class="unk">回数はまだ不明</span>' : it.visits + '回') : '');
        if (it.amountHigh && it.amountHigh > it.amount) s += '〜' + yen(it.amountHigh);
        if (it.certainty === 'provisional') s += ' <span class="prov">（仮に入れた額）</span>';
        return s;
      }
      return '<span class="unk">まだ不明</span>' + (forStaff ? '<span class="fill">含む ・ 別料金 月　　　円</span>' : '');
    }
    h.push('<tr><td>見積書の月額（税込）</td>');
    input.facilities.forEach(function (f) { h.push('<td>' + (f.monthlyQuote === null || f.monthlyQuote === undefined ? '<span class="unk">まだ不明</span>' : yen(f.monthlyQuote)) + '</td>'); });
    h.push('</tr><tr><td>入居時にまとめて払うお金</td>');
    input.facilities.forEach(function (f) { h.push('<td>' + (f.entryFee === null || f.entryFee === undefined ? '<span class="unk">まだ不明</span>' + (forStaff ? '<span class="fill">　　　　円</span>' : '') : yen(f.entryFee)) + '</td>'); });
    h.push('</tr><tr><td>見積もりの日付</td>');
    input.facilities.forEach(function (f) { h.push('<td>' + (f.quoteDate ? esc(f.quoteDate) : '<span class="unk">未記入</span>') + '</td>'); });
    h.push('</tr>');
    defs.forEach(function (def) {
      h.push('<tr><td>' + esc(def.label) + '</td>');
      input.facilities.forEach(function (f) { h.push('<td>' + cell(f, def) + '</td>'); });
      h.push('</tr>');
    });
    h.push('</tbody></table>');
    return h.join('');
  }

  function scopeNote() {
    return '<p class="scope">入力した金額での目安です。入居金の返金と値上げは含みません。</p>';
  }

  /* ---------- 画面の結果 ---------- */
  function renderScreen(input) {
    var r = build(input);
    var h = [];
    h.push('<section class="res-sec"><h2>① 毎月、いくらかかる？</h2>');
    r.facs.forEach(function (x) { h.push('<div class="card">' + monthlyBlock(x, true) + capCompareBlock(x, input) + '</div>'); });
    h.push(compareBlock(r));
    h.push('</section>');
    h.push('<section class="res-sec"><h2>② 貯金で何年分の費用を払える？</h2>');
    r.facs.forEach(function (x) { h.push('<div class="card">' + planBlock(x, r.T) + '</div>'); });
    h.push('</section>');
    h.push('<section class="res-sec"><h2>③ 次に確認したいこと（3つ）</h2><p class="note">先に確かめたい3つです。答えを書き込めます。</p>' + questionsBlock(r.questions, '') + '</section>');
    h.push(scopeNote());
    return h.join('');
  }

  /* ---------- 印刷票 ---------- */
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function renderSheet(input, mode, madeOn) {
    var r = build(input);
    var date = madeOn || today();
    var h = [];
    if (mode === 'checklist') {
      h.push('<h1>施設の見学で聞いておきたいこと</h1>');
      h.push('<p class="meta">作成日 ' + esc(date) + '／この紙には、貯金や収入など家計の金額は載せていません。</p>');
      h.push('<table class="tbl blanks"><tbody>' +
        '<tr><td>施設名</td><td></td></tr>' +
        '<tr><td>見学・確認した日</td><td></td></tr>' +
        '<tr><td>対応してくれた方</td><td></td></tr></tbody></table>');
      h.push(checklistBlock());
      h.push('<p class="meta">聞いた内容は、見積書と一緒に取っておくと、ほかの施設とも比べやすくなります。</p>');
      return h.join('');
    }
    if (mode === 'facility') {
      h.push('<h1>施設に確認したい費用（家計の金額なし）</h1>');
      h.push('<p class="meta">作成日 ' + esc(date) + '／この紙には貯金・収入など家計の金額を載せていません。</p>');
      h.push('<p>見積もりの内容について、まだ確認できていないところがあります。分かる範囲で教えていただけますか。</p>');
      h.push(quoteTable(input, true));
      h.push(questionsBlock(r.facilityQuestions, '施設に確認したいこと（最大6つ）'));
      h.push('<p class="meta">ご記入いただいた方：　　　　　　　　　　　日付：</p>');
      return h.join('');
    }
    h.push('<h1>施設の費用と家計のまとめ（家族用）</h1>');
    h.push('<p class="meta">作成日 ' + esc(date) + '／' + periodLabel(r.T) + '分で計算</p>');
    h.push('<h2>見積もりの内訳</h2>' + quoteTable(input, false));
    h.push('<h2>入力した家計の金額</h2>' + householdTable(input));
    h.push('<h2>施設に毎月いくら使えるか</h2>' + budgetBlock(input, { print: true }));
    h.push('<h2>毎月かかる費用</h2>');
    r.facs.forEach(function (x) { h.push('<div class="card">' + monthlyBlock(x, true) + '</div>'); });
    h.push(compareBlock(r));
    h.push('<h2>払う総額と期間</h2>');
    r.facs.forEach(function (x) { h.push('<div class="card">' + planBlock(x, r.T) + '</div>'); });
    h.push(questionsBlock(r.questions, '次に確認したい3つ'));
    h.push(formulaBlock());
    h.push(scopeNote());
    return h.join('');
  }

  function householdTable(input) {
    var hh = input.household, hi = K.householdIncome(hh);
    var rows = [
      ['介護に使えるお金', hh.funds],
      ['手元に残しておくお金', hh.reserve === null || hh.reserve === undefined ? 0 : hh.reserve]
    ];
    if (hh.mode === 'detail') {
      rows.push(['本人の毎月の手取り（年金など）', hh.incomeSelf]);
      rows.push([hi.spouseHeld ? '家で暮らす家族の手取り（月・まだ計算に含まず）' : '家で暮らす家族の手取り（月）', hh.incomeSpouse === null || hh.incomeSpouse === undefined ? 0 : hh.incomeSpouse]);
      rows.push(['家で暮らす家族の生活費（月・先に取り分ける分）', hh.spouseLiving]);
    }
    rows.push(['毎月介護に使える手取り', hi.I]);
    rows.push(['入居時にまとめて払うお金', hh.entryBudget === null || hh.entryBudget === undefined ? 0 : hh.entryBudget]);
    rows.push(['施設以外にかかるお金（月）', hh.otherMonthly]);
    if (hi.support) rows.push(['家族からの援助（別案だけで使用）', hi.support]);
    return '<table class="tbl"><tbody>' + rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + yen(r[1]) + '</td></tr>'; }).join('') + '</tbody></table>';
  }

  function formulaBlock() {
    return '<div class="formula"><h3>計算のしかた</h3><ul>' +
      '<li><strong>計算に使えるお金</strong> ＝ 介護に使えるお金 − 手元に残しておくお金 − 入居時に払うお金</li>' +
      '<li><strong>毎月の支出</strong> ＝ 見積書の月額 ＋ 月額に含まれない費用（分かっている分）</li>' +
      '<li><strong>毎月足りない額</strong> ＝ 毎月の支出 − 毎月介護に使える手取り</li>' +
      '<li><strong>何か月払えるか</strong>は、介護に使えるお金から手元に残す分や入居時の支払いを引き、毎月足りない額で割って出します。1か月未満は数えません。その次の月から足りなくなります。</li>' +
      '<li><strong>施設の費用に使える金額（5・10・15年）</strong> ＝ 毎月介護に使える手取り ＋（介護に使えるお金 − 手元に残しておくお金 − 入居時に払うお金）÷ 選んだ月数 − 施設以外にかかるお金（円未満は四捨五入）。</li>' +
      '<li><strong>介護にかけられるお金</strong>（施設以外にかかるお金が空欄の時）＝ 施設代や医療費など、介護全体に毎月使える金額です。</li>' +
      '<li><strong>毎月介護に使える手取り</strong> ＝ 本人の手取り ＋ 家で暮らす家族の手取り − 家で暮らす家族の生活費。生活費が空欄の時は、本人の手取りだけで計算します。</li>' +
      '<li><strong>空欄の扱い</strong> ＝ 入力のない金額は引きません。追加で金額を入れると、月の目安が下がることがあります（家族の手取りは、生活費と一緒に入力した時だけ加えます）。</li>' +
      '</ul></div>';
  }

  return {
    FORMULA_VERSION: FORMULA_VERSION,
    esc: esc, yen: yen, man: man, months: months,
    build: build,
    renderBudget: budgetBlock,
    renderBudgetEcho: budgetEcho,
    renderChecklist: checklistBlock,
    yearsMonths: yearsMonths,
    renderSavingsTable: savingsTableBlock,
    renderScreen: renderScreen,
    renderSheet: renderSheet
  };
});
