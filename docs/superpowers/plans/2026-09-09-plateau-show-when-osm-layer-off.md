# OSM のレイヤーが消えているあいだ PLATEAU の建物を表示し、追加だけ止める 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OSM のデータのレイヤーが消えているあいだ、PLATEAU の建物をすべて表示したうえで、OSM への追加だけを止め、追加できない状態をポリゴンの縞模様で示す。

**Architecture:** レイヤーが消えているかどうかの判定を `PlateauService.isAddBlocked()` に 1 か所だけ置く。描画 (`PixiLayerRapid`) と画面部品 (`UiRapidInspector`) がそこを見る。`PlateauService.getData()` は、レイヤーが消えているとき重なりの除去を飛ばして候補をそのまま返す。

**Tech Stack:** JavaScript (ES modules)、Pixi.js 8、d3-selection、karma + mocha + chai (`npm run test:browser`)

## Global Constraints

- 起点は `fb97052fc`（Pull Request #52 のマージ地点）。ブランチは `feature/plateau-show-when-osm-layer-off`。
- 上流の facebook/Rapid が持つ `modules/pixi/PixiLayerOsm.js` には手を入れない。
- 文言は `data/core.yaml`、`data/l10n/core.en.json`、`data/l10n/core.ja.json` の 3 つに、英語と日本語の両方を書く。
- タイルの取得が終わっていない場合（`_osmDataMissing()` が `'tiles'` を返す場合）の挙動は変えない。候補を出さない。
- 試験は `npm run build && npm run dist` のあとに `npm run test:browser` を実行する。作り直さないと古い版を測る。
- 起点 `fb97052fc` での試験結果は 770 件成功、5 件スキップ、失敗 0 件。
- コミットメッセージは日本語。末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を付ける。

---

### Task 1: `PlateauService` — 候補を返し、追加の可否を公開する

**Files:**
- Modify: `modules/services/PlateauService.js:50-52`（`_osmLayerOffNotified` の宣言）
- Modify: `modules/services/PlateauService.js:342-349`（`getData()` の分岐）
- Modify: `modules/services/PlateauService.js:355-384`（`_osmDataMissing()` の説明と 371 行目）
- Modify: `modules/services/PlateauService.js:386-404`（`_notifyOsmLayerOff()` の削除、`isAddBlocked()` の追加）
- Test: `test/browser/services/PlateauService.test.js:744-820`

**Interfaces:**
- Consumes: なし（このタスクが最初）
- Produces: `PlateauService.prototype.isAddBlocked(): boolean` — OSM のレイヤーが消えているために OSM へ追加できない状態なら `true`。Task 3 と Task 4 が使う。
- Produces: `PlateauService.prototype.getData(datasetID, options)` の挙動変更 — `_osmDataMissing()` が `'layer-off'` のとき、空の配列ではなく重なりの除去をしていない `entities` を返す。

- [ ] **Step 1: 既存の試験を書き換える**

`test/browser/services/PlateauService.test.js` の `describe('#getData conflation'...)` の中を書き換える。

まず `setOsmState` の定義の下に、OSM の建物を作る補助を足す。

```js
    // 編集ソフトの中に OSM の建物を 1 棟置く。重なりの除去の材料になる。
    function setupOsmBuilding(service, coords) {
      const editor = service.context.systems.editor;
      let graph = editor._graph;
      const nodeIds = [];
      for (let i = 0; i < coords.length; i++) {
        const nodeId = 'osmb-n' + i;
        nodeIds.push(nodeId);
        graph = graph.replace(Rapid.osmNode({ id: nodeId, loc: coords[i] }));
      }
      nodeIds.push(nodeIds[0]);
      const way = Rapid.osmWay({ id: 'osmbWay', nodes: nodeIds, tags: { building: 'yes' } });
      graph = graph.replace(way);
      editor._graph = graph;
      editor._entities = [way];
      return way;
    }

    // PLATEAU の建物と同じ四隅。100 パーセント重なる。
    function sameFootprint(service) {
      const c = service.context.viewport.visibleExtent().center();
      return [
        [c[0] - 0.0001, c[1] - 0.0001], [c[0] + 0.0001, c[1] - 0.0001],
        [c[0] + 0.0001, c[1] + 0.0001], [c[0] - 0.0001, c[1] + 0.0001]
      ];
    }
```

