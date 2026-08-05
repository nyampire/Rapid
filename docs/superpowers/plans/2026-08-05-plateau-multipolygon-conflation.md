# conflation を type=multipolygon に対応させる 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `type=multipolygon` の relation を conflation の意味単位として扱い、外形が既存 OSM 建物と重なるときは relation とメンバー way をまとめて隠す。

**Architecture:** `_filterPlateauOverlaps` の Phase 4-A の仕組み（外形 way の判定を relation のメンバー全員に適用する）を `type=multipolygon` にも広げる。判定の根拠は relation 自身の決定に置き、一覧に含まれるメンバーの数を数えない。

**Tech Stack:** JavaScript (ESM), Karma + Mocha + Chai, Polyclip

## Global Constraints

- `type=multipolygon` は外形を役割 `outer` で持ち、`type=building` は `outline` で持つ。両方を外形として受け付ける。
- `inner` メンバーは単独で重なり判定にかけない。外形の判定に従う。
- relation を隠すのは、その relation 自身の判定が `true`（重なる）のときだけ。`false` と `null` では隠さない。
- **一覧に残っているメンバーの数を数えて判定しない。** `getData` は `ds.tree.intersects(extent, ds.graph)` の結果に filter をかけるため、渡ってくるのは表示範囲で切り取った空間のスライスである。メンバーが一覧に無いことと reject されたことは別で、数える方式にするとパンした瞬間に建物が消える。
- 追跡対象でない relation（`type=route` など）は従来どおり素通しする。そのメンバー way も個別判定のままにする。
- `_checkWayOverlapsOsmBuildings` の判定ロジックは変えない。判定の精度そのものは本計画の対象外。
- relation のジオメトリ（穴を除いた実面積）で重なりを判定しない。外形メンバー way の形で判定する現在の方式を踏襲する。
- `inner` が外形からはみ出している場合の妥当性検査はしない。conflation は外形だけを見る。
- 形状置換機能（#5、`feature/plateau-geometry-replacement`）には触れない。未マージで独立している。
- 変更するのは `modules/services/PlateauService.js` と `test/browser/services/PlateauService.test.js` のみ。
- spec: `docs/superpowers/specs/2026-08-05-plateau-multipolygon-conflation-design.ja.md`

## テストの実行

```bash
npm run test:browser
```

Karma がブラウザを起動して全ブラウザテストを走らせる。個別ファイルだけを走らせる仕組みは無いので、
反復中も全体を回す。所要は 1 分程度。

---

### Task 1: multipolygon を conflation の意味単位として扱う

**Files:**
- Modify: `modules/services/PlateauService.js:500-516`（relation マップの構築）
- Test: `test/browser/services/PlateauService.test.js`

**Interfaces:**
- Produces: `wayToBuildingRelation` が `type=multipolygon` のメンバー way も含む
- Produces: `buildingRelationOutline` が役割 `outline` と `outer` の両方を外形として記録する
- 本タスクでは relation 自身の扱いを変えない。relation は従来どおり素通しする（Task 2 で変える）。

- [ ] **Step 1: 失敗するテストを書く**

`test/browser/services/PlateauService.test.js` の `#_filterPlateauOverlaps` ブロック内、
`non-building relation members are evaluated per-way` の後ろに追加する。
ヘルパーは同ブロック内の `makeBuilding` / `makePlateauWay` を使う。

