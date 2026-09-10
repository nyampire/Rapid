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

`getData()` はもう 1 つ、`#plateau_conflation=false`（または `no`）という URL hash フラグも見ています。
これは重なりの除去そのものをユーザが明示的に止めるための、既存の脱出口です。
`isAddBlocked()` もこのフラグを見ないと、除去を止めたユーザに対して追加のほうだけが止まったままになります。
そこでフラグの読み出しを `_conflationEnabled()` に集約し、`getData()` と `isAddBlocked()` の両方から使います。

```js
_conflationEnabled() {
  const useConflationStr = utilStringQs(window.location.hash).plateau_conflation;
  return useConflationStr !== 'false' && useConflationStr !== 'no';
}

/**
 * isAddBlocked
 * OSM のレイヤーが消えているために、候補を OSM へ追加できない状態かどうか。
 * @return {boolean}
 */
isAddBlocked() {
  if (!this._conflationEnabled()) return false;
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

`PixiLayerRapid` の組み立て時に `PixiScene` の `layerchange` を購読します。
`layerchange` はどのレイヤーの切り替えでも発生するため、素朴に毎回 `dirtyLayer()` を呼ぶと、塗り方の変わらない他のデータセットまで作り直すことになります。
そこで直前の `isAddBlocked()` の値を `_addBlocked` にキャッシュしておき、値が実際に反転したときだけ `dirtyLayer()` を呼びます。

```js
this._addBlocked = null;   // 直前の可否。初回の切り替えでは必ず塗り直す
scene.on('layerchange', () => {
  const addBlocked = !!this.context.services?.plateau?.isAddBlocked?.();
  if (addBlocked === this._addBlocked) return;
  this._addBlocked = addBlocked;
  this.dirtyLayer();
});
```

`dirtyLayer()` は `AbstractLayer` が持つ、そのレイヤーの図形をすべて塗り直す指示です。

これで `Shift` + `O` を押した瞬間に模様が付き、戻した瞬間に消えます。

### 5. `UiRapidInspector` の追加の無効化

`isAcceptFeatureDisabled()` は、いまは真偽値を返します。
無効になる理由が 2 つに増えるため、理由の文字列か `null` を返す形に変えます。

PLATEAU レイヤー起因の判定 (`'osm-layer-off'`) だけを `_osmLayerOffDisabled()` として切り出します。
理由は「この地物のみ追加」(`accept_only_this`) にも同じ理由を効かせる必要があるためです（詳細は後述）。
件数上限 (`'limit'`) の判定はそちらには含めません。

```js
_osmLayerOffDisabled() {
  const plateau = this.context.services?.plateau;
  if (this.datum?.__service__ === 'plateau' && plateau?.isAddBlocked?.()) return 'osm-layer-off';
  return null;
}

/**
 * isAcceptFeatureDisabled
 * @return {string?}  無効な理由。'osm-layer-off' か 'limit'。有効なら null
 */
isAcceptFeatureDisabled() {
  const osmLayerOffReason = this._osmLayerOffDisabled();
  if (osmLayerOffReason) return osmLayerOffReason;

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

`isAcceptFeatureDisabled()` の呼び出しは 2 か所です。

`acceptFeature()` の中では、理由に応じて画面下端に出す文言を選びます。
`renderChoice()` の中では、`d.key === 'accept'` のときに `isAcceptFeatureDisabled()` を、`isDisabled` の判定はそのまま（文字列は真として扱われる）で、ツールチップの文言を理由に応じて選びます。

PLATEAU 以外のデータセットの候補には影響しません。

#### 5-1. 「この地物のみ追加」(`accept_only_this`) も同じ理由で止める

`accept_only_this` は `type=building` relation のメンバー (PLATEAU LOD2 の外形+部材という、PLATEAU の標準的な構造) にだけ表示される選択肢で、`accept` と同じ `onClick` (`acceptFeature`) を共有します。
そのため `isAddBlocked()` が真のときにクリックしても、`acceptFeature()` 内のガードに当たって flash するだけで実際には追加されません。

しかしボタンの見た目 (`disabled` クラス、ツールチップ、`⇧A` のショートカット表示) は `accept` にしか連動しておらず、`accept_only_this` は見た目だけ有効なまま残っていました。
`renderChoice()` の `disabledReason` を次のように拡張し、`accept_only_this` にも `_osmLayerOffDisabled()` の結果を効かせます。
件数上限 (`'limit'`) は `accept` 専用のままなので、`isAcceptFeatureDisabled()` 全体ではなく `_osmLayerOffDisabled()` だけを渡します。

```js
const disabledReason = (d.key === 'accept') ? this.isAcceptFeatureDisabled()
  : (d.key === 'accept_only_this') ? this._osmLayerOffDisabled()
  : null;
```

ツールチップの文言も、`accept_only_this` が `'osm-layer-off'` のときは `accept` の無効時と同じ文言 (`rapid_inspector.option_accept.disabled_osm_layer_off`) を出し、ショートカットの表示を消します。

#### 5-2. `plateau_conflation` フラグとの関係

`#plateau_conflation=false`（または `no`）で重なりの除去そのものを止めているとき、`isAddBlocked()` は `false` を返します（§2 参照）。
`isAcceptFeatureDisabled()` と `_osmLayerOffDisabled()` はどちらも `isAddBlocked()` を経由するため、この場合は自動的に追加を止めなくなります。
フラグを明示的に降ろしたユーザに対して、追加のボタンだけが無効のまま残る、という食い違いが起きないようにするためです。

#### 5-3. `UiRapidInspector` 自身の再描画

OSM のレイヤーを切り替えると、PLATEAU の候補を追加できるかどうかが変わります。
候補を選んだままレイヤーを戻したとき、無効の見た目と説明が残らないよう、`UiRapidInspector` のコンストラクタでも `PixiScene` の `layerchange` を購読し、そのつど `render()` を呼び直します。

```js
scene?.on('layerchange', () => {
  if (!this.datum) return;
  this.render();
});
```

`render()` 自身は `$parent` が d3 selection でなければ抜けますが、`$parent` はサイドバーがリセットされたあとも detached な DOM を指したまま残るため、この条件だけでは「候補を選んでいない」ケースを弾けません。
候補を選んでいない (`this.datum` が無い) あいだは描き直す意味が無いため、ハンドラの先頭で `this.datum` を確認します。

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

`PixiFeaturePolygon` はさらに 2 通り、塗りそのものが消える、または模様を運ばない代替に切り替わる場面があります。

- ワイヤーフレームモードでは `fill.visible = !isWireframeMode` により塗り自体が非表示になるため、模様も含めて何も見えません。
- 画面上の幅・高さが 20 ピクセル未満になると、`fill` ではなく `lowRes` という代替スプライトに切り替わります (`fill.visible = false`)。この `lowRes` は形状ごとの簡易アイコンで、`construction` 模様を運びません。

どちらも 32 ピクセル未満のケースと同じく、候補を選べばツールチップと無効なボタンで理由が分かります。

すでに OSM にある建物も候補として並ぶため、候補の数が普段より多くなります。
レイヤーを戻したときに数が減ります。

タグ転記モードは、転記先の OSM の建物が編集ソフトの中に無いため、レイヤーが消えているあいだは何も表示しません。
これは今回の変更で新しく起きることではなく、Pull Request #52 以前から続いている状態です。
