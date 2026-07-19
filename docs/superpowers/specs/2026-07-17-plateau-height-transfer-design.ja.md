# 設計: PLATEAU 建物属性を既存 OSM 建物へ転記する (Phase 1)

Date: 2026-07-17
Scope: Rapid (クライアント) + rapid_plateau_api (サーバ)
Phase: 3 段階のうち第 1 段階（後述の "Phased Roadmap" 参照）

> **正典**: 実装作業の canonical は英語版
> [2026-07-17-plateau-height-transfer-design.md](2026-07-17-plateau-height-transfer-design.md)
> です。本書は日本語話者との議論・レビュー用の翻訳版です。両版に差分が生じた場合、英語版が優先されます。

## 問題

既存の OSM 建物オブジェクトのうち、高さ・標高・階数のデータが欠落しているものが多数存在します。PLATEAU データセットには同一の物理建物に対応する属性値がありますが、現在の Rapid Plateau エディタは PLATEAU からの新規建物追加のみをサポートしており、**既に OSM に存在する建物への属性転記**は提供されていません。

そこで、PLATEAU の代表点を地図上でクリックするだけで、その下の OSM 建物に欠落属性を追加できる Rapid ツールを、既存値の上書きに対する強固な安全策とともに実装します。1 件ずつマッパーが判断する形式です。

## Goals

- マッパーが地図上の PLATEAU 代表点をクリックすることで、その真下の OSM 建物に `height` / `ele` / `building:levels` のうち**欠落しているタグだけ**を追加できる
- マッチの状態（候補・完全カバー済み・値の不一致・マッチ不明瞭）をアイコンで可視化し、PLATEAU カバレッジを俯瞰でき、目視確認が必要な状況をひと目で識別できる
- 既存 OSM 値は Phase 1 で決して上書きしない
- Rapid の 50 オブジェクト/changeset 上限に収まる（バッチではなく 1 件ずつ手動）
- Phase 2（building:part 対応）・Phase 3（不一致値の上書き機能）を追加する際にリファクタが不要な構造で実装する

## Non-goals

- PLATEAU building:part の属性転記（Phase 2）
- PLATEAU part から OSM 側の `building:part` を新規作成する機能（Phase 2）
- 自動バッチマッチ + レビューパネル UI（Phase 3 を実施するかどうか自体がコミュニティ協議後の判断事項であり、実施が決まった場合には加えて Rapid の 50 オブジェクト上限緩和のコミュニティ相談も必要）
- `roof:shape` の転記（Phase 2 で building:part 対応と合わせて扱う。「屋根だけ vs 通常建物」の区別は `building=roof` で表現できるため Phase 1 での必要性が薄く、屋根形状の詳細分類は Simple 3D Buildings と一体で議論するのが自然）
- `building:material` / `roof:material` / `start_date` / `name` / `addr:*` の転記（対象外。事実精度が低いか、OSM 側で独自運用されているため）
- 既存 OSM 値の上書き（値が明らかに乖離している場合を含む。Phase 3 を実施するかどうか自体がコミュニティ協議後の判断事項）
- サーバ側での事前マッチ計算・キャッシュ（クライアントで計算する。サーバは代表点の提供のみ）

## 設計

### 機能概要

Rapid の Toolbar に「PLATEAU 高さ転記モード」を新設します。モード ON の間、bbox 内の PLATEAU outline 代表点のうち OSM 建物ポリゴン内に落ちるものをアイコンで表示します。アイコン色はマッチ状態で分類します:

| 状態 | アイコン | クリック時 |
|---|---|---|
| `CANDIDATE` | マゼンタドット | プレビュー表示 → 確認で欠落タグを適用 |
| `COVERED` | 緑チェック | 情報表示のみ（完全カバー、Plateau と一致） |
| `CONFLICT` | 黄色 !? マーク | 情報表示のみ（差分表示。上書き機能は Phase 3 として保留、実装可否はコミュニティ協議次第） |
| `AREA_MISMATCH` | オレンジ !? マーク | 情報表示のみ（街区マッピング疑い or PLATEAU 分割不足の疑い、目視確認推奨） |

