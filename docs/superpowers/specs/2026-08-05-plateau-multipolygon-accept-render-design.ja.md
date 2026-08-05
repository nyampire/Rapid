# multipolygon の accept・UI・描画を対応させる設計

- 日付: 2026-08-05
- 関連: `feature/plateau-multipolygon-conflation`（conflation 側、先行して実装済み）、rapid_plateau_api の #39

## 背景

API が、中庭のある建物を `type=multipolygon` の relation として返すようになった。
`outer` が外形、`inner` が穴で、**タグは relation にだけ付き、メンバー way はタグを持たない**。

クライアント側にはこの形を前提にしていない箇所が 3 つある。
conflation は先行して対応したが、それは 3 分の 1 にすぎなかった。

残る 2 つのうち、accept の経路は**壊れたデータを OSM に upload する**。
描画は、ユーザが何を accept するのか判断できない状態を作る。

## 現状

| 箇所 | 現状 | 結果 |
|---|---|---|
| `modules/actions/rapid_accept_feature.js:260` | `parent.tags.type === 'building'` の relation にしか cascade しない | multipolygon の外形を accept すると `acceptWay` に落ちる。タグは relation にしか無いので、**OSM に上がるのはタグの無い閉じた way**。中庭も `building` タグも失われる |
| `modules/util/building_relation.js:24` | 同じく `type=building` のみ | インスペクタの文言が切り替わらず、hover / select の兄弟 highlight も効かない。外形をホバーしても穴が光らないので、1 棟であることが UI から伝わらない |
| `modules/pixi/PixiLayerRapid.js:347` | `entity.type === 'way'` で絞ってから個別のポリゴンとして積む | 穴が穴として描かれない。外形の上に小さな図形が重なり、**「建物の中に建物」に見える**。api#39 で消したはずの見た目が描画側で再現する |

隠しそこねは機会損失だが、タグの無い way の upload は公開データベースを汚す。
影響の重さが違う。

## 描画の機構は既にある

`osmRelation.geometry()` は `isMultipolygon()`（`tags.type === 'multipolygon'`）のとき `'area'` を返す。
`asGeoJSON()` は `MultiPolygon` を返し、`PixiFeaturePolygon` は `rings`（外側に続けて穴）を既に描ける。
`PixiLayerRapid` も同じ `PixiFeaturePolygon` を使い、`geometry() === 'area'` で `data.polygons` に積んでいる。

塞いでいるのは `:347` の way 限定だけである。
新しい描画機構は要らない。

## 設計

### 1. accept の cascade を multipolygon にも効かせる

`rapid_accept_feature.js:260` の型判定に `multipolygon` を足す。

`acceptRelation` は relation の型を見ない汎用の処理で、relation を複製し、
メンバーを再帰的に accept し、置き換えた member id で更新する。
cascade に入りさえすれば、relation とメンバー way が揃って追加される。

### 2. 「この feature だけ追加」を multipolygon では出さない

`type=building` ではメンバー way が自分のタグを持つ（outline は `building=yes`、part は `building:part=yes`）。
だから 1 本だけ追加しても妥当な OSM になる。

`type=multipolygon` ではメンバー way がタグを持たない。
outer だけ追加すればタグの無い way、inner だけ追加すればタグの無い環になる。
**`skipCascade` を出すと、この設計で直そうとしている不具合をボタンの裏に残すことになる。**

relation のタグを way にコピーする案は採らない。
中庭を塗りつぶした建物を黙って作ることになり、サーバ側で直したばかりの誤りと同じ型である。

multipolygon のときは「建物全体を追加」だけを出す。

### 3. 兄弟 highlight とインスペクタ

`utilBuildingRelationInfo` を `type=multipolygon` にも広げる。

役割名が違うので、カウントは両方の語彙を数える。

| relation | 外形の役割 | 内訳の役割 |
|---|---|---|
| `type=building` | `outline` | `part` |
| `type=multipolygon` | `outer` | `inner` |

返り値に relation の種別を足し、呼び出し側が文言を選べるようにする。

文言も分ける。
現在の "multi-section building (outline + parts)" は「区画に分かれた建物」の意味で、
中庭のある建物には当てはまらない。穴の本数を伝える文言を別に用意する。

### 4. 描画

`PixiLayerRapid.js:347` の way 限定を外し、`type=multipolygon` の relation を `data.polygons` に流す。

**そのメンバー way は二重に描かない。**
relation が外形と穴をまとめて描くので、メンバー way を個別に積むと外形が二重になり、
穴の上にも塗りが乗る。描画対象にした relation のメンバー way は除外する。

conflation で relation を返り値から外した変更は、ここで初めて観測可能になる。
それまでは relation が描画に届いていなかった。

## 対象外（今回やらないこと）

**`type=building` の relation の描画。**
outline と parts を個別のポリゴンとして描く現在の形を変えない。
穴とは別の構造で、同時に触ると変更が大きくなる。

**`skipCascade` を multipolygon で安全に提供する方法。**
今回は出さないことで回避する。
「穴を保ったまま 1 棟だけ追加する」を実現するには、relation ごと複製する別の操作が要る。

**conflation の判定精度。**
外形メンバー way の形で重なりを判定する現在の方式を踏襲する。
穴を除いた実面積で判定するほうが厳密だが、`type=building` の既存の判定と食い違う形を新たに作ることになる。

## 次に実施しないといけないこと

本設計の完了後も、再取り込みまでに片付ける必要があるものが残る。

**サーバ側の本番投入手順。**
`ring_id` の `ALTER TABLE` を API のデプロイより前に流す。
API は `n.ring_id` を無条件に SELECT するため、順序を誤ると全 bbox クエリが 500 になる。

**API のデプロイをまたいだセッションのリロード周知。**
合成 OSM id の採番方式が変わったため、デプロイをまたいで開いたままのセッションでは
同じ建物が旧 id と新 id の両方で届き、二重に描かれうる。新規セッションでは起きない。

**捨てる way のタグが救えるかの実測。**
取り込み側は建物 ID を持たない建物 way を捨てる。10 メッシュ 386 本のうち 1 本は
`name=市立秋月小学校` を持っていた。融合でタグが移ったのなら、捨てた時点でその名前は DB に入らない。
形状は正しくなるが、実在の学校が無名の建物として配信されうる。再取り込み前に一度測る。

**三角形の面積判定（api#44）の修正。**
面積の検算が度の二乗で行われ、閾値が緯度 34 度で約 10,190 m² に相当する。
1 万 m² 未満の三角形の建物がすべて落ちる。

**`fix/api-drop-far-parts` の PR 作成と、本番サーバへの `git pull`。**

## 検証

- multipolygon の外形を accept すると、relation とメンバー way が揃って追加される
- 追加された relation が `type=multipolygon` と `building` のタグを持つ
- 追加されたメンバー way がタグを持たない（タグは relation にある）
- multipolygon のメンバーを選択したとき「この feature だけ追加」が出ない
- `type=building` のメンバーを選択したときは従来どおり「この feature だけ追加」が出る
- `utilBuildingRelationInfo` が multipolygon で `outer` / `inner` を正しく数える
- multipolygon の外形をホバーすると穴も一緒に highlight される
- 穴のある建物が 1 つのポリゴンとして描かれ、穴の部分に塗りが乗らない
- その relation のメンバー way が個別のポリゴンとして重複して描かれない
- `type=building` の accept・UI・描画の挙動が変わらない