次に、`it('returns no candidates while the OSM layer is switched off', ...)` を次の 3 件に置き換える。

```js
    it('returns candidates while the OSM layer is switched off', () => {
      setOsmState(_service, { layerEnabled: false });
      const ways = _service.getData('ds1').filter(e => e.type === 'way');
      expect(ways).to.have.lengthOf(1, 'レイヤーが消えていても表示は続ける');
    });

    it('does not remove overlapping candidates while the OSM layer is switched off', () => {
      setupOsmBuilding(_service, sameFootprint(_service));
      setOsmState(_service, { layerEnabled: false });
      const ways = _service.getData('ds1').filter(e => e.type === 'way');
      expect(ways).to.have.lengthOf(1, '重なりの除去を行わない');
    });

    it('removes overlapping candidates once the layer is switched on', () => {
      setupOsmBuilding(_service, sameFootprint(_service));
      setOsmState(_service, {});
      const ways = _service.getData('ds1').filter(e => e.type === 'way');
      expect(ways).to.have.lengthOf(0, '材料が揃えば除去する');
    });
```

さらに、`describe` の末尾にある画面下端の通知の試験 3 件を削除する。
削除するのは `mockFlash()`、`withUi()`、および次の 3 件である。

- `it('tells the user once while the OSM layer stays switched off', ...)`
- `it('stays quiet while the tiles are still loading', ...)`
- `it('tells the user again after the layer is switched on and off', ...)`

その位置に `isAddBlocked()` の試験を足す。

```js
    it('reports that adding is blocked while the OSM layer is switched off', () => {
      setOsmState(_service, { layerEnabled: false });
      expect(_service.isAddBlocked()).to.be.true;
    });

    it('does not report a block while the tiles are still loading', () => {
      setOsmState(_service, { tilesLoaded: false });
      expect(_service.isAddBlocked()).to.be.false;
    });

    it('does not report a block once the layer is on and the tiles are loaded', () => {
      setOsmState(_service, {});
      expect(_service.isAddBlocked()).to.be.false;
    });
```

- [ ] **Step 2: 試験を実行し、失敗を確かめる**

```bash
npm run build && npm run dist && npm run test:browser
```

期待する結果: `returns candidates while the OSM layer is switched off` が失敗する（`expected 0 to have a length of 1`）。
`isAddBlocked` の 3 件も失敗する（`_service.isAddBlocked is not a function`）。

- [ ] **Step 3: `_osmLayerOffNotified` の宣言を消す**

`modules/services/PlateauService.js` の 50 行目から 52 行目、次の 3 行を削除する。

```js
    // OSM のレイヤーが消えている件を伝えたかどうか。レイヤーが戻ると false に戻す。
    this._osmLayerOffNotified = false;

```

- [ ] **Step 4: `getData()` の分岐を書き換える**

`modules/services/PlateauService.js` の 342 行目から 349 行目を、次のとおり置き換える。

置き換え前:

```js
      const missing = this._osmDataMissing();
      if (missing) {
        if (missing === 'layer-off') this._notifyOsmLayerOff();
        return [];
      }
      entities = this._filterPlateauOverlaps(entities, ds.graph);
```

置き換え後:

```js
      const missing = this._osmDataMissing();

      // レイヤーが消えているあいだは、重なりの除去をせずにそのまま返す。
      // 材料が無いので除去できないが、表示は続ける。すでに OSM にある建物も
      // 候補に並ぶため、OSM への追加は `isAddBlocked()` を見る側が止める。
      if (missing === 'layer-off') return entities;

      // タイルの取得が終わっていないだけなら、待てば材料が揃う。候補は出さない。
      if (missing) return [];

      entities = this._filterPlateauOverlaps(entities, ds.graph);
```

- [ ] **Step 5: `_osmDataMissing()` の説明と 371 行目を直す**

371 行目の `this._osmLayerOffNotified = false;` を削除する。

説明の文（355 行目から 366 行目）を、次のとおり置き換える。

置き換え前:

