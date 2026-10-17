/*
 * 介護の見積もり整理 — 計算核（純関数だけ）
 * 設計図 §6.3 の式をそのまま実装する。
 * ・広告・通信・画面・施設名を一切参照しない（名前は表示用に素通しするだけ）
 * ・金額は内部ではすべて「円の整数」。null＝未確認（0円とは別の状態）
 * ・ブラウザでは window.KaigoCalc、node では module.exports で使う
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KaigoCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_YEN = 10000000000; // 100億円を超える入力は桁の打ち間違いとして止める
  var MAX_MONTHS = 600;      // 50年

  /* ---------- 費目の定義（見積もりに含まれるかを1つずつ確かめる） ---------- */
  // weight は「次に聞く3問」を選ぶ時の優先順（大きいほど先に聞く）
  var ITEM_DEFS = [
    { key: 'care',     label: '介護保険の自己負担', weight: 90, unit: 'month' },
    { key: 'food',     label: '食費',               weight: 80, unit: 'month' },
    { key: 'rent',     label: '家賃・居住費',       weight: 75, unit: 'month' },
    { key: 'mgmt',     label: '管理費',             weight: 70, unit: 'month' },
    { key: 'medical',  label: '医療費・薬代',       weight: 60, unit: 'month' },
    { key: 'diaper',   label: 'おむつ・日用品',     weight: 55, unit: 'month' },
    { key: 'escort',   label: '通院の付き添い',     weight: 50, unit: 'visit' },
    { key: 'utility',  label: '水道光熱費',         weight: 40, unit: 'month' },
    { key: 'other',    label: 'その他（理美容など）', weight: 20, unit: 'month' }
  ];

  var INCLUSION = { INCLUDED: 'included', SEPARATE: 'separate', UNKNOWN: 'unknown' };
  var CERTAINTY = { CONFIRMED: 'confirmed', PROVISIONAL: 'provisional' };

  /* ---------- 入力の正規化 ---------- */
  // 全角数字・全角カンマ・「円」「万」の表記ゆれを吸収して数値にする。
  // 戻り値：{ ok:true, value:整数円 | null（空欄＝未確認） } または { ok:false, error:'…' }
  function parseAmount(raw, unit) {
    var mult = unit === 'man' ? 10000 : 1;
    if (raw === null || raw === undefined) return { ok: true, value: null };
    var s = String(raw);
    s = s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    s = s.replace(/[．]/g, '.').replace(/[－ー−]/g, '-');
    s = s.replace(/[,，、\s　]/g, '').replace(/円$/, '').replace(/万$/, '');
    if (s === '') return { ok: true, value: null };
    if (s.charAt(0) === '-') return { ok: false, error: '0円以上で入力してください。' };
    if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, error: '数字だけで入力してください。' };
    if (unit !== 'man' && s.indexOf('.') >= 0) return { ok: false, error: '1円単位で入力してください。' };
    var n = Number(s);
    if (!isFinite(n)) return { ok: false, error: '数字だけで入力してください。' };
    var yen = Math.round(n * mult);
    if (yen > MAX_YEN) return { ok: false, error: '金額が大きすぎるようです。入力した数字を確認してください。' };
    return { ok: true, value: yen };
  }

  function parseMonths(raw) {
    var r = parseAmount(raw, 'yen');
    if (!r.ok) return r;
    if (r.value === null) return { ok: true, value: null };
    if (r.value < 1) return { ok: false, error: '期間は1か月以上にしてください' };
    if (r.value > MAX_MONTHS) return { ok: false, error: '期間が長すぎます（50年まで）' };
    return { ok: true, value: r.value };
  }

  function isYen(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0; }

  /* ---------- 1施設の月の支出 ---------- */
  // facility = { monthlyQuote, entryFee, items: { key: { inclusion, amount, amountHigh, certainty, visits } } }
  // ・「月額に含む」は足さない（二重加算しない）
  // ・「別途」で金額あり → E に足す。付き添いは 1回の金額×月の回数
  // ・「別途」で金額なし、または「含むか未確認」→ 未確認リストへ（0円として足さない）
  function facilityMonthly(f) {
    var q = f.monthlyQuote;
    var eLow = 0, eHigh = 0, hasRange = false;
    var unknown = [];       // { key, label, reason: 'inclusion' | 'amount' }
    var provisional = [];   // { key, label, amount }
    var separate = [];      // { key, label, low, high, certainty }
    ITEM_DEFS.forEach(function (def) {
      var it = (f.items && f.items[def.key]) || { inclusion: INCLUSION.UNKNOWN };
      if (it.inclusion === INCLUSION.INCLUDED) return;
      if (it.inclusion !== INCLUSION.SEPARATE) {
        unknown.push({ key: def.key, label: def.label, reason: 'inclusion', weight: def.weight });
        return;
      }
      var per = def.unit === 'visit' ? (isYen(it.visits) ? it.visits : null) : 1;
      if (!isYen(it.amount) || per === null) {
        unknown.push({ key: def.key, label: def.label, reason: def.unit === 'visit' && isYen(it.amount) ? 'visits' : 'amount', weight: def.weight });
        return;
      }
      var low = it.amount * per;
      var high = (isYen(it.amountHigh) && it.amountHigh > it.amount ? it.amountHigh : it.amount) * per;
      if (high !== low) hasRange = true;
      eLow += low; eHigh += high;
      separate.push({ key: def.key, label: def.label, low: low, high: high, certainty: it.certainty || CERTAINTY.CONFIRMED });
      if (it.certainty === CERTAINTY.PROVISIONAL) provisional.push({ key: def.key, label: def.label, amount: low, weight: def.weight });
    });
    var quoteKnown = isYen(q);
    var entryKnown = isYen(f.entryFee);
    return {
      quoteKnown: quoteKnown,
      entryKnown: entryKnown,
      Q: quoteKnown ? q : null,
      F: entryKnown ? f.entryFee : null,
      E: eLow,
      EHigh: eHigh,
      C: quoteKnown ? q + eLow : null,
      CHigh: quoteKnown ? q + eHigh : null,
      hasRange: hasRange,
      separate: separate,
      unknown: unknown,
      provisional: provisional,
      // 未確認が1つでもあれば「確認できた分の小計」。0件でも「全部込み」とは言わない
      complete: quoteKnown && entryKnown && unknown.length === 0
    };
  }

  /* ---------- 家計：毎月介護に回せる手取り I ---------- */
  // household = { mode:'simple'|'detail', monthlyIncome, incomeSelf, incomeSpouse, spouseLiving, support }
  // detail では、家に残る家族の生活費を「先に」取っておいてから残りを介護へ回す
  // 2026-10-14：最初は本人の手取りだけで答えを出す。家に残る家族の生活費が空欄の時は
  //   ・生活費は引かない（引いていないことは budget().notYet で画面に出す）
  //   ・配偶者の手取りも足さない（生活費が分からないまま、配偶者の収入を介護へ全部回さない）
  function householdIncome(h) {
    var base;
    var missing = [];
    var livingKnown = null, spouseHeld = false;
    if (h.mode === 'detail') {
      if (!isYen(h.incomeSelf)) missing.push('incomeSelf');
      livingKnown = isYen(h.spouseLiving);
      var spouseIn = isYen(h.incomeSpouse) ? h.incomeSpouse : 0; // 配偶者の収入は空欄なら0（収入なし）扱い
      spouseHeld = !livingKnown && spouseIn > 0;
      base = missing.length ? null : h.incomeSelf + (livingKnown ? spouseIn - h.spouseLiving : 0);
    } else {
      if (!isYen(h.monthlyIncome)) missing.push('monthlyIncome');
      base = missing.length ? null : h.monthlyIncome;
    }
    // 家族の援助は初期値0。利用者が入れた時だけ「別案」として出す（本案には混ぜない）
    var support = isYen(h.support) ? h.support : 0;
    return {
      I: base,                                    // 本案（援助なし）
      IWithSupport: base === null || support === 0 ? null : base + support,
      support: support,
      missing: missing,
      livingKnown: livingKnown,   // detail だけ true/false（simple は null）
      spouseHeld: spouseHeld      // 配偶者の手取りを、生活費が未入力なので足していない
    };
  }

  /* ---------- 設計図 §6.3 の式 ---------- */
  // L = S - R - F ／ C = Q + E ／ D = C - I
  function plan(p) {
    // p = { S, R, F, I, Q, E }
    var L = p.S - p.R - p.F;
    var C = p.Q + p.E;
    var D = C - p.I;
    var out = { L: L, C: C, D: D };
    if (L < 0) {
      out.state = 'initial_short';      // 入居時点で資金が足りない。負の年数は出さない
      out.initialShort = -L;
    } else if (D <= 0) {
      out.state = 'no_drawdown';        // この一定条件では毎月の取り崩しなし（永久に足りるとは言わない）
      out.monthlySurplus = 0 - D;   // -0 を出さない
    } else {
      out.state = 'drawdown';
      out.fullMonths = Math.floor(L / D);        // 支払える満月数
      out.shortMonth = out.fullMonths + 1;       // 足りなくなる月（何か月目）
    }
    return out;
  }

  function totalSpend(F, C, T) { return F + C * T; }           // Tか月の支出合計
  function balanceAfter(L, D, T) { return L - D * T; }         // Tか月後の計画用残高
  // Tか月を保つ施設月額上限 = I + L / T - E（円未満は四捨五入。画面では「約」を付ける）
  function monthlyCap(I, L, E, T) {
    if (!(T >= 1)) throw new Error('T must be >= 1');
    return Math.round(I + L / T - E);
  }

  /* ---------- 主役：見積もり無しで「施設に毎月いくらまで払えるか」 ---------- */
  // b = 家計（householdIncome と同じ形）＋ entryBudget（入居時に払えるまとまったお金。空欄＝0＝入居金なしで探す）
  //     ＋ otherMonthly（施設に払うお金とは別に毎月かかるお金。空欄＝未入力＝0円にしない）
  // 年数は資金計画の長さ（予測ではない）。5・10・15年を並べる。
  var BUDGET_YEARS = [5, 10, 15];
  function budget(b, years) {
    years = years || BUDGET_YEARS;
    var hi = householdIncome(b);
    var S = b.funds;
    var R = isYen(b.reserve) ? b.reserve : 0;
    var F = isYen(b.entryBudget) ? b.entryBudget : 0;
    var E = isYen(b.otherMonthly) ? b.otherMonthly : null; // null＝まだ入っていない（0円として引かない）
    // まだ計算に入れていないもの（空欄の欄）。どれも入れると答えは下がる。画面に1行で出す
    var notYet = [];
    if (E === null) notYet.push('other');
    if (!isYen(b.reserve)) notYet.push('reserve');
    if (hi.livingKnown === false) notYet.push('living');
    if (!isYen(b.entryBudget)) notYet.push('entry');
    var out = { ready: false, blockers: [], income: hi, S: S, R: R, F: F, E: E, otherKnown: E !== null, notYet: notYet };
    if (!isYen(S)) out.blockers.push('funds');
    if (hi.I === null) out.blockers.push('income');
    if (out.blockers.length) return out;
    out.ready = true;
    out.L = S - R - F;
    if (out.L < 0) {
      out.state = 'initial_short';
      out.initialShort = -out.L;
      return out;
    }
    out.state = 'ok';
    function row(I, Y) {
      var T = Y * 12;
      var careTotal = Math.round(I + out.L / T);              // 施設代と、それ以外を合わせて月に使える額
      var cap = E === null ? null : monthlyCap(I, out.L, E, T); // 施設に払える月額（別料金も込み）
      return { years: Y, T: T, careTotal: careTotal, cap: cap };
    }
    out.rows = years.map(function (Y) { return row(hi.I, Y); });
    if (hi.IWithSupport !== null) out.rowsSupport = years.map(function (Y) { return row(hi.IWithSupport, Y); });
    return out;
  }

  /* ---------- 入口のページ：貯金 × 毎月の不足額の早見表 ---------- */
  // 2026-10-14 入口「貯金◯万円で老人ホームに何年いられる？」。金額違いのページは作らず、この表1枚にまとめる。
  // 各マスは plan() と同じ式（入居時の支払い0・残すお金0・手取りは不足額に含めて考える）。
  // 払える月数 ＝ 貯金 ÷ 毎月の不足額（端数切り捨て）。その次の月に足りなくなる。
  var QUICK_FUNDS_MAN = [300, 500, 800, 1000, 1500, 2000, 3000]; // 貯金（万円）
  var QUICK_SHORT_MAN = [3, 5, 7, 10, 15];                         // 毎月の不足額（万円）
  function savingsTable(fundsMan, shortMan) {
    fundsMan = fundsMan || QUICK_FUNDS_MAN;
    shortMan = shortMan || QUICK_SHORT_MAN;
    return {
      shorts: shortMan.slice(),
      rows: fundsMan.map(function (fm) {
        return {
          fundsMan: fm,
          cells: shortMan.map(function (sm) {
            var p = plan({ S: fm * 10000, R: 0, F: 0, I: 0, Q: sm * 10000, E: 0 });
            return { shortMan: sm, fullMonths: p.fullMonths, shortMonth: p.shortMonth };
          })
        };
      })
    };
  }

  // 「今月から n か月後」の年と月（暦の計算だけ。日付は扱わない）。month は 1〜12
  function monthAfter(year, month, n) {
    var idx = year * 12 + (month - 1) + n;
    return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
  }

  /* ---------- 施設に聞いておきたいこと（見積もり無しでも出せる固定の問い） ---------- */
  // 2026-10-13 施設の悩み集めの上位から。AIで作らない・入力で変えない。家計の数字は入れない。
  var CHECKLIST = [
    { key: 'extras',   text: '毎月の料金に含まれない費用を、一覧でもらえますか？おむつ・日用品・医療費・通院の付き添い・理美容など、実費や別料金になるものを知りたいです。' },
    { key: 'carecost', text: '介護保険の自己負担は、月額に含まれていますか？介護が今より多く必要になった時、月にいくらぐらい増えますか？介護保険の限度を超えた分は、全額自己負担になりますか？' },
    { key: 'leave',    text: 'どのような場合に、退去をお願いされますか？医療的なケアが増えた時、認知症が進んだ時、入院が長くなった時などの条件を教えてください。' },
    { key: 'refund',   text: '入居時に払うお金は、何か月で償却されますか？3か月以内・1年・3年で退去した場合、それぞれいくら戻りますか？' },
    { key: 'guarantor', text: '身元保証人は必要ですか？いない場合、保証会社を利用する必要がありますか？費用はいくらですか？' },
    { key: 'night',    text: '夜間は職員が何人いますか？看護師がいるのは何時から何時までですか？' },
    { key: 'hospital', text: '入院中も、部屋代などの支払いは続きますか？' },
    { key: 'raise',    text: '今後、料金が上がる予定はありますか？これまでに値上げしたことはありますか？' },
    { key: 'moveout',  text: '退去する時に、修繕費やクリーニング代はかかりますか？' },
    { key: 'visit',    text: '面会できる曜日・時間・回数に決まりはありますか？' }
  ];
  function facilityChecklist() {
    return CHECKLIST.map(function (q) { return { key: q.key, text: q.text }; });
  }

  /* ---------- 1施設を家計に当てはめた結果 ---------- */
  function evaluate(facility, household, periodsMonths) {
    var m = facilityMonthly(facility);
    var hi = householdIncome(household);
    var S = household.funds, R = isYen(household.reserve) ? household.reserve : 0;
    var res = { monthly: m, income: hi, ready: false, blockers: [] };
    if (!m.quoteKnown) res.blockers.push('quote');
    if (!m.entryKnown) res.blockers.push('entry');
    if (!isYen(S)) res.blockers.push('funds');
    if (hi.I === null) res.blockers.push('income');
    if (res.blockers.length) return res;
    res.ready = true;
    res.knownOnly = !m.complete; // 未確認があれば「既知の費用だけなら」の条件付き
    res.plan = plan({ S: S, R: R, F: m.F, I: hi.I, Q: m.Q, E: m.E });
    if (m.hasRange) res.planHigh = plan({ S: S, R: R, F: m.F, I: hi.I, Q: m.Q, E: m.EHigh });
    if (hi.IWithSupport !== null) res.planSupport = plan({ S: S, R: R, F: m.F, I: hi.IWithSupport, Q: m.Q, E: m.E });
    res.totals = (periodsMonths || [12, 60, 120]).map(function (T) {
      return {
        T: T,
        spend: totalSpend(m.F, m.C, T),
        spendHigh: m.hasRange ? totalSpend(m.F, m.CHigh, T) : null,
        balance: balanceAfter(res.plan.L, res.plan.D, T)
      };
    });
    return res;
  }

  /* ---------- 2施設の比べ方 ---------- */
  // 未確認が残る側があれば順番を出さない。幅が重なる時も順番を出さない。
  function compare(mA, mB) {
    if (!mA.quoteKnown || !mB.quoteKnown) return { kind: 'missing_quote' };
    if (mA.unknown.length || mB.unknown.length || !mA.entryKnown || !mB.entryKnown) {
      return { kind: 'need_check', unknownA: mA.unknown.length + (mA.entryKnown ? 0 : 1), unknownB: mB.unknown.length + (mB.entryKnown ? 0 : 1) };
    }
    var aLow = mA.C, aHigh = mA.CHigh, bLow = mB.C, bHigh = mB.CHigh;
    if (aLow === bLow && aHigh === bHigh && mA.F === mB.F) return { kind: 'same' };
    var overlap = !(aHigh < bLow || bHigh < aLow);
    if ((mA.hasRange || mB.hasRange) && overlap && aLow !== bLow) return { kind: 'range_overlap' };
    return { kind: 'diff', monthlyDiff: aLow - bLow, entryDiff: mA.F - mB.F };
  }

  /* ---------- 次に聞く3問（固定ルール。AIは使わない） ---------- */
  // 優先順：①含むか未確認の費目（重い順）②別途だが金額未確認 ③入居時の支払いが未確認
  //        ④家計の未確認（残る家族の生活費・回せる手取り）⑤入居時のお金の償却と返還 ⑥別料金の一覧・退去条件・身元保証
  //        ⑦仮置きの数字 ⑧見積日 ⑨定番の確認（家計の未確認があれば1問は必ず家族の問いにする）
  function nextQuestions(input, limit) {
    limit = limit || 3;
    var cands = [];
    var names = input.facilities.map(function (f) { return f.name || ''; });
    var monthlies = input.facilities.map(facilityMonthly);

    // 同じ費目が両方で未確認なら1問にまとめる
    var byKey = {};
    monthlies.forEach(function (m, idx) {
      m.unknown.forEach(function (u) {
        var k = u.key + ':' + u.reason;
        if (!byKey[k]) { byKey[k] = { u: u, who: [] }; }
        byKey[k].who.push(names[idx]);
      });
    });
    Object.keys(byKey).forEach(function (k) {
      var u = byKey[k].u, who = byKey[k].who.join('・');
      var text;
      if (u.reason === 'inclusion') {
        text = u.key === 'escort'
          ? who + '：通院の付き添いは月額に含まれていますか？別料金の場合、1回いくらですか？'
          : who + '：「' + u.label + '」は月額に含まれていますか？含まれない場合、月いくらかかりますか？';
      } else if (u.reason === 'visits') {
        text = who + '：通院の付き添いは月に何回くらい必要になりそうですか？';
      } else {
        text = u.key === 'escort'
          ? who + '：通院の付き添いは1回いくらで、月に何回くらい必要になりそうですか？'
          : who + '：「' + u.label + '」は別料金とのことですが、月にいくらぐらいかかりますか？';
      }
      cands.push({ to: 'facility', text: text, score: 1000 + u.weight + (u.reason === 'inclusion' ? 5 : 0) + byKey[k].who.length });
    });

    input.facilities.forEach(function (f, idx) {
      var m = monthlies[idx];
      if (!m.quoteKnown) cands.push({ to: 'facility', text: names[idx] + '：毎月の見積額（税込）はいくらですか？', score: 2000 });
      if (!m.entryKnown) cands.push({ to: 'facility', text: names[idx] + '：入居時に払うお金はいくらですか？あとで戻るお金がある場合は、どんな条件ですか？', score: 990 });
    });

    var hi = householdIncome(input.household);
    if (input.household.mode === 'detail' && !isYen(input.household.spouseLiving)) {
      cands.push({ to: 'family', text: '家族で：家で暮らす家族の生活費は、毎月いくら必要ですか？', score: 985 });
    }
    if (hi.missing.indexOf('monthlyIncome') >= 0 || hi.missing.indexOf('incomeSelf') >= 0) {
      cands.push({ to: 'family', text: '家族で：家の生活費を先に確保したあと、毎月の手取りから介護にいくら使えますか？', score: 984 });
    }
    if (!isYen(input.household.funds)) {
      cands.push({ to: 'family', text: '家族で：介護に使えるお金はいくらですか？そのうち、手元に残しておきたいお金はいくらですか？', score: 983 });
    }

    monthlies.forEach(function (m, idx) {
      m.provisional.forEach(function (p) {
        cands.push({ to: 'facility', text: names[idx] + '：仮に入れた「' + p.label + '」の金額は、実際には月いくらですか？', score: 500 + p.weight });
      });
    });
    input.facilities.forEach(function (f, idx) {
      if (!f.quoteDate) cands.push({ to: 'facility', text: names[idx] + '：この見積もりは、いつ時点の料金ですか？', score: 300 });
    });

    // 入居時のお金がある施設：償却と、早く退去した時に戻る額（家族の悩みで計算依頼まで出ている）
    var withEntry = input.facilities.filter(function (f, idx) { return monthlies[idx].entryKnown && f.entryFee > 0; })
      .map(function (f) { return f.name || ''; });
    if (withEntry.length) {
      cands.push({ to: 'facility', text: withEntry.join('・') + '：入居時のお金は何か月で償却されますか？1年・3年で退去した場合、いくら戻りますか？', score: 600 });
    }

    // どの見積もりでも聞いておきたいこと（2026-10-13 施設の悩み集めの上位から）
    var who = names.filter(Boolean).join('・');
    cands.push({ to: 'facility', text: who + '：月額に含まれない費用の一覧をもらえますか？', score: 595 });
    cands.push({ to: 'facility', text: who + '：医療的なケアが増えた時や入院が長引いた時、退去が必要になる条件はありますか？', score: 590 });
    cands.push({ to: 'facility', text: who + '：身元保証人は必要ですか？いない場合は保証会社が必要ですか？費用はいくらですか？', score: 580 });
    cands.push({ to: 'facility', text: who + '：今後、料金が上がる予定はありますか？これまでに値上げしたことはありますか？', score: 103 });
    cands.push({ to: 'facility', text: who + '：入院中も部屋代などの支払いは続きますか？', score: 102 });
    cands.push({ to: 'facility', text: who + '：退去する時、修繕費やクリーニング代はかかりますか？', score: 101 });

    cands.sort(function (a, b) { return b.score - a.score; });
    var picked = cands.slice(0, limit);
    // 家計の未確認があれば、3問のうち1問は必ず「家族で決めること」にする（残る家族の生活費を先に確保するため）
    var fam = cands.filter(function (c) { return c.to === 'family'; });
    if (fam.length && limit >= 2 && !picked.some(function (c) { return c.to === 'family'; })) {
      picked[picked.length - 1] = fam[0];
    }
    return picked.map(function (c) { return { to: c.to, text: c.text }; });
  }

  return {
    MAX_YEN: MAX_YEN,
    ITEM_DEFS: ITEM_DEFS,
    INCLUSION: INCLUSION,
    CERTAINTY: CERTAINTY,
    parseAmount: parseAmount,
    parseMonths: parseMonths,
    facilityMonthly: facilityMonthly,
    householdIncome: householdIncome,
    plan: plan,
    totalSpend: totalSpend,
    balanceAfter: balanceAfter,
    monthlyCap: monthlyCap,
    BUDGET_YEARS: BUDGET_YEARS,
    budget: budget,
    QUICK_FUNDS_MAN: QUICK_FUNDS_MAN,
    QUICK_SHORT_MAN: QUICK_SHORT_MAN,
    savingsTable: savingsTable,
    monthAfter: monthAfter,
    facilityChecklist: facilityChecklist,
    evaluate: evaluate,
    compare: compare,
    nextQuestions: nextQuestions
  };
});