モードは他の Rapid ツールと排他的で、OFF に戻せばアイコンが全消去され通常編集画面に戻ります。

### マッチ対象: outline のみ、面積比フィルタ

- PLATEAU の候補は `building=*` を持ち `building:part` を持たない feature のみ（outline / parent 建物）
- サーバから配信される `representative_point`（`ST_PointOnSurface` の結果、必ずポリゴン内部）を使う
- クライアントで OSM building way / relation に対して point-in-polygon 判定
- 対応 OSM 建物が**ちょうど 1 件**の場合のみ候補化。0 件・複数件の曖昧ケースはアイコンを出さずスキップ
- 面積比が 0.5〜2.0（PLATEAU 面積 / OSM 面積）の範囲内でないと `CANDIDATE` / `COVERED` / `CONFLICT` にならず、範囲外は `AREA_MISMATCH` になる

### タグ範囲とタグ単位の欠落埋め (C-b)

転記対象は以下 3 タグ:

- `height`
- `ele`
- `building:levels`

**タグ単位で判定**します。OSM 側で欠落しているタグだけを追加し、既存値には Phase 1 で決して触れません。プレビュー UI には実際に追加される tag のサブセットだけを表示します。

状態判定ロジック（1 つの候補に対して）:

```
if area_ratio < 0.5 or area_ratio > 2.0:
  state = AREA_MISMATCH
elif missing_tags が空でない:
  state = CANDIDATE
elif conflicting_tags が空でない:
  state = CONFLICT
elif matching_tags が空でない and missing_tags が空:
  state = COVERED
else:
  # PLATEAU 側にも OSM 側にも比較すべきタグが無い → アイコン出さずスキップ
  skip
```

### UX フロー

1. ユーザが Toolbar から「PLATEAU 高さ転記モード」を有効化
2. 現在の bbox で候補を計算しアイコン描画（`CANDIDATE` は zoom ≥ 17、他 3 状態は視覚ノイズ低減のため zoom ≥ 18）
3. `CANDIDATE` ドットをクリック → 対応する OSM 建物をハイライトし、現状のタグ + 追加予定タグをプレビュー表示
4. 「適用」で標準の Rapid tag-edit action が dispatch され、Plateau feature ID を `transferredIDs` に登録、ドットは即座に消える
5. 他状態のアイコンをクリックしても情報 popup のみ（操作は発生しない）
6. Undo は OSM tag を元に戻し、`transferredIDs` から削除、ドット再表示。Redo は逆に再適用
7. モード OFF で全アイコン消去

### アーキテクチャ

**サーバ側 (rapid_plateau_api):**

- `osmfj_plateau_api.py` の `/api/mapwithai/buildings`: SELECT に `ST_AsGeoJSON(ST_PointOnSurface(geom)) AS representative_point` を追加
- 本 endpoint は OSM XML を返すため、代表点は各 `<way>` / `<relation>` に追加の `<tag>` 要素として付与（例: `<tag k="representative_point" v="139.7563,35.6795" />`）。PlateauService はこれを OSM タグではなく Entity プロパティとして取り出す
- outline / part 両方に付与（Phase 1 では outline 分のみ使用、Phase 2 で part 分を利用）
- 新規 endpoint なし、DB マイグレーションなし、API バージョン変更なし。既存クライアントは新タグを無視するだけ

**クライアント側 (Rapid):**

- `PlateauService` (既存拡張): response の `representative_point` を feature entity に格納
- `HeightTransferMode` (新規): モードの lifecycle、候補計算、`transferredIDs` set 管理、プレビュー state
- `HeightTransferAction` (新規): OSM way / relation に欠落タグを追加する標準 Rapid graph action。undo/redo は Rapid 標準機構で扱う
- `PixiLayerHeightTransfer` (新規): モード ON 時に状態別着色でアイコン描画、クリックのヒットテストを `HeightTransferMode` へ転送
- Toolbar (既存拡張): モード切替ボタン追加

