/*
 * 川崎市で比べる — 予算・区・要介護度から、施設の種類ごとの行を作る（DOM を触らない・計算核 core.js は変えない）
 * ・広告の設定を読まない（件数・並び順・「予算以内」の判定に広告が入り込まない）
 * ・「入れる」とは言わない。言うのは「届出の月額が予算以内の施設が◯件」「計算の目安」まで
 * ・施設の名前は持たない（data は金額と区だけ）
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KaigoCompare = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // desc＝初めて見る人への一言（画面の行・冒頭の札・トップの「ことば」の3か所で同じ文を使う）／more＝「くわしく見る」の中身
  var TYPES = [
    { key: 'tokuyo', name: '特別養護老人ホーム（特養）', short: '特養',
      desc: '介護が多く必要になった方が暮らす、介護保険の施設です。原則、要介護3以上の方が対象です。',
      more: '費用は民間の有料老人ホームより抑えられる傾向がありますが、空きを待つ場合もあります。申し込んだ順に入れるとは限りません。' },
    // ちゃっトク案は「施設の月額に加えて…」。届出の月額（下の川崎市の行）には自己負担が入っていることが多いので、足し算に読めないよう「月額といっしょに」にした
    { key: 'kaigo', name: '介護付き有料老人ホーム', short: '介護付き有料',
      desc: '施設の職員から介護を受けながら暮らす、民間の老人ホームです。',
      more: '介護保険の自己負担は、要介護度によって変わります。月額に含まれるかは施設ごとに違うので、確認してください。' },
    { key: 'jutaku', name: '住宅型有料老人ホーム', short: '住宅型有料',
      desc: '食事や日常生活の手助けを受けながら暮らせる、民間の老人ホームです。',
      more: '介護が必要な場合は、訪問介護など外部のサービスを別に契約します。介護保険を使った分の自己負担は、施設の月額とは別にかかります。' },
    { key: 'satsuki', name: 'サービス付き高齢者向け住宅（サ高住）', short: 'サ高住',
      desc: '安否確認や生活相談のサービスが付いた、高齢者向けの賃貸住宅です。',
      more: '介護は外部のサービスを利用する形が基本で、利用した分は別料金です。なかには、施設の職員による介護を受けられる住まいもあります。' },
    { key: 'gh', name: 'グループホーム（認知症の方の共同生活）', short: 'グループホーム',
      desc: '認知症の方が、職員の手を借りながら少人数で一緒に暮らす施設です。',
      more: '1か所5〜9人で暮らします。原則として、施設のある市区町村に住民登録のある方が対象です。' },
    { key: 'roken', name: '介護老人保健施設（老健）', short: '老健',
      desc: '退院後などにリハビリを受け、家での暮らしに戻ることを目指す介護保険の施設です。',
      more: '長く暮らす住まいというより、自宅へ戻るまでの期間に利用する施設です。' }
  ];
  var ROOMS = ['多床室', '従来型個室', 'ユニット型個室'];
  var MEDIAN_MIN = 5; // 区の中央値は、届出の月額が分かる施設が5件以上の時だけ出す

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function yen(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '円'; }
  function man(n) { // 12.3万円（千円の位で四捨五入）
    var v = Math.round(n / 1000) / 10;
    return v.toFixed(1).replace(/\.0$/, '') + '万円';
  }
  function median(v) {
    if (!v.length) return null;
    var s = v.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function sumWards(obj, wards) { return wards.reduce(function (a, w) { return a + (obj[w] || 0); }, 0); }
  function pick(obj, ward, wards) { return ward ? (obj[ward] || 0) : sumWards(obj, wards); }
  function pricesOf(data, key, ward) {
    var p = data.prices[key];
    if (ward) return (p[ward] || []).slice();
    return data.wards.reduce(function (a, w) { return a.concat(p[w] || []); }, []);
  }
  function levelsFor(level, from) { // 要介護度が分からない時は、その施設で数える範囲（特養3〜5・ほか1〜5）
    if (level >= from && level <= 5) return [level];
    var out = []; for (var i = from; i <= 5; i++) out.push(i); return out;
  }
  // 予算の日付の期限：介護報酬・地域区分の見直し（2027年4月予定）で、計算の目安は古くなる
  function expired(data, today) {
    var d = today || new Date();
    var y = d.getFullYear(), m = ('0' + (d.getMonth() + 1)).slice(-2), dd = ('0' + d.getDate()).slice(-2);
    return (y + '-' + m + '-' + dd) > data.validUntil;
  }

  /*
   * opt = { budget: 月の額（円・null＝まだ無い／マイナスあり）, kind: 'facility'|'care'（施設に払える額／介護に使える額）,
   *         entry: 入居時に払うお金（円・null＝空欄）, ward: '' か区の名前, level: 0（分からない）か1〜5, today: Date }
   */
  function compare(data, opt) {
    opt = opt || {};
    var ward = data.wards.indexOf(opt.ward) >= 0 ? opt.ward : '';
    var level = Number(opt.level) || 0;
    var hasBudget = typeof opt.budget === 'number' && isFinite(opt.budget);
    var budget = hasBudget ? opt.budget : null;
    var usable = hasBudget && budget > 0;
    var entry = typeof opt.entry === 'number' && opt.entry > 0 ? opt.entry : 0;
    var stop = expired(data, opt.today);
    var rows = TYPES.map(function (t) {
      var row = { key: t.key, name: t.name, short: t.short, count: pick(data.counts[t.key], ward, data.wards), notes: [] };
      if (t.key === 'kaigo' || t.key === 'jutaku' || t.key === 'satsuki') {
        var all = pricesOf(data, t.key, ward);
        var totals = all.map(function (p) { return p[0]; });
        row.priced = all.length;
        row.median = all.length >= MEDIAN_MIN ? median(totals) : null;
        row.cityMedian = median(pricesOf(data, t.key, '').map(function (p) { return p[0]; }));
        row.min = totals.length ? Math.min.apply(null, totals) : null;
        row.max = totals.length ? Math.max.apply(null, totals) : null;
        if (usable) {
          // 1施設に「代表のプラン（前払金なし優先）」と「安い方のプラン」の2つ。どちらかが予算以内で、前払金なし（か、入れた入居時のお金で払える）なら数える
          var plans = function (p) { return p.length >= 4 ? [[p[0], p[1]], [p[2], p[3]]] : [[p[0], p[1]]]; };
          var fits = function (p) { return plans(p).some(function (pl) { return pl[0] <= budget && (pl[1] === 0 || (entry > 0 && pl[1] <= entry)); }); };
          row.within = all.filter(fits).length;
          row.prepaidOnly = all.filter(function (p) { return !fits(p) && plans(p).some(function (pl) { return pl[0] <= budget; }); }).length;
        }
      } else if (t.key === 'tokuyo' || t.key === 'roken') {
        var lv = levelsFor(level, t.key === 'tokuyo' ? 3 : 1);
        var table = data.monthly[t.key];
        var vals = [];
        ROOMS.forEach(function (r) { lv.forEach(function (l) { vals.push(table[r][String(l)]); }); });
        row.levels = lv;
        row.stopped = stop;
        if (!stop) {
          row.min = Math.min.apply(null, vals);
          row.max = Math.max.apply(null, vals);
          if (usable) {
            row.roomsWithin = ROOMS.filter(function (r) { return lv.every(function (l) { return table[r][String(l)] <= budget; }); });
          }
        }
        if (t.key === 'tokuyo') {
          row.capacity = pick(data.tokuyo.capacity, ward, data.wards);
          row.mitchaku = pick(data.tokuyo.mitchaku, ward, data.wards);
          if (level === 1 || level === 2) row.levelNote = true;
        }
      } else if (t.key === 'gh') {
        var lv2 = levelsFor(level, 1);
        row.levels = lv2;
        row.stopped = stop;
        if (!stop) {
          row.careMin = Math.min.apply(null, lv2.map(function (l) { return data.care1.gh2[l - 1]; }));
          row.careMax = Math.max.apply(null, lv2.map(function (l) { return data.care1.gh1[l - 1]; }));
        }
      }
      return row;
    });
    return { ward: ward, level: level, hasBudget: hasBudget, usable: usable, budget: budget, kind: opt.kind || null, entry: entry, stopped: stop, rows: rows };
  }

  function levelText(lv) {
    return lv.length === 1 ? '要介護' + lv[0] : '要介護' + lv[0] + '〜' + lv[lv.length - 1];
  }
  function place(r) { return r.ward ? r.ward : '川崎市'; }

  /* ---------- 画面の文（文字列だけ返す） ---------- */
  function render(data, r) {
    var h = [];
    var where = place(r);
    if (!r.hasBudget) {
      h.push('<p class="kw-basis">まずは' + esc(where) + 'の施設数と月額をご覧いただけます。上で予算を出すと、予算以内の数も分かります。</p>');
    } else if (!r.usable) {
      h.push('<p class="kw-basis warn">' + (r.kind === 'entryShort'
        ? '入居時の支払いが不足しているため、予算以内の施設数は出していません。'
        : '施設に充てられる金額がないため、予算以内の施設数は出していません。') + '</p>');
    } else if (r.kind === 'facility') {
      h.push('<p class="kw-basis"><strong>月 約' + yen(r.budget) + '</strong>で比較中（病院代・おむつ代などを差し引いた額）。</p>');
    } else {
      h.push('<div class="kw-basis"><p><strong>月 約' + yen(r.budget) + '</strong>で比較中。病院代などを引く前なので、予算以内の数は多めに出ます。</p>' +
        '<a class="btn-line" href="#more-box" data-open-other>病院代なども入れて比べる<span class="arr" aria-hidden="true">›</span></a></div>');
    }
    h.push('<ul class="kw-list">');
    r.rows.forEach(function (x) { h.push('<li class="kw-row kw-' + x.key + '">' + rowHtml(data, r, x, where) + '</li>'); });
    h.push('</ul>');
    if (r.usable) {
      // ちゃっトク案「川崎市の重要事項説明書」→ 書類を作るのは施設で、市はそれを公開している＝「川崎市が公開している」にした（10/16 と同じ直し）
      h.push('<p class="note">「予算以内」は、川崎市が公開している重要事項説明書の月額で比べた数です（前払金なしを優先）。<strong>空室の数ではありません。</strong>入居条件や実際の費用は施設へ。</p>');
    }
    return h.join('');
  }

  // 1つの種類の札：名前と数 → 一言の説明 → 「この予算以内」（いちばん大きく） → 月額 → 金額の意味に関わる注意（見えたまま）
  // → それ以外の注意は「くわしく見る」の中へ（文は前と同じ）
  function rowHtml(data, r, x, where) {
    var t = TYPES.filter(function (y) { return y.key === x.key; })[0];
    var h = ['<h3>' + esc(x.name) + '<span class="kw-count">' + esc(where) + 'に ' + x.count + 'か所</span></h3>', '<p class="kw-desc">' + esc(t.desc) + '</p>'];
    var more = [];
    function fold() { if (more.length) h.push('<details class="fold kw-more"><summary>料金と入居条件を詳しく見る</summary>' + more.join('') + '</details>'); }
    if (x.key === 'kaigo' || x.key === 'jutaku' || x.key === 'satsuki') {
      if (x.priced === 0) {
        h.push('<p>この区には、月額が分かる施設がありません。</p>');
      } else {
        if (r.usable) {
          h.push('<p class="kw-within">月額が分かる' + x.priced + '件のうち、<span class="nw">予算以内は<strong>' + x.within + '件</strong>です。</span></p>');
          if (x.prepaidOnly) h.push('<p class="note">前払金のあるプランなら、ほかに' + x.prepaidOnly + '件。入居時のお金を入力すると数に加わります。</p>');
        }
        h.push('<p class="kw-money">月額の目安：' + (x.median !== null ? '<span class="nw">真ん中 約' + man(x.median) + '</span>／' : '') + '<span class="nw">安い施設 約' + man(x.min) + '</span>／<span class="nw">高い施設 約' + man(x.max) + '</span>（月額が分かる' + x.priced + '件）</p>');
        if (x.median === null) {
          h.push('<p class="note">' + (x.key === 'kaigo'
            ? 'この区は件数が少ないため、川崎市全体の真ん中の額（約' + man(x.cityMedian) + '）を載せています。'
            : '件数が少ないため、川崎市全体の真ん中の額（約' + man(x.cityMedian) + '）を載せています。') + '</p>');
        }
      }
      if (x.key === 'kaigo') {
        h.push('<p class="note">介護保険の自己負担は、1割負担なら月 約' + man(data.care1.kaigo[0]) + '〜' + man(data.care1.kaigo[4]) + '（要介護1〜5）。月額に含む施設が多いものの、別の場合もあります。病院代・おむつ代は別です。</p>');
      } else {
        h.push('<p class="note">月額のほかに、介護サービス代（介護保険利用分の<strong>1〜3割</strong>）がかかります。病院代・おむつ代も別です。</p>');
      }
      if (x.key === 'satsuki') more.push('<p class="note">施設の数は神奈川県の登録情報から、月額は有料老人ホームにも該当する施設の料金資料から調べています。</p>');
      fold();
      return h.join('');
    }
    if (x.key === 'tokuyo' || x.key === 'roken') {
      if (x.stopped) {
        h.push('<p class="warn">介護保険の料金改定に伴い、月額の目安を確認中です。</p>');
      } else {
        if (r.usable) {
          // 2026-10-17 ちゃっトク：計算のもと（国の基準）は言わない＝出どころは一番下の畳んだ欄に残してある
          h.push('<p class="kw-within">' + (x.roomsWithin.length === 3 ? 'どの部屋も<span class="nw">予算以内です。</span>'
            : x.roomsWithin.length ? '予算以内の部屋：<strong>' + x.roomsWithin.map(function (rm) { return rm === '多床室' ? '多床室（相部屋）' : rm; }).join('・') + '</strong>'
              : '部屋代を含む目安が予算を超えています。') + '</p>');
        }
        h.push('<p class="kw-money">月額の目安：' + levelText(x.levels) + '・1割負担で<span class="nw">月 約' + man(x.min) + '〜' + man(x.max) + '</span>（相部屋〜個室）</p>');
        h.push('<p class="note">施設ごとの追加料金（加算）や日用品代は別です。実際の請求は、目安より高くなる場合があります。</p>');
        // ちゃっトク案の「下の『川崎市で確認したい制度』」は、このページの見出しに無いので、札の名前「食費と部屋代が軽くなる場合」にした
        more.push('<p class="note">収入や貯金などの条件に当てはまれば、申請によって食費と部屋代が軽くなる場合があります。' + (x.key === 'tokuyo' ? '詳しくは下の「食費と部屋代が軽くなる場合」をご覧ください。' : '') + '</p>');
      }
      if (x.key === 'tokuyo') {
        h.push('<p class="note">定員' + x.capacity.toLocaleString('ja-JP') + '人' + (x.mitchaku ? '（定員29人以下の小さい特養：' + x.mitchaku + 'か所）' : '') + '。</p>');
        h.push('<p class="note">川崎市の特養は市内まとめて受け付け、要介護度などの点数で入居の順番が決まります。申し込んだ順ではありません。</p>');
        if (x.levelNote) h.push('<p class="warn">要介護1・2の方は、川崎市の「申込チェックシート」の条件に当てはまる場合に申し込めます。</p>');
      }
      fold();
      return h.join('');
    }
    // グループホーム：自己負担だけの目安で安く見えないよう、金額の名前に「だけ」を入れ、家賃などが外であることをすぐ下に置く
    if (x.stopped) {
      h.push('<p class="warn">介護保険の料金改定に伴い、自己負担の目安を確認中です。</p>');
    } else {
      h.push('<p class="kw-money">介護保険の自己負担のみ：<span class="nw">月 約' + man(x.careMin) + '〜' + man(x.careMax) + '</span>（' + levelText(x.levels) + '・1割）</p>');
    }
    h.push('<p class="note"><strong>家賃・食費・光熱費は別で、</strong>合計は施設によって違います。見学や電話で確認を。</p>');
    h.push('<p class="note">原則、川崎市に住民登録がある方が対象です。</p>');
    return h.join('');
  }


  /* ---------- 区ごとの比べ表（kawasaki.html に作る時に入れる・数字は data から） ---------- */
  function wardTable(data) {
    var W = data.wards;
    var h = ['<table class="tbl ward-tbl"><caption>区ごとの施設の数</caption><thead><tr><th scope="col">区</th>' +
      '<th scope="col">特養<br><span>か所／定員／千人当たり</span></th><th scope="col">介護付き<br>有料</th><th scope="col">住宅型<br>有料</th><th scope="col">サ高住</th><th scope="col">グループ<br>ホーム</th><th scope="col">老健</th></tr></thead><tbody>'];
    function line(label, get) {
      var c = data.counts;
      var cap = get(data.tokuyo.capacity), pop = get(data.pop65);
      h.push('<tr><th scope="row">' + label + '</th><td>' + get(c.tokuyo) + 'か所<br><span>定員' + cap.toLocaleString('ja-JP') + '人</span><span>' + (cap / pop * 1000).toFixed(1) + '人</span></td>' +
        '<td>' + get(c.kaigo) + '</td><td>' + get(c.jutaku) + '</td><td>' + get(c.satsuki) + '</td><td>' + get(c.gh) + '</td><td>' + get(c.roken) + '</td></tr>');
    }
    W.forEach(function (w) { line(w, function (o) { return o[w]; }); });
    line('川崎市', function (o) { return o === data.pop65 ? data.pop65City : sumWards(o, W); });
    h.push('</tbody></table>');
    return h.join('');
  }

  // 介護付き有料の、区ごとの届出の月額（真ん中の値・件数）。件数が少ない区は出さない
  function kaigoMedianLine(data) {
    return data.wards.map(function (w) {
      var v = (data.prices.kaigo[w] || []).map(function (p) { return p[0]; });
      return '<span class="nw">' + w + ' ' + (v.length >= MEDIAN_MIN ? '約' + man(median(v)) : '—') + '（' + v.length + '件）</span>';
    }).join('／');
  }

  function total(o, W) { return sumWards(o, W); }
  function cityMedian(data, key) { return median(pricesOf(data, key, '').map(function (p) { return p[0]; })); }
  function nPriced(data, key) { return pricesOf(data, key, '').length; }

  // ページ冒頭の「結論」（数字は全部 data から作る＝手で写さない）。種類ごとの数を札にして、一言の説明を添える
  // today：作る時の日付（build_pages.js が渡す）。期限（validUntil）を過ぎていれば、特養の目安の行は「確認中」だけを書く。
  // 期限より前に作った HTML でも、ブラウザで期限を過ぎたら kawasaki.js が data-until の行を隠し、data-stopped の行を出す（札の中と同じ止め方）
  function summaryHtml(data, today) {
    var W = data.wards, c = data.counts, t = data.monthly.tokuyo;
    var tMin = Math.min(t['多床室']['3'], t['従来型個室']['3'], t['ユニット型個室']['3']);
    var tMax = Math.max(t['多床室']['5'], t['従来型個室']['5'], t['ユニット型個室']['5']);
    var cards = TYPES.map(function (ty) {
      var sub = ''; // 特養の定員は札の下の1行で言う（2回言わない）
      return '<li class="sum-card"><span class="sum-name">' + esc(ty.name) + '</span><span class="sum-n"><strong>' + total(c[ty.key], W) + '</strong>か所</span>' + sub +
        '<span class="sum-desc">' + esc(ty.desc) + '</span></li>';
    }).join('');
    var all = TYPES.reduce(function (a, ty) { return a + total(c[ty.key], W); }, 0);
    return '<ul class="sum-grid">' + cards + '</ul>' +
      '<p><strong>合計 ' + all + 'か所</strong>。市内の特養の定員は、あわせて' + total(data.tokuyo.capacity, W).toLocaleString('ja-JP') + '人です。</p>' +
      '<h3>施設の月額は、どれくらい？</h3><ul class="next">' +
      '<li>介護付き有料老人ホーム：<span class="nw">月 約' + man(cityMedian(data, 'kaigo')) + '</span>（真ん中の額）</li>' +
      '<li>住宅型有料老人ホーム：<span class="nw">月 約' + man(cityMedian(data, 'jutaku')) + '</span>（介護代は別）</li>' +
      '<li>サービス付き高齢者向け住宅：<span class="nw">月 約' + man(cityMedian(data, 'satsuki')) + '</span>（介護代は別）</li>' +
      (expired(data, today) ? '' : '<li data-until>特養：要介護3〜5の方で、<span class="nw">月 約' + man(tMin) + '〜' + man(tMax) + '</span>（追加料金など別）</li>') +
      '<li data-stopped' + (expired(data, today) ? '' : ' hidden') + '>特養：介護保険の料金改定に伴い、月額の目安を確認中です。</li></ul>' +
      '<p>目安の金額です。下で予算を出すと、区ごとの予算以内の数も分かります。</p>';
  }

  // 数字の出どころ（件数は data から）
  function sourcesHtml(data) {
    var d = data.juusetsuDocs, W = data.wards;
    var none = function (k) { return total(data.noPrice[k], W) + (data.noPriceNoWard[k] || 0); };
    var all = d.kaigo + d.jutaku + d.satsuki;
    return '<p>川崎市が公開している重要事項説明書' + all + '件（介護付き' + d.kaigo + '・住宅型' + d.jutaku + '・有料老人ホームに当たるサ高住' + d.satsuki + '）の料金表を確認し、そのうち月額が分かった' +
      (nPriced(data, 'kaigo') + nPriced(data, 'jutaku') + nPriced(data, 'satsuki')) + '件（介護付き' + nPriced(data, 'kaigo') + '・住宅型' + nPriced(data, 'jutaku') + '・サ高住' + nPriced(data, 'satsuki') + '）を集計しました。' +
      '料金欄が空欄だった書類など' + (none('kaigo') + none('jutaku') + none('satsuki')) + '件は、施設数には含めていますが、月額の集計からは除いています。' +
      '機械で読み取れない書類や合計が合わない書類は、画像を1枚ずつ目で確認しました。資料の記入日は' +
      data.juusetsuWritten[0].replace(/-/g, '/') + '〜' + data.juusetsuWritten[1].replace(/-/g, '/') + 'です。施設から川崎市へは、毎年7月1日時点の内容が報告されます。</p>';
  }

  return { TYPES: TYPES, ROOMS: ROOMS, MEDIAN_MIN: MEDIAN_MIN, compare: compare, render: render, wardTable: wardTable, summaryHtml: summaryHtml, sourcesHtml: sourcesHtml, kaigoMedianLine: kaigoMedianLine, median: median, man: man, expired: expired };
});