```js
  /**
   * _osmDataMissing
   * 重なりの判定は、編集ソフトの中にある OSM の建物だけを材料にする。
   * 材料が集まっていない状態では「OSM に無い建物」と「まだ確かめられていない建物」を
   * 区別できない。区別しないまま候補を出すと、すでに OSM にある建物を重ねて
   * 登録することになるため、そのときは候補を出さない。
   *
   * OSM のレイヤーを消すと `PixiLayerOsm` の描画が先頭で止まり、その先の
   * `context.loadTiles()` に届かない。画面から消えるだけでなく、編集ソフトの中身も
   * 空のままになる。
   *
   * @return {string?}  材料が揃っていない理由。'layer-off' か 'tiles'。揃っていれば null
   */
```

置き換え後:

```js
  /**
   * _osmDataMissing
   * 重なりの判定は、編集ソフトの中にある OSM の建物だけを材料にする。
   * 材料が集まっていない状態では「OSM に無い建物」と「まだ確かめられていない建物」を
   * 区別できない。
   *
   * OSM のレイヤーを消すと `PixiLayerOsm` の描画が先頭で止まり、その先の
   * `context.loadTiles()` に届かない。画面から消えるだけでなく、編集ソフトの中身も
   * 空のままになる。この場合は候補をそのまま表示し、OSM への追加のほうを止める。
   *
   * タイルの取得が終わっていないだけの場合は、待てば材料が揃うので候補を出さない。
   *
   * @return {string?}  材料が揃っていない理由。'layer-off' か 'tiles'。揃っていれば null
   */
```

- [ ] **Step 6: `_notifyOsmLayerOff()` を `isAddBlocked()` に置き換える**

386 行目から 404 行目の `_notifyOsmLayerOff()` を丸ごと削除し、同じ位置に次を置く。

```js
  /**
   * isAddBlocked
   * OSM のレイヤーが消えているために、候補を OSM へ追加できない状態かどうか。
   * 重なりを確かめる材料が無いまま追加すると、すでに OSM にある建物を
   * 重ねて登録することになるため、追加のほうを止める。
   *
   * 描画 (`PixiLayerRapid`) と画面部品 (`UiRapidInspector`) の両方がここを見る。
   *
   * @return {boolean}  追加できない状態なら true
   */
  isAddBlocked() {
    return this._osmDataMissing() === 'layer-off';
  }
```

- [ ] **Step 7: 試験を実行し、成功を確かめる**

```bash
npm run build && npm run dist && npm run test:browser
```

期待する結果: 失敗 0 件。
削除した 3 件のぶん試験の総数が減り、足した 6 件のぶん増える。

- [ ] **Step 8: コミット**

```bash
git add modules/services/PlateauService.js test/browser/services/PlateauService.test.js
git commit -m "$(cat <<'EOF'
feat(plateau): レイヤーが消えているあいだも候補を返し、追加の可否を公開する

重なりの除去は材料が無いので飛ばす。画面下端の通知は追加の無効化に
置き換えるため削除する。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 文言 — 追加できない理由を足し、使わなくなった文言を消す

**Files:**
- Modify: `data/core.yaml:28`（`plateau_conflation.osm_layer_off` の削除）
- Modify: `data/core.yaml:1125-1131`（`rapid_inspector.option_accept` への追加）
- Modify: `data/l10n/core.en.json:31`、`data/l10n/core.en.json` の `option_accept`
- Modify: `data/l10n/core.ja.json:2966`、`data/l10n/core.ja.json:2990-2997`

**Interfaces:**
- Consumes: なし
- Produces: 文言の名前 `rapid_inspector.option_accept.disabled_osm_layer_off` と `rapid_inspector.option_accept.disabled_osm_layer_off_flash`。Task 3 が使う。

- [ ] **Step 1: `data/core.yaml` に文言を足す**

1131 行目の `disabled_flash:` の次の行に、2 行を足す。

```yaml
      disabled_osm_layer_off: Plateau buildings cannot be added while the OpenStreetMap data layer is off, because existing buildings cannot be checked for duplicates. Press Shift+O to turn it back on.
      disabled_osm_layer_off_flash: Plateau buildings cannot be added while the OpenStreetMap data layer is off. Press Shift+O to turn it back on.
