# 中庭建物のインスペクタを relation の datum に対応させる 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** relation を選んでいるときも中庭建物だと分かるようにし、用意済みのインスペクタ分岐が実際に働くようにする。

**Architecture:** `utilBuildingRelationInfo` が relation の entity も受け付けるようにする。way なら「属する建物 relation」、relation なら「その relation 自身」を返す。あわせて、relation を選んでいるときの情報行の文言を分ける。

**Tech Stack:** JavaScript (ESM), node:test（unit）, Karma（browser）

## Global Constraints

- 判定条件は変えない。`type=building`、または `building` タグを持つ `type=multipolygon` だけを建物として扱う。
- 返り値の形は変えない。`{ relation, outlineCount, partCount, relationType }`。
- way を渡したときの返り値を変えない。
- `type=building` の文言・選択肢・カウントを変えない。
- `modules/services/PlateauService.js` を変更しない。兄弟 highlight は中庭建物では光らせる相手が居ないので対象外。
- 描画を変えない。メンバー way を描画対象に戻さない。
- `isCourtyard` を `partCount` に依存させない。「Add Only This」の抑制という安全側の判定を担うため。
- spec: `docs/superpowers/specs/2026-08-05-courtyard-inspector-relation-datum-design.ja.md`

## テストの実行

```bash
node --test-reporter dot --test "test/unit/**/*.test.js"   # npm run test:unit は c8 が Node v26 で壊れて起動しない
npm run build:bundle:modern:dev && npm run test:browser    # Karma は dist/rapid.js を読む
```

`detect.test.js` に既存の失敗が 3 件ある。今回の変更とは無関係。
browser の baseline は 745 completed / 5 skipped / 0 failed。
ビルド成果物はコミットしない。

---

### Task 1: `utilBuildingRelationInfo` が relation も受け付ける

**Files:**
- Modify: `modules/util/building_relation.js`（全面。52 行の小さなファイル）
- Test: `test/unit/util/building_relation.test.js`

**Interfaces:**
- Produces: entity が relation のとき、その relation 自身の情報を返す。判定条件と返り値の形は way のときと同じ。
- Produces: way のときの挙動は変わらない。

- [ ] **Step 1: 失敗するテストを書く**

`test/unit/util/building_relation.test.js` の末尾に追加する。

```javascript
  it('accepts a multipolygon relation itself, not only its member ways', () => {
    // 中庭建物は relation 単位で描画されるので、インスペクタが受け取る datum は
    // relation になる。way が来ないので、relation を直接渡せる必要がある。
    const outer = Rapid.osmWay({ id: 'w_outer', nodes: [] });
    const inner = Rapid.osmWay({ id: 'w_inner', nodes: [] });
    const relation = Rapid.osmRelation({
      id: 'r_mp',
      tags: { type: 'multipolygon', building: 'yes' },
      members: [
        { id: 'w_outer', type: 'way', role: 'outer' },
        { id: 'w_inner', type: 'way', role: 'inner' }
      ]
    });
    const graph = new Rapid.Graph([outer, inner, relation]);

    const info = Rapid.utilBuildingRelationInfo(relation, graph);
    assert.ok(info, 'relation 自身が受け付けられていない');
    assert.equal(info.relation.id, 'r_mp');
    assert.equal(info.relationType, 'multipolygon');
    assert.equal(info.outlineCount, 1);
    assert.equal(info.partCount, 1);
  });

  it('accepts a type=building relation itself', () => {
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

    const info = Rapid.utilBuildingRelationInfo(relation, graph);
    assert.ok(info);
    assert.equal(info.relationType, 'building');
    assert.equal(info.outlineCount, 1);
    assert.equal(info.partCount, 1);
  });

  it('returns null for a relation that is not a building', () => {
    const outer = Rapid.osmWay({ id: 'w_outer', nodes: [] });
    const relation = Rapid.osmRelation({
      id: 'r_forest',
      tags: { type: 'multipolygon', landuse: 'forest' },
      members: [{ id: 'w_outer', type: 'way', role: 'outer' }]
    });
    const graph = new Rapid.Graph([outer, relation]);

    assert.equal(Rapid.utilBuildingRelationInfo(relation, graph), null);
  });

  it('returns null for a route relation', () => {
    const way = Rapid.osmWay({ id: 'w1', nodes: [] });
    const relation = Rapid.osmRelation({
      id: 'r_route',
      tags: { type: 'route', route: 'bus' },
      members: [{ id: 'w1', type: 'way', role: '' }]
    });
    const graph = new Rapid.Graph([way, relation]);

    assert.equal(Rapid.utilBuildingRelationInfo(relation, graph), null);
  });

  it('does not need parentRelations when a relation is passed', () => {
    // relation 自身を渡すときは親をたどらないので、graph が
    // parentRelations を持たなくても答えられる。
    const relation = Rapid.osmRelation({
      id: 'r_mp2',
      tags: { type: 'multipolygon', building: 'yes' },
      members: [{ id: 'w_outer', type: 'way', role: 'outer' }]
    });

    const info = Rapid.utilBuildingRelationInfo(relation, {});
    assert.ok(info, 'graph に依存しない経路になっていない');
    assert.equal(info.outlineCount, 1);
    assert.equal(info.partCount, 0);
  });
```

