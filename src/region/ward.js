/*
 * 川崎市の区のページ（下書き・_draft/kawasaki-<区>.html）の配線：月の予算を1つ入れると、その区で月額が予算以内の施設の数を出す。
 * ・数え方は compare.js と同じ決まり（代表のプランか安い方のプランが「月額≦予算」で、前払金なし）。テスト（tests/ward.test.js）で compare.js と同じ数になるか突き合わせる
 * ・通信しない・保存しない・URLに数字を載せない。広告の設定は読まない
 * ・2027年4月の介護報酬の見直しの後（data.validUntil を過ぎたら）、国の基準で計算した目安（data-until の所）を隠す
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KaigoWard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var ROOMS = ['多床室', '従来型個室', 'ユニット型個室'];
  var ROOM_NAME = { '多床室': '相部屋', '従来型個室': '従来型個室', 'ユニット型個室': 'ユニット個室' };

  function man(n) { var v = Math.round(n / 1000) / 10; return v.toFixed(1).replace(/\.0$/, '') + '万円'; }

  // 1つの区・1つの種類で、予算以内の数（within）と、前払金のあるプランなら予算以内の数（prepaidOnly）
  function countWithin(data, key, ward, budget) {
    var all = (data.prices[key][ward] || []);
    var plans = function (p) { return p.length >= 4 ? [[p[0], p[1]], [p[2], p[3]]] : [[p[0], p[1]]]; };
    var fits = function (p) { return plans(p).some(function (pl) { return pl[0] <= budget && pl[1] === 0; }); };
    return {
      priced: all.length,
      within: all.filter(fits).length,
      prepaidOnly: all.filter(function (p) { return !fits(p) && plans(p).some(function (pl) { return pl[0] <= budget; }); }).length
    };
  }

  // 特養（要介護3〜5）・老健（要介護1〜5）：どの要介護度でも予算以内の部屋
  function roomsWithin(data, key, budget) {
    var table = data.monthly[key];
    return ROOMS.filter(function (r) { return Object.keys(table[r]).every(function (l) { return table[r][l] <= budget; }); });
  }

  function lineFor(data, key, ward, budget) {
    if (key === 'kaigo' || key === 'jutaku' || key === 'satsuki') {
      var c = countWithin(data, key, ward, budget);
      if (!c.priced) return '<p>この区には、月額が分かる所がありません。</p>';
      var h = '<p>予算以内：<strong>' + c.within + 'か所</strong><span class="nw">（月額が分かる' + c.priced + 'か所のうち）</span></p>';
      if (c.prepaidOnly) h += '<p class="note">ほかに' + c.prepaidOnly + 'か所、入居金を払うプランなら予算以内です。</p>';
      return h;
    }
    if (key === 'tokuyo' || key === 'roken') {
      var rs = roomsWithin(data, key, budget);
      if (rs.length === ROOMS.length) return '<p>相部屋・従来型個室・ユニット個室の<strong>どれも予算以内</strong>の目安です。</p>';
      if (rs.length) return '<p>予算以内の部屋：<strong>' + rs.map(function (r) { return ROOM_NAME[r]; }).join('・') + '</strong></p>';
      var low = Math.min.apply(null, Object.keys(data.monthly[key]['多床室']).map(function (l) { return data.monthly[key]['多床室'][l]; }));
      return '<p>目安は予算より高めです<span class="nw">（相部屋で 月 約' + man(low) + 'から）</span>。</p>';
    }
    return '';
  }

  function expired(data, today) {
    var d = today || new Date();
    var s = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    return s > data.validUntil;
  }

  // 画面の配線（ブラウザだけ）
  function wire(doc, K, data) {
    var box = doc.querySelector('[data-ward]');
    var inp = doc.querySelector('#w-budget');
    if (!box || !inp || !K || !data) return;
    var ward = box.getAttribute('data-ward');
    var err = inp.parentNode.querySelector('.err');
    var stopped = expired(data, new Date());
    if (stopped) {
      Array.prototype.forEach.call(doc.querySelectorAll('[data-until]'), function (e) { e.hidden = true; });
      Array.prototype.forEach.call(doc.querySelectorAll('[data-stopped]'), function (e) { e.hidden = false; });
    }
    function update() {
      var r = K.parseAmount(inp.value, 'yen');
      var budget = r.ok ? r.value : null;
      if (!r.ok) { inp.setAttribute('aria-invalid', 'true'); err.textContent = r.error; }
      else { inp.removeAttribute('aria-invalid'); err.textContent = ''; }
      var on = typeof budget === 'number' && budget > 0;
      Array.prototype.forEach.call(doc.querySelectorAll('[data-within]'), function (e) {
        var key = e.getAttribute('data-within');
        var html = on && !(stopped && (key === 'tokuyo' || key === 'roken')) ? lineFor(data, key, ward, budget) : '';
        e.innerHTML = html;
        e.hidden = !html;
      });
      var after = doc.querySelector('#w-after');
      if (after) after.hidden = !on;
    }
    inp.addEventListener('input', update);
    update();
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    var go = function () { wire(document, window.KaigoCalc, window.KaigoKawasakiData); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }

  return { countWithin: countWithin, roomsWithin: roomsWithin, lineFor: lineFor, expired: expired, man: man };
});
