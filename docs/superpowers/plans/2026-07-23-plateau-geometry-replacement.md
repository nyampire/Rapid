# PLATEAU Geometry Replacement (#5, Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OSM 建物の外形を Plateau 外形で置換し、OSM way の id/履歴を保ったまま更新できるようにする（第 1 弾は単純な閉じた building way のみ、プレビュー→確定 UX）。

**Architecture:** 既存のタグ転記モード (`HeightTransferMode` / `HeightTransferMatcher` / `PixiLayerHeightTransfer` / `uiSectionPlateauTags`) の兄弟機能として実装する。新規 graph action がノードを Plateau 座標で再構築し、Matcher が共有ノードガードで「置換可能」候補だけを通し、Mode がプレビュー状態と確定/取消を持ち、section にボタン、Pixi layer にゴーストプレビューを足す。

**Tech Stack:** JavaScript (ESM), Rapid graph model (`osmWay`/`osmNode`/`Graph`), Pixi.js, mocha/chai + karma (browser tests).

## Global Constraints

- スコープ: 単純な閉じた `building` way のみ。1 対 1 マッチ、面積比 0.5〜2.0、共有ノード無し。`AREA_MISMATCH` / `ratio<0.5` / relation・building:part メンバーは対象外（spec 参照）。
- タグマージ: **OSM 優先/非破壊**。OSM に既存値があるキーは保持、空のキーのみ Plateau から補完。
- 履歴保持: 既存 OSM way の id を保持し、ノードのみ差し替える。undo/redo は `editor.commit` の annotation 経由で追跡（タグ転記と同じ流儀）。
- Plateau 由来の内部メタタグ (`conn` `dupe` `orig_id` `debug_way_id` `import`) は置換後 way に残さない。
- コミットに `Co-Authored-By` 行は付けない（このリポジトリの慣習）。
- action/matcher の export 追加先: `modules/actions/index.js`（action）、`modules/core/lib/index.js`（matcher）。
- spec: `docs/superpowers/specs/2026-07-23-plateau-geometry-replacement-design.ja.md`

---

### Task 1: action `actionReplaceBuildingGeometry`

Plateau 外形で OSM way のノードを再構築し、タグを非破壊マージ、孤立した旧ノードを削除する純粋な graph action。

**Files:**
- Create: `modules/actions/replace_building_geometry.js`
- Modify: `modules/actions/index.js:39`（`actionTransferPlateauTags` の隣に export を追加）
- Test: `test/browser/actions/replace_building_geometry.test.js`

**Interfaces:**
- Produces: `actionReplaceBuildingGeometry(osmWayID, plateauWay, plateauGraph)` — 関数を返し、`(graph) => graph` で適用。返り値関数に `.actionName === 'replace_building_geometry'`。`plateauWay` は `{ id, nodes:[nodeID...], tags:{} }`、`plateauGraph` は `plateauWay` のノードを `graph.entity(id).loc` で解決できる `Graph`。タグは action 内で `osmWay.tags` に対し非破壊マージ（`plateauWay.tags` を補完、内部メタ除去）。

- [ ] **Step 1: Write the failing test**

`test/browser/actions/replace_building_geometry.test.js`:

```javascript
describe('actionReplaceBuildingGeometry', () => {
  // Build a closed square way + its nodes in a real Graph.
  function building(prefix, coords, tags) {
    const nodes = coords.map((loc, i) => Rapid.osmNode({ id: `${prefix}n${i}`, loc }));
    const nodeIDs = nodes.map(n => n.id);
    nodeIDs.push(nodes[0].id);                 // close the ring by ref
    const way = Rapid.osmWay({ id: `${prefix}w`, tags, nodes: nodeIDs });
    return { nodes, way, entities: [...nodes, way] };
  }
  const OSM_SQR = [[139.755, 35.679], [139.756, 35.679], [139.756, 35.680], [139.755, 35.680]];
  // Plateau outline: same footprint nudged, distinct corner coords
  const PL_SQR  = [[139.7551, 35.6791], [139.7561, 35.6791], [139.7561, 35.6801], [139.7551, 35.6801]];

  it('keeps the OSM way id and replaces its node coords with the Plateau outline', () => {
    const osm = building('o', OSM_SQR, { building: 'yes' });
    const pl  = building('p', PL_SQR,  { building: 'yes', height: '12' });
    const osmGraph = new Rapid.Graph(osm.entities);
    const plateauGraph = new Rapid.Graph(pl.entities);

    const g2 = Rapid.actionReplaceBuildingGeometry('ow', pl.way, plateauGraph)(osmGraph);

    const w = g2.entity('ow');                 // same id preserved
    const locs = w.nodes.map(nid => g2.entity(nid).loc);
    // first 4 distinct corners equal the Plateau corners, ring closed
    expect(locs.slice(0, 4)).to.eql(PL_SQR);
    expect(locs[locs.length - 1]).to.eql(locs[0]);
  });

  it('merges Plateau tags non-destructively (OSM wins, empty keys filled)', () => {
    const osm = building('o', OSM_SQR, { building: 'house', height: '10' });
    const pl  = building('p', PL_SQR,  { building: 'yes', height: '12', 'building:levels': '3' });
    const g2 = Rapid.actionReplaceBuildingGeometry('ow', pl.way, new Rapid.Graph(pl.entities))(new Rapid.Graph(osm.entities));
    expect(g2.entity('ow').tags).to.eql({ building: 'house', height: '10', 'building:levels': '3' });
  });

  it('strips Plateau-internal metadata tags', () => {
    const osm = building('o', OSM_SQR, { building: 'yes' });
    const pl  = building('p', PL_SQR,  { building: 'yes', height: '12', conn: 'x', dupe: 'y', orig_id: '1' });
    const g2 = Rapid.actionReplaceBuildingGeometry('ow', pl.way, new Rapid.Graph(pl.entities))(new Rapid.Graph(osm.entities));
    const t = g2.entity('ow').tags;
    expect(t.conn).to.be.undefined;
    expect(t.dupe).to.be.undefined;
    expect(t.orig_id).to.be.undefined;
    expect(t.height).to.eql('12');
  });

  it('removes old OSM nodes that become orphaned', () => {
    const osm = building('o', OSM_SQR, { building: 'yes' });
    const g2 = Rapid.actionReplaceBuildingGeometry('ow', building('p', PL_SQR, { building: 'yes' }).way,
      new Rapid.Graph(building('p', PL_SQR, { building: 'yes' }).entities))(new Rapid.Graph(osm.entities));
    expect(g2.hasEntity('on0')).to.be.false;   // old corner gone
  });

  it('keeps an old node still used by another way', () => {
    const osm = building('o', OSM_SQR, { building: 'yes' });
    // a second way reuses OSM corner on0
    const other = Rapid.osmWay({ id: 'ow2', tags: { barrier: 'fence' }, nodes: ['on0', 'on1'] });
    const graph = new Rapid.Graph([...osm.entities, other]);
    const pl = building('p', PL_SQR, { building: 'yes' });
    const g2 = Rapid.actionReplaceBuildingGeometry('ow', pl.way, new Rapid.Graph(pl.entities))(graph);
    expect(g2.hasEntity('on0')).to.be.true;    // still referenced by ow2
  });

  it('marks the returned action with actionName', () => {
    const action = Rapid.actionReplaceBuildingGeometry('ow', { id: 'pw', nodes: [], tags: {} }, new Rapid.Graph([]));
    expect(action.actionName).to.eql('replace_building_geometry');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx karma start karma.conf.cjs --single-run 2>&1 | grep -i replaceBuildingGeometry`
Expected: FAIL — `Rapid.actionReplaceBuildingGeometry is not a function`.

- [ ] **Step 3: Write minimal implementation**

`modules/actions/replace_building_geometry.js`:

```javascript
import { osmNode } from '../osm/index.js';

// Plateau-internal metadata that must never reach OSM.
const INTERNAL_TAGS = new Set(['conn', 'dupe', 'orig_id', 'debug_way_id', 'import']);

// Replace an OSM building way's geometry with a Plateau outline while keeping
// the OSM way's id (and therefore its version/history). Tags are merged
// non-destructively: existing OSM values win, empty keys are filled from Plateau.
export function actionReplaceBuildingGeometry(osmWayID, plateauWay, plateauGraph) {
  const action = function(graph) {
    const osmWay = graph.entity(osmWayID);

    // 1. Build new nodes at the Plateau outline coords. Reuse one new node per
    //    Plateau node id, so a closing first==last ref closes the new ring too.
    let g = graph;
    const idMap = new Map();   // plateauNodeID -> new osmNode
    const newNodeIDs = [];
    for (const pid of plateauWay.nodes) {
      let nn = idMap.get(pid);
      if (!nn) {
        const loc = plateauGraph.entity(pid).loc;
        nn = osmNode({ loc });
        idMap.set(pid, nn);
        g = g.replace(nn);
      }
      newNodeIDs.push(nn.id);
    }

    // 2. Non-destructive tag merge (OSM wins).
    const merged = { ...osmWay.tags };
    for (const [k, v] of Object.entries(plateauWay.tags ?? {})) {
      if (INTERNAL_TAGS.has(k)) continue;
      if (merged[k] === undefined || merged[k] === null || merged[k] === '') merged[k] = v;
    }

    // 3. Replace the way in place (id/version kept by `update`).
    const oldNodeIDs = osmWay.nodes.slice();
    g = g.replace(osmWay.update({ nodes: newNodeIDs, tags: merged }));

    // 4. Drop old nodes that are now orphaned (no way/relation references them).
    for (const oid of new Set(oldNodeIDs)) {
      if (!g.hasEntity(oid)) continue;
      const node = g.entity(oid);
      if (g.parentWays(node).length === 0 && g.parentRelations(node).length === 0) {
        g = g.remove(node);
      }
    }

    return g;
  };

  action.actionName = 'replace_building_geometry';
  return action;
}
```

`modules/actions/index.js`（39 行目付近、`actionTransferPlateauTags` の export の隣に）:

```javascript
export { actionReplaceBuildingGeometry } from './replace_building_geometry.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx karma start karma.conf.cjs --single-run 2>&1 | grep -iE "replaceBuildingGeometry|SUCCESS|FAILED"`
Expected: PASS（6 テスト green）。

- [ ] **Step 5: Commit**

```bash
git add modules/actions/replace_building_geometry.js modules/actions/index.js test/browser/actions/replace_building_geometry.test.js
git commit -m "feat(plateau): add replace_building_geometry action (#5)"
```

---

### Task 2: Matcher に置換候補ガード（共有ノード）

置換可能な候補だけに `replaceable` フラグを立てる。`AREA_MISMATCH` と、隣接 building/building:part とノードを共有する building は `replaceable=false`。あわせて候補が確定時に使う `plateauGraph` を candidate に載せる。

**Files:**
- Modify: `modules/core/lib/HeightTransferMatcher.js`（`findCandidates` に判定を追加）
- Test: `test/browser/core/lib/HeightTransferMatcher.test.js`（`describe('findCandidates with real entities')` に追記）

**Interfaces:**
- Consumes: `findCandidates({ ..., osmGraph, plateauGraph })`（既存シグネチャ）。
- Produces: 各 candidate に `replaceable: boolean` と `plateauGraph`（呼び出し時の値）を追加。既存フィールド（`state`/`missingTags` 等）は不変。

- [ ] **Step 1: Write the failing test**

`test/browser/core/lib/HeightTransferMatcher.test.js` の `describe('findCandidates with real entities', ...)` 内に追記（`realBuilding` ヘルパーは既存）:

