# 中庭のある建物を高さ転記の対象にする設計

- 日付: 2026-08-06
- 関連: `feature/plateau-multipolygon-conflation`（conflation・accept・描画・インスペクタを実装済み）、`feature/plateau-geometry-replacement`（未マージ）

## 背景

中庭のある建物は `type=multipolygon` の relation で届き、タグは relation にだけ付く。
このブランチで表示・選択・説明・追加は 1 棟として扱えるようになった。

高さ転記だけが残っている。
`HeightTransferMatcher.findCandidates` が候補を `f.type === 'way'` で絞るため、
relation は落ち、タグを持たないメンバー way も落ちる。
**中庭のある建物は高さ転記の対象に一度も現れない。**

インスペクタが中庭建物でまともに動くようになった分、ユーザが触れる回数は増える。
高さ転記だけ黙って対象外である状態は、これまでより目につきやすくなる。

## 調査で確認したこと

高さ転記の経路を端から端まで読んだ。relation を通すのに必要な変更は 2 箇所だけである。

| 段 | relation で動くか |
|---|---|
| 候補の絞り込み | **動かない。`f.type === 'way'` で落ちる** |
| `asGeoJSON` と面積 | **要検討。MultiPolygon になり、turf の `area` は穴を差し引く** |
| `analyzeTagStates` | 動く。`plateauFeature.tags` を読むだけで、タグは relation にある |
| `booleanPointInPolygon` | 動く。OSM 側のポリゴンに対してのみ使う |
| `PixiLayerHeightTransfer` | 動く。`representativePoint` と `id` しか使わない |
| 転記後の `transferredIDs` | 動く。`plateauFeature.id` を記録するだけ |
| タグ転記の action | 動く。entity の型に依存しない |

`type=building` の LOD2 は影響を受けない。
外形 way が `building` タグを持つので、いまも候補に入っている。

## 設計

### 1. 候補の絞り込みを relation にも広げる

`type=multipolygon` かつ `building` タグを持つ relation を候補にする。
判定は意味の問いなので `building` を要求する。森林などの multipolygon は対象外。

`!f.tags['building:part']` の条件はそのままでよい。relation はこのタグを持たない。

### 2. 面積比は外側リングで測る

turf の `area` は MultiPolygon の穴を差し引く。
一方 OSM 側は単純な way なので総面積である。
そのまま比べると**正味面積と総面積の比較**になり、中庭が広い建物ほど比が小さく出る。

`AREA_RATIO_MIN` のコメントはこの閾値の目的をこう書いている。

> A Plateau outline far SMALLER than the OSM building it sits in is an ancillary structure
> Plateau models as its own `building` — a rooftop stair enclosure, a shed.

正味面積で比べると、**中庭のある建物が小屋と同じ理由で落ちる**。
閾値が防ごうとしているものと正反対になる。

そこで PLATEAU 側の面積は**外側リングだけ**で測る。
OSM 側が総面積なので、同種どうしの比較になる。

単純な way はリングが 1 本なので、外側リングの面積は全体の面積と等しい。
**本番データの大半を占めるこの経路の値は変わらない。**

outer が複数ある multipolygon は、黙って 1 本目だけを測らない。
現行の producer は outer を 1 本しか出さない（importer は `len(outer) == 1` を要求し、
Esri は `ways[0]` にだけ outer を振る）が、来たときの扱いを決めておく。

### 3. 形状置換ブランチを安全にする

`feature/plateau-geometry-replacement` の `isReplaceable` は OSM 側しか見ておらず、既定が `true` である。
本設計で relation が候補になると、そのブランチでは `replaceable: true` が付き、
`actionReplaceBuildingGeometry` が `plateauWay.nodes` を回そうとして落ちる。

形状置換は「OSM の way の形状を差し替えて id を保つ」操作である。
中庭のある形は 1 本の way で表せないので、置換するなら既存の way を multipolygon relation に
作り変えることになる。これは形状の差し替えではなく OSM オブジェクトの種類を変える操作で、別の設計が要る。

そこで、そのブランチに**防御コミットを 1 本**入れる。
`isReplaceable` に PLATEAU 側の条件を足し、`outline.type !== 'way'` なら `false` を返す。

これは機能追加ではなく、そのブランチ単体を安全にする変更である。
形状置換のレビューやデプロイ判断とは切り離せる。マージのタイミングも自由なままになる。

提示してから失敗するより、提示しないほうが素直なので、`isReplaceable` に置く。
`actionReplaceBuildingGeometry` 側では拒否しない。

## 対象外

**OSM 側が multipolygon の建物。**
`f.type === 'way'` で絞っているので、すでに中庭付きで描かれている OSM の建物は転記先にならない。
PLATEAU 側の形とは独立した既存の穴で、本設計では扱わない。

**形状置換を中庭建物に対応させること。**
上記のとおり別の操作になる。今回は候補から外すだけにする。

**面積比の閾値そのもの。** `0.5` と `2.0` は変えない。

## 記録しておくこと

比率が画面の見た目と一致しなくなる。
描画は穴を抜いた形を見せるのに、判定は穴を含む面積で行う。
不一致を調べる人が迷わないよう、コードにその理由を残す。

`osmRelation.multipolygon()` は `'outer' === (m.role || 'outer')` で role 空を outer とみなす。
本設計を含め他の判定は文字列一致を要求するのでずれる。
API は必ず role を書くので到達しない。

## 検証

- `type=multipolygon` + `building` の relation が候補になる
- 建物でない multipolygon の relation は候補にならない
- `type=building` の LOD2 外形 way が従来どおり候補になる
- **単純な way の面積比が変わらない**（外側リング＝全体）
- 中庭のある建物の面積比が、穴を差し引かない値で計算される
- 中庭が広い建物が `AREA_RATIO_MIN` で落ちない
- outer が複数ある multipolygon で、1 本目だけを黙って測らない
- 転記後に relation の id が `transferredIDs` に入り、再び候補にならない
- 形状置換ブランチで、中庭建物の候補が `replaceable: false` になる