```javascript
    // type=multipolygon: 中庭のある建物。outer が外形、inner が穴。
    // タグは relation にだけ付き、メンバー way はタグを持たない。
    // ----------------------------------------------------------------------

    function makeMultipolygon(plateauGraph, relId, outerId, innerIds, outerCoords, innerCoordsArr) {
      let g = plateauGraph;
      const outRes = makePlateauWay(g, outerId, outerCoords);
      g = outRes.graph;
      const inners = [];
      for (let i = 0; i < innerIds.length; i++) {
        const iRes = makePlateauWay(g, innerIds[i], innerCoordsArr[i]);
        g = iRes.graph;
        inners.push(iRes.way);
      }
      const members = [{ id: outRes.way.id, type: 'way', role: 'outer' }];
      for (const inner of inners) members.push({ id: inner.id, type: 'way', role: 'inner' });
      const relation = Rapid.osmRelation({
        id: relId,
        tags: { type: 'multipolygon', building: 'yes' },
        members: members,
      });
      g = g.replace(relation);
      return { graph: g, outer: outRes.way, inners, relation };
    }

    it('rejects outer and inner together when the outer overlaps an OSM building', () => {
      let osmGraph = new Rapid.Graph();
      const osmRes = makeBuilding(osmGraph, 'osmB1', [[0,0], [1,0], [1,1], [0,1]]);
      _service.context.systems.editor._graph = osmRes.graph;
      _service.context.systems.editor._entities = [osmRes.way];

      let plateauGraph = new Rapid.Graph();
      const mp = makeMultipolygon(
        plateauGraph, 'r_mp1', 'pOuter1', ['pInner1'],
        [[0.5,0.5], [1.5,0.5], [1.5,1.5], [0.5,1.5]],   // outer が OSM と重なる
        [[[1.2,1.2], [1.4,1.2], [1.4,1.4], [1.2,1.4]]], // inner は OSM の bbox 外
      );
      plateauGraph = mp.graph;

      const entities = [mp.outer, mp.inners[0], mp.relation];
      const result = _service._filterPlateauOverlaps(entities, plateauGraph);

      const wayIds = result.filter(e => e.type === 'way').map(e => e.id);
      expect(wayIds).to.have.lengthOf(0, 'outer と inner はまとめて隠れる');
    });

    it('keeps outer and inner together when the outer does not overlap', () => {
      let osmGraph = new Rapid.Graph();
      const osmRes = makeBuilding(osmGraph, 'osmB1', [[0,0], [1,0], [1,1], [0,1]]);
      _service.context.systems.editor._graph = osmRes.graph;
      _service.context.systems.editor._entities = [osmRes.way];

      let plateauGraph = new Rapid.Graph();
      const mp = makeMultipolygon(
        plateauGraph, 'r_mp2', 'pOuter2', ['pInner2'],
        [[10,10], [11,10], [11,11], [10,11]],
        [[[10.4,10.4], [10.6,10.4], [10.6,10.6], [10.4,10.6]]],
      );
      plateauGraph = mp.graph;

      const entities = [mp.outer, mp.inners[0], mp.relation];
      const result = _service._filterPlateauOverlaps(entities, plateauGraph);

      const wayIds = result.filter(e => e.type === 'way').map(e => e.id);
      expect(wayIds).to.include('pOuter2');
      expect(wayIds).to.include('pInner2');
    });

    it('does not judge an inner ring on its own', () => {
      // inner だけを OSM 建物に重ねる。個別判定なら inner が reject される配置。
      // outer は OSM から離れているので、意味単位で扱えば inner も残る。
      //
      // ジオメトリとしては inner が outer の外に出るが、conflation は外形だけを
      // 見るので判定には影響しない。outer が OSM 建物を含む配置にすると outer 自身も
      // 重なり判定に引っかかり、このテストの主張が検証できなくなる。
      let osmGraph = new Rapid.Graph();
      const osmRes = makeBuilding(osmGraph, 'osmB2', [[20.4,20.4], [20.6,20.4], [20.6,20.6], [20.4,20.6]]);
      _service.context.systems.editor._graph = osmRes.graph;
      _service.context.systems.editor._entities = [osmRes.way];

      let plateauGraph = new Rapid.Graph();
      const mp = makeMultipolygon(
        plateauGraph, 'r_mp3', 'pOuter3', ['pInner3'],
        [[30,30], [31,30], [31,31], [30,31]],             // outer は OSM から離す
        [[[20.4,20.4], [20.6,20.4], [20.6,20.6], [20.4,20.6]]],  // inner は OSM に重なる
      );
      plateauGraph = mp.graph;

      const entities = [mp.outer, mp.inners[0], mp.relation];
      const result = _service._filterPlateauOverlaps(entities, plateauGraph);

      const wayIds = result.filter(e => e.type === 'way').map(e => e.id);
      expect(wayIds).to.include('pInner3', 'inner が単独で判定されている');
    });
```

- [ ] **Step 2: テストが落ちることを確認する**

Run: `npm run test:browser`
Expected: 3 件のうち `rejects outer and inner together...` と `does not judge an inner ring on its own` が FAIL。
`keeps outer and inner together...` は PASS（もともと誰も reject しないため）。

- [ ] **Step 3: relation マップの構築を広げる**

`modules/services/PlateauService.js` の `wayToBuildingRelation` を組み立てるループを差し替える。

```javascript
    // way_id → building relation のマップ + relation_id → 外形 way_id を記録
    //
    // 対象は 2 種類ある。
    // type=building は PLATEAU LOD2 の outline + parts で、外形の役割は 'outline'。
    // type=multipolygon は中庭のある建物で、外形の役割は 'outer'、穴が 'inner'。
    // どちらも「1 棟の建物」なので、外形の判定にメンバー全員が従う。
    //
    // multipolygon のメンバー way はタグを持たないため、個別に判定すると穴が
    // 単独の建物として扱われる。ここでまとめて拾うことでその経路を塞ぐ。
    const wayToBuildingRelation = new Map();
    const buildingRelationOutline = new Map();
    for (const e of entities) {
      if (e.type !== 'relation') continue;
      const relType = e.tags?.type;
      if (relType !== 'building' && relType !== 'multipolygon') continue;
      let outlineWayId;
      for (const m of e.members ?? []) {
        if (m.type !== 'way') continue;
        if (!wayToBuildingRelation.has(m.id)) {
          wayToBuildingRelation.set(m.id, e);
        }
        if ((m.role === 'outline' || m.role === 'outer') && outlineWayId === undefined) {
          outlineWayId = m.id;
        }
      }
      buildingRelationOutline.set(e.id, outlineWayId);
    }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test:browser`