```javascript
    it('marks an isolated building replaceable', () => {
      const p = realBuilding('p', SQR_CORNERS, { building: 'yes', area: 'yes', height: '12' });
      p.way.representativePoint = SQR_CENTER;
      const o = realBuilding('o', SQR_CORNERS, { building: 'yes', area: 'yes' });
      const out = Rapid.findCandidates({
        plateauEntities: [p.way], osmEntities: [o.way],
        plateauGraph: new Rapid.Graph(p.entities), osmGraph: new Rapid.Graph(o.entities),
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.have.lengthOf(1);
      expect(out[0].replaceable).to.be.true;
    });

    it('marks a building sharing a node with another building NOT replaceable', () => {
      const p = realBuilding('p', SQR_CORNERS, { building: 'yes', area: 'yes', height: '12' });
      p.way.representativePoint = SQR_CENTER;
      const o = realBuilding('o', SQR_CORNERS, { building: 'yes', area: 'yes' });
      // neighbour building reuses OSM corner `on0`
      const neigh = Rapid.osmWay({ id: 'nw', tags: { building: 'yes' }, nodes: ['on0', 'on1'] });
      const osmGraph = new Rapid.Graph([...o.entities, neigh]);
      const out = Rapid.findCandidates({
        plateauEntities: [p.way], osmEntities: [o.way],
        plateauGraph: new Rapid.Graph(p.entities), osmGraph,
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.have.lengthOf(1);
      expect(out[0].replaceable).to.be.false;
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx karma start karma.conf.cjs --single-run 2>&1 | grep -iE "replaceable|FAILED"`
Expected: FAIL — `expected undefined to be true`.

- [ ] **Step 3: Write minimal implementation**

`modules/core/lib/HeightTransferMatcher.js`。`findCandidates` の関数本体末尾近く、`candidates.push({...})` を組み立てる直前にヘルパーとフラグを追加する。

まずファイル上部（`findCandidates` の外、`analyzeTagStates` の下あたり）にヘルパーを追加:

```javascript
// A building whose node is shared with another building/part cannot have its
// geometry replaced without deforming the neighbour. Guard Phase 1 against it.
function isReplaceable(osmWay, osmGraph, state) {
  if (state === 'AREA_MISMATCH') return false;
  if (!osmGraph?.hasEntity || !osmGraph.parentWays) return true;   // mock/no-graph fallback
  for (const nid of osmWay.nodes ?? []) {
    const node = osmGraph.hasEntity(nid);
    if (!node) continue;
    for (const parent of osmGraph.parentWays(node)) {
      if (parent.id !== osmWay.id && (parent.tags?.building || parent.tags?.['building:part'])) {
        return false;
      }
    }
  }
  return true;
}
```

`candidates.push({ ... })` に 2 フィールドを追加:

```javascript
    candidates.push({
      plateauFeature: outline,
      osmFeature: osm,
      kind: 'outline_to_building',
      state,
      missingTags: tagStates.missing,
      conflictingTags: tagStates.conflicting,
      matchingTags: tagStates.matching,
      ratio,
      replaceable: isReplaceable(osm, osmGraph, state),   // NEW
      plateauGraph                                        // NEW (for confirmReplace)
    });
```

（`plateauGraph` は `findCandidates` の引数にある。`osm` は `osmGraph` で resolve 済みの OSM way。）

- [ ] **Step 4: Run test to verify it passes**

Run: `npx karma start karma.conf.cjs --single-run 2>&1 | grep -iE "replaceable|SUCCESS|FAILED"`
Expected: PASS。既存 `findCandidates` テスト（osmGraph 無しの mock）も fallback で green のまま。

- [ ] **Step 5: Commit**

```bash
git add modules/core/lib/HeightTransferMatcher.js test/browser/core/lib/HeightTransferMatcher.test.js
git commit -m "feat(plateau): flag replaceable candidates with shared-node guard (#5)"
```

---

### Task 3: Mode に preview/confirm/cancel

