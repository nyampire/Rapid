# 1 つ受理しても同じ relation の残りを候補に残す設計

- 日付: 2026-09-11
- ブランチ: `fix/plateau-conflation-cache-invalidation`
- 起点: `c764cecd7`

## 背景

同じブランチで、編集が確定したときに重なりの判定をやり直す修正を入れました。
その最終査読で、次の動きが見つかりました。

`type=building` の relation の outline を「この地物だけを追加」で受理すると、その直後に残りの parts が候補から消えます。
試験で組み立てて確かめたところ、outline も parts も relation も戻り値から消えました。

画面の文言は、これと違うことを約束しています。

> この線は複数区画の建物の一部ですが、残りの構造を伴わずにこの線だけを追加することもできます。外形とほかの部分は提案のまま残ります。

約束が守られていません。

## 原因

`_filterPlateauOverlaps` は、`editor.intersects()` が返す OSM の建物をすべて判定の材料にします。

受理した地物は、Plateau 側と同じ id のまま OSM のグラフに入ります。
`actionRapidAcceptFeature` が `recordAccepted(way.id)` を呼ぶ時点で、id は付け替えられていません。

`evalRelationOverlap` は relation の判定を outline の重なりだけで決めます。
受理した建物は outline と同じ形なので、必ず重なると判定されます。
その結果、relation とそのメンバーの way がまとめて候補から外れます。

この規則自体は以前からありました。
変わったのは適用される時期です。
これまでは次にデータを取り込むまで parts が見えたままで、今回の修正で受理した直後に適用されるようになりました。

## 決めたこと

判定の材料に、その面がどの地物から来たかを持たせます。
relation を判定するときは、その relation 自身とメンバーの way から来た面を、材料から外します。

### 材料に出どころを持たせる

`_filterPlateauOverlaps` が `osmBuildingData` を組み立てるとき、各要素に `sourceID` を足します。

- multipolygon の relation から作った面には、relation の id を入れます。
- way から作った面には、その way の id を入れます。

### 判定のときに外す

`_checkWayOverlapsOsmBuildings` に、外す id の集合を渡す引数を足します。
`sourceID` がその集合にある面は、重なりの判定から飛ばします。

引数を渡さない呼び出しは、これまでどおり全部の面を見ます。

### relation を判定するときに集合を作る

`evalRelationOverlap` が relation を判定するとき、次の id を集めて渡します。

- relation 自身の id
- relation のメンバーのうち、way の id

受理した地物は Plateau 側と同じ id のまま OSM のグラフに入るので、この照合だけで足ります。
`acceptIDs` を見る必要はありません。

### 外形のメンバーが無い relation の場合

外形の役割（`outline` か `outer`）を持つメンバーが無い relation では、`evalRelationOverlap` が `null` を返し、メンバーは 1 本ずつ判定されます。

この経路にも同じ集合を渡します。
約束は relation の形によらないためです。

### parts のタグについて

公開中の API は、parts に `building:part` を付けます（`osmfj_plateau_api.py` の `add_tag('building:part', ...)`）。
判定の材料に入るのは `building` タグを持つ地物だけなので、実際の運用で約束が破れるのは outline を受理したときだけです。

試験のヘルパ `makePlateauWay` は、outline にも parts にも `building` を付けます。
ヘルパはそのままにします。
約束はタグの付き方によらず守るべきもので、タグに依存した試験にすると、API の出力が変わったときに気づけなくなるためです。

### 変えないこと

relation に属さない候補の判定は変えません。
別の建物として受理したものは、これまでどおり重複の判定に使われます。

## 検討して採らなかった案

### 受理済みをすべて材料から外す案

`RapidSystem.acceptIDs` に入っている地物を、一律に材料から外す案です。
実装は最も短くなります。

採りませんでした。
Plateau 側に同じ建物が二重に入っている場合（Issue #35）に、片方を追加してももう片方が候補に残るためです。

### relation の判定の仕方を変える案

材料には手を入れず、outline の重なりで relation 全体を決める仕組みのほうを見直す案です。

採りませんでした。
中庭のある建物の扱いにも及び、この修正の範囲を超えるためです。

## 守るべきもの

重なりの判定と候補の表示について、守るべきものを並べます。
出どころと、それを固定する試験を対で書きます。

| # | 守るべきもの | 出どころ | 固定する試験 |
|---|---|---|---|
| 1 | OSM の建物と重なる候補は出さない | Phase 4-A の設計 | `filters out Plateau buildings that overlap with OSM buildings` ほか |
| 2 | 同じ relation の中で 1 つを受理しても、残りは候補のまま残る | 画面の文言 `rapid_inspector.option_accept_only_this.description` | **この設計で足す** |
| 3 | 材料のタイルが揃っていないあいだは候補を出さない | Pull Request #52 | `returns no candidates while the OSM tiles covering the view are not loaded` |
| 4 | OSM のレイヤーが消えているあいだは候補を出し、追加を止める | Pull Request #54 | `returns candidates while the OSM layer is switched off`、`reports that adding is blocked while the OSM layer is switched off` |
| 5 | 編集が確定したら判定をやり直す。建物に関わる編集のときだけ | 2026-09-10 の設計 | `clears the cache when a building way itself changes` ほか 6 件 |
| 6 | `#plateau_conflation=false` のときは、除去も追加の抑止も行わない | Phase 4-A の設計 | 抑止の側は `does not block adding when the flag is off and the layer is off`。除去の側は **この設計で足す** |
| 7 | 高さの転記の経路は判定を通らない | Pull Request #38 | `still returns everything for the height transfer path` |
| 8 | 中庭（`role=inner`）は面から差し引く | Pull Request #46 | `keeps a Plateau building that sits inside the courtyard of an OSM multipolygon`、`does not judge an inner ring on its own` |

2 番と 6 番の除去の側に試験がありません。
ほかの 6 項目は、いまある 72 件の中で固定されています。

この一覧は、重なりの判定と候補の表示に範囲を限ります。
hover の強調、カバレッジの読み込み、代表点の解釈は含めません。

## 試験

6 件を足します。

1. outline を受理した直後、同じ relation の parts が `getData()` の戻り値に残ります。（守るべきもの 2）
2. parts の 1 本を受理した直後、outline と残りの parts が戻り値に残ります。（守るべきもの 2）
3. 同じ relation に属さない OSM の建物と重なる場合は、これまでどおり隠れます。（守るべきもの 1 が壊れていないことの確認）
4. relation に属さない候補の判定は変わりません。（守るべきもの 1 が壊れていないことの確認）
5. `#plateau_conflation=false` のとき、重なる候補も戻り値に残ります。（守るべきもの 6）
6. 外形のメンバーが無い relation でも、1 本を受理した直後に残りが戻り値に残ります。（守るべきもの 2）

各段の 1 件目は、実装の前に失敗することを確認します。

## 変えないもの

`isAddBlocked` の動きは変えません。

高さの転記の経路（`skipConflation`）は判定を通らないため、影響を受けません。

Plateau 以外のデータセット（mapwithai、esri、overture）は変えません。

上流のファイル（`modules/core/` と `modules/actions/rapid_accept_feature.js`）には手を入れません。

## この設計で解決しないこと

受理した地物を取り消した場合の動きは、この設計では扱いません。
取り消すと OSM のグラフから地物が消え、材料からも消えるため、判定は自然に元へ戻ります。
試験も足しません。