- [ ] **Step 2: テストが落ちることを確認する**

Run: `node --test-reporter dot --test test/unit/util/building_relation.test.js`
Expected: `accepts a multipolygon relation itself...`、`accepts a type=building relation itself`、
`does not need parentRelations when a relation is passed` が FAIL（先頭の `entity.type !== 'way'` で null）。
`returns null for a relation that is not a building` と `returns null for a route relation` は PASS。

- [ ] **Step 3: relation を受け付ける**

`modules/util/building_relation.js` を差し替える。

```javascript
/**
 * utilBuildingRelationInfo
 *
 * 指定 entity が「1 棟の建物」に属するとき、その relation 情報を返す。それ以外は null。
 *
 * way を渡すと、その way が属する建物 relation を返す。
 * relation を渡すと、その relation 自身について同じ形の情報を返す。
 * 中庭建物は relation 単位で描画されるため、インスペクタが受け取る datum は relation になる。
 * メンバー way は描かれず hover も select もできないので、way からの経路だけでは届かない。
 *
 * 対象は 2 種類ある。
 * type=building は Simple 3D Buildings / PLATEAU LOD2 の構造で、外形が役割 outline、
 * 内訳が part。メンバー way はそれぞれ自分のタグを持つ。
 * type=multipolygon は中庭のある建物で、外形が outer、穴が inner。
 * **タグは relation にだけ付き、メンバー way はタグを持たない。**
 *
 * UiRapidInspector や conflation ロジックから、UI 表示 / 動作判定の両方で使用。
 *
 * @param  {Object|null}  entity - osmEntity (way または relation)
 * @param  {Graph|null}   graph  - 該当 entity の含まれる Graph (parentRelations を提供)。
 *                                 relation を渡す場合は参照しない。
 * @return {{relation: osmRelation, outlineCount: number, partCount: number,
 *           relationType: string} | null}
 */
export function utilBuildingRelationInfo(entity, graph) {
  if (!entity) return null;

  const relation = (entity.type === 'relation')
    ? (isBuildingRelation(entity) ? entity : null)
    : findParentBuildingRelation(entity, graph);
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


/**
 * 「1 棟の建物」を表す relation かどうか。
 * 建物でない multipolygon (森林など) は対象外にする。
 */
function isBuildingRelation(r) {
  if (!r || !r.tags) return false;
  if (r.tags.type === 'building') return true;
  return r.tags.type === 'multipolygon' && !!r.tags.building;
}


/**
 * way が属する建物 relation を探す。
 */
function findParentBuildingRelation(entity, graph) {
  if (entity.type !== 'way') return null;
  if (!graph || typeof graph.parentRelations !== 'function') return null;

  let parents;
  try {
    parents = graph.parentRelations(entity);
  } catch (e) {
    return null;
  }
  return parents.find(isBuildingRelation) || null;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test-reporter dot --test test/unit/util/building_relation.test.js`
Expected: 既存のテストを含めて全件 PASS

- [ ] **Step 5: relation の経路が本当に効いていることを確かめる**

