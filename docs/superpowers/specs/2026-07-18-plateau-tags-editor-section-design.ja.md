# PLATEAU タグ提案を地物編集ペインの独立セクションに統合する設計

- 日付: 2026-07-18
- 対象ブランチ: `feature/plateau-height-transfer`
- 前提: Phase 1（height/ele/building:levels 転記）実装済み。本設計はその UI 統合の改訂。
- 関連: `docs/superpowers/specs/2026-07-17-plateau-height-transfer-design.ja.md`

## 背景と目的

現在、PLATEAU タグ転記の候補は地図上に候補ドット（マゼンタ/緑/黄/オレンジ）で示され、
ドットをクリックすると**右上のフローティングパネル**（`UiHeightTransferPreview`）に
現タグ・追加タグ・Apply/Cancel が出る。この独立ウィンドウを廃し、**左ペインの地物編集画面
（エンティティエディタ）に統合**する。

統合方式は、iD/Rapid の validation UI（`outdated_tags` → `entity_issues` セクション）の
**見た目・操作を踏襲**しつつ、`entity_issues` とは**別の独立セクション**として実装する。
結果として、エディタ内には「Issues」と「PLATEAU tags」の2つのセクションが並ぶ。

### 明示的に採用しない選択肢

- **validator パイプライン経由にはしない**。理由: (1) 独立テーブルにするため、(2) Issues ペインの
  警告件数を汚さないため、(3) PLATEAU 提案は「修正すべきエラー」ではなく任意の補完提案であるため。
  validator UI の見た目（CSS クラス）だけを踏襲する。

## 全体像

| 要素 | 変更 |
|---|---|
| ツールバートグル（`heightTransfer`） | **存続**。機能全体の opt-in ON/OFF。ドット表示と提案セクションの算出を支配。 |
| 候補ドット（`PixiLayerHeightTransfer`） | **存続**（発見手段）。クリック挙動のみ変更（後述）。 |
| フローティングパネル（`UiHeightTransferPreview`） | **削除**。役割を新セクションへ移管。 |
| 新: `uiSectionPlateauTags` | **新規**。エディタ内の独立セクション。validation UI を踏襲。 |
| `heightTransfer.getCandidateForOSM(entityID)` | **新規メソッド**。選択中 1 建物ぶんの候補を返す。 |
| `actionTransferPlateauTags` | **再利用**（変更なし）。不足タグのみ追加、既存値は上書きしない。 |

## コンポーネント設計

### 1. `modules/ui/sections/plateau_tags.js`（中核・新規）

- `uiSectionPlateauTags(context)` を新設し、`uiSection(context, 'plateau-tags')` を土台にする。
- 描画は `entity_issues.js` の markup を踏襲し、同じ CSS クラス
  （`.issue-container` / `.issue` / `.issue-label` / `.issue-text` / `.issue-message` /
  `.issue-fix-list` / `.issue-fix-item` / `.fix-message`）を再利用する。
  → Validation と同じ見た目で、別テーブルとして並ぶ。
- API（他セクションと同じ形）:
  - `section.entityIDs(val)`: 選択エンティティ ID を受け取り、候補を再取得。
  - `section.shouldDisplay(() => 候補が存在する)`: 候補があるときだけ表示。
  - `section.label(() => "PLATEAU tags")`: セクション見出し。
- データ取得: `context.systems.heightTransfer.getCandidateForOSM(entityID)`。
- 状態別レンダリング（現行パネル踏襲）:
  - `CANDIDATE`: 不足タグ一覧（`key = value ← PLATEAU`）＋ Fix 項目「Apply」（実行可能）。
    クリックで内部的に `heightTransfer.apply(candidate)` を呼ぶ（既存の commit/annotation フローを再利用）。
  - `CONFLICT`: `conflict_note` と OSM/PLATEAU 値の対比を情報表示。**Fix なし**。
  - `AREA_MISMATCH`: `area_mismatch_note` を情報表示。**Fix なし**。
  - `COVERED`: セクション非表示（`shouldDisplay` が false）。

### 2. `heightTransfer.getCandidateForOSM(entityID)`（新規メソッド）

- 選択中の 1 建物に対応する `MatchCandidate` を返す（無ければ `null`）。
- 実装方針: 既に算出済みの `this.candidates`（現ビューぶん）から `osmFeature.id === entityID`
  で引く。opt-in トグルが OFF（`active === false`）のときは `null` を返す。
