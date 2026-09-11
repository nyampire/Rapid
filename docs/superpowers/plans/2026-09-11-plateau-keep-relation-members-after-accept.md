# 1 つ受理しても同じ relation の残りを候補に残す 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `type=building` の relation のメンバーを 1 つ受理しても、同じ relation の残りが候補のまま残るようにします。

**Architecture:** 重なりの判定の材料に、その面がどの地物から来たかを `sourceID` として持たせます。relation を判定するときは、その relation 自身とメンバーの way から来た面を材料から外します。受理した地物は Plateau 側と同じ id のまま OSM のグラフに入るため、id の照合だけで足ります。

**Tech Stack:** JavaScript (ES modules)、karma と mocha と chai による browser 試験、esbuild による配布物の生成。

## Global Constraints

- 設計文書は `docs/superpowers/specs/2026-09-11-plateau-keep-relation-members-after-accept-design.ja.md` です。判断に迷ったらこちらが優先します。
- 上流のファイル（`modules/core/` の下、`modules/actions/rapid_accept_feature.js`）には手を入れません。
- `isAddBlocked` の動きは変えません。
- 高さの転記の経路（`getData` の `skipConflation`）は変えません。
- Plateau 以外のデータセット（mapwithai、esri、overture）には触れません。
- コミットメッセージは日本語のですます調で書き、一文ごとに改行します。末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を付けます。
- コードコメントも一文ごとに改行します。文の途中で折り返さないでください。1 つの行に 2 つの文を入れないでください。
- 公開リポジトリのため、ファイル、コミットメッセージ、Pull Request の本文の 3 つで機微情報を確認します。検査に使う語そのものは、どの文書にも書きません。
- 起点は `f589cf43b` です。ブランチは `fix/plateau-conflation-cache-invalidation` で、前の修正と設計文書がすでに載っています。
- 既存の試験を 1 件も壊さないでください。起点の結果は 798 件成功、5 件スキップ、失敗 0 件です。

## 試験の走らせ方

browser 試験は配布物（`dist/rapid.js`）を読みます。
コードを変えたら、必ず作り直してから走らせます。

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npm run test:browser
```

1 件だけ走らせる仕組みはありません。
出力の中から試験の名前を探して結果を見ます。

足す試験は 7 件です。
設計に挙げた 6 件に加えて、Task 1 で下位の関数に 1 件足します。
最後は 805 件成功、5 件スキップ、失敗 0 件になります。

## ファイルの構成

- 変更: `modules/services/PlateauService.js`
  - `_filterPlateauOverlaps` の材料の組み立てに `sourceID` を足します。
  - `_filterPlateauOverlaps` に `ownSourceIDsOf(relation)` を足します。relation 自身とメンバーの way の id を返します。
  - `_checkWayOverlapsOsmBuildings` に、外す id の集合を受ける引数を足します。
- 変更: `test/browser/services/PlateauService.test.js`
  - `#_checkWayOverlapsOsmBuildings` の `makeOsmBuildingData` に `sourceID` を渡せるようにします。
  - 試験を 7 件足します。

---

### Task 1: 材料に出どころを持たせ、判定で外せるようにする

**Files:**
- Modify: `modules/services/PlateauService.js`
- Test: `test/browser/services/PlateauService.test.js`（`describe('#_checkWayOverlapsOsmBuildings', ...)` の中）

**Interfaces:**
- Consumes: 既存の `_filterPlateauOverlaps` と `_checkWayOverlapsOsmBuildings`
- Produces: `osmBuildingData` の各要素が `sourceID` を持つようになります。`_checkWayOverlapsOsmBuildings(way, plateauGraph, osmBuildingData, skipSourceIDs)` の第 4 引数で、外す id の集合を渡せるようになります。省略すると全部の面を見ます。

- [ ] **Step 1: 試験のヘルパに sourceID を渡せるようにする**

`test/browser/services/PlateauService.test.js` の `describe('#_checkWayOverlapsOsmBuildings', ...)` にある `makeOsmBuildingData` を、次の内容に置き換えます。

