# Plateau 開発者向け情報

このドキュメントは、Rapid エディタにおける Plateau データ統合に関する開発者向け情報をまとめたものです。

## アーキテクチャ概要

Plateau データは `MapWithAIService`（`modules/services/MapWithAIService.js`）を通じて取得・管理されます。

- **データセットID**: `plateauJapan`
- **サービス**: `mapwithai`
- **データ形式**: OSM XML
- **タイルズームレベル**: 16以上

## Plateau API

### 本番URL

```
https://rapid.nyampire.info/api/mapwithai/buildings
```

`MapWithAIService.js` の `PLATEAU_API_URL` 定数にハードコードされています。

### ローカル開発時のAPI切り替え

URLハッシュパラメータでAPIエンドポイントをランタイムで上書きできます。

```
http://127.0.0.1:8080/#plateau_api_url=http://localhost:8000/api/mapwithai/buildings
```

ローカルで Plateau API サーバー（`rapid_plateau_api`）を起動し、上記のようにアクセスすることで、本番APIの代わりにローカルAPIを使用できます。

## URLハッシュパラメータ一覧

| パラメータ | 説明 | 例 |
|---|---|---|
| `plateau_api_url` | Plateau APIエンドポイントの上書き | `#plateau_api_url=http://localhost:8000/api/mapwithai/buildings` |
| `plateau_conflation` | クライアントサイドconflationの無効化 | `#plateau_conflation=false` |

## Plateau対応エリア表示（zoom 5〜14）

`PixiLayerPlateauCoverage` がPlateauデータが存在するエリアを半透明オレンジで表示します。

- **データソース**: `GET /api/mapwithai/coverage` （都市単位のConcaveHull）
- **表示ズーム**: 5〜14（15以上で実際の建物データに切り替わるため自動非表示）
- **色**: `#FE6100`（IBM Accessible Color Palette、色覚バリアフリー対応）
- **モジュール**: `modules/pixi/PixiLayerPlateauCoverage.js`
- **API 取得**: `MapWithAIService.loadCoverage()` でセッション内キャッシュ

サーバ側の `plateau_coverage` マテリアライズドビューが必要。
詳細は [rapid_plateau_api README](https://github.com/nyampire/rapid_plateau_api) 参照。

## クライアントサイド Conflation

Plateau 建物が既存のOSM建物と重複する場合、自動的に非表示にする機能です。

### 仕組み

1. 表示範囲内のOSM建物を収集
2. 各Plateau建物に対し、バウンディングボックスで事前フィルタ
3. Polyclip ライブラリでポリゴン交差を精密判定
4. 重複するPlateau建物を非表示にする

### キャッシュ

判定結果は `_plateauConflationCache`（`checked` / `rejected`）にキャッシュされ、OSMデータの変更時（`merge` イベント）に自動で無効化されます。

### 無効化

開発・デバッグ時にconflationを無効にしてすべてのPlateauデータを表示するには：

```
http://127.0.0.1:8080/#plateau_conflation=false
```

## テスト

Plateau 関連のテストは以下のファイルにあります：

- `test/browser/services/MapWithAIService.test.js` — XMLパース、conflationロジック
- `test/browser/core/RapidSystem.test.js` — データセットの追加・有効化・無効化・トグル

```bash
npm run test:browser
```

## 過去の主要な変更

- **対応エリア表示**: [#9](https://github.com/nyampire/Rapid/issues/9) ✅ 完了 (PR #10)
  - `PixiLayerPlateauCoverage` 追加
  - サーバ側 [rapid_plateau_api #10](https://github.com/nyampire/rapid_plateau_api/pull/10) でAPI実装
- **デフォルト表示位置**: 日本に変更（zoom 5.52/36.934/139.144）
- **OAuth client_id**: Plateau 用にハードコード変更（PR #8）

## 関連 Issue（オープン）

- [#3 Keyboard shortcut conflict (R / Shift+R)](https://github.com/nyampire/Rapid/issues/3)
- [#4 選択中のOSMオブジェクトと重複するPlateauオブジェクトを検索・表示する機能](https://github.com/nyampire/Rapid/issues/4)
- [#5 OSM建物のジオメトリをPlateauジオメトリで置換する機能（履歴保持）](https://github.com/nyampire/Rapid/issues/5)
- [#6 Plateau APIエラー時のフォールバックとユーザー通知の改善](https://github.com/nyampire/Rapid/issues/6)
- [#7 ビルド時にclient_id/client_secretを環境変数から注入する仕組み](https://github.com/nyampire/Rapid/issues/7)
- [#8 PlateauからOSMへのタグマッピングルールのカスタマイズ機能](https://github.com/nyampire/Rapid/issues/8)
- [#11 テストカバレッジの拡充](https://github.com/nyampire/Rapid/issues/11)

## サーバ側との関係

サーバ側リポジトリ: [nyampire/rapid_plateau_api](https://github.com/nyampire/rapid_plateau_api)

クライアントが利用する主な API:
- `GET /api/mapwithai/buildings?bbox=...` → OSM XML
- `GET /api/mapwithai/coverage` → GeoJSON FeatureCollection（対応エリア）

サーバ側のアーキテクチャやデータベース構造は、上記リポジトリの README / ARCHITECTURE.md 参照。