### データモデル

`MatchCandidate`:

```typescript
type MatchCandidate = {
  plateauFeature: Entity;       // PLATEAU outline
  osmFeature: Entity;            // OSM building way/relation
  kind: 'outline_to_building';   // Phase 2 で 'part_to_part' 追加
  state: 'CANDIDATE' | 'COVERED' | 'CONFLICT' | 'AREA_MISMATCH';
  missingTags: string[];         // PLATEAU にあり OSM に欠落
  conflictingTags: {             // 両方にあるが値が異なる
    key: string;
    osmValue: string;
    plateauValue: string;
  }[];
  matchingTags: string[];        // 両方にあり値も一致
  ratio: number;                 // PLATEAU 面積 / OSM 面積
};
```

`HeightTransferMode` state:

```typescript
{
  active: boolean;
  transferredIDs: Set<string>;
  candidates: MatchCandidate[];
  selectedCandidate: MatchCandidate | null;
}
```

`transferredIDs` はセッションスコープ（ページリロードで破棄）。適用済み tag は Rapid の標準 auto-save で保持され、upload 後は次セッションで OSM 値として認識されて `COVERED` になります。

### 候補計算

```
function findCandidates(bbox):
  plateauFeatures = plateauService.getFeaturesInBbox(bbox)
  osmFeatures = graph.getBuildingsInBbox(bbox)

  outlines = plateauFeatures.filter(f =>
    f.tags.building and
    not f.tags['building:part'] and
    not transferredIDs.has(f.id) and
    not acceptIDs.has(f.id) and
    not ignoreIDs.has(f.id)
  )

  candidates = []
  for outline in outlines:
    rp = outline.representative_point
    matched = osmFeatures.filter(w =>
      w.tags.building and pointInPolygon(rp, w.geometry)
    )
    if len(matched) != 1:
      continue      # 曖昧 → skip、アイコン出さず

    osm = matched[0]
    ratio = geodesicArea(outline.geometry) / geodesicArea(osm.geometry)

    if ratio < 0.5 or ratio > 2.0:
      state = 'AREA_MISMATCH'
    else:
      tagStates = analyzeTagStates(osm, outline)
      if tagStates.missing:
        state = 'CANDIDATE'
      elif tagStates.conflicting:
        state = 'CONFLICT'
      elif tagStates.matching and not tagStates.missing:
        state = 'COVERED'
      else:
        continue    # 比較対象なし → skip

    candidates.append(MatchCandidate(outline, osm, 'outline_to_building',
                                     state, tagStates, ratio))

  return candidates
```

`analyzeTagStates(osm, plateau)` は 3 タグに対して `{missing, matching, conflicting}` を返す。`geodesicArea` は Turf.js の `@turf/area` を利用。

### Rapid 統合

- タグ追加は Rapid 標準の graph action pattern で行う。changeset には通常の tag 編集として載り、標準の upload フローと undo/redo に自然に統合される
- `transferredIDs` は既存の `acceptIDs` / `ignoreIDs` とは別の新規 set。accept の意味を歪めない
- Commit UI の comment 欄には、`HeightTransferAction` が 1 回以上 dispatch された session でデフォルト文言をプリセット（ユーザ編集可、既存 comment がある場合は追記）
- `source=RapiD_Plateau_JP` の既存 changeset タグはそのまま利用

### Backward-compat フォールバック

サーバが `representative_point` フィールドを返さない場合（旧デプロイ）、クライアントは `turf.pointOnFeature(geometry)` で計算します。若干の CPU コストは発生しますが、機能は動作します。

## Edge cases

**サーバ側:**

- `ST_PointOnSurface` が壊れた geometry で失敗 → NULL 返却 → クライアントで `turf.pointOnFeature` にフォールバック
- API endpoint ダウン → 既存の Plateau service エラー処理に従う

**クライアント側:**

- Plateau / OSM fetch 中 → モードは「候補計算中」インジケータを表示、アイコン非描画
- モード ON 中に OSM entity が他の action で削除 → 次サイクルで候補から除外、アイコンが消える
- Pan / 再 fetch で Plateau feature が失われる → 同上