```js
    function makeOsmBuildingData(coords, sourceID) {
      const closed = coords.concat([coords[0]]);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of closed) {
        if (c[0] < minX) minX = c[0];
        if (c[0] > maxX) maxX = c[0];
        if (c[1] < minY) minY = c[1];
        if (c[1] > maxY) maxY = c[1];
      }
      return [{ sourceID: sourceID, coords: [closed], bbox: { minX, minY, maxX, maxY } }];
    }
```

既存の 3 件の呼び出しは `sourceID` を渡しません。
その場合 `sourceID` は `undefined` になり、これまでと同じ結果になります。

- [ ] **Step 2: 失敗する試験を書く**

同じ `describe` の中、`returns null for open ways` のうしろに足します。

```js
    it('ignores an OSM building whose source is in the skip set', () => {
      const plateauResult = makePlateauWay(new Rapid.Graph(),
        'pW', [[0.5,0.5], [1.5,0.5], [1.5,1.5], [0.5,1.5]]);
      const osmData = makeOsmBuildingData([[0,0], [1,0], [1,1], [0,1]], 'pW');

      const result = _service._checkWayOverlapsOsmBuildings(
        plateauResult.way, plateauResult.graph, osmData, new Set(['pW'])
      );

      expect(result).to.be.false;
    });
```

- [ ] **Step 3: 試験を走らせて失敗を確認する**

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npm run test:browser
```

`ignores an OSM building whose source is in the skip set` が失敗します。
`expected true to be false` の形の誤りが出ます。
外す集合を受ける引数がまだ無いため、重なりがそのまま返ります。

- [ ] **Step 4: 判定の関数に引数を足す**

`modules/services/PlateauService.js` の `_checkWayOverlapsOsmBuildings` を書き換えます。

説明の `@return` の行の手前に、次の 1 行を足します。

```js
   * @param {Set?} skipSourceIDs - 材料から外す地物の id。省略すると全部の面を見る
```

関数の宣言を、次の内容に置き換えます。

```js
  _checkWayOverlapsOsmBuildings(way, plateauGraph, osmBuildingData, skipSourceIDs) {
```

`for (const osm of osmBuildingData) {` の直後に、次の 1 行を足します。

```js
        if (skipSourceIDs?.has(osm.sourceID)) continue;
```

- [ ] **Step 5: 材料に出どころを持たせる**

`_filterPlateauOverlaps` の中を 4 か所書き換えます。

1 か所目は `osmPolygons` の宣言です。
置き換える前はこれです。

```js
    const osmPolygons = [];       // 各要素は環の配列。先頭が外形、以降が穴。
```

置き換えたあとはこれです。

```js
    // 各要素は { sourceID, rings }。
    // rings の先頭が外形、以降が穴。
    // sourceID は面の元になった地物の id で、判定のときに材料から外すために使う。
    const osmPolygons = [];
```

2 か所目は multipolygon の relation から面を作るところです。
置き換える前はこれです。

```js
      if (outer) osmPolygons.push([outer, ...inners]);
```

置き換えたあとはこれです。

```js
      if (outer) osmPolygons.push({ sourceID: entity.id, rings: [outer, ...inners] });
```

3 か所目は way から面を作るところです。
置き換える前はこれです。

```js
      if (ring) osmPolygons.push([ring]);
```

置き換えたあとはこれです。

```js
      if (ring) osmPolygons.push({ sourceID: entity.id, rings: [ring] });
```

4 か所目は `osmBuildingData` を組み立てるところです。
置き換える前はこれです。

```js
    const osmBuildingData = [];
    for (const rings of osmPolygons) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of rings[0]) {
        if (c[0] < minX) minX = c[0];
        if (c[0] > maxX) maxX = c[0];
        if (c[1] < minY) minY = c[1];
        if (c[1] > maxY) maxY = c[1];
      }
      osmBuildingData.push({
        coords: rings,
        bbox: { minX, minY, maxX, maxY }
      });
    }
