# multipolygon の accept・UI・描画 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `type=multipolygon` の建物を accept したときに relation ごと追加され、UI が 1 棟であることを示し、穴が穴として描かれるようにする。

**Architecture:** 3 箇所の `type=building` 前提を広げる。accept の cascade 判定、`utilBuildingRelationInfo`、`PixiLayerRapid` の描画対象。描画機構は既にあるので、way 限定を外して relation を流し、メンバー way の二重描画を止める。

**Tech Stack:** JavaScript (ESM), node:test（unit）, Karma + Mocha + Chai（browser）, Pixi.js

## Global Constraints

- `type=multipolygon` は外形が役割 `outer`、穴が `inner`。`type=building` は `outline` と `part`。両方の語彙を扱う。
- **`type=multipolygon` のメンバー way はタグを持たない。**タグは relation にだけ付く。
- multipolygon では「この feature だけ追加」（`skipCascade`）を提示しない。メンバー way 単独では必ずタグ無しになる。
- relation のタグをメンバー way にコピーしない。中庭を塗りつぶした建物を黙って作ることになる。
- 描画対象にした relation のメンバー way は個別のポリゴンとして積まない。二重描画になる。
- `type=building` の accept・UI・描画の挙動を変えない。
- `type=building` の relation の描画方式（outline と parts を個別に描く）は変えない。
- conflation の判定ロジック（`_filterPlateauOverlaps` / `_checkWayOverlapsOsmBuildings`）には触れない。
- spec: `docs/superpowers/specs/2026-08-05-plateau-multipolygon-accept-render-design.ja.md`

## テストの実行

```bash
npm run test:unit      # node:test。速い。ビルド不要
npm run test:browser   # Karma。dist/rapid.js を読むので事前ビルドが必要
npm run build:bundle:modern:dev   # browser テストの前に必ず実行する
```

**Karma はプリビルドの `dist/rapid.js` を読み、`modules/` を直接見ない。**
ソースを変えたらビルドを挟まないとテスト結果が変わらない。
ビルド成果物はコミットしない。

---

### Task 1: accept の cascade を multipolygon にも効かせる

**Files:**
- Modify: `modules/actions/rapid_accept_feature.js:256-266`（cascade 検出）
- Test: `test/unit/actions/rapid_accept_feature.test.js`

**Interfaces:**
- Produces: `type=multipolygon` の relation を親に持つ way を accept すると、`acceptRelation` に入り relation とメンバーが揃って追加される。
- `acceptRelation` 自体は変更しない。relation の型を見ない汎用処理である。

- [ ] **Step 1: 失敗するテストを書く**

`test/unit/actions/rapid_accept_feature.test.js` の末尾、`describe('actionRapidAcceptFeature', ...)` の中に追加する。

