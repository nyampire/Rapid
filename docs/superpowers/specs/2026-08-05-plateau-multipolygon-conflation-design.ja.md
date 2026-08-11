# conflation を type=multipolygon に対応させる設計

- 日付: 2026-08-05
- 関連: rapid_plateau_api の #39、および取り込みを元データに忠実にする一連の変更

## 背景

API が、中庭のある建物を `type=multipolygon` の relation として返すようになった。
`outer` メンバーが外形、`inner` メンバーが穴で、タグは relation にだけ付く。

クライアント側の conflation はこの形を知らない。
`_filterPlateauOverlaps` は Phase 4-A で `type=building` の relation を 1 つの意味単位として扱い、
outline way の判定結果をメンバー全員に適用している。
「親の外形が消えて部分だけ宙に浮く」不整合を防ぐためである。

`type=multipolygon` はこの仕組みに入らない。
`PlateauService.js:505` の `e.tags?.type !== 'building'` で除外されるので、
メンバー way は個別に `_checkWayOverlapsOsmBuildings` にかけられる。

## 現状の壊れ方

判定はジオメトリだけを見てタグを見ない。
multipolygon のメンバー way はタグを持たないので、**穴が単独の建物として重なり判定にかけられる**。

| 状況 | 結果 |
|---|---|
| `outer` が reject（その建物は既に OSM にある） | relation は残るがメンバー参照が切れる |
| `outer` は残り `inner` が reject | relation が存在しない `inner` を参照する。中庭が失われる |
| `outer` が reject、`inner` は残る | タグの無い環が親を失って単独で浮く |

既存の 1,489 万行では起きない。すべて `ring_id` が 0 で、multipolygon として出力されないためである。
最初の 1 都市を再取り込みした時点で出る。

## 設計

### 1. multipolygon を意味単位として扱う

`type=building` と同じ扱いにする。
relation の判定を 1 度だけ計算し、メンバー way 全員がそれに従う。

違いは役割名だけである。
`type=building` は外形を `outline` で持ち、`type=multipolygon` は `outer` で持つ。
判定の根拠にする「外形のメンバー」を引く箇所で、両方の役割名を受け付ける。

`inner` メンバーが個別に判定されることは無くなる。
タグの無い環を建物として扱う経路が消える。

### 2. メンバーが隠れる relation は relation 自身も隠す

現在の filter は relation を無条件に通す（`if (entity.type === 'relation') return true;`）。
そのため外形が reject されると、メンバーがすべて消えた relation が呼び出し側に渡る。

**この filter は配列を絞り込むだけで `ds.graph` を変更しない。**
除外した way も relation もグラフには残り続ける。
影響するのは `getData` の戻り値を受け取る側だけである。

規則は relation 自身の判定に置く。

| relation の判定 | 扱い |
|---|---|
| `true`（重なる） | relation も落とす |
| `false` | 残す |
| `null`（判定できない） | 残す |

`null` は外形のメンバーがグラフに無い、way が閉じていない、座標が足りない場合に返る。
way 側のフォールバックと同じく、判定できないものは隠さない。

これは `type=building` にも同じ 1 つの規則で効く。
外形が reject されたときに空の relation が残る既存の挙動も解消する。

### 3. 生存メンバーを数える方式は採らない

`getData` は `ds.tree.intersects(extent, ds.graph)` の結果に filter をかける。
渡ってくるのはタイル単位のバッチではなく、**表示範囲で切り取った空間のスライス**である。

したがって、メンバーが一覧に無いことと、そのメンバーが reject されたことは別である。
範囲外にあるだけのメンバーは単に一覧に含まれない。

生存数を数える書き方にすると、パンして relation が範囲の端にかかった時点で
「メンバーが 0 件」と見えて落ちる。
建物は OSM に無いのに消えるという、逆向きの誤りになる。

relation 自身の判定を使えば、一覧に何件メンバーが居るかに依存しない。
判定は既に `evalRelationOverlap` が計算しており、way 側もそれに従っている。

## 対象外

**relation のジオメトリで重なりを判定すること。**
外形のメンバー way の形で判定する現在の方式を踏襲する。
穴を除いた実面積で判定するほうが厳密だが、`type=building` の既存の判定と食い違う形を新たに作ることになる。
判定の精度そのものは別の論点として切り離す。

**`inner` が外形からはみ出している場合の扱い。**
取り込み側が形状の妥当性を検査していないので理論上ありうるが、
conflation の判定は外形だけを見るので影響しない。

**形状置換機能（#5）との関係。**
`feature/plateau-geometry-replacement` は未マージで、この変更とは独立している。

## conflation だけでは足りない（実装後の最終レビューで判明）

`type=multipolygon` を認識していない箇所が、conflation の他に 2 つある。
どちらも本設計の対象外だが、**再取り込みの前に片付ける必要がある**。

**accept の cascade。** `modules/actions/rapid_accept_feature.js:260` は
`parent.tags.type === 'building'` の relation にしか cascade しない。
multipolygon の外形をユーザが accept すると `acceptWay` に落ちる。
タグは relation にしか無いので、**OSM に上がるのはタグの無い閉じた way になる**。
中庭も `building` タグも失われる。
conflation が隠しそこねるのは機会損失だが、こちらは壊れたデータの upload であり、より有害である。

**hover / select の兄弟 highlight。** `modules/util/building_relation.js:24` も
`type=building` しか返さない。外形をホバーしても穴が光らず、1 棟であることが UI から伝わらない。

**描画。** `modules/pixi/PixiLayerRapid.js:347` は way だけを拾って個別のポリゴンとして積む。
穴が穴として描かれず、外形の上に小さな図形が重なって見える。
conflation が穴を隠さなくなった分、再取り込み後に必ず表に出る。

なお同じ箇所の絞り込みにより、relation を返り値から外す変更は現時点で観測可能な効果を持たない。
将来 relation を読む consumer が現れたときのための備えである。

## 検証

- `type=multipolygon` の `outer` が OSM 建物と重なるとき、`outer` と `inner` と relation がすべて隠れる
- 重ならないとき、3 つとも残る
- `inner` が単独で判定されない（`inner` だけが隠れる状態が作れない）
- 外形のメンバーがグラフに無いとき、relation も way も隠れない
- `type=building` の outline が reject されたとき、relation も隠れる
- `type=building` の既存の挙動（outline の判定にメンバーが従う）が変わらない