`HeightTransferMode` に置換プレビュー状態と 3 メソッドを足す。確定は `editor.perform`+`commit`+annotation で undo/redo に統合し、置換済み Plateau id を history から再導出する。

**Files:**
- Modify: `modules/modes/HeightTransferMode.js`
- Test: `test/browser/modes/HeightTransferMode.test.js`（既存 `MockEditor` を使用）

**Interfaces:**
- Consumes: `actionReplaceBuildingGeometry`（Task 1）、candidate の `replaceable`/`plateauGraph`（Task 2）。
- Produces: `heightTransfer.replacePreview`（`MatchCandidate|null`）、`previewReplace(candidate)`、`confirmReplace()`、`cancelReplace()`。annotation type `'replace_building_geometry'` を `_recomputeTransferredIDs` が拾う。

- [ ] **Step 1: Write the failing test**

`test/browser/modes/HeightTransferMode.test.js` に追記（既存 `MockEditor` と mode 構築ヘルパーに倣う。candidate は最小 stub でよい）:

```javascript
  it('previewReplace sets replacePreview; cancelReplace clears it', () => {
    const mode = makeActiveMode();               // 既存ヘルパー（activate 済み mode を返す）
    const cand = { osmFeature: { id: 'w1' }, plateauFeature: { id: 'p1', nodes: [], tags: {} },
                   plateauGraph: {}, replaceable: true };
    mode.previewReplace(cand);
    expect(mode.replacePreview).to.equal(cand);
    mode.cancelReplace();
    expect(mode.replacePreview).to.equal(null);
  });

  it('confirmReplace performs+commits a replace action and records the plateauID in history', () => {
    const mode = makeActiveMode();
    const editor = mode.context.systems.editor;  // the MockEditor
    const cand = { osmFeature: { id: 'w1' }, plateauFeature: { id: 'p1', nodes: [], tags: {} },
                   plateauGraph: {}, replaceable: true };
    mode.previewReplace(cand);
    mode.confirmReplace();
    expect(editor.performCalls).to.have.lengthOf(1);
    expect(editor.performCalls[0].actionName).to.equal('replace_building_geometry');
    expect(editor.commitCalls[0].annotation).to.eql({
      type: 'replace_building_geometry', entityID: 'w1', plateauID: 'p1'
    });
    expect(mode.replacePreview).to.equal(null);
  });
```

（`makeActiveMode` が既存に無ければ、既存テストの mode 構築コードをそのまま関数に括り出す。`MockEditor` は `performCalls`/`commitCalls` を既に公開している。）

- [ ] **Step 2: Run test to verify it fails**

Run: `npx karma start karma.conf.cjs --single-run 2>&1 | grep -iE "replacePreview|confirmReplace|FAILED"`
Expected: FAIL — `mode.previewReplace is not a function`。

- [ ] **Step 3: Write minimal implementation**

`modules/modes/HeightTransferMode.js`。import を追加:

```javascript
import { actionReplaceBuildingGeometry } from '../actions/replace_building_geometry.js';
```

constructor に状態を追加（`this.transferredIDs = new Set();` の近く）:

```javascript
    this.replacePreview = null;   // MatchCandidate currently previewed for geometry replace, or null
```

メソッドを追加（`apply()` の下あたり）:

```javascript
  /** previewReplace — enter geometry-replace preview for a candidate. */
  previewReplace(candidate) {
    if (!this.active || !candidate?.replaceable) return;
    this.replacePreview = candidate;
    this.emit('change');
    this.context.systems.gfx?.immediateRedraw?.();
  }

  /** cancelReplace — leave preview without changing the graph. */
  cancelReplace() {
    if (!this.replacePreview) return;
    this.replacePreview = null;
    this.emit('change');
    this.context.systems.gfx?.immediateRedraw?.();
  }

  /** confirmReplace — apply the previewed geometry replacement as an undoable edit. */
  confirmReplace() {
    const cand = this.replacePreview;
    if (!cand) return;
    const editor = this.context.systems.editor;
    if (!editor) return;

    const action = actionReplaceBuildingGeometry(cand.osmFeature.id, cand.plateauFeature, cand.plateauGraph);
    editor.perform(action);
    editor.commit({
      annotation: {
        type: action.actionName,
        entityID: cand.osmFeature.id,
        plateauID: cand.plateauFeature.id
      },
      selectedIDs: [ cand.osmFeature.id ]
    });

    this.replacePreview = null;
    this.emit('replaced', cand);
  }
```