```javascript
    describe('type=multipolygon (courtyard building)', () => {
        // 中庭のある建物。outer が外形、inner が穴。
        // タグは relation にだけ付き、メンバー way はタグを持たない。
        function makeCourtyardGraph() {
            const n1 = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
            const n2 = Rapid.osmNode({ id: 'n2', loc: [1, 0] });
            const n3 = Rapid.osmNode({ id: 'n3', loc: [1, 1] });
            const n4 = Rapid.osmNode({ id: 'n4', loc: [0, 1] });
            const n5 = Rapid.osmNode({ id: 'n5', loc: [0.4, 0.4] });
            const n6 = Rapid.osmNode({ id: 'n6', loc: [0.6, 0.4] });
            const n7 = Rapid.osmNode({ id: 'n7', loc: [0.6, 0.6] });
            const n8 = Rapid.osmNode({ id: 'n8', loc: [0.4, 0.6] });
            const outer = Rapid.osmWay({ id: 'w_outer', nodes: ['n1','n2','n3','n4','n1'] });
            const inner = Rapid.osmWay({ id: 'w_inner', nodes: ['n5','n6','n7','n8','n5'] });
            const relation = Rapid.osmRelation({
                id: 'r_mp',
                tags: { type: 'multipolygon', building: 'yes', height: '12' },
                members: [
                    { id: outer.id, type: 'way', role: 'outer' },
                    { id: inner.id, type: 'way', role: 'inner' }
                ]
            });
            const extGraph = new Rapid.Graph([n1,n2,n3,n4,n5,n6,n7,n8, outer, inner, relation]);
            return { extGraph, outer, inner, relation };
        }

        it('accepts the whole relation when the outer way is clicked', () => {
            const { extGraph, outer } = makeCourtyardGraph();
            const graph = Rapid.actionRapidAcceptFeature(outer.id, extGraph)(new Rapid.Graph());

            assert.ok(graph.hasEntity('r_mp'), 'relation not in graph');
            assert.ok(graph.hasEntity('w_outer'), 'outer not in graph');
            assert.ok(graph.hasEntity('w_inner'), 'inner not in graph');
        });

        it('accepts the whole relation when the inner way is clicked', () => {
            const { extGraph, inner } = makeCourtyardGraph();
            const graph = Rapid.actionRapidAcceptFeature(inner.id, extGraph)(new Rapid.Graph());

            assert.ok(graph.hasEntity('r_mp'));
            assert.ok(graph.hasEntity('w_outer'));
            assert.ok(graph.hasEntity('w_inner'));
        });

        it('keeps the tags on the relation and none on the member ways', () => {
            const { extGraph, outer } = makeCourtyardGraph();
            const graph = Rapid.actionRapidAcceptFeature(outer.id, extGraph)(new Rapid.Graph());

            const rel = graph.entity('r_mp');
            assert.equal(rel.tags.type, 'multipolygon');
            assert.equal(rel.tags.building, 'yes');
            assert.equal(rel.tags.height, '12');

            // メンバー way にタグは足さない。relation にあるものをコピーしない。
            assert.equal(graph.entity('w_outer').tags.building, undefined);
            assert.equal(graph.entity('w_inner').tags.building, undefined);
        });

        it('keeps the member roles', () => {
            const { extGraph, outer } = makeCourtyardGraph();
            const graph = Rapid.actionRapidAcceptFeature(outer.id, extGraph)(new Rapid.Graph());

            const roles = {};
            for (const m of graph.entity('r_mp').members) roles[m.role] = m.id;
            assert.equal(roles.outer, 'w_outer');
            assert.equal(roles.inner, 'w_inner');
        });

        it('adds only the clicked way when skipCascade is set', () => {
            // action 自体は skipCascade を尊重する。UI 側が multipolygon で
            // この選択肢を出さないことは Task 2 で担保する。
            const { extGraph, outer } = makeCourtyardGraph();
            const graph = Rapid.actionRapidAcceptFeature(
                outer.id, extGraph, { skipCascade: true }
            )(new Rapid.Graph());

            assert.ok(graph.hasEntity('w_outer'));
            assert.equal(graph.hasEntity('r_mp'), undefined);
        });
    });
```

- [ ] **Step 2: テストが落ちることを確認する**

Run: `npm run test:unit`
Expected: `accepts the whole relation when the outer way is clicked` と
`accepts the whole relation when the inner way is clicked` と `keeps the member roles` が FAIL
（relation が graph に入らない）。
`keeps the tags on the relation and none on the member ways` も relation が無いので FAIL。
`adds only the clicked way when skipCascade is set` は PASS。

- [ ] **Step 3: cascade の型判定を広げる**

`modules/actions/rapid_accept_feature.js` の cascade 検出を差し替える。

```javascript
            if (!skipOuterCascade) {
                var parents = extGraph.parentRelations(extWay);
                for (var i = 0; i < parents.length; i++) {
                    var parent = parents[i];
                    // type=building は PLATEAU LOD2 の outline + parts。
                    // type=multipolygon は中庭のある建物で、外形が outer、穴が inner。
                    // multipolygon のメンバー way はタグを持たず、タグは relation にしか無い。
                    // cascade しないと acceptWay に落ちてタグの無い way が OSM に上がる。
                    var parentType = parent.tags && parent.tags.type;
                    if ((parentType === 'building' || parentType === 'multipolygon')
                        && !seenRelations[parent.id]
                        && !inProgressRelations[parent.id]) {
                        return acceptRelation(parent);
                    }
                }
            }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test:unit`
