# PLATEAU 形状置換 (#5) 設計

- Issue: [#5 OSM建物のジオメトリをPlateauジオメトリで置換する機能（履歴保持）](https://github.com/nyampire/Rapid/issues/5)
- ステータス: 設計 (実装未着手)
- 前提機能: タグ転記 (Phase 1, 本番稼働中) — `HeightTransferMode` / `HeightTransferMatcher` / `PixiLayerHeightTransfer` / `uiSectionPlateauTags`

## 背景

OSM 建物のジオメトリを Plateau の外形で更新したいが、既存建物を削除して
Plateau を新規取り込みすると OSM エンティティの編集履歴チェーンが途切れる。
JOSM の ReplaceGeometry 相当を Rapid に用意し、**既存 OSM way の id を保持
したままノードを Plateau 座標で置換**することで履歴を自然に維持する。

#5 issue はタグ転記機能の実装より前に書かれており、前提が古い:

- 「OSM と Plateau を同時選択して実行」という UX は不要。`HeightTransferMatcher.findCandidates()`
  が OSM building を選ぶだけで重なる Plateau outline を 1 対 1 特定する。
- 依存とされた #4 (重複 Plateau 検索) は実質 done (同じ Matcher が担う)。
- 「`actionRapidAcceptFeature` を参考に」とあるが、accept は Plateau を**新規追加**
  する処理で、既存 way のノードを差し替える形状置換とは方向が逆。参考にはなるが流用不可。
- 履歴保持の原理 (既存 way の id 保持 → v+1) は有効。`transfer_plateau_tags` +
  `HeightTransferMode.apply()` (editor.perform→commit + annotation で undo/redo 統合) が雛形。

### 共有ノード実測 (2026-07-23)

Geofabrik Kanto PBF を osmium で層別計測。ノード共有は building + building:part の
全 way で数え、way を 3 分類 (単純 building / building:part / relation member=outline):

| エリア | 単純building 孤立率 | building:part 孤立率 | relation member 孤立率 |
|---|---|---|---|
| 墨田区・京島 (超密集木造) | 100.0% (1591) | 4.8% (21) | 0.0% (9) |
| 世田谷・弦巻 (戸建て中密度) | 98.8% (165) | — (2) | — (0) |
| さいたま新都心 (大規模棟) | 91.7% (169) | — (0) | — (0) |
| 千代田・大手町 (都心オフィス) | 96.4% (169) | 100.0% (7) | — (0) |
| 新宿駅周辺 (高層/LOD2) | 81.7% (1316) | 52.4% (82) | 0.0% (3) |
| 渋谷駅周辺 (高層/LOD2) | 94.8% (1063) | 31.2% (16) | 14.3% (7) |

(括弧内は way 数、— は母数僅少)

- **単純 building way は 82〜100% 孤立**。非 LOD2 エリアは 92〜100%、LOD2 高層密集
  (新宿) でも 82%。日本の OSM 建物は隣接しても各棟を独立した閉じた way で描く文化で、
  角ノードを共有しない (JOSM ReplaceGeometry が身構える欧米の terrace house =
  長屋で辺を共有、とは違う)。→ **第 1 弾 (単純 building + 共有ノードガード) の妥当性は保たれる**。
- **building:part / relation member (outline) は共有だらけ** (孤立 0〜52%)。3D 建物は
  outline と part、part 同士が辺・ノードを共有するため。→ **relation 建物の形状置換は
  共有ノード処理が本質**で、単純 building とは別設計。第 1 弾でスコープ外にした判断は正しく、
  むしろ「relation 建物こそ将来フェーズで relation 単位に扱うべき」と定量的に裏付けられた
  (下記「将来フェーズ」)。
- building:part の絶対数は単純 building 比で数% (京島 21/1591、渋谷 16/1063) だが、
  LOD2 都市 (新宿 82) では増える。

## スコープ

### 対象
- 単純な閉じた `building` way。
- `findCandidates` の 1 対 1 ペアで `0.5 ≤ 面積比 ≤ 2.0` のもの
  (`state` が CANDIDATE / CONFLICT / COVERED。タグの揃い具合ではなく面積比で対象を決める —
  タグが揃っていても形は違いうるので COVERED も置換対象)。
- **共有ノードガード**: 置換対象 way のノードが他の building / building:part way と
  共有されていたら候補から除外 (第 1 弾では置換不可)。実測上 LOD2 高層密集エリアでは
  単純 building の孤立率が ~82% まで下がる (近隣の part とノードを共有) ため、
  カバー率は非 LOD2 で 92〜100%、LOD2 密集で ~82%。

### 非対象 (将来フェーズ)
- `AREA_MISMATCH` (面積比 > 2.0): Plateau が OSM の 2 倍超 = 街区全体 or 部分マッピング。
  置換すると 1 棟の OSM way が街区形になる危険。除外。
- `ratio < 0.5`: Plateau 付属構造物 (塔屋/物置)。除外。
- multipolygon / `type=building` relation のメンバー way。
- 共有ノードを持つ建物の置換 (隣接建物を壊さない境界追従処理)。

## UX フロー (プレビュー → 確定の 2 段階)

1. OSM building を選択すると、`uiSectionPlateauTags` に既存の「タグ適用」に加えて
   **「形状を置換」ボタン**が出る (候補が上記スコープを満たすとき)。
2. ボタン押下で**プレビューモード**に入る:
   - 専用レイヤ (`PixiLayerHeightTransfer` を拡張) に**置換後の形状**をゴースト表示
     (半透明 + 破線)、対象 OSM building をハイライト。
   - セクションに「確定 / キャンセル」ボタン。タグも同時マージするので、確定前に
     **入るタグ (追加/補完されるキー)** もセクションに列挙する。
3. 「確定」で `actionReplaceBuildingGeometry` を適用しプレビュー解除。
   「キャンセル」でプレビューのみ解除 (グラフ変更なし)。
4. 確定後の編集は通常の undo/redo で取り消せる。

タグ転記の「即時 apply + undo」と違い形状置換はプレビューを挟む
(ジオメトリ変更は影響が大きいため)。ユーザ選好: 2 段階。

## action と履歴保持

新規 `actionReplaceBuildingGeometry(osmWayID, plateauWay, plateauGraph, mergedTags)`:

1. 既存 OSM way entity を取得 (**id / version を保持**)。
2. `plateauWay` のノードを `plateauGraph` で解決して座標列を得る。
   各座標で**新規 `osmNode`** を作成 (Plateau のノード id は使わず新規)。
3. 閉じた way の first==last を維持した新ノード列で `way.update({ nodes })`。
4. タグは `mergedTags` (下記マージ結果) を `way.update({ tags })`。
   Plateau 由来の内部メタ (conn/dupe/orig_id 等) は除去。
5. 旧 way のノードのうち、置換後に**他 entity から参照されず孤立するもの**は
   `graph.remove`。共有ノードガードにより通常は全ノードが孤立するはずだが、
   念のため参照カウントで判定 (共有されていれば残す)。
6. `graph.replace(way)`。

`HeightTransferMode` に置換用メソッドを追加 (候補は既存 `findCandidates` と共通):

- `previewReplace(candidate)`: `this.replacePreview = { candidate }` をセット、
  レイヤを即再描画 (`gfx.immediateRedraw`)。
- `confirmReplace()`: `editor.perform(action)` → `editor.commit({ annotation })`。
  annotation は `{ type: 'replace_building_geometry', entityID: osmWayID, plateauID }`。
  `transferredIDs` と同様、置換済み Plateau id を history から再導出して
  undo/redo に追従させる (`_recomputeTransferredIDs` の枠組みを踏襲)。
- `cancelReplace()`: `this.replacePreview = null`、再描画。
- プレビューは**選択変更 (modechange) やモードトグル off でも自動解除**する
  (別建物を選び直したときにゴーストが残らないように)。

アップロード時に OSM API が既存 id の新バージョン (v+1) として記録 → 履歴チェーン維持。

## タグマージ

形状置換と同時に、Plateau が持つ建物タグを OSM にマージする。

- 対象キー: Plateau が配信する建物タグ全般 (`height` `ele` `building:levels`
  `building:levels:underground` `name` `addr:housenumber` `addr:street` `start_date`
  `building:material` `roof:material` `roof:shape`、および `building` の具体値)。
- 競合ルール: **OSM 優先 / 非破壊**。OSM に既存値があるキーは保持し、空のキーのみ
  Plateau から補完する。マッパーの手入力を尊重し、既存タグ転記の never-overwrites
  ポリシーと一貫。
- `building=yes` のような generic 値を Plateau の具体値で上書きするかは要検討事項
  だが、第 1 弾は非破壊を優先し「OSM に値があれば保持」で統一 (generic 上書きは
  やらない)。プレビューで「補完されるキー」を明示するので誤解は生じない。

## ファイル構成

| ファイル | 変更 |
|---|---|
| `modules/actions/replace_building_geometry.js` | 新規。ノード再構築 + タグマージ + 孤立ノード削除 |
| `modules/core/lib/HeightTransferMatcher.js` | 共有ノードガード判定を追加 (候補に「置換可能か」フラグ) |
| `modules/modes/HeightTransferMode.js` | previewReplace / confirmReplace / cancelReplace + プレビュー状態 |
| `modules/ui/sections/plateau_tags.js` | 「形状を置換」ボタン + プレビュー時の確定/キャンセル + 入るタグ一覧 |
| `modules/pixi/PixiLayerHeightTransfer.js` | プレビューゴースト (置換後形状 + ハイライト) 描画 |
| `data/core.yaml` | l10n キー (ボタン/確定/キャンセル/注記/ショートカット) |

## テスト方針

- **action** (`replace_building_geometry`):
  - ノード再構築: way id 保持、新ノード座標が Plateau 座標と一致、閉合維持。
  - 履歴保持: 既存 version を引き継ぐ (新 way でない)。
  - 孤立ノード削除: 旧ノードが graph から消える。共有されている旧ノードは残る。
  - タグマージ: OSM 既存値保持、空キーのみ補完 (OSM 優先/非破壊)。
- **Matcher / Mode**:
  - 共有ノードガード: 共有 building way があるペアは置換候補にならない。
  - `AREA_MISMATCH` / `ratio < 0.5` は置換候補外。
  - プレビュー状態遷移: preview → confirm でグラフ変更、preview → cancel で無変更。
  - undo/redo で置換済み plateauID が history から正しく再導出される。
- **section**: 「形状を置換」ボタンの表示条件、確定/キャンセルの挙動。

## 将来フェーズ (relation 建物の一括置換)

実測で building:part / relation member はノード共有が常態 (孤立 0〜52%) と分かったため、
relation 建物 (Plateau LOD2 由来の type=building relation = outline + building:part 群) の
形状置換は、単純 building とは別に**次フェーズ**として設計する。

- **relation 単位で一括置換**する。個別 way ごとの置換ではなく、OSM relation の全メンバー
  (outline + parts) を Plateau の対応 LOD2 relation に丸ごと差し替える。共有ノードは
  relation 内部で完結するので、メンバー全体を一括再構築すれば隣接建物を壊さない
  (relation 外の建物との共有は稀)。
- **履歴保持**: OSM relation の id を保持。可能なら outline way の id も保持し、
  parts の id はメンバー構成が一致すれば保持、違えば作り直す簡易版から始める。
- **マッチング**: OSM relation ↔ Plateau LOD2 relation の対応付け (outline の
  `representativePoint` ベース。単純 building と同じ `HeightTransferMatcher` を relation
  対応に拡張)。
- **依存**: api 側の LOD2 relation 出力 (実装済) と #43 (building:part 対応) の議論。
- **Phase 3 (優先度低)**: relation に属さない単純 building で隣接と角ノードを共有する稀な
  ケース (実測 0〜18%、多くは 0)。JOSM ReplaceGeometry 相当の境界追従処理。頻度が低いので後回し。

依存の鎖: api#33 (重複巨大 part 除去、未実装) → 本 spec 第 1 弾 (単純 building
外形置換) → 将来フェーズ (relation 一括置換 + building:part)。

## 参考

- JOSM ReplaceGeometry: https://wiki.openstreetmap.org/wiki/JOSM/Plugins/ReplaceGeometry
- 共有ノード実測スクリプト (ローカル, scratchpad): Kanto PBF を osmium で density 別集計