```

置き換えたあとはこれです。

```js
    const osmBuildingData = [];
    for (const polygon of osmPolygons) {
      const rings = polygon.rings;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of rings[0]) {
        if (c[0] < minX) minX = c[0];
        if (c[0] > maxX) maxX = c[0];
        if (c[1] < minY) minY = c[1];
        if (c[1] > maxY) maxY = c[1];
      }
      osmBuildingData.push({
        sourceID: polygon.sourceID,
        coords: rings,
        bbox: { minX, minY, maxX, maxY }
      });
    }
```

- [ ] **Step 6: 試験を走らせて通ることを確認する**

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npm run test:browser
```

`ignores an OSM building whose source is in the skip set` が成功します。
既存の試験も引き続き成功します。
全体は 799 件成功、5 件スキップ、失敗 0 件になります。

- [ ] **Step 7: コミットする**

```bash
cd /Users/nyampire/git/Rapid && git add modules/services/PlateauService.js test/browser/services/PlateauService.test.js && git commit -F- <<'EOF'
refactor(plateau): 重なりの材料に出どころを持たせる

重なりの判定の材料に、その面がどの地物から来たかを sourceID として持たせました。
判定の関数に、外す id の集合を受ける引数を足しました。

この段では、まだどこからも集合を渡していません。
動きはこれまでと同じです。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: relation を判定するときに自分自身の面を外す

**Files:**
- Modify: `modules/services/PlateauService.js`（`_filterPlateauOverlaps` の `evalRelationOverlap`）
- Test: `test/browser/services/PlateauService.test.js`（`describe('#_filterPlateauOverlaps', ...)` の中）

**Interfaces:**
- Consumes: Task 1 の `sourceID` と `_checkWayOverlapsOsmBuildings` の第 4 引数
- Produces: `_filterPlateauOverlaps` の中のローカル関数 `ownSourceIDsOf(relation)` → `Set`。relation 自身の id と、メンバーの way の id を返します。Task 3 でも使います。

- [ ] **Step 1: 失敗する試験を 2 件書く**

`describe('#_filterPlateauOverlaps', ...)` の中、`keeps all relation members when outline does NOT overlap OSM building` のうしろに足します。

`makeBuildingRelationWithParts` と `makeBuilding` は、同じ `describe` にあるものをそのまま使います。

```js
    it('keeps the other members after the outline itself was accepted', () => {
      // 外形と同じ形の建物が OSM 側にある。
      // 外形を受理した直後の状態を表す。
      // 受理した地物は Plateau 側と同じ id のまま OSM のグラフに入る。
      let osmGraph = new Rapid.Graph();
      const accepted = makeBuilding(osmGraph, 'pOutline', [[0,0], [1,0], [1,1], [0,1]]);
      _service.context.systems.editor._graph = accepted.graph;
      _service.context.systems.editor._entities = [accepted.way];

      let plateauGraph = new Rapid.Graph();
      const rel = makeBuildingRelationWithParts(
        plateauGraph, 'pOutline', ['pPart1', 'pPart2'],
        [[0,0], [1,0], [1,1], [0,1]],
        [
          [[0.1,0.1], [0.4,0.1], [0.4,0.4], [0.1,0.4]],
          [[0.6,0.6], [0.9,0.6], [0.9,0.9], [0.6,0.9]],
        ]
      );
      plateauGraph = rel.graph;

      const entities = [rel.outline, rel.parts[0], rel.parts[1], rel.relation];
      const result = _service._filterPlateauOverlaps(entities, plateauGraph);
      const ids = result.map(e => e.id);

      expect(ids).to.include('pPart1');
      expect(ids).to.include('pPart2');
    });


    it('keeps the outline and the other part after one part was accepted', () => {
      // parts の 1 本と同じ形の建物が OSM 側にある。
      // その part を受理した直後を表す。
      let osmGraph = new Rapid.Graph();
      const accepted = makeBuilding(osmGraph, 'pPart1', [[0.1,0.1], [0.4,0.1], [0.4,0.4], [0.1,0.4]]);
      _service.context.systems.editor._graph = accepted.graph;
      _service.context.systems.editor._entities = [accepted.way];

      let plateauGraph = new Rapid.Graph();
      const rel = makeBuildingRelationWithParts(
        plateauGraph, 'pOutline', ['pPart1', 'pPart2'],
        [[0,0], [1,0], [1,1], [0,1]],
        [
          [[0.1,0.1], [0.4,0.1], [0.4,0.4], [0.1,0.4]],
          [[0.6,0.6], [0.9,0.6], [0.9,0.9], [0.6,0.9]],
        ]
      );
      plateauGraph = rel.graph;

      const entities = [rel.outline, rel.parts[0], rel.parts[1], rel.relation];
      const result = _service._filterPlateauOverlaps(entities, plateauGraph);
      const ids = result.map(e => e.id);

      expect(ids).to.include('pOutline');
      expect(ids).to.include('pPart2');
    });
