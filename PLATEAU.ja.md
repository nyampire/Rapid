# Plateau インポート機能 開発者ガイド

*English version: [PLATEAU.md](PLATEAU.md)*

Plateau の建築物データを OpenStreetMap にインポートする作業を支援するために
Rapid へ追加した機能について、実装と開発の進め方をまとめたものです。

このフォークが扱うのは **Plateau の建築物データのみ**です。Plateau には橋梁・
トンネル・植生などのカテゴリもありますが、それらは対象外です。

関連リポジトリは 3 つあります。

| リポジトリ | 役割 |
|---|---|
| [nyampire/Rapid](https://github.com/nyampire/Rapid) | エディタ（このリポジトリ） |
| [nyampire/rapid_plateau_api](https://github.com/nyampire/rapid_plateau_api) | 建物データを配信するバックエンド |
| [nyampire/rapid_plateau_dashboard](https://github.com/nyampire/rapid_plateau_dashboard) | インポート進捗の可視化 |

## アーキテクチャ概要

Plateau データは `PlateauService`（`modules/services/PlateauService.js`）が
取得・管理します。

- **データセットID**: `plateauJapan`
- **データ形式**: OSM XML
- **タイルズームレベル**: 16 以上

Plateau 固有の処理（リレーション対応、conflation、カバレッジ、ハイライト）は、
upstream の MapWithAI / PMTiles まわりから独立させてあります。
`git merge upstream/main` で Plateau 側が巻き込まれないようにするためです。

このサービスが出すデータには `__service__ = 'plateau'` が付きます。

### Plateau 固有のモジュール

| モジュール | 役割 |
|---|---|
| `modules/services/PlateauService.js` | API 取得、リレーション組み立て、conflation、カバレッジ |
| `modules/pixi/PixiLayerPlateauCoverage.js` | 対応エリアの塗りつぶし表示 |
| `modules/pixi/PixiLayerHeightTransfer.js` | タグ転記の候補ドット描画 |
| `modules/modes/HeightTransferMode.js` | タグ転記モード本体。候補の再計算と適用 |
| `modules/core/lib/HeightTransferMatcher.js` | Plateau 外形と OSM 建物の突き合わせ |
| `modules/ui/sections/plateau_tags.js` | エンティティエディタ内のタグ転記セクション |
| `modules/actions/transfer_plateau_tags.js` | タグ追加の編集アクション |

## Plateau API

### 本番URL

```
https://rapid.nyampire.info/api/mapwithai/buildings
```

`PlateauService.js` の `PLATEAU_API_URL` 定数にハードコードされています。

### ローカル開発時のAPI切り替え

URLハッシュパラメータでAPIエンドポイントをランタイムで上書きできます。

```
http://127.0.0.1:8080/#plateau_api_url=http://localhost:8000/api/mapwithai/buildings
```

ローカルで Plateau API サーバー（`rapid_plateau_api`）を起動し、上記のように
アクセスすることで、本番APIの代わりにローカルAPIを使用できます。

## URLハッシュパラメータ一覧

| パラメータ | 説明 | 例 |
|---|---|---|
| `plateau_api_url` | Plateau APIエンドポイントの上書き | `#plateau_api_url=http://localhost:8000/api/mapwithai/buildings` |
| `plateau_conflation` | クライアントサイドconflationの無効化 | `#plateau_conflation=false` |

## タグ転記（height / ele / building:levels）

Plateau が持つ高さ情報を、既存の OSM 建物へ転記する機能です。
ツールバーの「タグ転記モード」で有効になります。

対象タグは `height` / `ele` / `building:levels` の 3 つです。

### 候補の判定

`HeightTransferMatcher.findCandidates()` が、Plateau 外形の代表点
（API が返す `representative_point`）を含む OSM 建物を探します。含む建物が
ちょうど 1 つのときだけ候補になります。0 個や複数なら曖昧なので対象外です。

そのうえで面積比（Plateau 外形 ÷ OSM 建物）を見ます。

| 面積比 | 扱い |
|---|---|
| 0.5 未満 | 候補から除外 |
| 0.5〜2.0 | タグの状態で判定（下表） |
| 2.0 超 | `AREA_MISMATCH` |

0.5 未満を捨てるのは、Plateau が塔屋や物置といった付属構造物を
`building:part` ではなく独立した `building=yes` として持つためです。
代表点が大きな OSM 建物の内側に落ちるので、除外しないとノイズになります。
これらの高さは付属構造物自身の高さであって、建物の高さではありません。

面積比が範囲内なら、対象タグの状態で候補の状態が決まります。判定の優先順位は
「欠けている」→「食い違っている」→「一致している」の順です。

| 状態 | 意味 | 表示 |
|---|---|---|
| `CANDIDATE` | 追加できるタグがある | マゼンタのドット（zoom 17〜） |
| `CONFLICT` | OSM と Plateau で値が違う | ドット（zoom 18〜）+ 注記のみ |
| `AREA_MISMATCH` | Plateau 外形が OSM 建物の 2 倍超 | オレンジの `!?`（zoom 18〜） |
| `COVERED` | すべて存在し一致している | セクション自体を非表示 |

### 適用

建物を選択すると、エンティティエディタに「Plateauタグ転記」セクションが出ます。
追加されるタグが読み取り専用で並び、「適用」ボタンか、選択中のみ有効な
ショートカット `A` で転記できます。

セクションの構造は、注記を出すかどうかを状態が決め、タグ表と適用ボタンを出すか
どうかを「追加できるタグがあるか」が決める、という直交した形になっています。
そのため `AREA_MISMATCH` でも、追加できるタグがあれば注記と一緒に適用ボタンが
出ます。`CONFLICT` は状態の優先順位から追加できるタグが必ず空になるので、
特別扱いなしに注記だけが表示されます。

値の上書きは行いません。既存の OSM の値と食い違う場合は注記を出すだけで、
上書きするかどうかはコミュニティでの合意を待っている段階です。

## LOD2 リレーション対応

Plateau の LOD2 建物は、外形と屋根などの部分が `type=building` リレーションで
まとまっています。API 側がリレーションを出力し、クライアントはそれを解釈します。

- リレーション単位の conflation（一部だけ OSM と重なる場合の判定）
- 複数セクション建物の選択・ホバー時にメンバーをハイライト
- 「Add Entire Feature」（リレーション全体）と「Add Only This Feature」
  （その部分だけ）の使い分け。後者は `Shift+A`

## Plateau対応エリア表示（zoom 5〜15）

`PixiLayerPlateauCoverage` がPlateauデータが存在するエリアを半透明オレンジで表示します。

- **データソース**: `GET /api/mapwithai/coverage` （都市単位のConcaveHull）
- **表示ズーム**: 5〜15（16 以上で実際の建物データに切り替わるため自動非表示）
- **色**: `#FE6100`（IBM Accessible Color Palette、色覚バリアフリー対応）
- **モジュール**: `modules/pixi/PixiLayerPlateauCoverage.js`
- **API 取得**: `PlateauService.loadCoverage()` でセッション内キャッシュ

サーバ側の `plateau_coverage` マテリアライズドビューが必要です。
詳細は [rapid_plateau_api README](https://github.com/nyampire/rapid_plateau_api) を参照してください。

## クライアントサイド Conflation

Plateau 建物が既存のOSM建物と重複する場合、自動的に非表示にする機能です。

### 仕組み

1. 表示範囲内のOSM建物を収集
2. 各Plateau建物に対し、バウンディングボックスで事前フィルタ
3. Polyclip ライブラリでポリゴン交差を精密判定
4. 重複するPlateau建物を非表示にする

### キャッシュ

判定結果は `_plateauConflationCache`（`checked` / `rejected`）にキャッシュされ、
OSMデータの変更時（`merge` イベント）に自動で無効化されます。

### 無効化

開発・デバッグ時にconflationを無効にしてすべてのPlateauデータを表示するには：

```
http://127.0.0.1:8080/#plateau_conflation=false
```

## テスト

```bash
npm run test:browser
```

Plateau 関連のテストは主に以下にあります。

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

UI 文字列の英語ソースは `data/core.yaml` です。`data/l10n/core.en.json` は
そこから生成されるので、直接編集しないでください。

日本語訳のうちフォーク固有のキーは `data/l10n/core.ja.json` を直接編集します
（本家の文字列は Transifex 由来です）。

翻訳を足しても画面に出ないときは、ブラウザキャッシュを疑ってください。
`data/l10n/*.min.json` はキャッシュが効くため、新しいキーが
「Missing translation」のまま表示されることがあります。シークレット
ウィンドウで開くと切り分けられます。

## サーバ側との関係

サーバ側リポジトリ: [nyampire/rapid_plateau_api](https://github.com/nyampire/rapid_plateau_api)

クライアントが利用する主な API:

- `GET /api/mapwithai/buildings?bbox=...` → OSM XML
- `GET /api/mapwithai/coverage` → GeoJSON FeatureCollection（対応エリア）

建物データには、タグ転記が使う `representative_point`（外形の内部にある代表点）が
含まれます。ポリゴンが凹んでいる場合に重心が外に出てしまうため、重心ではなく
内部に落ちる点を使っています。

サーバ側のアーキテクチャやデータベース構造は、上記リポジトリの
README / ARCHITECTURE.md を参照してください。

## 関連 Issue

未対応の課題や検討中の機能は
[issue 一覧](https://github.com/nyampire/Rapid/issues) を参照してください。