**マッチ曖昧:**

- `representative_point` が null → `turf.pointOnFeature` フォールバック、それも失敗したら skip
- 複数 OSM 建物にヒット（重なり合ったポリゴン） → skip（Phase 1 の曖昧ルール）
- PLATEAU feature に 3 タグとも値なし → 候補にしない
- OSM が `building=roof` などの非典型値 → Phase 1 では対象内（値は問わない）

**UI 状態遷移:**

- モード ON 中に別 tool へ切替 → 自動 OFF、アイコン消去、進行中プレビューはキャンセル
- Undo → 該当 feature を `transferredIDs` から削除、アイコン再表示
- Redo → 逆に `transferredIDs` に再登録
- Reload → `transferredIDs` は失われるが、適用済みタグは Rapid auto-save で復元、upload 後は次セッションで `COVERED` に

**適用時:**

- プレビュー〜適用の間に OSM entity が削除 → 適用失敗、短い警告表示
- PLATEAU タグ値が invalid（例: 数値でない height） → その 1 タグのみ skip、他は適用

**Changeset upload 時:**

- Version conflict → 既存 Rapid の conflict resolution UI に委ねる
- Auth 切れ → 既存 OAuth フロー
- 50 objects/changeset 上限 → Rapid 標準の上限エラーが自然に出る（Phase 1 の運用上限）

## テスト戦略

**サーバ側 (rapid_plateau_api, pytest + `fresh_plateau_schema` fixture):**

- Integration: `representative_point` が outline / part の response に含まれ、座標が polygon 内部に落ちる
- Integration: 壊れた geometry で NULL 返却、リクエストは失敗しない
- Integration: 既存 API 契約が破壊されていない（JSON schema チェック）

**クライアント側 (Rapid, browser test suite):**

- Unit: `findCandidates` — outline のみ抽出、transferred/accept/ignore の除外、point-in-polygon の一意性、面積比の分岐、4 状態分類、タグ単位の missing/matching/conflicting 判定
- Unit: `HeightTransferAction` — タグ追加、undo で復元、redo で再適用、既存値は上書きしない、entity 削除時は noop
- Unit: `HeightTransferMode` — active flag 遷移、tool 切替時の自動 OFF、bbox 変更時の debounce 再計算
- Unit: `representative_point` 欠如時の `turf.pointOnFeature` フォールバック

**統合テスト（手動）:**

- ローカル `plateau_api` に数都市を投入 → Rapid を `#plateau_api_url=...` で向ける → アイコン描画 → クリック → 適用 → undo の end-to-end 確認

**手動 QA:**

- 密集地（東京 23 区中心部）: アイコン密度、パフォーマンス、zoom 閾値の妥当性
- 中密度地域（郊外住宅地）: 通常運用の代表
- 疎地域（地方都市）: 少数候補時の見え方
- 4 状態のアイコンが視覚的に区別可能で、情報 popup が意図どおり
- モード切替と他 tool の相互作用、reload、logout
- 50 objects/changeset 上限のフィードバックが分かりやすい

**パフォーマンス:**

- 密集地 bbox での `findCandidates` 実行時間測定（目標 < 100ms）
- パン時の debounce 挙動を体感で確認
- 必要なら Web Worker or 空間 index を追加（Phase 1 では実装せず、実測後に判断）

## 開発ブランチ運用

**この Phase 1 は必ず両リポジトリで feature branch を切って開発します。`main` への直接コミットは禁止します。**

- Rapid 側: `feature/plateau-height-transfer`
- rapid_plateau_api 側: `feature/representative-point`
- `main` への merge は PR レビューを経てから
- 実装中は頻繁に main を feature branch へ pull して衝突を早期検出
- 本番反映は `main` への merge 後にのみ実行

**根拠**: 変更が新規モード・新規 Pixi レイヤ・Toolbar 変更・新規 graph action・SQL 修正の複合で影響範囲が広く、本番稼働中の `rapid.nyampire.info` と plateau-api service の安定性を損なうリスクがあるため。