```

- [ ] **Step 2: 試験を走らせて 2 件とも失敗することを確認する**

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npm run test:browser
```

`keeps the other members after the outline itself was accepted` と `keeps the outline and the other part after one part was accepted` の 2 件が失敗します。
どちらも `expected [] to include 'pPart1'` の形の誤りが出ます。
受理した地物が判定の材料に入っているため、relation 全体が候補から外れます。

- [ ] **Step 3: 外す id の集合を作る関数を足す**

`modules/services/PlateauService.js` の `_filterPlateauOverlaps` の中、`const relationOverlapDecision = new Map();` の手前に足します。

```js
    // relation 自身から来た面を、材料から外すための id の集合。
    //
    // メンバーを受理すると、その地物は Plateau 側と同じ id のまま OSM のグラフに入る。
    // 外形と同じ形なので必ず重なり、残りのメンバーまで候補から外れてしまう。
    // 画面の文言は「外形とほかの部分は提案のまま残ります」と約束している。
    //
    // relation ごとに一度だけ作って使い回す。
    const ownSourceIDsCache = new Map();
    const ownSourceIDsOf = (relation) => {
      const cached = ownSourceIDsCache.get(relation.id);
      if (cached) return cached;

      const ids = new Set([relation.id]);
      for (const m of relation.members ?? []) {
        if (m.type === 'way') ids.add(m.id);
      }
      ownSourceIDsCache.set(relation.id, ids);
      return ids;
    };
```

- [ ] **Step 4: relation の判定で集合を渡す**

`evalRelationOverlap` の中を書き換えます。
置き換える前はこれです。

```js
      const decision = this._checkWayOverlapsOsmBuildings(outlineWay, plateauGraph, osmBuildingData);
```

置き換えたあとはこれです。

```js
      const decision = this._checkWayOverlapsOsmBuildings(
        outlineWay, plateauGraph, osmBuildingData, ownSourceIDsOf(relation)
      );
```

- [ ] **Step 5: 試験を走らせて通ることを確認する**

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npm run test:browser
```

新しい 2 件が成功します。
既存の試験も引き続き成功します。
とくに `rejects all relation members when outline overlaps OSM building` は、重なる相手が `osmB1` で relation のメンバーではないため、通ったままになります。
全体は 801 件成功、5 件スキップ、失敗 0 件になります。

- [ ] **Step 6: コミットする**

```bash
cd /Users/nyampire/git/Rapid && git add modules/services/PlateauService.js test/browser/services/PlateauService.test.js && git commit -F- <<'EOF'
fix(plateau): 1 つ受理しても同じ relation の残りを候補に残す

type=building の relation のメンバーを受理すると、その地物は Plateau 側と同じ id のまま OSM のグラフに入ります。
外形と同じ形なので必ず重なると判定され、残りのメンバーまで候補から外れていました。

画面の文言は「外形とほかの部分は提案のまま残ります」と約束しています。
relation を判定するときに、その relation 自身とメンバーの way から来た面を材料から外すようにしました。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: 外形のメンバーが無い relation の経路

**Files:**
- Modify: `modules/services/PlateauService.js`（`_filterPlateauOverlaps` の way ごとの判定）
- Test: `test/browser/services/PlateauService.test.js`（`describe('#_filterPlateauOverlaps', ...)` の中）

**Interfaces:**
- Consumes: Task 2 の `ownSourceIDsOf(relation)`
- Produces: 変更なし。

- [ ] **Step 1: 失敗する試験を書く**