`_recomputeTransferredIDs` の annotation 判定を、置換も拾うよう広げる:

```javascript
      if ((annotation?.type === 'transfer_plateau_tags' || annotation?.type === 'replace_building_geometry')
          && annotation.plateauID) {
        next.add(annotation.plateauID);
      }
```

`deactivate()` と `_refreshApplyShortcut()`（modechange で呼ばれる）にプレビュー自動解除を追加。`deactivate()` の `this.candidates = [];` の隣:

```javascript
    this.replacePreview = null;
```

`_refreshApplyShortcut()` の冒頭（選択が変わったらゴーストを残さない）:

```javascript
    if (this.replacePreview && !(this.context.selectedIDs?.() ?? []).includes(this.replacePreview.osmFeature?.id)) {
      this.replacePreview = null;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx karma start karma.conf.cjs --single-run 2>&1 | grep -iE "replacePreview|confirmReplace|SUCCESS|FAILED"`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add modules/modes/HeightTransferMode.js test/browser/modes/HeightTransferMode.test.js
git commit -m "feat(plateau): height-transfer mode preview/confirm/cancel replace (#5)"
```

---

### Task 4: section に「形状を置換」ボタン + プレビュー UI

`uiSectionPlateauTags` に、候補が `replaceable` のとき「形状を置換」ボタンを出す。押下でプレビューへ。プレビュー中は「確定/キャンセル」ボタンと、置換で入るタグ（非破壊マージで補完される分）を列挙する。

**Files:**
- Modify: `modules/ui/sections/plateau_tags.js`
- Test: `test/browser/ui/sections/plateau_tags.test.js`（既存があればパターンに従う。無ければ Task 6 の手動 E2E で担保し本タスクは実装のみ）

**Interfaces:**
- Consumes: `heightTransfer.getCandidateForOSM`、`candidate.replaceable`、`heightTransfer.replacePreview`、`previewReplace`/`confirmReplace`/`cancelReplace`（Task 3）。
- Produces: セクション内の追加 UI。新しい l10n キー（Task 6 で定義）を参照。

- [ ] **Step 1: 実装（renderContent の末尾に追記）**

`renderContent(selection)` の中、既存のタグ Apply ブロックの後に、置換 UI を追加する。`heightTransfer` は既に取得済み（`const heightTransfer = context.systems.heightTransfer;`）。

```javascript
    // --- geometry replace ---
    const inPreview = heightTransfer.replacePreview && heightTransfer.replacePreview.osmFeature?.id === cand.osmFeature?.id;

    if (!cand.replaceable && !inPreview) {
      // building shares nodes with a neighbour, or is AREA_MISMATCH: no replace here
    } else if (!inPreview) {
      $panel.append('div')
        .attr('class', 'plateau-tags-actions')
        .append('button')
        .attr('class', 'plateau-replace')
        .text(l10n.t('height_transfer.replace_geometry'))
        .on('click', () => heightTransfer.previewReplace(cand));
    } else {
      // preview mode: list tags that will be filled, then confirm/cancel
      const fillKeys = Object.keys(cand.plateauFeature?.tags ?? {}).filter(k => {
        const ov = cand.osmFeature?.tags?.[k];
        return (ov === undefined || ov === null || ov === '')
          && !['conn', 'dupe', 'orig_id', 'debug_way_id', 'import'].includes(k);
      });
      $panel.append('p')
        .attr('class', 'plateau-tags-note')
        .text(l10n.t('height_transfer.replace_preview_note'));
      if (fillKeys.length) {
        $panel.append('p').attr('class', 'plateau-tags-note')
          .text(l10n.t('height_transfer.additions'));
        const $list = $panel.append('ul').attr('class', 'tag-list plateau-additions');
        for (const key of fillKeys) {
          const $inner = $list.append('li').attr('class', 'tag-row readonly').append('div').attr('class', 'inner-wrap');
          $inner.append('div').attr('class', 'key-wrap').append('input')
            .attr('type', 'text').attr('class', 'key').attr('readonly', true).property('value', key);
          $inner.append('div').attr('class', 'value-wrap').append('input')
            .attr('type', 'text').attr('class', 'value').attr('readonly', true)
            .property('value', cand.plateauFeature.tags[key]);
        }
      }
      const $actions = $panel.append('div').attr('class', 'plateau-tags-actions');
      $actions.append('button').attr('class', 'plateau-replace-confirm')
        .text(l10n.t('height_transfer.replace_confirm'))
        .on('click', () => heightTransfer.confirmReplace());
      $actions.append('button').attr('class', 'plateau-replace-cancel')
        .text(l10n.t('height_transfer.replace_cancel'))
        .on('click', () => heightTransfer.cancelReplace());
    }