## 成果物

1. サーバ側 PR (`rapid_plateau_api`, `feature/representative-point`): `representative_point` フィールド追加
2. クライアント側 PR (`Rapid`, `feature/plateau-height-transfer`): `HeightTransferMode` / `HeightTransferAction` / `PixiLayerHeightTransfer` / Toolbar 拡張 / PlateauService 拡張 / `turf.pointOnFeature` フォールバック
3. 単体テスト・統合テスト（両リポジトリ）
4. 手動 QA レポート（密集地・中密度・疎地の 3 エリア）
5. 本番デプロイ（サーバ側 git-pull + service restart、クライアント側 `npm run dist` + rsync）

## Rollout 手順

1. **rapid_plateau_api を先に本番反映**（`representative_point` フィールド追加のみ、既存クライアントに影響なし）
2. Rapid PR を merge、`npm run dist` 実行
3. `dist/` を rsync で本番 web root へデプロイ
4. 動作確認: 数都市でアイコン描画・適用・undo の一連フロー
5. コミュニティ告知（OSM Japan Discord、反応次第で `talk-ja`）

## Rollback

- サーバ側: `git revert` で SELECT 変更を戻し、service 再起動
- クライアント側: 前バージョンの `dist/` を rsync 上書き
- DB マイグレーション不要、永続化 state なし → ロールバック影響は表示上のみ

## Open questions

| # | 問い | 解決タイミング |
|---|---|---|
| OQ-1 | Plateau DB での 3 タグ実際の充填率 | 実装初期に read-only SELECT COUNT で計測（~10 分） |
| OQ-2 | プレビュー UI: Sidebar / Popup どちらが Rapid の他 UI と揃うか | UI 実装着手時に既存パターン調査 |
| OQ-3 | アイコン ズーム閾値: 17 / 18 / 状態別チューニング | 手動 QA と性能測定後に調整 |
| OQ-4 | Changeset comment のデフォルト文言: 英語 / 日本語 / 併記 | 実装完了直前に nyampire と協議 |
| OQ-5 | アイコン資産: Rapid 既存アイコンライブラリから選ぶ / 新規 | UI 実装初期に調査 |

## Phased roadmap

**Phase 1（本設計）:** outline のみ、1件ずつ手動 UI、4 状態アイコン、タグ単位の欠落埋め、既存値の非上書き。

**Phase 2:** PLATEAU building:part の対応。`MatchCandidate.kind` を `'part_to_part'` に拡張、part matcher を追加、Pixi layer を part 対応に拡張。OSM `building:part` の新規作成方針と Simple 3D Buildings 規約との整合について別途ブレストが必要。

**Phase 3（実施可否はコミュニティ協議で判断）:** Phase 3 を実施するかどうか自体がコミュニティ協議後の判断事項であり、Phase 2 完了後に自動的に進む段階ではない。実施する場合の想定スコープ: OSM 既存値の上書き機能（`CONFLICT` 状態の info popup に「上書き」ボタン追加）、自動マッチ + レビューパネル UI (Model 2)。Model 2 の実装には加えて、Rapid の 50 オブジェクト/changeset 上限を緩和するコミュニティ相談も必要。コミュニティ協議は Phase 3 全体の前提条件。

Phase 1 で仕込む拡張フック:

| フック | Phase 1 の形 | Phase 2/3 での使い道 |
|---|---|---|
| `MatchCandidate.kind` | `'outline_to_building'` のみ | `'part_to_part'` 追加 |
| `findCandidates(kind)` | パラメータ化された関数構造 | part matcher を差し替え可能 |
| `PixiLayerHeightTransfer` | 状態別着色（後に kind 別も） | part 対応アイコン追加 |
| サーバ `representative_point` | outline / part 両方に付与 | Phase 2 で part 側を利用 |
| `analyzeTagStates.conflicting` | 表示のみ | Phase 3 が実施される場合（コミュニティ協議次第）に上書きボタン追加 |
