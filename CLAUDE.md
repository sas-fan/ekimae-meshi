# このリポジトリで作業する Claude へ

「梅田地下メシ」（`ekimae/`）。梅田の地下の飲食店を平面図とタグで探す Web アプリ。
設計の意図は `ekimae/README.md` と `ekimae/SCHEMA.md` に書いてある。作業の前に読むこと。

## 話し方

- 持ち主はエンジニアではない。日本語で、専門用語は噛み砕いて説明する
  （GitHub にアップする方法は分かっている）。
- 推測で埋めない。店名・点数・営業時間などは、確かめられたものだけ入れる。

## どこに何があるか（本物は ekimae.sasfans.com の1つ）

- **https://ekimae.sasfans.com/** … 本物。ログインなしで誰でも使える。「ログインして保存」を押した人だけ、
  記録がネット（Cloudflare の D1）に保存される。構成は `ekimae/README.md` の「Cloudflare に置く」。
- https://sas-fan.github.io/ekimae-meshi/ … 古い版（GitHub Pages）。同じコードが出る。記録はスマホの中だけ。
  開くと「新しい住所はこちら」を案内する。
- claude.ai の Artifact（Web版）… 持ち主の個人用。claude.ai のアカウントに同期する。
- `main` に push すると、Cloudflare（Workers Builds）と GitHub Pages の両方が自動で公開する。

## 直したあとの流れ

1. 作業用ブランチで直す。スマホの幅（390×844）でブラウザ確認してからコミットする
   （`cd ekimae && python3 -m http.server 8000`、Playwright は `/opt/node22/lib/node_modules/playwright`）。
2. **main には毎回入れてよい（2026-10-17 に持ち主が了承）。聞かずに入れて、入れたことを報告する。**
   - main は早送り（fast-forward）で進める。main 側に知らない変更があったら、勝手に混ぜずに報告する。
   - main に入れると GitHub Actions（GitHub Pages）と Cloudflare Workers Builds が自動で公開する。
     結果（成功／失敗）も見て報告する（Cloudflare は `gh api repos/sas-fan/ekimae-meshi/commits/<sha>/check-runs`）。
   - GitHub への push は 500 が返ることがある。間をあけて数回やり直す。
3. Web 版（claude.ai の Artifact）も更新する（個人用。大きな変更のあと、ついでに）。
   - URL: https://claude.ai/artifact/5sUtWcnH5HcBm7sWfvXX3v （`url` に渡さないと別物が新しく作られる）
   - 先に `python3 tools/build_artifact.py`。`file_path` は `ekimae/artifact.html`、`root` は `ekimae`、
     `files` は `app.js` / `styles.css` / `data/stores.json`。`capabilities` は渡さない（今の設定が引き継がれる）。
   - 別の会話からも更新されることがある。上書きする前に公開中の `data/stores.json` を読んで、差がないか確かめる。

## 壊してはいけない決まり

- 店の ID は「場所＋フロア＋店名の hash」（例 `b4-B1-c86200`）。変わるとお気に入り・メモ・訪問履歴・
  仲間のレビューが全部外れる。店名を直すときは `tools/rename_store.py`（ID はそのまま残る）。
- 場所を足すときは `app.js` の `VENUES` と `tools/ekimae_data.py` の `VENUES` の両方に同じキーで足す。
- 平面図の画像は公式サイトのもの。公開リポジトリに新しく置くかは、そのつど持ち主に確認する。
- 食べログの点は `tabelogRating`、Google の星は `rating`。尺度が違うので混ぜない。
- 外部サイトに 200 が返らなければ、そこで止めて報告する。TLS の検証を切る・プロキシを避けるなどの迂回はしない。
- プルリクエストは頼まれたときだけ作る。
- Cloudflare の秘密の値（メンバー名簿 `MEMBER_EMAILS`）や、Access の設定はリポジトリに書かない。
  `wrangler.jsonc` に入っているのは秘密でない識別用の値だけ（D1 の ID・Access の AUD・チームのドメイン）。
- 画面の読み込み（`sw.js` の navigate）はネット優先のままにする。控えを先に返すと、ログインが切れたときに
  古い画面だけが開いてデータが取れなくなる。