Expected: 追加した 3 件が PASS。既存のテストも全件 PASS。

- [ ] **Step 5: 意味単位の扱いが本当に効いていることを確かめる**

`relType !== 'building' && relType !== 'multipolygon'` を一時的に `relType !== 'building'` に戻し、
`does not judge an inner ring on its own` が落ちることを確認してから戻す。
戻したあと `git diff` が想定どおりであることを確認する。

- [ ] **Step 6: コミット**

```bash
git add modules/services/PlateauService.js test/browser/services/PlateauService.test.js
git commit -m "fix(plateau): treat type=multipolygon as one conflation unit"
```

---

### Task 2: メンバーが隠れる relation は relation 自身も隠す

**Files:**
- Modify: `modules/services/PlateauService.js:540-546`（filter の relation 分岐）
- Test: `test/browser/services/PlateauService.test.js`（既存 1 件の期待値修正を含む）

**Interfaces:**
- Consumes: `buildingRelationOutline`（relation id → 外形 way id。Task 1 で `outline` と `outer` の両方を拾うようになっている。追跡対象でない relation はキーごと存在しない）
- Consumes: `evalRelationOverlap(relation)`（`true` / `false` / `null` を返す。結果は `relationOverlapDecision` にメモ化される）
- Consumes: テストヘルパー `makeMultipolygon(plateauGraph, relId, outerId, innerIds, outerCoords, innerCoordsArr)`。Task 1 が `test/browser/services/PlateauService.test.js` の `#_filterPlateauOverlaps` ブロックに追加済みで、`{ graph, outer, inners, relation }` を返す。
- Produces: 追跡対象の relation は、自身の判定が `true` のとき filter から落ちる。`false` と `null` では残る。
- Produces: 追跡対象でない relation（`type=route` など）は従来どおり素通しする。

- [ ] **Step 1: 失敗するテストを書く**

Task 1 で追加したテストの後ろに追加する。

```javascript
    it('drops a multipolygon relation when its outer overlaps', () => {
      let osmGraph = new Rapid.Graph();
      const osmRes = makeBuilding(osmGraph, 'osmB1', [[0,0], [1,0], [1,1], [0,1]]);
      _service.context.systems.editor._graph = osmRes.graph;
      _service.context.systems.editor._entities = [osmRes.way];

      let plateauGraph = new Rapid.Graph();
      const mp = makeMultipolygon(
        plateauGraph, 'r_mp4', 'pOuter4', ['pInner4'],
        [[0.5,0.5], [1.5,0.5], [1.5,1.5], [0.5,1.5]],
        [[[1.2,1.2], [1.4,1.2], [1.4,1.4], [1.2,1.4]]],
      );
      plateauGraph = mp.graph;

      const result = _service._filterPlateauOverlaps(
        [mp.outer, mp.inners[0], mp.relation], plateauGraph
      );
      expect(result.filter(e => e.type === 'relation')).to.have.lengthOf(0);
    });

    it('keeps a multipolygon relation when its outer does not overlap', () => {
      let osmGraph = new Rapid.Graph();
      const osmRes = makeBuilding(osmGraph, 'osmB1', [[0,0], [1,0], [1,1], [0,1]]);
      _service.context.systems.editor._graph = osmRes.graph;
      _service.context.systems.editor._entities = [osmRes.way];

      let plateauGraph = new Rapid.Graph();
      const mp = makeMultipolygon(
        plateauGraph, 'r_mp5', 'pOuter5', ['pInner5'],
        [[10,10], [11,10], [11,11], [10,11]],
        [[[10.4,10.4], [10.6,10.4], [10.6,10.6], [10.4,10.6]]],
      );
      plateauGraph = mp.graph;

      const result = _service._filterPlateauOverlaps(
        [mp.outer, mp.inners[0], mp.relation], plateauGraph
      );
      expect(result.filter(e => e.type === 'relation')).to.have.lengthOf(1);
    });

    it('keeps a relation whose outer way is not in the graph', () => {
      // 判定できない (null) ときは隠さない。way 側のフォールバックと同じ。
      let osmGraph = new Rapid.Graph();
      const osmRes = makeBuilding(osmGraph, 'osmB1', [[0,0], [1,0], [1,1], [0,1]]);
      _service.context.systems.editor._graph = osmRes.graph;
      _service.context.systems.editor._entities = [osmRes.way];

      const relation = Rapid.osmRelation({
        id: 'r_mp_missing',
        tags: { type: 'multipolygon', building: 'yes' },
        members: [{ id: 'pOuterMissing', type: 'way', role: 'outer' }],
      });
      const g = new Rapid.Graph().replace(relation);

      const result = _service._filterPlateauOverlaps([relation], g);
      expect(result.filter(e => e.type === 'relation')).to.have.lengthOf(1);
    });

    it('keeps a non-building relation regardless of its members', () => {
      let osmGraph = new Rapid.Graph();
      const osmRes = makeBuilding(osmGraph, 'osmB1', [[0,0], [1,0], [1,1], [0,1]]);
      _service.context.systems.editor._graph = osmRes.graph;
      _service.context.systems.editor._entities = [osmRes.way];

      let g = new Rapid.Graph();
      const w1 = makePlateauWay(g, 'pRouteWay2', [[0.5,0.5], [1.5,0.5], [1.5,1.5], [0.5,1.5]]);
      g = w1.graph;
      const routeRel = Rapid.osmRelation({
        id: 'r_route2',
        tags: { type: 'route', route: 'bus' },
        members: [{ id: w1.way.id, type: 'way', role: '' }],
      });
      g = g.replace(routeRel);

      const result = _service._filterPlateauOverlaps([w1.way, routeRel], g);
      expect(result.filter(e => e.type === 'relation')).to.have.lengthOf(1);
      expect(result.filter(e => e.type === 'way')).to.have.lengthOf(0);
    });
```

