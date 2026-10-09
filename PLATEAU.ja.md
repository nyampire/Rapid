# Plateauインポート機能 開発者ガイド

*English version: [PLATEAU.md](PLATEAU.md)*

Plateauの建築物データをOpenStreetMapにインポートする作業を支援するために
Rapidへ追加した機能について、実装と開発の進め方をまとめたものです。

エディタの使い方は、OSM wikiの[JA:MLIT PLATEAU/Plateau RapiD](https://wiki.openstreetmap.org/wiki/JA:MLIT_PLATEAU/Plateau_RapiD)に利用者向けにまとめています。

このフォークが扱うのは**Plateauの建築物データのみ**です。Plateauには橋梁・
トンネル・植生などのカテゴリもありますが、それらは対象外です。

関連リポジトリは3つあります。

| リポジトリ | 役割 |
|---|---|
| [nyampire/Rapid](https://github.com/nyampire/Rapid) | エディタ（このリポジトリ） |
| [nyampire/rapid_plateau_api](https://github.com/nyampire/rapid_plateau_api) | 建物データを配信するバックエンド |
| [nyampire/rapid_plateau_dashboard](https://github.com/nyampire/rapid_plateau_dashboard) | インポート進捗の可視化 |

## アーキテクチャ概要

Plateauデータは`PlateauService`（`modules/services/PlateauService.js`）が
取得・管理します。

- **データセットID**: `plateauJapan`
- **データ形式**: OSM XML
- **タイルズームレベル**: 16以上

Plateau固有の処理（リレーション対応、conflation、カバレッジ、ハイライト）は、
upstreamのMapWithAI / PMTilesまわりから独立させてあります。
`git merge upstream/main`でPlateau側が巻き込まれないようにするためです。

このサービスが出すデータには`__service__ = 'plateau'`が付きます。

### Plateau固有のモジュール

| モジュール | 役割 |
|---|---|
| `modules/services/PlateauService.js` | API取得、リレーション組み立て、conflation、カバレッジ |
| `modules/pixi/PixiLayerPlateauCoverage.js` | 対応エリアの塗りつぶし表示 |
| `modules/pixi/PixiLayerHeightTransfer.js` | タグ転記の候補ドット描画 |
| `modules/modes/HeightTransferMode.js` | タグ転記モード本体。候補の再計算と適用 |
| `modules/core/lib/HeightTransferMatcher.js` | Plateau外形とOSM建物の突き合わせ |
| `modules/ui/sections/plateau_tags.js` | エンティティエディタ内のタグ転記セクション |
| `modules/actions/transfer_plateau_tags.js` | タグ追加の編集アクション |
| `modules/util/plateau_height_warning.js` | 高さの警告を、利用者に見せる文にする |
| `modules/ui/plateau_height_warning.js` | 高さの警告の欄を描く |

## Plateau API

### 本番URL

```
https://rapid.nyampire.info/api/mapwithai/buildings
```

`PlateauService.js`の`PLATEAU_API_URL`定数にハードコードされています。

### ローカル開発時のAPI切り替え

URLハッシュパラメータでAPIエンドポイントをランタイムで上書きできます。

```
http://127.0.0.1:8080/#plateau_api_url=http://localhost:8000/api/mapwithai/buildings
```

ローカルでPlateau APIサーバー（`rapid_plateau_api`）を起動し、上記のように
アクセスすることで、本番APIの代わりにローカルAPIを使用できます。

## URLハッシュパラメータ一覧

| パラメータ | 説明 | 例 |
|---|---|---|
| `plateau_api_url` | Plateau APIエンドポイントの上書き | `#plateau_api_url=http://localhost:8000/api/mapwithai/buildings` |
| `plateau_conflation` | クライアントサイドconflationの無効化 | `#plateau_conflation=false` |
| `plateau_overwrite` | タグ転記で、タグごとにOSMとPlateauのどちらの値を使うかを選べるようにする（協議の前の試用） | `#plateau_overwrite=1` |

## タグ転記（height / ele / building:levels）

Plateauが持つ高さ情報を、既存のOSM建物へ転記する機能です。
ツールバーの「タグ転記モード」で有効になります。

対象タグは`height` / `ele` / `building:levels`の3つです。

### 候補の判定

`HeightTransferMatcher.findCandidates()`が、Plateau外形の代表点
（APIが返す`representative_point`）を含むOSM建物を探します。含む建物が
ちょうど1つのときだけ候補になります。0個や複数なら曖昧なので対象外です。

そのうえで面積比（Plateau外形 ÷ OSM建物）を見ます。

| 面積比 | 扱い |
|---|---|
| 0.5未満 | 候補から除外 |
| 0.5〜2.0 | タグの状態で判定（下表） |
| 2.0超 | `AREA_MISMATCH` |

0.5未満を捨てるのは、Plateauが塔屋や物置といった付属構造物を
`building:part`ではなく独立した`building=yes`として持つためです。
代表点が大きなOSM建物の内側に落ちるので、除外しないとノイズになります。
これらの高さは付属構造物自身の高さであって、建物の高さではありません。

面積比が範囲内なら、対象タグの状態で候補の状態が決まります。判定の優先順位は
「欠けている」→「食い違っている」→「一致している」の順です。

| 状態 | 意味 | 表示 |
|---|---|---|
| `CANDIDATE` | 追加できるタグがある | マゼンタのドット（zoom 17〜） |
| `CONFLICT` | OSMとPlateauで値が違う | ドット（zoom 18〜）+ 注記のみ |
| `AREA_MISMATCH` | Plateau外形がOSM建物の2倍超 | オレンジの`!?`（zoom 18〜） |
| `COVERED` | すべて存在し一致している | セクション自体を非表示 |

### 適用

建物を選択すると、エンティティエディタに「Plateauタグ転記」セクションが出ます。
追加されるタグが読み取り専用で並び、「適用」ボタンか、選択中のみ有効な
ショートカット`A`で転記できます。

セクションの構造は、注記を出すかどうかを状態が決め、タグ表と適用ボタンを出すか
どうかを「追加できるタグがあるか」が決める、という直交した形になっています。
そのため`AREA_MISMATCH`でも、追加できるタグがあれば注記と一緒に適用ボタンが
出ます。`CONFLICT`は状態の優先順位から追加できるタグが必ず空になるので、
特別扱いなしに注記だけが表示されます。

既定では値の上書きは行いません。
既存のOSMの値と食い違う場合は注記を出すだけです。
上書きするかどうかは、コミュニティでの合意を待っている段階です。

協議で実物を試してもらうため、URLに`plateau_overwrite=1`を付けたときだけ、OSMに無いタグと食い違うタグを1つの表に並べ、行ごとに「OSM」と「Plateau」のボタンで使う値を選べます。
最初は、OSMに無いタグでは「Plateau」、食い違うタグでは「OSM」が選ばれています。
OSMに無いタグで「OSM」を選ぶと、そのタグは追加しません。
転記元の建物に高さの警告があるときと、面積の不一致のときは、食い違うタグの「Plateau」を選べず、その理由の文が出ます。
協議でご意見をいただきたい点と試し方は、OSM wikiの[既存の値の上書き（試用中）](https://wiki.openstreetmap.org/wiki/JA:MLIT_PLATEAU/Plateau_RapiD#%E6%97%A2%E5%AD%98%E3%81%AE%E5%80%A4%E3%81%AE%E4%B8%8A%E6%9B%B8%E3%81%8D%EF%BC%88%E8%A9%A6%E7%94%A8%E4%B8%AD%EF%BC%89)にまとめています。

## 高さの警告

Plateauの建物の高さには、誤りが含まれることがあります。
誤った高さがそのままOSMに入らないよう、高さが怪しい建物を、追加するかどうかを決める時点で知らせます。
警告の役目は知らせることだけで、追加やタグ転記の操作は止めない作りです。

### APIからの受け取り

判定はAPI側で行い、建物を返すときに目印のタグを添えます。

| タグ | 値 |
|---|---|
| `plateau:height_warning` | 当てはまった検査の名前を`;`でつないだもの（例: `needle;floor-height`） |
| `plateau:footprint_m2` | 平方メートルでの底面積。`needle`に当てはまったときだけ付く |

この2つはOSMのタグではありません。
`PlateauService`が読み込みの時点で取り除き、`heightWarnings`と`footprintM2`という建物の内部の属性に移します。
建物を追加するときは、`rapid_accept_feature.js`がこの内部の属性も消すので、OSMには送られません。

古いエディタは、届いたタグをすべて建物に写します。
そのため、本番に出すときはエディタを先に、APIを後に更新します。

### 検査

| 検査 | 警告にする条件 |
|---|---|
| `degenerate-area` | 輪郭の面積が0以下 |
| `part-over-outline` | 建物の一部が、建物全体より10mを超えて高い |
| `needle` | 高さが15mを超え、底面積が20m²未満。建物の一部は対象外 |
| `absolute` | 高さが1.0m未満 |
| `floor-height` | `building`が`house`、`apartments`、`residential`で、高さを階数で割った値が1.5m未満か10.2mを超える |

屋上の塔屋や階段室は、地面からの高さが高く、底面積は小さいのがふつうです。
そのため、建物の一部は`needle`の対象から外しています。
工場や倉庫は1階が高いことが多いので、`floor-height`は住宅に限っています。
閾値と判定の詳細は、API側のリポジトリの`plateau_height_warning.py`を参照してください。

### 表示

警告の付いた建物の、地図上の塗りは点の模様です。
建物を選ぶと、サイドバーのタグ一覧の上に、警告の理由の欄が出ます。
建物が`type=building`のリレーションに属するときは、リレーションと全メンバーの警告をまとめて出します。
1つを選んで追加すると、建物全体が一緒に追加されるためです。

タグ転記では、転記元に警告があると、候補の印を赤い縁と「!」にし、「Plateauタグ転記」の欄にも同じ警告を出します。
転記するのは外形の高さだけなので、ここで見るのは外形自身の警告と、建物の一部の`part-over-outline`だけです。

## LOD2リレーション対応

PlateauのLOD2建物は、外形と屋根などの部分が`type=building`リレーションで
まとまっています。API側がリレーションを出力し、クライアントはそれを解釈します。

- リレーション単位のconflation（一部だけOSMと重なる場合の判定）
- 複数セクション建物の選択・ホバー時にメンバーをハイライト
- 「Add Entire Feature」（リレーション全体）と「Add Only This Feature」
  （その部分だけ）の使い分け。後者は`Shift+A`

## Plateau対応エリア表示（zoom 5〜15）

`PixiLayerPlateauCoverage`がPlateauデータが存在するエリアを半透明オレンジで表示します。

- **データソース**: `GET /api/mapwithai/coverage`（都市単位のConcaveHull）
- **表示ズーム**: 5〜15（16以上で実際の建物データに切り替わるため自動非表示）
- **色**: `#FE6100`（IBM Accessible Color Palette、色覚バリアフリー対応）
- **モジュール**: `modules/pixi/PixiLayerPlateauCoverage.js`
- **API取得**: `PlateauService.loadCoverage()`でセッション内キャッシュ

サーバ側の`plateau_coverage`マテリアライズドビューが必要です。
詳細は[rapid_plateau_api README](https://github.com/nyampire/rapid_plateau_api)を参照してください。

## 背景画像

背景画像の一覧に、PLATEAU VIEWのタイル配信のオルソ画像（`ortho-all`）を「MLIT Plateau Ortho (all years)」として足しています。
すべての年の画像を、新しい年のものを上に重ねて1つにした配信です。
項目はエディタ独自の設定の`data/manual_imagery.json`にあり、エディタが読む`data/imagery.json`にも同じ項目を手で足しています。
`npm run imagery`で一覧を作り直しても、独自の設定から同じ項目が作られます。

一覧に出る範囲は、日本のおおまかな四角形です。
画像の無い場所（木更津、岡山の中心部など）では、選ぶと背景が空白になります。

`ortho-all`は配信元の案内のページに載っておらず、配信が続く保証はありません。
そのため、editor-layer-index由来の2020年版（「MLIT Plateau Official」）も残しています。

## クライアントサイドConflation

Plateau建物が既存のOSM建物と重複する場合、自動的に非表示にする機能です。

### 仕組み

1. 表示範囲内のOSM建物を収集
2. 各Plateau建物に対し、バウンディングボックスで事前フィルタ
3. Polyclipライブラリでポリゴン交差を精密判定
4. 重複するPlateau建物を非表示にする

### キャッシュ

判定結果は`_plateauConflationCache`（`checked` / `rejected`）にキャッシュされ、
OSMデータの変更時（`merge`イベント）に自動で無効化されます。

### 無効化

開発・デバッグ時にconflationを無効にしてすべてのPlateauデータを表示するには：

```
http://127.0.0.1:8080/#plateau_conflation=false
```

## テスト

```bash
npm run test:browser
```

Plateau関連のテストは主に以下にあります。

- `test/browser/services/PlateauService.test.js` — XMLパース、conflation、リレーション
- `test/browser/core/lib/HeightTransferMatcher.test.js` — 候補判定と面積比
- `test/browser/modes/HeightTransferMode.test.js` — 適用、ショートカット、再計算
- `test/browser/ui/sections/plateau_tags.js` — エディタセクションの表示
- `test/browser/core/RapidSystem.test.js` — データセットの追加・有効化・トグル

## ローカル開発

```bash
npm install
npm run start         # http://127.0.0.1:8080
```

### 翻訳の追加

UI文字列の英語ソースは`data/core.yaml`です。`data/l10n/core.en.json`は
そこから生成されるので、直接編集しないでください。

日本語訳のうちフォーク固有のキーは`data/l10n/core.ja.json`を直接編集します
（本家の文字列はTransifex由来です）。

翻訳を足しても画面に出ないときは、ブラウザキャッシュを疑ってください。
`data/l10n/*.min.json`はキャッシュが効くため、新しいキーが
「Missing translation」のまま表示されることがあります。シークレット
ウィンドウで開くと切り分けられます。

## サーバ側との関係

サーバ側リポジトリ: [nyampire/rapid_plateau_api](https://github.com/nyampire/rapid_plateau_api)

クライアントが利用する主なAPI:

- `GET /api/mapwithai/buildings?bbox=...` → OSM XML
- `GET /api/mapwithai/coverage` → GeoJSON FeatureCollection（対応エリア）

建物データには、タグ転記が使う`representative_point`（外形の内部にある代表点）が
含まれます。ポリゴンが凹んでいる場合に重心が外に出てしまうため、重心ではなく
内部に落ちる点を使っています。

サーバ側のアーキテクチャやデータベース構造は、上記リポジトリの
README / ARCHITECTURE.mdを参照してください。

## 関連Issue

未対応の課題や検討中の機能は
[issue一覧](https://github.com/nyampire/Rapid/issues)を参照してください。