```

セクションはすでに `heightTransfer` の `'change'` 購読で再描画されるので（`_onChange = () => section.reRender()`）、preview/confirm/cancel が `emit('change')` するたびに UI が更新される。追加購読は不要。

- [ ] **Step 2: 動作確認（Task 6 の手動 E2E で担保）**

ユニットで DOM を検証できる既存パターンがあれば「replaceable のときボタンが出る／preview 中に確定・取消が出る」を 2 ケース追加。無ければ Task 6 の手動 E2E に委ねる。

- [ ] **Step 3: Commit**

```bash
git add modules/ui/sections/plateau_tags.js
git commit -m "feat(plateau): replace-geometry button + preview UI in tags section (#5)"
```

---

### Task 5: Pixi layer にゴーストプレビュー描画

`PixiLayerHeightTransfer` に、`heightTransfer.replacePreview` があるとき置換後の外形（Plateau outline）を破線ゴーストで、対象 OSM building をハイライトで描く。

**Files:**
- Modify: `modules/pixi/PixiLayerHeightTransfer.js`
- Test: `test/browser/pixi/PixiLayerHeightTransfer.test.js`（既存パターンに従う）

**Interfaces:**
- Consumes: `heightTransfer.replacePreview`（candidate。`plateauFeature`/`plateauGraph`/`osmFeature`）。
- Produces: 追加描画のみ。既存の候補ドット描画は不変。

- [ ] **Step 1: 実装（既存 render に分岐を追加）**

このレイヤの既存 `render(frame, viewport, zoom)`（候補ドットを描く）に倣い、`heightTransfer.replacePreview` があれば置換後外形を描く分岐を足す。既存のジオメトリ→スクリーン変換ユーティリティ（このファイルが既にドット描画で使っているもの）を再利用する。実装方針:

- `const cand = this.context.systems.heightTransfer?.replacePreview;`
- あれば `cand.plateauFeature.asGeoJSON(cand.plateauGraph)` の座標列を viewport で投影し、`PIXI.Graphics` で破線ポリゴン（ゴースト、半透明の塗り + 破線ストローク）を描く。
- `cand.osmFeature` の外形をハイライト色でストロークする。
- コンテナは既存のドット用コンテナとは別の子コンテナ（`this._previewContainer`）に入れ、preview が無いフレームでは `removeChildren()`＋各 child `.destroy()` して GPU リークを避ける。

具体コードは既存 `PixiLayerHeightTransfer.js` のドット描画（`PIXI.Graphics` の生成・`viewport` 投影・`immediateRedraw` 連携）と同じ API を用いる。実装者はまず既存 `render()` を読み、同じ投影ユーティリティで polygon を stroke するだけでよい。

- [ ] **Step 2: 動作確認（Task 6 の手動 E2E で担保）**

`PixiLayerHeightTransfer.test.js` に、`replacePreview` セット時に preview コンテナが child を持ち、null 時に空になる、を 1 ケース追加（既存テストの stage 構築に従う）。描画の見た目は手動 E2E。

- [ ] **Step 3: Commit**

```bash
git add modules/pixi/PixiLayerHeightTransfer.js test/browser/pixi/PixiLayerHeightTransfer.test.js
git commit -m "feat(plateau): ghost preview of replacement geometry (#5)"
```

---

### Task 6: l10n キー + 手動 E2E（実 Chrome）

**Files:**
- Modify: `data/core.yaml`（英語ソース。`core.en.json` は生成物なので直接編集しない）
- Modify: `data/core.ja.json`（日本語文言。既存の `height_transfer` セクションに追記）

**Interfaces:** 追加 l10n キー — `height_transfer.replace_geometry` / `.replace_confirm` / `.replace_cancel` / `.replace_preview_note`。

- [ ] **Step 1: 英語キーを追加**

`data/core.yaml` の `height_transfer:` セクションに:

```yaml
    replace_geometry: Replace shape with Plateau
    replace_confirm: Confirm replacement
    replace_cancel: Cancel
    replace_preview_note: Preview of the new shape. Existing tags are kept; empty ones are filled from Plateau.
