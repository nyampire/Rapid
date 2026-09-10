# OSM のレイヤーが消えているあいだ PLATEAU の建物を表示し、追加だけ止める設計

- 日付: 2026-09-09
- ブランチ: `feature/plateau-show-when-osm-layer-off`
- 起点: `fb97052fc`（Pull Request #52 のマージ地点）

## 背景

Pull Request #52 で、重なりの判定に使う OSM の建物が編集ソフトの中に無いあいだは、PLATEAU の候補を出さないようにしました。
候補を出さない判断は `PlateauService.getData()` の 1 か所で行っており、ここが空の配列を返します。
`getData()` の戻り値は Pixi の描画がそのまま使うため、表示と追加が同時に止まっています。

利用者の作業では、OSM の線を画面から消して PLATEAU の建物だけを見たい場面があります。
いまの実装ではこの場面で PLATEAU の建物も消えるため、目的を果たせません。

Pull Request #53 は、候補を伏せた理由をダイアログで伝えるものでした。
表示を止めること自体をやめるため、この Pull Request は不要になります。
close するのは、この設計の変更が動くことを実機で確認したあとにします。
それまでは open のまま残し、ブランチ `feature/plateau-osm-layer-off-notice` も残します。

## 決めたこと

OSM のレイヤーが消えているあいだ、視野にある PLATEAU の建物をすべて表示します。
重なりの除去は行いません。

その状態では、PLATEAU の候補を OSM へ追加できません。
追加できない状態は、ポリゴンの縞模様で示します。

タイルの取得が終わっていない場合は、いまと同じく候補を出しません。
レイヤーは表示されており、待てば取得が終わるためです。

## 検討して採らなかった案

### OSM のタイルを裏で取得し続ける案

`PixiLayerOsm.render()` の早期終了より前に `context.loadTiles()` を移し、レイヤーが消えていても OSM のデータを編集ソフトに取り込む案です。
重なりの除去がこれまでどおり働くため、追加を止める必要そのものが無くなります。

採りませんでした。
上流の facebook/Rapid が持つファイルに手を入れるため upstream を取り込むときに衝突しうること、そして「追加を止める」という要求を別の要求に置き換えてしまうことが理由です。

### 手元にある OSM のデータで重なりの除去を行う案

レイヤーを消す前に見ていた場所では、OSM のデータが編集ソフトの中に残っています。
その材料だけで除去を行えば、見ていた場所の候補は正しく絞られます。

採りませんでした。
同じ画面の中で、見たことのある場所と無い場所で候補の出方が変わり、利用者から見て理由の分からない差になるためです。

### 灰色に変える案、不透明度を下げる案

追加できない状態を、緑から灰色への変更や、不透明度の低下で示す案です。

採りませんでした。
灰色はデータセットの区別に使う色を失うこと、不透明度は航空写真の明るさによって違いが分かりにくいことが理由です。

## 設計

### 1. `PlateauService.getData()`

`_osmDataMissing()` が `'layer-off'` を返したとき、空の配列ではなく `entities` をそのまま返します。
`_filterPlateauOverlaps()` は呼びません。

`'tiles'` を返したときは、いまと同じく空の配列を返します。

```js
const missing = this._osmDataMissing();
if (missing === 'layer-off') return entities;   // 重なりの除去はしない
if (missing) return [];
entities = this._filterPlateauOverlaps(entities, ds.graph);
```

画面下端の通知を出す `_notifyOsmLayerOff()` を削除します。
理由は画面上の縞模様と、追加のボタンの無効化で伝わるためです。

あわせて `_osmLayerOffNotified` を削除します。
`_osmDataMissing()` の中にある `this._osmLayerOffNotified = false;` の行も削除します。
削除すると `_osmDataMissing()` は状態を変えない問い合わせだけになります。

文言 `plateau_conflation.osm_layer_off` は使わなくなるため、`data/core.yaml`、`data/l10n/core.en.json`、`data/l10n/core.ja.json` の 3 つから削除します。

### 2. 追加できない状態の判定

OSM のレイヤーが消えているかどうかは、`PlateauService` に問い合わせる形にします。
`_osmDataMissing()` は非公開なので、公開の問い合わせを 1 つ足します。

```js
/**
 * isAddBlocked
 * OSM のレイヤーが消えているために、候補を OSM へ追加できない状態かどうか。
 * @return {boolean}
 */
isAddBlocked() {
  return this._osmDataMissing() === 'layer-off';
}
```

描画と画面部品の両方がここを見ます。
判定を 1 か所に置くことで、2 か所が食い違うことを防ぎます。

### 3. `PixiLayerRapid.renderPolygons()`

PLATEAU のデータセットを描くとき、`isAddBlocked()` が真であれば `fill` に `pattern: 'construction'` を足します。
色と不透明度は変えません。

`construction` は斜めの連続した線の模様で、`PixiTextures.js` が読み込む 27 種類の 1 つです。

`renderPolygons()` は複数のデータセットで共有されているため、`dataset.service === 'plateau'` を見て分岐します。
PLATEAU 以外のデータセットのポリゴンには模様を付けません。

