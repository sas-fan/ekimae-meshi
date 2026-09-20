# 店舗データ仕様 (stores.json v2)

`ekimae/data/stores.json` がアプリの唯一の入力。アプリ側で編集した内容は端末の
localStorage に差分として載り、`id` をキーに上書きマージされる。

```jsonc
{
  "version": 2,
  "updatedAt": "2026-09-19",     // ファイル全体の更新日
  "floors": { "1": ["B2","B1","1F","2F"], ... },
  "stores": [ /* ↓ */ ]
}
```

## 店舗オブジェクト

| キー | 必須 | 型 | 説明 |
| --- | :-: | --- | --- |
| `id` | ● | string | 一意キー。`b{ビル}-{フロア}-{名前hash6}` 形式で自動採番（`tools/ingest.py`）。同じ店を再取り込みしても ID が変わらないので、お気に入りやメモが外れない |
| `name` | ● | string | 店名。表記は公式フロア案内に合わせる |
| `kana` | | string | 検索用のよみ。ひらがな推奨（アプリ側でカナ↔かなは吸収する） |
| `aliases` | | string[] | 別名・旧店名・略称。検索対象に含まれる |
| `building` | ● | 1\|2\|3\|4 | 第Nビル |
| `floor` | ● | `B2`\|`B1`\|`1F`\|`2F`\|`3F` | フロア |
| `block` | | string | 区画番号。公式表記のまま（例 `68`, `28-1`, `57-3-1`） |
| `pos` | | `{x,y}`\|null | マップ上の位置。列X・行Y（1始まり）。null は「位置未設定」 |
| `w` / `h` | | number | 区画をまたぐ広い店のマス数。既定 1 |
| `category` | | enum | 下記のいずれか。1つだけ |
| `tags` | | string[] | 複数可。フィルタの主役 |
| `budget` | | string | 自由記述（`~2000`, `2000-3000`） |
| `hours` | | string | `11:00-14:00,17:00-23:00`。`17:00-01:00` のような日跨ぎ可 |
| `closedDays` | | string[] | `日月火水木金土祝` から |
| `phone` | | string | 電話番号 |
| `url` | | string | 店の公式サイト |
| `gmapsUrl` | | string | 空なら「店名＋大阪駅前第Nビル」で検索を開く |
| `rating` | | number\|null | 外部サイトで見た星（0〜5） |
| `ratingCount` | | number\|null | レビュー件数 |
| `ratingSource` | | string | `google` / `tabelog` など |
| `ratingCheckedAt` | | date | 星を確認した日。**古い星を信用しないための必須情報** |
| `source` | ● | string | 出どころ。`official:ekimae2` / `websearch` / `manual` / `onsite` |
| `verified` | ● | boolean | 現地または公式フロア案内で裏が取れているか |
| `updatedAt` | | date | この行を最後に触った日 |

### category（列挙）

```
居酒屋 立ち飲み バー 串カツ 焼鳥 焼肉・ホルモン 寿司 海鮮 中華 洋食 和食
ラーメン そば・うどん お好み焼き・粉もん カレー 定食 喫茶 スイーツ その他
```

### tags（推奨セット・自由追加可）

```
立ち飲み 座り飲み カウンターのみ 個室あり 一人OK
ランチあり 昼飲み 深夜営業 行列
現金のみ カード可 予約可 テイクアウト
喫煙可 分煙 禁煙
```

`category` は「何の店か」1つ、`tags` は「どう使えるか」複数。
**探すときに効くのは tags のほう**なので、迷ったら tags を厚くする。

## verified の運用

駅前ビルは入れ替わりが激しく、公式フロア案内も反映が遅れる。
そのため「誰が確認したか」を必ず持たせる。

| `source` | `verified` | 意味 |
| --- | :-: | --- |
| `official:ekimaeN` | `true` | 公式フロア案内に載っている |
| `websearch` | `false` | 検索で拾っただけ。店名は実在するが階・区画は未確認 |
| `manual` | `false` | 手入力。未確認 |
| `onsite` | `true` | 現地で自分の目で確認した |

アプリは `verified: false` に「未確認」バッジを出し、「未確認のみ」で絞り込める。
現地で確認したら詳細画面の「現地で確認した」を押す → 端末側で `onsite` / `true` になる。

## ID の決め方

```
id = "b{building}-{floor}-{sha1(正規化した店名)[:6]}"     例: b2-B2-9f1c3a
```

正規化は NFKC → 小文字化 → カタカナをひらがなへ → 空白と長音・中黒を除去。
`tools/ingest.py` が自動で振るので手で付ける必要はない。
**店名が変わると ID も変わる**点だけ注意（改名時は旧 ID を `aliases` ではなく
手で引き継ぐか、お気に入りを付け直す）。

## 取り込み

```sh
# CSV / TSV から（公式フロア案内からのコピペを想定）
python3 tools/ingest.py --csv in/ekimae2_b2.csv --building 2 --floor B2 --source official:ekimae2 --verified

# 保存した公式フロア案内の HTML から（区画番号と店名の対を拾う best-effort）
python3 tools/ingest.py --html in/ekimae2_b2.html --building 2 --floor B2 --source official:ekimae2 --dry-run

# 検算
python3 tools/validate_stores.py
```

`--dry-run` は差分を表示するだけで書き込まない。まず必ず目視すること。