- [ ] **Step 2: 既存テストの期待値を直す**

`rejects all relation members when outline overlaps OSM building` は、
relation が残ることを固定している。この挙動を変えるので期待値を直す。

```javascript
      // outline + parts は relation のおかげで一括 reject される
      const wayResults = result.filter(e => e.type === 'way');
      expect(wayResults).to.have.lengthOf(0);
      // relation 自身も隠す。メンバーが全部消えた relation を残さない。
      const relResults = result.filter(e => e.type === 'relation');
      expect(relResults).to.have.lengthOf(0);
```

`falls back to per-way check when relation has no outline member` は、
外形メンバーが無いので判定が `null` になり relation は残る。期待値の変更は要らない。

- [ ] **Step 3: テストが落ちることを確認する**

Run: `npm run test:browser`
Expected: `drops a multipolygon relation when its outer overlaps` と、
Step 2 で直した `rejects all relation members...` が FAIL。他の 3 件は PASS。

- [ ] **Step 4: filter の relation 分岐を差し替える**

`modules/services/PlateauService.js` の filter 冒頭を差し替える。

```javascript
    return entities.filter(entity => {
      if (entity.type === 'node') return true;

      if (entity.type === 'relation') {
        // 追跡対象でない relation (type=route など) は素通しする。
        if (!buildingRelationOutline.has(entity.id)) return true;
        // メンバーが隠れる relation は relation 自身も隠す。
        // 判定できない (null) ときは隠さない。way 側のフォールバックと同じ。
        //
        // 一覧に残っているメンバーを数えないこと。getData は表示範囲で切り取った
        // スライスに filter をかけるので、範囲外のメンバーは単に一覧に含まれない。
        // 数える方式にすると、パンして relation が範囲の端にかかった時点で
        // 「メンバー 0 件」と見えて、OSM に無い建物まで消える。
        return evalRelationOverlap(entity) !== true;
      }

      if (entity.type !== 'way') return true;
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `npm run test:browser`
Expected: 追加した 4 件と直した 1 件が PASS。既存のテストも全件 PASS。

- [ ] **Step 6: 数える方式にしていないことを確かめる**

`return evalRelationOverlap(entity) !== true;` を、
一覧に残るメンバー数を数える書き方に一時的に置き換える。

```javascript
        const survivors = entities.filter(e =>
          e.type === 'way' && (entity.members ?? []).some(m => m.id === e.id)
        );
        return survivors.length > 0;
```

`keeps a relation whose outer way is not in the graph` が落ちることを確認してから戻す。
この配置では relation だけを渡していてメンバー way が一覧に無いため、数える方式では 0 件と見えて落ちる。
これが「範囲外のメンバーを reject と取り違える」失敗の最小形である。

戻したあと `git diff` が想定どおりであることを確認する。

- [ ] **Step 7: コミット**

```bash
git add modules/services/PlateauService.js test/browser/services/PlateauService.test.js
git commit -m "fix(plateau): hide the relation when its building is already mapped"
```