### 4. 塗り直しの仕組み

`renderPolygons()` の `style` の代入は `if (feature.dirty)` の中にあります。
すでに描画オブジェクトが作られている候補は、レイヤーの状態が変わっただけでは塗り直されません。

`PixiLayerRapid` の組み立て時に `PixiScene` の `layerchange` を購読し、`this.dirtyLayer()` を呼びます。
`layerchange` はレイヤーの切り替えのたびに `PixiScene` が発生させます。
`dirtyLayer()` は `AbstractLayer` が持つ、そのレイヤーの図形をすべて塗り直す指示です。

これで `Shift` + `O` を押した瞬間に模様が付き、戻した瞬間に消えます。

### 5. `UiRapidInspector` の追加の無効化

`isAcceptFeatureDisabled()` は、いまは真偽値を返します。
無効になる理由が 2 つに増えるため、理由の文字列か `null` を返す形に変えます。

```js
/**
 * isAcceptFeatureDisabled
 * @return {string?}  無効な理由。'osm-layer-off' か 'limit'。有効なら null
 */
isAcceptFeatureDisabled() {
  const datum = this.datum;
  const plateau = this.context.services.plateau;
  if (datum?.__service__ === 'plateau' && plateau?.isAddBlocked()) return 'osm-layer-off';

  // 以下はいまの判定をそのまま残し、戻り値だけ真偽値から文字列に変える
  const rapid = this.context.systems.rapid;
  const urlhash = this.context.systems.urlhash;
  if (rapid.taskExtent) return null;
  if (urlhash.getParam('poweruser') === 'true') return null;
  return rapid.acceptIDs.size >= ACCEPT_FEATURES_LIMIT ? 'limit' : null;
}
```

PLATEAU の判定を先頭に置きます。
既存の `taskExtent` と `poweruser` は追加できる数の上限を外すためのもので、重なりを確かめられない状態とは関係がないためです。
上限を外している利用者でも、レイヤーが消えているあいだは追加できません。

呼び出しは 2 か所です。

`acceptFeature()` の中では、理由に応じて画面下端に出す文言を選びます。
`renderChoice()` の中では、`isDisabled` の判定はそのまま（文字列は真として扱われる）で、ツールチップの文言を理由に応じて選びます。

PLATEAU 以外のデータセットの候補には影響しません。

### 6. 文言

`rapid_inspector.option_accept` の下に 2 つ足します。

| 名前 | 用途 |
|---|---|
| `disabled_osm_layer_off` | 無効なときのツールチップ |
| `disabled_osm_layer_off_flash` | 押したときに画面下端に出す文言 |

日本語の趣旨は次のとおりです。
「OpenStreetMap のデータのレイヤーが消えているあいだは追加できません。既存の建物と重なるかを確かめられないためです。`Shift` + `O` で戻せます。」

`data/core.yaml`、`data/l10n/core.en.json`、`data/l10n/core.ja.json` の 3 つに、日本語と英語の両方を書きます。

## 試験

### `PlateauService` の試験

画面下端の通知に関する既存の試験 3 件を削除し、次の 4 件に置き換えます。

- レイヤーが消えているとき、`getData()` が候補を返すこと
- レイヤーが消えているとき、`getData()` が重なりの除去を行わないこと
- タイルが未取得のとき、`getData()` が空の配列を返すこと
- レイヤーが消えているとき、`isAddBlocked()` が真を返すこと

重なりの除去そのものの試験は、いまのまま残します。

### `UiRapidInspector` の試験

- レイヤーが消えていて PLATEAU の候補を選んでいるとき、`isAcceptFeatureDisabled()` が `'osm-layer-off'` を返すこと
- 同じ状況で他のデータセットの候補を選んでいるとき、`null` を返すこと
- レイヤーが戻ると `null` を返すこと
- 追加の上限に達しているときは `'limit'` を返すこと

### 縞模様

自動試験に向かないため、実機で確認します。
一辺が画面上で 32 ピクセル以上の建物を含む場所を開き、`Shift` + `O` の前後で見え方を比べます。

### 実行

`npm run build` と `npm run dist` を実行してから `npm run test:browser` を実行します。
作り直さないと古い版を測ります。

## この設計の弱点

`PixiFeaturePolygon` は、建物の画面上の幅か高さが 32 ピクセル未満のとき、模様の画像を外して通常の塗りに戻します。
東京の緯度で拡大率 17.5 のとき画面の 1 ピクセルはおよそ 0.7 メートルなので、一辺 10 メートルの住宅には模様が付きません。
住宅の多い場所では、追加できない状態が画面から分かりません。
候補を選べば、ツールチップと無効なボタンで理由が分かります。

すでに OSM にある建物も候補として並ぶため、候補の数が普段より多くなります。
レイヤーを戻したときに数が減ります。

タグ転記モードは、転記先の OSM の建物が編集ソフトの中に無いため、レイヤーが消えているあいだは何も表示しません。
これは今回の変更で新しく起きることではなく、Pull Request #52 以前から続いている状態です。