Expected: 追加した 5 件が PASS。既存のテストも全件 PASS。

- [ ] **Step 5: cascade が本当に効いていることを確かめる**

`parentType === 'building' || parentType === 'multipolygon'` を一時的に
`parentType === 'building'` に戻し、`accepts the whole relation when the outer way is clicked`
が落ちることを確認してから戻す。
戻したあと `git diff` が想定どおりであることを確認する。

- [ ] **Step 6: コミット**

```bash
git add modules/actions/rapid_accept_feature.js test/unit/actions/rapid_accept_feature.test.js
git commit -m "fix(plateau): cascade accept through type=multipolygon relations"
```

---

### Task 2: 兄弟 highlight とインスペクタを multipolygon に対応させる

**Files:**
- Modify: `modules/util/building_relation.js`（全面。34 行の小さなファイル）
- Modify: `modules/ui/UiRapidInspector.js:440-470`（選択肢の組み立て）
- Modify: `modules/ui/UiRapidInspector.js:505-515`（情報行の文言）
- Modify: `data/core.yaml:1139-1141`（文言の追加）
- Test: `test/unit/util/building_relation.test.js`

**Interfaces:**
- Consumes: なし（Task 1 とは独立）
- Produces: `utilBuildingRelationInfo` の返り値が `{ relation, outlineCount, partCount, relationType }`。
  `relationType` は `'building'` または `'multipolygon'`。
  multipolygon では `outer` を `outlineCount`、`inner` を `partCount` に数える。
- Produces: multipolygon のメンバーを選択したとき「この feature だけ追加」が選択肢に出ない。

**hover / select の兄弟 highlight は自動で直る。**
`modules/services/PlateauService.js:143` と `:198` が `utilBuildingRelationInfo` を直接呼び、
返ってきた relation のメンバーに highlight を付けている。
この関数を広げれば両方に効くので、**`PlateauService.js` は変更しない。**

**UI の選択肢そのものにはテストが無い。**
`UiRapidInspector` は d3 の DOM 構築に密結合していて、既存のテストも無い。
`utilBuildingRelationInfo` が `relationType` を返すところまでを unit テストで固定し、
それを使う分岐は目視で確認する。テストで固定できないことを承知のうえで進める。

- [ ] **Step 1: 失敗するテストを書く**

`test/unit/util/building_relation.test.js` の末尾に追加する。

```javascript
  it('recognizes a type=multipolygon relation and counts outer/inner', () => {
    const outer = Rapid.osmWay({ id: 'w_outer', nodes: [] });
    const inner1 = Rapid.osmWay({ id: 'w_inner1', nodes: [] });
    const inner2 = Rapid.osmWay({ id: 'w_inner2', nodes: [] });
    const relation = Rapid.osmRelation({
      id: 'r_mp',
      tags: { type: 'multipolygon', building: 'yes' },
      members: [
        { id: 'w_outer', type: 'way', role: 'outer' },
        { id: 'w_inner1', type: 'way', role: 'inner' },
        { id: 'w_inner2', type: 'way', role: 'inner' }
      ]
    });
    const graph = new Rapid.Graph([outer, inner1, inner2, relation]);

    const info = Rapid.utilBuildingRelationInfo(outer, graph);
    assert.ok(info, 'multipolygon が認識されていない');
    assert.equal(info.relationType, 'multipolygon');
    assert.equal(info.outlineCount, 1);
    assert.equal(info.partCount, 2);
  });

  it('reports relationType for a type=building relation', () => {
    const outline = Rapid.osmWay({ id: 'w_outline', nodes: [] });
    const part = Rapid.osmWay({ id: 'w_part', nodes: [] });
    const relation = Rapid.osmRelation({
      id: 'r_b',
      tags: { type: 'building', building: 'yes' },
      members: [
        { id: 'w_outline', type: 'way', role: 'outline' },
        { id: 'w_part', type: 'way', role: 'part' }
      ]
    });
    const graph = new Rapid.Graph([outline, part, relation]);

    const info = Rapid.utilBuildingRelationInfo(outline, graph);
    assert.equal(info.relationType, 'building');
    assert.equal(info.outlineCount, 1);
    assert.equal(info.partCount, 1);
  });

  it('returns null for a multipolygon without a building tag', () => {
    // 建物でない multipolygon (森林など) は対象外。
    const outer = Rapid.osmWay({ id: 'w_outer', nodes: [] });
    const relation = Rapid.osmRelation({
      id: 'r_forest',
      tags: { type: 'multipolygon', landuse: 'forest' },
      members: [{ id: 'w_outer', type: 'way', role: 'outer' }]
    });
    const graph = new Rapid.Graph([outer, relation]);

    assert.equal(Rapid.utilBuildingRelationInfo(outer, graph), null);
  });
```

