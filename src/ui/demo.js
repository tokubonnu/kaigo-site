/*
 * 架空の例（実在の施設・人ではない）。画面の「架空の例を入れる」とテストの両方で使う。
 * A施設：月額は安いが、おむつ・付き添いが未確認、医療費は仮置き
 * B施設：月額は高いが、ほぼ全部込み。入居時の支払いなし
 * 家計：§5.2 の例（使える資金800万・残す200万・回せる手取り15万）を詳しくモードで作る
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KaigoDemo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return {
    facilities: [
      {
        name: 'A施設', quoteDate: '2026-10-01', monthlyQuote: 165000, entryFee: 1000000,
        items: {
          care:    { inclusion: 'separate', amount: 25000, certainty: 'confirmed' },
          food:    { inclusion: 'included' },
          rent:    { inclusion: 'included' },
          mgmt:    { inclusion: 'included' },
          medical: { inclusion: 'separate', amount: 8000, amountHigh: 15000, certainty: 'provisional' },
          diaper:  { inclusion: 'unknown' },
          escort:  { inclusion: 'separate', amount: null, visits: null },
          utility: { inclusion: 'included' },
          other:   { inclusion: 'separate', amount: 3000, certainty: 'confirmed' }
        }
      },
      {
        name: 'B施設', quoteDate: '2026-10-05', monthlyQuote: 210000, entryFee: 0,
        items: {
          care:    { inclusion: 'separate', amount: 25000, certainty: 'confirmed' },
          food:    { inclusion: 'included' },
          rent:    { inclusion: 'included' },
          mgmt:    { inclusion: 'included' },
          medical: { inclusion: 'separate', amount: 8000, certainty: 'provisional' },
          diaper:  { inclusion: 'included' },
          escort:  { inclusion: 'included' },
          utility: { inclusion: 'included' },
          other:   { inclusion: 'unknown' }
        }
      }
    ],
    household: {
      mode: 'detail', funds: 8000000, reserve: 2000000, monthlyIncome: null,
      incomeSelf: 150000, incomeSpouse: 70000, spouseLiving: 70000, support: 0, periodYears: 10,
      // §5.2 の残り：入居時に払うまとまったお金100万・施設以外の支出 月2万 → 10年なら月 約171,667円
      entryBudget: 1000000, otherMonthly: 20000
    }
  };
});