`keeps the outline and the other part after one part was accepted` のうしろに足します。

`falls back to per-way check when relation has no outline member` の組み立て方を参考にします。
外形の役割を持つメンバーが無い relation を作り、メンバーの 1 本と同じ形の建物を OSM 側に置きます。

```js
    it('keeps the other members of an outline-less relation after one was accepted', () => {
      // メンバーの 1 本と同じ形の建物が OSM 側にある。
      // その 1 本を受理した直後を表す。
      let osmGraph = new Rapid.Graph();
      const accepted = makeBuilding(osmGraph, 'pA', [[0,0], [1,0], [1,1], [0,1]]);
      _service.context.systems.editor._graph = accepted.graph;
      _service.context.systems.editor._entities = [accepted.way];

      let plateauGraph = new Rapid.Graph();
      const a = makePlateauWay(plateauGraph, 'pA', [[0,0], [1,0], [1,1], [0,1]]);
      plateauGraph = a.graph;
      const b = makePlateauWay(plateauGraph, 'pB', [[0.2,0.2], [0.8,0.2], [0.8,0.8], [0.2,0.8]]);
      plateauGraph = b.graph;

      // 外形の役割を持つメンバーが無い relation。
      const relation = Rapid.osmRelation({
        id: 'r_no_outline',
        tags: { type: 'building', building: 'yes' },
        members: [
          { id: 'pA', type: 'way', role: 'part' },
          { id: 'pB', type: 'way', role: 'part' }
        ]
      });
      plateauGraph = plateauGraph.replace(relation);

      const entities = [a.way, b.way, relation];
      const result = _service._filterPlateauOverlaps(entities, plateauGraph);
      const ids = result.map(e => e.id);

      expect(ids).to.include('pB');
    });
```

- [ ] **Step 2: 試験を走らせて失敗を確認する**

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npm run test:browser
```

`keeps the other members of an outline-less relation after one was accepted` が失敗します。
`expected [ 'r_no_outline' ] to include 'pB'` の形の誤りが出ます。
外形が無いため relation の判定が `null` になり、メンバーが 1 本ずつ判定されます。
その経路には外す集合が渡っていません。

- [ ] **Step 3: way ごとの判定でも集合を渡す**

`_filterPlateauOverlaps` の返り値を作る `filter` の中を書き換えます。
置き換える前はこれです。

```js
      const decision = this._checkWayOverlapsOsmBuildings(entity, plateauGraph, osmBuildingData);
```

置き換えたあとはこれです。

```js
      // 外形の役割を持つメンバーが無い relation では、ここで 1 本ずつ判定する。
      // その場合も、同じ relation から来た面は材料から外す。
      const decision = this._checkWayOverlapsOsmBuildings(
        entity, plateauGraph, osmBuildingData,
        parentRel ? ownSourceIDsOf(parentRel) : undefined
      );
```

- [ ] **Step 4: 試験を走らせて通ることを確認する**

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npm run test:browser
```

`keeps the other members of an outline-less relation after one was accepted` が成功します。
既存の試験も引き続き成功します。
`falls back to per-way check when relation has no outline member` は、重なる相手が relation のメンバーではないため、通ったままになります。
全体は 802 件成功、5 件スキップ、失敗 0 件になります。

- [ ] **Step 5: コミットする**

