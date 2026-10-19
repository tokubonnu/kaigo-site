// サイト全体の設定（ここ1か所だけ直す）。直したら  node tools/build_pages.js  を1回打つ。
// ・canonical／OGP の URL・sitemap.xml・robots.txt は、この値から作り直される
// ・ブラウザでは読まない（作る時だけ使う）
'use strict';
module.exports = {
  // 公開先（最後の / を付ける）
  BASE_URL: 'https://kaigo.bibon.net/',
  // true＝検索に載せてよい。false にすると全ページに noindex を付ける
  INDEXABLE: true,
  SITE_NAME: '施設のお金を整理する',
  // SNS・LINE でリンクを貼った時に出る絵（1200×630。トップの母と娘の絵を白い地に置いた物＝site/og.jpg）
  OG_IMAGE: 'og.jpg',
  // 画面のタブ・検索結果に出る小さな印（site/favicon.svg）
  FAVICON: 'favicon.svg',
  // 運営者の表示（フッター）。これ以上の個人情報は出さない
  OPERATOR: 'B.B.T',
  CONTACT: 'kaigo@bibon.net',
  // 広告の中身を置く場所（トップページの「計算の結果」と「施設に確認しておきたいこと」の間・川崎市のページの「川崎市で比べる」の後）。
  //  ・入口③（払えなくなるのはいつ？）には置かない（印が無い＝出ない）
  //  ・html が空（''）の間は、広告の囲みも「ここまでが計算です」の区切りも出ない
  //  ・本物のリンクが決まったら html に入れて  node tools/build_pages.js  を1回打つ
  //    例：html: '<p><a href="https://…" rel="sponsored noopener" target="_blank">○○で資料を請求する</a></p>'
  AD: {
    heading: 'この予算を目安に、施設の資料を探す',
    html: ''
  },
  // ページの一覧（sitemap.xml の順）。path は BASE_URL の後ろに付く部分
  PAGES: [
    { file: 'index.html', path: '' },
    { file: 'nokoru-kazoku.html', path: 'nokoru-kazoku.html' },
    { file: 'chokin-nannen.html', path: 'chokin-nannen.html' },
    { file: 'harae-naku-naru.html', path: 'harae-naku-naru.html' },
    { file: 'kawasaki.html', path: 'kawasaki.html' },
    // 文字だけのページ（運営者情報・プライバシーポリシー）。plain：true＝絵の決まり（rules.test.js ③）の対象にしない
    { file: 'operator.html', path: 'operator.html', plain: true },
    { file: 'privacy.html', path: 'privacy.html', plain: true }
  ]
};