```

- [ ] **Step 2: `data/core.yaml` から使わなくなった文言を消す**

`plateau_conflation` の下には `osm_layer_off` しか無いため、入れ物ごと削除する。
27 行目と 28 行目の次の 2 行を削除する。

```yaml
  plateau_conflation:
    osm_layer_off: "Plateau buildings stay hidden while the OpenStreetMap data layer is off, because existing buildings cannot be checked for duplicates. Press Shift+O to turn it back on."
```

- [ ] **Step 3: `data/l10n/core.en.json` を同じ形に直す**

`"option_accept"` の中の `"disabled_flash"` の次に 2 項目を足す。

```json
        "disabled_osm_layer_off": "Plateau buildings cannot be added while the OpenStreetMap data layer is off, because existing buildings cannot be checked for duplicates. Press Shift+O to turn it back on.",
        "disabled_osm_layer_off_flash": "Plateau buildings cannot be added while the OpenStreetMap data layer is off. Press Shift+O to turn it back on."
```

30 行目から 32 行目の `"plateau_conflation"` を、入れ物ごと削除する。

```json
    "plateau_conflation": {
      "osm_layer_off": "Plateau buildings stay hidden while the OpenStreetMap data layer is off, because existing buildings cannot be checked for duplicates. Press Shift+O to turn it back on."
    },
```

- [ ] **Step 4: `data/l10n/core.ja.json` を直す**

2996 行目の `"disabled_flash"` の次に 2 項目を足す。

```json
        "disabled_osm_layer_off": "OpenStreetMap のデータのレイヤーが消えているあいだは、PLATEAU の建物を追加できません。既存の建物と重なるかを確かめられないためです。Shift+O で戻せます。",
        "disabled_osm_layer_off_flash": "OpenStreetMap のデータのレイヤーが消えているあいだは、PLATEAU の建物を追加できません。Shift+O で戻せます。"
```

2965 行目から 2967 行目の `"plateau_conflation"` を、入れ物ごと削除する。

```json
    "plateau_conflation": {
      "osm_layer_off": "OpenStreetMap のデータのレイヤーが消えているあいだは、Plateau の建物を表示しません。既存の建物と重なるかを確かめられないためです。Shift+O で戻せます。"
    },
```

- [ ] **Step 5: 作り直して、残った参照が無いことを確かめる**

```bash
npm run build && npm run dist
grep -rn "plateau_conflation\.osm_layer_off\|plateau_conflation\"" modules/ data/ test/
grep -rn "osm_layer_off" modules/ data/ test/
```

期待する結果: どちらの `grep` も何も出力しない。
出力がある場合は、その参照を消してから次へ進む。

`modules/services/PlateauService.js` には `utilStringQs(window.location.hash).plateau_conflation` という行が残る。
これは重なりの除去を URL の指定で切るための引数で、文言とは関係がない。
上の `grep` はこの行に当たらない書き方にしてある。
この行は削除しない。

- [ ] **Step 6: 試験を実行し、成功を確かめる**

```bash
npm run test:browser
```

期待する結果: 失敗 0 件。

- [ ] **Step 7: コミット**

```bash
git add data/core.yaml data/l10n/core.en.json data/l10n/core.ja.json
git commit -m "$(cat <<'EOF'
i18n(plateau): 追加できない理由の文言を足し、使わなくなった文言を消す

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `UiRapidInspector` — PLATEAU の候補の追加を止める

**Files:**
- Modify: `modules/ui/UiRapidInspector.js:139-158`（`isAcceptFeatureDisabled()`）
- Modify: `modules/ui/UiRapidInspector.js:178-187`（`acceptFeature()` の中）
- Modify: `modules/ui/UiRapidInspector.js:612`、`modules/ui/UiRapidInspector.js:668-673`（`renderChoice()` の中）
- Test: `test/browser/ui/UiRapidInspector.js`（新規）

**Interfaces:**
- Consumes: `PlateauService.prototype.isAddBlocked(): boolean`（Task 1）、`rapid_inspector.option_accept.disabled_osm_layer_off` と `..._flash`（Task 2）
- Produces: `UiRapidInspector.prototype.isAcceptFeatureDisabled(): string?` — 無効な理由 `'osm-layer-off'` か `'limit'`、有効なら `null`。真偽値ではなくなる。