- 現状 `_recompute()` はビュー内候補を配列で保持しているため、id 一致で線形探索で足りる。
  必要なら `Map(osmID → candidate)` を副次的に構築してキャッシュする（詳細は実装プランで判断）。

### 3. `entity_editor.js` への組み込み

- `sections` 配列（現在 7 セクション）に `uiSectionPlateauTags(context)` を追加する。
- 位置は `uiSectionEntityIssues` の**直後**。→ 「Issues」の下に「PLATEAU tags」が並ぶ。
- 既存の render ループ（各セクションに `entityIDs/presets/tags/state` を配って `render` する箇所）は
  そのまま流用できる。`plateau_tags` セクションは `entityIDs` だけ使う。

### 4. ドットのクリック挙動変更（`PixiLayerHeightTransfer` / `HeightTransferMode`）

- 現状: アイコンの `pointertap` で `mode.select(candidate)` → フローティングパネル表示。
- 変更後: 対象 OSM 建物を **`select-osm` モードで選択**する。
  `context.enter('select-osm', { selection: { osm: [candidate.osmFeature.id] } })`
  （`maproulette_details.js` と同じ API を確認済み）。
  → エディタが開き、`plateau_tags` セクションが候補を表示する。
- `mode.select` / `selectedCandidate` / `clearSelection` はパネル専用だったため、
  パネル削除に伴い不要になる分は撤去する（詳細は実装プランで棚卸し）。

### 5. フローティングパネルの撤去

- `modules/ui/panes/UiHeightTransferPreview.js` を削除。
- `modules/core/UiSystem.js` の配線（フィールド宣言・`new UiHeightTransferPreview`・
  `.call(this.HeightTransferPreview.render)` の 3 箇所）を削除。
- `modules/ui/index.js` の export を削除。
- l10n キー（`height_transfer.current_tags/additions/apply/cancel/conflict_note/covered_note/
  area_mismatch_note`）は新セクションで流用する。不足があれば追加（例: セクション見出し用キー）。

## データフロー

```
[ツールバートグル ON]
   → heightTransfer.activate() → _recompute() でビュー内 candidates 算出
   → PixiLayerHeightTransfer が候補ドット描画

[ドットをクリック]
   → 対象 OSM 建物を select モードで選択
   → UiInspector/entity_editor が再描画
   → 各セクションに entityIDs 配布
   → uiSectionPlateauTags が getCandidateForOSM(id) で候補取得
   → shouldDisplay=true なら Validation 踏襲 UI で描画
        CANDIDATE: Apply Fix / CONFLICT・AREA_MISMATCH: 情報のみ

[Apply クリック]
   → heightTransfer.apply(candidate)
   → actionTransferPlateauTags（不足タグのみ追加）を editor.perform + commit
   → 'stablechange' → _recompute() → candidates 更新 → ドット/セクション再描画
```

## エラー処理・境界条件

- `heightTransfer` システムが未登録、または `active === false` の場合、
  `getCandidateForOSM` は `null` を返し、セクションは非表示。
- 選択が複数エンティティ / way 以外 / building 以外の場合は候補なし → 非表示。
- 候補適用後は当該建物が `transferredIDs` に入り `findCandidates` から除外されるため、
  再描画でセクションは自然に消える（COVERED 相当）。

## テスト方針

- `uiSectionPlateauTags` の単体テスト（`test/browser/ui/sections/` 配下）:
  4 状態それぞれで `shouldDisplay` と描画内容（Apply の有無、情報文言）を検証。
  依存はモックの `heightTransfer.getCandidateForOSM` で注入。
- `getCandidateForOSM` の単体テスト（active/inactive、id 一致/不一致）。
- 既存の `HeightTransferMatcher` / `actionTransferPlateauTags` テストは不変。
- パネル削除に伴い `UiHeightTransferPreview` のテストは削除。
- 実機確認（foreground Chrome、hard reload）: ドットクリック→エディタに 2 セクション表示、
  Apply でタグ追加、CONFLICT が情報のみ、を目視。

## スコープ外（Phase 1 では扱わない）

- CONFLICT の「PLATEAU 値で上書き」Fix（コミュニティ協議前提で Phase 3 以降）。
- relation/`building:part` のジオメトリ由来 representative_point 補完（既定方針どおり）。
- height 以外の PLATEAU カテゴリ（橋梁・トンネル等）。