`entity.type === 'relation'` の分岐を一時的に `false` に置き換え、
`accepts a multipolygon relation itself, not only its member ways` が落ちることを確認してから戻す。
戻したあと `git diff` が想定どおりであることを確認する。

- [ ] **Step 6: 全テストを実行する**

Run: `node --test-reporter dot --test "test/unit/**/*.test.js"`
Expected: `detect.test.js` の既存 3 件以外に失敗が無い

Run: `npm run build:bundle:modern:dev && npm run test:browser`
Expected: 745 completed / 5 skipped / 0 failed

- [ ] **Step 7: コミット**

```bash
git add modules/util/building_relation.js test/unit/util/building_relation.test.js
git commit -m "feat(plateau): let building relation info accept the relation itself"
```

---

### Task 2: relation を選んでいるときの情報行を分ける

**Files:**
- Modify: `data/core.yaml`（`courtyard_building_info` の直後に 1 キー追加）
- Modify: `modules/ui/UiRapidInspector.js:516-536`（情報行の文言選択）
- Test: なし（`UiRapidInspector` にテストは無い。理由は下記）

**Interfaces:**
- Consumes: Task 1 が relation の datum で `buildingInfo` を返すようになったこと
- Produces: datum が relation のとき、情報行が「一部です」ではなく建物そのものを指す文言になる

**このタスクにテストは無い。**
`UiRapidInspector` は d3 の DOM 構築に密結合していて、リポジトリ全体でテストが 1 件も無い。
Task 1 で `relationType` と datum 種別の判定を unit テストに固定してあるので、
ここで残るのは文言の選択だけである。目視で確認する。

- [ ] **Step 1: 文言を足す**

`data/core.yaml` の `courtyard_building_info` の直後に追加する。
インデントは前後の行に合わせる（キーは 4 スペース、その下は 6 スペース）。

```yaml
    courtyard_building_selected_info:
      one: This building has {n} courtyard.
      other: This building has {n} courtyards.
```

- [ ] **Step 2: 情報行の文言選択を差し替える**

`modules/ui/UiRapidInspector.js` の `$multiInfo` を組み立てる箇所で、
`infoStringID` を決めている部分を差し替える。

```javascript
      // datum が relation なら建物そのものを選んでいる。way なら建物の一部を選んでいる。
      // 中庭建物は relation 単位で描画されるので、実際に来るのは relation のほうである。
      const isRelationDatum = this.datum?.type === 'relation';
      let infoStringID = 'rapid_inspector.multi_section_building_info';
      if (isCourtyard) {
        infoStringID = isRelationDatum
          ? 'rapid_inspector.courtyard_building_selected_info'
          : 'rapid_inspector.courtyard_building_info';
      }
```

`$multiInfo.text(l10n.t(infoStringID, { n: partCount }))` はそのまま使う。

- [ ] **Step 3: 全テストを実行する**

Run: `node --test-reporter dot --test "test/unit/**/*.test.js"`
Expected: `detect.test.js` の既存 3 件以外に失敗が無い

Run: `npm run build:bundle:modern:dev && npm run test:browser`
Expected: 745 completed / 5 skipped / 0 failed

- [ ] **Step 4: 文言の選択を目視で確認する**

次の 3 つの経路について、`renderChoices` を読んで確認する。
確認した内容を報告に書く。

| datum | `isCourtyard` | 出る文言 |
|---|---|---|
| `type=multipolygon` の relation | true | `courtyard_building_selected_info`（「この建物には中庭が N 個あります」） |
| `type=building` の way | false | `multi_section_building_info`（従来どおり） |
| 建物 relation に属さない way | — | `buildingInfo` が null なので情報行を隠す（従来どおり） |

あわせて、`type=multipolygon` の relation で
「Add Entire Building」が出て「Add Only This」が出ないことを、
`acceptLabelStringID` の分岐と `if (buildingInfo && !isCourtyard)` のガードから確認する。

- [ ] **Step 5: コミット**

```bash
git add data/core.yaml modules/ui/UiRapidInspector.js
git commit -m "feat(plateau): word the courtyard info line for a selected relation"
```