- [ ] **Step 1: 試験を書く**

`test/browser/ui/UiRapidInspector.js` を新規に作る。

```js
describe('UiRapidInspector', () => {
  let inspector;

  class MockContext {
    constructor() {
      this.systems = {
        l10n: { t: (key) => key, isRTL: () => false },
        rapid: { taskExtent: null, acceptIDs: new Set() },
        urlhash: { getParam: () => null }
      };
      this.services = { plateau: { isAddBlocked: () => false } };
    }
    container() { return d3.select('body'); }
  }

  beforeEach(() => {
    inspector = new Rapid.UiRapidInspector(new MockContext());
  });


  it('returns null when nothing blocks adding', () => {
    inspector.datum = { __service__: 'plateau' };
    expect(inspector.isAcceptFeatureDisabled()).to.be.null;
  });

  it('blocks a Plateau candidate while the OSM layer is switched off', () => {
    inspector.context.services.plateau.isAddBlocked = () => true;
    inspector.datum = { __service__: 'plateau' };
    expect(inspector.isAcceptFeatureDisabled()).to.eql('osm-layer-off');
  });

  it('leaves other datasets alone while the OSM layer is switched off', () => {
    inspector.context.services.plateau.isAddBlocked = () => true;
    inspector.datum = { __service__: 'mapwithai' };
    expect(inspector.isAcceptFeatureDisabled()).to.be.null;
  });

  it('blocks a Plateau candidate before the poweruser bypass', () => {
    // 追加できる数の上限を外している利用者でも、材料が無い状態では追加させない。
    inspector.context.services.plateau.isAddBlocked = () => true;
    inspector.context.systems.urlhash.getParam = () => 'true';
    inspector.datum = { __service__: 'plateau' };
    expect(inspector.isAcceptFeatureDisabled()).to.eql('osm-layer-off');
  });

  it('reports the accept limit once it is reached', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add('w' + i);
    inspector.context.systems.rapid.acceptIDs = ids;
    inspector.datum = { __service__: 'mapwithai' };
    expect(inspector.isAcceptFeatureDisabled()).to.eql('limit');
  });

  it('returns null when the plateau service is not installed', () => {
    inspector.context.services = {};
    inspector.datum = { __service__: 'plateau' };
    expect(inspector.isAcceptFeatureDisabled()).to.be.null;
  });
});
```

- [ ] **Step 2: 試験を実行し、失敗を確かめる**

```bash
npm run build && npm run dist && npm run test:browser
```

期待する結果: `returns null when nothing blocks adding` が失敗する（`expected false to be null`）。
`blocks a Plateau candidate while the OSM layer is switched off` も失敗する（`expected false to equal 'osm-layer-off'`）。

- [ ] **Step 3: `isAcceptFeatureDisabled()` を書き換える**

139 行目から 158 行目を、次のとおり置き換える。

置き換え前:

```js
  /**
   * isAcceptFeatureDisabled
   * The "Add Feature" button is disabled if the user has already added more than the
   *  ACCEPT_FEATURES_LIMIT - unless they are working on a task, or in poweruser mode.
   * @return {boolean}  `true` if Add Feature is disabled, `false` if enabled.
   */
  isAcceptFeatureDisabled() {
    const context = this.context;
    const rapid = context.systems.rapid;
    const urlhash = context.systems.urlhash;

    // If Rapid is working with on a task, "add roads" is always enabled
    if (rapid.taskExtent) return false;

    // Power users aren't limited by the max features limit
    const isPowerUser = urlhash.getParam('poweruser') === 'true';
    if (isPowerUser) return false;

    return rapid.acceptIDs.size >= ACCEPT_FEATURES_LIMIT;
  }
```

置き換え後:

```js
  /**
   * isAcceptFeatureDisabled
   * The "Add Feature" button is disabled for two reasons:
   *  - 'osm-layer-off': the OSM data layer is switched off, so a Plateau candidate
   *      cannot be checked against existing OSM buildings before adding it.
   *  - 'limit': the user has already added more than the ACCEPT_FEATURES_LIMIT,
   *      unless they are working on a task, or in poweruser mode.
   * @return {string?}  無効な理由 'osm-layer-off' か 'limit'。有効なら null
   */
  isAcceptFeatureDisabled() {
    const context = this.context;
    const rapid = context.systems.rapid;
    const urlhash = context.systems.urlhash;

    // 重なりを確かめる材料が無いまま PLATEAU の建物を追加すると、すでに OSM に
    // ある建物を重ねて登録することになる。追加できる数の上限とは別の理由なので、
    // 上限を外している利用者にも効かせるため先に見る。
    const plateau = context.services?.plateau;
    if (this.datum?.__service__ === 'plateau' && plateau?.isAddBlocked?.()) return 'osm-layer-off';

    // If Rapid is working with on a task, "add roads" is always enabled
    if (rapid.taskExtent) return null;

    // Power users aren't limited by the max features limit
    const isPowerUser = urlhash.getParam('poweruser') === 'true';
    if (isPowerUser) return null;

    return rapid.acceptIDs.size >= ACCEPT_FEATURES_LIMIT ? 'limit' : null;
  }
```

- [ ] **Step 4: 試験を実行し、成功を確かめる**

```bash
npm run build && npm run dist && npm run test:browser
```

期待する結果: 新しい 6 件がすべて成功し、全体の失敗が 0 件。

- [ ] **Step 5: `acceptFeature()` で理由に応じた文言を出す**

178 行目から 187 行目を、次のとおり置き換える。

置き換え前:

```js
    if (this.isAcceptFeatureDisabled()) {
      const flash = uiFlash(context)
        .duration(5000)
        .label(l10n.t(
          'rapid_inspector.option_accept.disabled_flash',
          { n: ACCEPT_FEATURES_LIMIT }
        ));
      flash();
      return;
    }
```

置き換え後:

```js
    const disabledReason = this.isAcceptFeatureDisabled();
    if (disabledReason) {
      const label = (disabledReason === 'osm-layer-off')
        ? l10n.t('rapid_inspector.option_accept.disabled_osm_layer_off_flash')
        : l10n.t('rapid_inspector.option_accept.disabled_flash', { n: ACCEPT_FEATURES_LIMIT });

      const flash = uiFlash(context).duration(5000).label(label);
      flash();
      return;
    }
```

- [ ] **Step 6: `renderChoice()` でツールチップの文言を選び分ける**

612 行目を、次のとおり置き換える。

置き換え前:

```js
    const isDisabled = (d.key === 'accept' && this.isAcceptFeatureDisabled());
```

置き換え後:

```js
    const disabledReason = (d.key === 'accept') ? this.isAcceptFeatureDisabled() : null;
    const isDisabled = !!disabledReason;
```

668 行目から 672 行目を、次のとおり置き換える。

置き換え前:

```js
    if (d.key === 'accept') {
      if (isDisabled) {
        title = l10n.t('rapid_inspector.option_accept.disabled', { n: ACCEPT_FEATURES_LIMIT } );
        shortcut = '';
      } else {
```

置き換え後:

```js
    if (d.key === 'accept') {
      if (disabledReason === 'osm-layer-off') {
        title = l10n.t('rapid_inspector.option_accept.disabled_osm_layer_off');
        shortcut = '';
      } else if (isDisabled) {
        title = l10n.t('rapid_inspector.option_accept.disabled', { n: ACCEPT_FEATURES_LIMIT } );
        shortcut = '';
      } else {
```

- [ ] **Step 7: 試験を実行し、成功を確かめる**

```bash
npm run build && npm run dist && npm run test:browser
```

期待する結果: 失敗 0 件。

- [ ] **Step 8: コミット**