```bash
cd /Users/nyampire/git/Rapid && git add modules/services/PlateauService.js test/browser/services/PlateauService.test.js && git commit -F- <<'EOF'
fix(plateau): 外形の無い relation でも残りを候補に残す

外形の役割を持つメンバーが無い relation では、メンバーが 1 本ずつ判定されます。
この経路には、同じ relation から来た面を外す集合が渡っていませんでした。

約束は relation の形によらないため、この経路にも同じ集合を渡すようにしました。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: 守るべきものの取りこぼしを埋める

**Files:**
- Test: `test/browser/services/PlateauService.test.js`

**Interfaces:**
- Consumes: Task 1 から Task 3 までの実装
- Produces: なし

この段で足す 3 件は、実装を変えずに通ります。
いまの動きを固定するための試験なので、失敗を確認する段はありません。
3 件とも、書いた直後に成功することを確かめてください。
もし失敗したら、実装のどこかが壊れているので、私に報告してください。

- [ ] **Step 1: 別の建物との重なりが、これまでどおり隠れることを確かめる**

`describe('#_filterPlateauOverlaps', ...)` の中、Task 3 で足した試験のうしろに足します。

```js
    it('still hides relation members when the overlap is a different building', () => {
      // relation のメンバーではない建物が OSM 側にある。
      // 受理したものではないので、これまでどおり隠れる。
      let osmGraph = new Rapid.Graph();
      const other = makeBuilding(osmGraph, 'osmOther', [[0,0], [1,0], [1,1], [0,1]]);
      _service.context.systems.editor._graph = other.graph;
      _service.context.systems.editor._entities = [other.way];

      let plateauGraph = new Rapid.Graph();
      const rel = makeBuildingRelationWithParts(
        plateauGraph, 'pOutline', ['pPart1'],
        [[0,0], [1,0], [1,1], [0,1]],
        [[[0.1,0.1], [0.4,0.1], [0.4,0.4], [0.1,0.4]]]
      );
      plateauGraph = rel.graph;

      const entities = [rel.outline, rel.parts[0], rel.relation];
      const result = _service._filterPlateauOverlaps(entities, plateauGraph);

      expect(result.map(e => e.id)).to.not.include('pPart1');
    });
```

- [ ] **Step 2: relation に属さない候補の判定が変わらないことを確かめる**

同じ場所に足します。

```js
    it('still hides a standalone candidate that overlaps an accepted building', () => {
      // relation に属さない候補は、受理済みの建物と重なれば隠れる。
      // 外す集合は relation の判定のときだけ渡される。
      let osmGraph = new Rapid.Graph();
      const accepted = makeBuilding(osmGraph, 'pAccepted', [[0,0], [1,0], [1,1], [0,1]]);
      _service.context.systems.editor._graph = accepted.graph;
      _service.context.systems.editor._entities = [accepted.way];

      const plateauResult = makePlateauWay(new Rapid.Graph(),
        'pLone', [[0.2,0.2], [0.8,0.2], [0.8,0.8], [0.2,0.8]]);

      const result = _service._filterPlateauOverlaps([plateauResult.way], plateauResult.graph);

      expect(result.map(e => e.id)).to.not.include('pLone');
    });
```

- [ ] **Step 3: 重なりの除去を止めているときは除去しないことを確かめる**

`describe('#getData の材料の確認', ...)` の中にある `describe('plateau_conflation フラグ', ...)` に足します。
`blocks adding when the flag is absent and the layer is off` のうしろに置きます。

`setupOsmBuilding`、`sameFootprint`、`setOsmState` は外側の `describe` にあるものをそのまま使います。

```js
      it('does not remove overlapping candidates when the flag is off', () => {
        window.history.replaceState(null, '', window.location.pathname + '#plateau_conflation=false');
        setupOsmBuilding(_service, sameFootprint(_service));
        setOsmState(_service, {});

        const ways = _service.getData('ds1').filter(e => e.type === 'way');
        expect(ways).to.have.lengthOf(1, 'フラグが降りていれば重なっていても残す');
      });
```

`sameFootprint` は、外側の `beforeEach` が作る候補とまったく同じ四隅を返します。
フラグが無ければこの候補は除去されます。

- [ ] **Step 4: 試験を走らせて 3 件とも通ることを確認する**

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npm run test:browser
```

3 件とも成功します。
全体は 805 件成功、5 件スキップ、失敗 0 件になります。

- [ ] **Step 5: コミットする**

```bash
cd /Users/nyampire/git/Rapid && git add test/browser/services/PlateauService.test.js && git commit -F- <<'EOF'
test(plateau): 守るべきものの取りこぼしを埋める

設計に並べた守るべきもののうち、試験が無かったものを埋めました。

別の建物との重なりがこれまでどおり隠れること、relation に属さない候補の判定が変わらないこと、重なりの除去を止めているときは除去しないことの 3 件です。

いまの動きを固定するための試験で、実装は変えていません。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: 仕上げと Pull Request

**Files:**
- 変更なし（確認と、コミット済みの内容の送信だけです）

**Interfaces:**
- Consumes: Task 1 から Task 4 までのコミット
- Produces: なし

- [ ] **Step 1: 静的検査を走らせる**

```bash
cd /Users/nyampire/git/Rapid && npm run lint
```

誤り 0 件で終わります。
警告は 42 件で、起点と同じ内容です。
数が増えていたら、増えた分を直します。

- [ ] **Step 2: 試験をひととおり走らせる**

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npm run test:browser
```