```

- [ ] **Step 2: 日本語キーを追加**

`data/core.ja.json` の `height_transfer` オブジェクトに:

```json
    "replace_geometry": "形状をPlateauで置換",
    "replace_confirm": "置換を確定",
    "replace_cancel": "キャンセル",
    "replace_preview_note": "置換後の形状のプレビューです。既存タグは保持し、空のタグのみPlateauから補完します。"
```

- [ ] **Step 3: ビルドしてバンドルに反映**

Run: `npm run build`
Expected: エラーなし。`dist/data/l10n/` に新キーが出る（`build:data` が走る）。

- [ ] **Step 4: 手動 E2E（実 foreground Chrome、ハードリロード）**

preview pane は OSM データを読めない（background-tab の requestIdleCallback が発火しない）ので、実 Chrome で確認する:

1. `npm run start` → 実 Chrome で `http://127.0.0.1:8080/`、対応エリアにズーム、ハードリロード。
2. 単純な building（隣接と角を共有していないもの）を選択 → タグセクションに「形状をPlateauで置換」ボタンが出る。
3. ボタン押下 → ゴーストで置換後外形が出て、対象 building がハイライトされる。「置換を確定/キャンセル」が出る。
4. 「確定」→ OSM way の形が Plateau 外形に変わり、空きタグが補完される。way の id は変わらない（Inspector で確認）。
5. Ctrl+Z で元に戻る／Ctrl+Shift+Z でやり直せる。
6. 隣接建物と角を共有している building では、置換ボタンが出ない（共有ノードガード）。
7. 別の building を選び直すとゴーストが消える。

- [ ] **Step 5: Commit**

```bash
git add data/core.yaml data/core.ja.json
git commit -m "i18n(plateau): strings for geometry replacement (#5)"
```

---

## 実装後（PR 前）

- `npm run test:browser` 全 green を確認。
- デプロイは **`npm run build && npm run dist`** の順（`dist` 単独では `dist/data/l10n` が再生成されず文言が古いまま出る）。rsync は `--exclude '/dashboard/'` 必須、事前にドライランで削除 0 件を確認。
- PR は `--repo nyampire/Rapid` を明示（fork のデフォルトが upstream を指すため）。

## 将来フェーズ（本プランの対象外）

spec の「将来フェーズ」節参照 — relation 建物の一括置換（outline + building:part を relation 単位で差し替え）。依存の鎖: api#33 → 本プラン（単純 building）→ relation 一括置換。