- [ ] **Step 2: テストが落ちることを確認する**

Run: `npm run test:unit`
Expected: `recognizes a type=multipolygon relation and counts outer/inner` が FAIL（null が返る）。
`reports relationType for a type=building relation` も FAIL（`relationType` が undefined）。
`returns null for a multipolygon without a building tag` は PASS（今は multipolygon 自体を見ていないため）。

- [ ] **Step 3: `utilBuildingRelationInfo` を広げる**

`modules/util/building_relation.js` を差し替える。

```javascript
/**
 * utilBuildingRelationInfo
 *
 * 指定 entity が「1 棟の建物」を表す relation のメンバー way である場合に、その relation
 * 情報を返す。それ以外は null。
 *
 * 対象は 2 種類ある。
 * type=building は Simple 3D Buildings / PLATEAU LOD2 の構造で、外形が役割 outline、
 * 内訳が part。メンバー way はそれぞれ自分のタグを持つ。
 * type=multipolygon は中庭のある建物で、外形が outer、穴が inner。
 * **タグは relation にだけ付き、メンバー way はタグを持たない。**
 *
 * UiRapidInspector や conflation ロジックから、UI 表示 / 動作判定の両方で使用。
 *
 * @param  {Object|null}  entity - osmEntity (typically a way)
 * @param  {Graph|null}   graph  - 該当 entity の含まれる Graph (parentRelations を提供)
 * @return {{relation: osmRelation, outlineCount: number, partCount: number,
 *           relationType: string} | null}
 */
export function utilBuildingRelationInfo(entity, graph) {
  if (!entity || entity.type !== 'way') return null;
  if (!graph || typeof graph.parentRelations !== 'function') return null;

  let parents;
  try {
    parents = graph.parentRelations(entity);
  } catch (e) {
    return null;
  }

  const relation = parents.find(r => {
    if (!r.tags) return false;
    if (r.tags.type === 'building') return true;
    // 建物でない multipolygon (森林など) は対象外。
    return r.tags.type === 'multipolygon' && !!r.tags.building;
  });
  if (!relation) return null;

  const relationType = relation.tags.type;
  // 役割名は relation の種別で変わる。外形と内訳を同じ 2 つの数に集約する。
  const outlineRole = (relationType === 'multipolygon') ? 'outer' : 'outline';
  const partRole = (relationType === 'multipolygon') ? 'inner' : 'part';

  let outlineCount = 0;
  let partCount = 0;
  for (const m of relation.members || []) {
    if (m.role === outlineRole) outlineCount++;
    else if (m.role === partRole) partCount++;
  }
  return { relation, outlineCount, partCount, relationType };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test:unit`
Expected: 追加した 3 件が PASS。既存のテストも全件 PASS。

- [ ] **Step 5: 文言を足す**

`data/core.yaml` の `multi_section_building_info` の直後に追加する。
インデントは前後の行に合わせる（`    ` 4 スペース）。

```yaml
    courtyard_building_info:
      one: This way is part of a building with {n} courtyard.
      other: This way is part of a building with {n} courtyards.
```

`option_accept_entire_building` の下に、multipolygon 用の説明を足す。

```yaml
    option_accept_entire_courtyard_building:
      label: Add Entire Building
      description: This way is part of a building with a courtyard. The tags live on the relation, so the outline, every courtyard ring, and the relation are added together. Adding a single ring on its own would produce an untagged way.
      tooltip: Add the whole building, including its courtyards, to the map.
```

- [ ] **Step 6: インスペクタの選択肢を切り替える**