805 件成功、5 件スキップ、失敗 0 件になります。

- [ ] **Step 3: 守るべきものの一覧と試験を突き合わせる**

設計文書の「守るべきもの」の表にある 8 項目それぞれについて、書かれている試験の名前が試験ファイルに存在することを確かめます。

```bash
cd /Users/nyampire/git/Rapid && grep -c "it(" test/browser/services/PlateauService.test.js
```

表の「この設計で足す」となっている 2 項目が、実際の試験の名前に置き換わっていることも確かめます。
置き換わっていなければ、設計文書の表を実際の名前に直します。

- [ ] **Step 4: `describe.only` と `it.only` が残っていないことを確かめる**

```bash
cd /Users/nyampire/git/Rapid && grep -rn "describe.only\|it.only" test/browser/services/PlateauService.test.js || echo "残っていません"
```

`残っていません` と出ます。

- [ ] **Step 5: 機微情報を確認する**

このブランチで足した差分とコミットメッセージを、目で読んで確認します。
確認する対象は次の 4 種類です。

- 認証情報（パスワード、接続文字列、client_secret）
- サーバの識別子（ホスト名、SSH の別名、IP アドレス）
- 本番環境の内部パス
- 本番環境での操作手順

検査に使う語そのものは、この文書にも Pull Request の本文にも書きません。

```bash
cd /Users/nyampire/git/Rapid && git diff $(git merge-base main HEAD)..HEAD
```

```bash
cd /Users/nyampire/git/Rapid && git log $(git merge-base main HEAD)..HEAD --format=%B
```

どちらの出力にも、上の 4 種類が現れないことを確かめます。

- [ ] **Step 6: ブランチを送る**

```bash
cd /Users/nyampire/git/Rapid && git push -u origin fix/plateau-conflation-cache-invalidation
```

- [ ] **Step 7: Pull Request を作る**

本文は、この計画と 2 つの設計文書をもとに書きます。
含める内容は次のとおりです。

- 編集が確定したときに重なりの判定をやり直すようにしたこと
- その結果、1 つ受理すると同じ relation の残りが消えることが分かり、同じ Pull Request で直したこと
- 守るべきものを 8 項目に並べ、それぞれに試験を対応させたこと
- 試験は 805 件成功、5 件スキップ、失敗 0 件であること。起点は 791 件だったこと
- 静的検査は誤り 0 件、警告 42 件で起点と同じであること
- 2 つの設計文書の場所

本文を一時ファイルに書いてから `gh pr create --body-file` で渡します。
本文にも機微情報を書きません。

- [ ] **Step 8: 実機で 1 度だけ確かめる**

自動の試験はグラフを組み立てて呼ぶ形で、実際の操作は通っていません。
手元の開発サーバで 1 度だけ通しの動作を見ます。

```bash
cd /Users/nyampire/git/Rapid && npm run start
```

`http://127.0.0.1:8080/` を開き、Plateau の対応エリアで parts のある建物を探します。
外形を選んで「この地物だけを追加」を押し、残りの parts が候補として残ることを見ます。
あわせて、すでに OSM にある建物を動かしたときに、重なっている候補の表示が変わることも見ます。

確認が済んだら開発サーバを止めます。

## 積み残し

受理した地物を取り消した場合の動きは、この計画では扱いません。
取り消すと OSM のグラフから地物が消え、材料からも消えるため、判定は自然に元へ戻ります。

前の最終査読で残った Minor は、そのままにします。
試験ファイルの空行、`building` タグの判定が 2 か所にあること、`building=no` への明示的な変更の試験が無いことの 3 件です。
