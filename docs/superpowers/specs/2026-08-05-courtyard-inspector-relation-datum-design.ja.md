# 中庭建物のインスペクタを relation の datum に対応させる設計

- 日付: 2026-08-05
- 関連: `feature/plateau-multipolygon-conflation`（conflation・accept・描画をこのブランチで実装済み）

## 背景

中庭のある建物は `type=multipolygon` の relation で届く。
このブランチで accept・インスペクタ・描画を対応させたが、**インスペクタの分岐だけが表示されない**。

描画を relation 単位に変えたため、メンバー way は描画対象から外れた。
描かれていない way は hover も select もできないので、インスペクタが受け取る datum は常に relation になる。

`utilBuildingRelationInfo` は先頭で `entity.type !== 'way'` なら null を返す。
そのため `isCourtyard` が常に false になり、用意した文言が一度も出ない。

動作は壊れていない。
relation を選んで「Add This Feature」を押せば `acceptRelation` が正しく cascade する。
足りないのは、ユーザに中庭があると伝えることだけである。

## 確認した事実

**relation の datum はインスペクタに届く。**
`modules/ui/UiSidebar.js:241` は `__fbid__` を要求するが、`PlateauService._parseEntity` は
relation を含む全 entity に `__fbid__` を付けている。

**API は member の role を必ず明示する。**
`osmfj_plateau_api.py:716` が `m.set('role', 'outer' if ring_no == 0 else 'inner')` を書く。
role が空になる経路は無い。

**中庭建物に兄弟 highlight は意味を持たない。**
描かれているのは relation 1 つだけで、光らせる相手が居ない。
`type=building` は datum が way のままなので、そちらの highlight は従来どおり動く。

## 設計

### 1. `utilBuildingRelationInfo` が relation も受け付ける

way が渡されたら、その way が属する建物 relation を返す（現状）。
relation が渡されたら、その relation 自身について同じ形の情報を返す。

判定条件は変えない。
`type=building`、または `building` タグを持つ `type=multipolygon` だけを建物として扱う。

返り値の形も変えない。
`{ relation, outlineCount, partCount, relationType }` のまま。

### 2. 情報行の文言を relation 用に分ける

way を選んでいるときは「この way は〜の一部です」でよい。
relation を選んでいるときは建物そのものを選んでいるので、「一部」は当たらない。

relation を選んでいるときの文言を別に用意し、中庭の本数を伝える。

### 3. 「Add Only This」の抑制が意図した理由で効く

現状は `buildingInfo` が null であることによって、たまたま出ていない。
本設計のあと `isCourtyard` が true になるので、`!isCourtyard` のガードが実際に働く。

relation だけを追加してメンバー way を置き去りにする操作は壊れている。
その抑制が偶然ではなく意図で成り立つようになる。

## 対象外

**兄弟 highlight。** 中庭建物では光らせる相手が居ない。
`PlateauService` は変更しない。

**`type=building` の挙動。** datum は way のままで、文言も選択肢もカウントも変えない。

**描画。** relation 単位で描く現在の形を変えない。メンバー way を描画対象に戻さない。

## 検証

- relation の datum で `utilBuildingRelationInfo` が情報を返す
- way の datum での返り値が変わらない
- 建物でない `type=multipolygon` の relation では null が返る
- relation を選んだとき「Add Entire Building」が出て、「Add Only This」が出ない
- relation を選んだときの情報行が「一部」ではなく建物そのものを指す文言になる
- `type=building` の way を選んだときの文言と選択肢が変わらない