`modules/ui/UiRapidInspector.js` の `renderChoices` で、
`acceptLabelStringID` / `acceptReferenceStringID` を決めている箇所を差し替える。

```javascript
    const buildingInfo = this._getBuildingRelationInfo();
    const isCourtyard = buildingInfo?.relationType === 'multipolygon';
    let acceptLabelStringID = 'rapid_inspector.option_accept.label';
    let acceptReferenceStringID = 'rapid_inspector.option_accept.description';
    if (isCourtyard) {
      acceptLabelStringID = 'rapid_inspector.option_accept_entire_courtyard_building.label';
      acceptReferenceStringID = 'rapid_inspector.option_accept_entire_courtyard_building.description';
    } else if (buildingInfo) {
      acceptLabelStringID = 'rapid_inspector.option_accept_entire_building.label';
      acceptReferenceStringID = 'rapid_inspector.option_accept_entire_building.description';
    }
```

「この feature だけ追加」を出す条件を差し替える。

```javascript
    // Phase 4-C: relation member 時は「この feature だけ追加」 (cascade なし) を追加。
    // ただし multipolygon では出さない。メンバー way はタグを持たないので、
    // 1 本だけ追加すると必ずタグの無い way になる。
    if (buildingInfo && !isCourtyard) {
```

情報行の文言を差し替える。

```javascript
    const $multiInfo = $choices.selectAll('.rapid-inspector-multi-section-building-info');
    if (buildingInfo) {
      const partCount = buildingInfo.partCount;
      const infoStringID = isCourtyard
        ? 'rapid_inspector.courtyard_building_info'
        : 'rapid_inspector.multi_section_building_info';
      $multiInfo
        .style('display', null)
        .text(l10n.t(infoStringID, { n: partCount }));
    } else {
```

- [ ] **Step 7: 全テストを実行する**

Run: `npm run test:unit`
Expected: 失敗なし

Run: `npm run build:bundle:modern:dev && npm run test:browser`
Expected: 失敗なし

- [ ] **Step 8: コミット**

```bash
git add modules/util/building_relation.js modules/ui/UiRapidInspector.js data/core.yaml test/unit/util/building_relation.test.js
git commit -m "feat(plateau): treat courtyard buildings as one unit in the inspector"
```

---

### Task 3: 穴のある建物を 1 つのポリゴンとして描く

**Files:**
- Modify: `modules/pixi/PixiLayerRapid.js:345-351`（Plateau の描画対象の絞り込み）
- Modify: `modules/index.js:25-26` の並びに 1 行追加（テストから参照するため）
- Test: `test/browser/pixi/PixiLayerRapid.test.js`（新規）

**テストから参照できるようにする。**
`PixiLayerRapid` はどこからも export されていない。
このフォークは Pixi レイヤをテストするために `modules/index.js` で個別に export しており
（`PixiLayerPlateauCoverage` と `PixiLayerHeightTransfer` の 2 行がある）、同じ形で 1 行足す。

```javascript
export { PixiLayerRapid } from './pixi/PixiLayerRapid.js';
```

**Interfaces:**
- Consumes: `utilBuildingRelationInfo` は使わない。描画は relation のタグを直接見る。
- Produces: `type=multipolygon` かつ `building` タグを持つ relation が `data.polygons` に入る。
- Produces: その relation のメンバー way は `data.polygons` に入らない。

`osmRelation.geometry()` は `isMultipolygon()`（`tags.type === 'multipolygon'`）のとき `'area'` を返し、
`PixiFeaturePolygon` は `rings`（外側に続けて穴）を既に描ける。
新しい描画機構は要らない。

- [ ] **Step 1: 失敗するテストを書く**

`test/browser/pixi/PixiLayerRapid.test.js` を新規作成する。

このタスクの検証は描画対象の選別なので、`renderPolygons` の描画結果ではなく
**`data.polygons` に何が入るか**を確かめる。そのため絞り込みロジックを
`PixiLayerRapid._plateauRenderables` に切り出し、テストからそれを呼ぶ。

