# PLATEAUのオルソ画像（全年度）を背景画像に足す設計

- 日付: 2026-10-09
- 関連: 背景画像の一覧にある既存の項目`Plateau_orthophoto_official`（2020年版）

## 背景

PLATEAU VIEWのタイル配信は、航空写真のオルソ画像をXYZタイルで配っています。
案内のページ（https://docs.plateauview.mlit.go.jp/datasets/ortho/ ）に載っているのは、2023年版（`plateau-ortho-2023`）です。
配信元のタイルの一覧（`https://tile.plateauview.mlit.go.jp/tiles/catalog.json`）には、ほかに年ごとの画像と、すべての年をまとめた`ortho-all`があります。

エディタの背景画像の一覧には、editor-layer-indexから取り込んだ2020年版（`Plateau_orthophoto_official`）がすでにあります。
この項目のタイルの配信先は、Amazon S3の古い場所です。
新しい配信先の画像とは、URLも画像の中身も違います。

## 調べたこと

同じ場所のタイルを取得して比べました。

`ortho-all`は、2025年の画像がある大阪市の南港の付近で、`ortho-2025`とまったく同じ画像を返しました。
カタログの説明のとおり、新しい年の画像を上に重ねたものです。

2020年版の21の範囲で63点を調べたところ、2020年版に画像があった31点では、すべて`ortho-all`にも画像がありました。
`ortho-all`にだけ画像があった点は25点で、2020年版にだけ画像があった点はありませんでした。

画像の無い場所（木更津、岡山の中心部など）では、どの配信もHTTPの404を返します。
範囲を示す情報（`bounds`）は、タイルのメタデータにありません。
`ortho-all`は案内のページに載っておらず、配信が続くかどうかの保証はありません。

## 決めたこと

| 項目 | 決定 |
|---|---|
| 足す配信 | `ortho-all` |
| 足す先 | このエディタだけ。editor-layer-indexへの提案はしない |
| 既存の2020年版 | 残す。`ortho-all`が止まったときの予備にするため |
| 一覧に出す範囲 | 日本のおおまかな四角形 |
| OSMでの利用 | 2022年にOSMFJが国土交通省から受けた、公式のタイル画像の利用許諾の範囲として扱う |
| 取り込み方 | `data/manual_imagery.json`に足し、`data/imagery.json`にも変換した同じ項目を手で足す |

一覧に出す範囲を画像のある都市に絞らないのは、`ortho-all`の範囲が年ごとに広がり、固定するとすぐ古くなるためです。
日本の中でも画像の無い場所では、選ぶと背景が空白になります。
このことは項目の説明に書きます。

`data/imagery.json`全体を作り直す命令（`npm run imagery`）は使いません。
手元にあるeditor-layer-indexの版から一覧全体が作り直され、ほかの国の項目まで変わるためです。
`data/manual_imagery.json`にも同じ項目を書いておくので、あとで作り直しても項目は消えません。

元のRapidのコアの部分（`modules/core/ImagerySystem.js`など）には触れません。

## 足す項目

`data/manual_imagery.json`の`manualImagery`の配列の最後に、editor-layer-indexと同じ書き方で足します。

```json
{
  "id": "Plateau_orthophoto_all",
  "name": "MLIT Plateau Ortho (all years)",
  "type": "tms",
  "category": "photo",
  "url": "https://tile.plateauview.mlit.go.jp/tiles/ortho-all/{zoom}/{x}/{y}.png",
  "extent": {
    "min_zoom": 10,
    "max_zoom": 19,
    "bbox": { "min_lon": 122.9, "min_lat": 24.0, "max_lon": 146.0, "max_lat": 45.6 }
  },
  "attribution": {
    "required": true,
    "text": "MLIT_PLATEAU",
    "url": "https://docs.plateauview.mlit.go.jp/datasets/ortho/"
  },
  "license_url": "https://www.mlit.go.jp/plateau/site-policy/",
  "permission_osm": "explicit",
  "country_code": "JP",
  "description": "Japan MLIT Project PLATEAU orthophotos of all years, newest on top. Blank where no imagery is available."
}
```

`data/imagery.json`には、`scripts/update_imagery.js`が上の項目から作るのと同じ形の項目を足します。
置く位置は、ファイルの並び順（`name`の順）に合わせて、既存の`MLIT Plateau Official`の直後です。

```json
{
  "id": "Plateau_orthophoto_all",
  "name": "MLIT Plateau Ortho (all years)",
  "type": "tms",
  "template": "https://tile.plateauview.mlit.go.jp/tiles/ortho-all/{zoom}/{x}/{y}.png",
  "zoomExtent": [10, 19],
  "polygon": [[[122.9, 24.0], [122.9, 45.6], [146.0, 45.6], [146.0, 24.0], [122.9, 24.0]]],
  "terms_url": "https://docs.plateauview.mlit.go.jp/datasets/ortho/",
  "terms_text": "MLIT_PLATEAU",
  "description": "Japan MLIT Project PLATEAU orthophotos of all years, newest on top. Blank where no imagery is available."
}
```

出典の表示（地図の右下に出る文字）は、既存の2020年版と同じ`MLIT_PLATEAU`にそろえます。
変更セットの記録（`imagery_used`）に残るのは出典の表示ではなく、項目の名前（`MLIT Plateau Ortho (all years)`）です。
名前は英語で、ほかの背景画像と同じく日本語の翻訳はありません。

## 試験と確認

背景画像の一覧のデータについて、既存の試験はありません。
足した項目が`scripts/update_imagery.js`の変換と一致することは、手元で同じ変換を項目1つだけに通して確かめます。
`data/imagery.json`全体は作り直しません。

配布物を作り直し、ブラウザの試験が今までどおり通ることを確かめます。
そのうえで、手元のエディタで次を目で確かめます。

- 東京駅の付近で、一覧に新しい項目が出て、選ぶと画像が出ること
- 木更津の付近で、一覧には出るが、選ぶと空白になること
- 海外（ロンドンなど）では、一覧に出ないこと
- URLの`background=Plateau_orthophoto_all`で開いたときに、この画像が選ばれること
- 保存の画面の手前で、変更セットの記録（`imagery_used`）に`MLIT Plateau Ortho (all years)`が出ること（保存はしない）

## 文書

`PLATEAU.ja.md`と`PLATEAU.md`には、背景画像の項目を足したことと、配信の保証が無いことを書き足す予定です。

## 公開の手順

Pull Requestをマージしたあと、`DEPLOY.md`の「Rapidの更新」の手順で本番に送ります。

## 対象外

- editor-layer-indexへの提案
- 年ごとの画像（`plateau-ortho-2023`、`plateau-ortho-2024`など）を別の項目として足すこと
- 画像のある都市だけに一覧の範囲を絞ること