```bash
git add modules/ui/UiRapidInspector.js test/browser/ui/UiRapidInspector.js
git commit -m "$(cat <<'EOF'
feat(plateau): レイヤーが消えているあいだ PLATEAU の候補の追加を止める

無効になる理由が 2 つになるため、isAcceptFeatureDisabled の戻り値を
真偽値から理由の文字列に変える。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `PixiLayerRapid` — 追加できない状態を縞模様で示す

**Files:**
- Modify: `modules/pixi/PixiLayerRapid.js:24-27`（組み立て時の購読）
- Modify: `modules/pixi/PixiLayerRapid.js:469-490`（`renderPolygons()`）

**Interfaces:**
- Consumes: `PlateauService.prototype.isAddBlocked(): boolean`（Task 1）
- Produces: なし（このタスクが最後）

- [ ] **Step 1: 塗り直しの購読を足す**

24 行目から 27 行目のあと、`this._resolved = new Map();` の次の行に足す。

```js
    // OSM のレイヤーを切り替えると、PLATEAU の候補の塗り方が変わる。
    // `renderPolygons()` の `style` の代入は `feature.dirty` のときだけ行われるため、
    // 切り替えのたびにこのレイヤーの図形を塗り直す。
    scene.on('layerchange', () => this.dirtyLayer());
```

- [ ] **Step 2: `renderPolygons()` で縞模様を付ける**

469 行目から 490 行目のうち、関数の先頭と `style` の組み立てを次のとおり置き換える。

置き換え前:

```js
  renderPolygons(parentContainer, dataset, graph, frame, viewport, zoom, data) {
    const color = new PIXI.Color(dataset.color);
    const l10n = this.context.systems.l10n;
```

置き換え後:

```js
  renderPolygons(parentContainer, dataset, graph, frame, viewport, zoom, data) {
    const color = new PIXI.Color(dataset.color);
    const l10n = this.context.systems.l10n;

    // OSM のレイヤーが消えているあいだ、PLATEAU の候補は OSM へ追加できない。
    // その状態を斜めの縞模様で示す。`construction` は `PixiTextures` が読み込む
    // 模様の 1 つ。建物が画面上で 32 ピクセル未満のときは模様が外れる。
    const plateau = this.context.services?.plateau;
    const addBlocked = (dataset.service === 'plateau') && !!plateau?.isAddBlocked?.();
```

さらに、同じ関数の中の `style` の組み立てを置き換える。

置き換え前:

```js
          const style = {
            labelTint: color,
            fill: { width: 2, color: color, alpha: 0.3 },
            // fill: { width: 2, color: color, alpha: 1, pattern: 'stripe' }
          };
```

置き換え後:

```js
          const style = {
            labelTint: color,
            fill: addBlocked
              ? { width: 2, color: color, alpha: 0.3, pattern: 'construction' }
              : { width: 2, color: color, alpha: 0.3 }
          };
```

- [ ] **Step 3: 試験を実行し、これまでの試験が壊れていないことを確かめる**

```bash
npm run build && npm run dist && npm run test:browser
```

期待する結果: 失敗 0 件。

- [ ] **Step 4: 実機で見え方を確かめる**

開発サーバを起動する。

```bash
npm start
```

`http://127.0.0.1:8080/#map=17.50/35.68467/139.69826&locale=ja` を開く。
一辺が 30 メートル以上の建物が見える場所であることを確かめる。

確かめる項目は次の 4 つである。

1. `Shift` + `O` を押すと、OSM の建物が消え、PLATEAU の候補が表示されたままであること
2. 押した瞬間に、大きい建物のポリゴンに斜めの縞模様が付くこと
3. 候補を選ぶと、追加のボタンが無効の見た目になり、ツールチップに理由が出ること
4. もう一度 `Shift` + `O` を押すと、縞模様がその場で消え、追加のボタンが有効に戻ること

4 つとも満たさない場合は、原因を調べてから次へ進む。

- [ ] **Step 5: コミット**

```bash
git add modules/pixi/PixiLayerRapid.js
git commit -m "$(cat <<'EOF'
feat(plateau): 追加できない状態を候補の縞模様で示す

レイヤーの切り替えのたびに塗り直すため、layerchange で dirtyLayer を呼ぶ。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 完了後

4 つのタスクが終わったら、`superpowers:finishing-a-development-branch` を使って Pull Request を出すかどうかを決める。

Pull Request #53 は、この変更が公開中のサイトで動くことを確かめてから close する。
ブランチ `feature/plateau-osm-layer-off-notice` もそれまで残す。

公開リポジトリへ出す前に、変更したファイル、コミットメッセージ、Pull Request 本文の 3 つで機微情報を確認する。