`scene` のモックは `test/browser/pixi/PixiLayerPlateauCoverage.test.js` の `makeScene` と同じ形で足りる。
`_plateauRenderables` は `scene` を使わないので、コンストラクタを通せればよい。

```javascript
describe('PixiLayerRapid', () => {
  function makeScene() {
    const gfx = {
      scene: null,
      deferredRedraw() {},
      immediateRedraw() {}
    };
    const context = { services: {}, systems: { gfx: gfx } };
    const scene = { gfx: gfx, context: context, groups: new Map([['basemap', null]]) };
    gfx.scene = scene;
    return scene;
  }

  describe('#_plateauRenderables', () => {
    function makeWay(graph, id, coords, tags) {
      let g = graph;
      const nodeIds = [];
      for (let i = 0; i < coords.length; i++) {
        const nodeId = id + '-n' + i;
        nodeIds.push(nodeId);
        g = g.replace(Rapid.osmNode({ id: nodeId, loc: coords[i] }));
      }
      nodeIds.push(nodeIds[0]);
      const way = Rapid.osmWay({ id, nodes: nodeIds, tags: tags || {} });
      g = g.replace(way);
      return { graph: g, way };
    }

    function makeCourtyard(graph) {
      let g = graph;
      const o = makeWay(g, 'w_outer', [[0,0], [1,0], [1,1], [0,1]]);
      g = o.graph;
      const i = makeWay(g, 'w_inner', [[0.4,0.4], [0.6,0.4], [0.6,0.6], [0.4,0.6]]);
      g = i.graph;
      const relation = Rapid.osmRelation({
        id: 'r_mp',
        tags: { type: 'multipolygon', building: 'yes' },
        members: [
          { id: 'w_outer', type: 'way', role: 'outer' },
          { id: 'w_inner', type: 'way', role: 'inner' }
        ]
      });
      g = g.replace(relation);
      return { graph: g, outer: o.way, inner: i.way, relation };
    }

    it('renders a courtyard relation as one polygon', () => {
      const mp = makeCourtyard(new Rapid.Graph());
      const layer = new Rapid.PixiLayerRapid(makeScene(), 'rapid');
      const out = layer._plateauRenderables(
        [mp.outer, mp.inner, mp.relation], mp.graph
      );
      const ids = out.polygons.map(e => e.id);
      expect(ids).to.include('r_mp');
    });

    it('does not also render the member ways of a courtyard relation', () => {
      const mp = makeCourtyard(new Rapid.Graph());
      const layer = new Rapid.PixiLayerRapid(makeScene(), 'rapid');
      const out = layer._plateauRenderables(
        [mp.outer, mp.inner, mp.relation], mp.graph
      );
      const ids = out.polygons.map(e => e.id);
      expect(ids).to.not.include('w_outer', 'outer が二重に描かれる');
      expect(ids).to.not.include('w_inner', 'inner が単独で描かれる');
    });

    it('still renders a plain building way', () => {
      let g = new Rapid.Graph();
      const b = makeWay(g, 'w_plain', [[10,10], [11,10], [11,11], [10,11]], { building: 'yes' });
      g = b.graph;
      const layer = new Rapid.PixiLayerRapid(makeScene(), 'rapid');
      const out = layer._plateauRenderables([b.way], g);
      expect(out.polygons.map(e => e.id)).to.include('w_plain');
    });

    it('does not render a type=building relation, only its member ways', () => {
      // type=building は outline と parts を個別に描く現在の方式を変えない。
      let g = new Rapid.Graph();
      const o = makeWay(g, 'w_outline', [[20,20], [21,20], [21,21], [20,21]], { building: 'yes' });
      g = o.graph;
      const p = makeWay(g, 'w_part', [[20.2,20.2], [20.8,20.2], [20.8,20.8], [20.2,20.8]], { 'building:part': 'yes' });
      g = p.graph;
      const rel = Rapid.osmRelation({
        id: 'r_b',
        tags: { type: 'building', building: 'yes' },
        members: [
          { id: 'w_outline', type: 'way', role: 'outline' },
          { id: 'w_part', type: 'way', role: 'part' }
        ]
      });
      g = g.replace(rel);
      const layer = new Rapid.PixiLayerRapid(makeScene(), 'rapid');
      const out = layer._plateauRenderables([o.way, p.way, rel], g);
      const ids = out.polygons.map(e => e.id);
      expect(ids).to.include('w_outline');
      expect(ids).to.include('w_part');
      expect(ids).to.not.include('r_b');
    });
  });
});
```

- [ ] **Step 2: テストが落ちることを確認する**

Run: `npm run build:bundle:modern:dev && npm run test:browser`
Expected: `_plateauRenderables` が存在しないので 4 件すべて FAIL。

- [ ] **Step 3: 絞り込みを私有メソッドに切り出す**

`modules/pixi/PixiLayerRapid.js` の Plateau 分岐にある次の 2 行を、

```javascript
      const entities = service.getData(datasetID)
        .filter(entity => entity.type === 'way' && !isAcceptedOrIgnored(entity));

      data.polygons = entities.filter(d => d.geometry(dsGraph) === 'area');
```

次に差し替える。

```javascript
      const renderables = this._plateauRenderables(
        service.getData(datasetID), dsGraph, isAcceptedOrIgnored
      );
      data.polygons = renderables.polygons;
```

`isAcceptedOrIgnored` は同じスコープの局所関数なので、第 3 引数で渡す。

- [ ] **Step 4: 絞り込みを実装する**

`PixiLayerRapid` にメソッドを足す。`renderPolygons` の直前に置く。

```javascript
  /**
   * _plateauRenderables
   * Plateau の entity 群から、描画するポリゴンを選ぶ。
   *
   * 中庭のある建物は `type=multipolygon` の relation で届く。外形が role='outer'、
   * 穴が role='inner' で、タグは relation にだけ付く。`osmRelation.geometry()` は
   * multipolygon に対して 'area' を返し、`PixiFeaturePolygon` は外側に続く穴を
   * 既に描けるので、relation をそのまま積めば穴が穴として描かれる。
   *
   * そのメンバー way は積まない。積むと外形が二重に描かれ、穴の上にも塗りが乗る。
   *
   * `type=building` は従来どおり outline と parts を個別に積む。穴とは別の構造なので、
   * 描画方式は変えない。
   *
   * @param   {Array}  entities  service.getData() の戻り値
   * @param   {Graph}  dsGraph   データセットのグラフ
   * @return  {{polygons: Array}}
   */
  _plateauRenderables(entities, dsGraph, isAcceptedOrIgnored) {
    const skip = isAcceptedOrIgnored || (() => false);

    // 先に「relation として描く」対象を決め、そのメンバー way を除外集合に入れる。
    const memberWayIDs = new Set();
    const relations = [];
    for (const entity of entities) {
      if (entity.type !== 'relation') continue;
      if (entity.tags?.type !== 'multipolygon' || !entity.tags?.building) continue;
      if (skip(entity)) continue;
      relations.push(entity);
      for (const m of entity.members ?? []) {
        if (m.type === 'way') memberWayIDs.add(m.id);
      }
    }

    const polygons = [];
    for (const relation of relations) {
      if (relation.geometry(dsGraph) === 'area') polygons.push(relation);
    }
    for (const entity of entities) {
      if (entity.type !== 'way') continue;
      if (memberWayIDs.has(entity.id)) continue;
      if (skip(entity)) continue;
      if (entity.geometry(dsGraph) === 'area') polygons.push(entity);
    }
    return { polygons };
  }
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `npm run build:bundle:modern:dev && npm run test:browser`
Expected: 追加した 4 件が PASS。既存のテストも全件 PASS。

- [ ] **Step 6: 二重描画の除外が効いていることを確かめる**

`if (memberWayIDs.has(entity.id)) continue;` を一時的に消し、
`does not also render the member ways of a courtyard relation` が落ちることを確認してから戻す。
戻したあと `git diff` が想定どおりであることを確認する。

- [ ] **Step 7: unit テストも回す**

Run: `npm run test:unit`
Expected: 失敗なし

- [ ] **Step 8: コミット**

```bash
git add modules/pixi/PixiLayerRapid.js test/browser/pixi/PixiLayerRapid.test.js
git commit -m "fix(plateau): draw courtyard buildings with their holes"
```
