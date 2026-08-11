# 中庭のある建物を高さ転記の対象にする 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `type=multipolygon` の中庭建物を高さ転記の候補にし、面積比を外側リングで測る。あわせて未マージの形状置換ブランチを、中庭建物の候補が来ても壊れない状態にする。

**Architecture:** `HeightTransferMatcher.findCandidates` の絞り込みを relation にも広げ、PLATEAU 側の面積を外側リングだけで測る補助関数を足す。形状置換ブランチには `isReplaceable` に PLATEAU 側の条件を足す防御コミットを 1 本入れる。

**Tech Stack:** JavaScript (ESM), Karma + Mocha + Chai（browser）, node:test（unit）, @turf/area

## Global Constraints

- 候補にするのは `type=multipolygon` かつ `building` タグを持つ relation。建物でない multipolygon は対象外。
- `!f.tags['building:part']` の条件は残す。
- **PLATEAU 側の面積は外側リングだけで測る。**OSM 側は単純な way で総面積なので、同種どうしの比較にする。
- **単純な way の面積比を変えない。**リング 1 本なので外側リングの面積は全体の面積と等しい。本番データの大半がこの経路である。
- outer が複数ある multipolygon で、黙って 1 本目だけを測らない。
- 面積比の閾値 `AREA_RATIO_MIN = 0.5` と `AREA_RATIO_MAX = 2.0` は変えない。
- `analyzeTagStates`、`booleanPointInPolygon` の使い方、`PixiLayerHeightTransfer`、`transferredIDs` の記録は変えない。調査でいずれも relation でそのまま動くことを確認済み。
- OSM 側の `f.type === 'way'` は変えない。OSM が multipolygon で描かれた建物を転記先にするのは対象外。
- `type=building` の LOD2 外形 way の挙動を変えない。
- spec: `docs/superpowers/specs/2026-08-06-courtyard-height-transfer-design.ja.md`

## テストの実行

```bash
npm run build:bundle:modern:dev && npm run test:browser   # Karma は dist/rapid.js を読む
node --test-reporter dot --test "test/unit/**/*.test.js"  # npm run test:unit は c8 が Node v26 で起動しない
```

browser の baseline は 745 completed / 5 skipped / 0 failed。
unit は `detect.test.js` に既存の失敗がある。今回の変更とは無関係。
ビルド成果物はコミットしない。

## GeoJSON の形が 2 通りある

`osmWay.asGeoJSON` は素のジオメトリ `{ type: 'Polygon', coordinates }` を返す。
`osmRelation.asGeoJSON` も素の `{ type: 'MultiPolygon', coordinates }` を返す。

一方、`test/browser/core/lib/HeightTransferMatcher.test.js` の既存モックは
`{ type: 'Feature', geometry: {...}, properties: {} }` を返す。

turf はどちらも受け付けるが、**自分で `coordinates` を読む補助関数は両方に対応する必要がある。**

---

### Task 1: 中庭建物を候補にし、面積を外側リングで測る

**Files:**
- Modify: `modules/core/lib/HeightTransferMatcher.js`（絞り込みと面積計算）
- Test: `test/browser/core/lib/HeightTransferMatcher.test.js`

**Interfaces:**
- Produces: `outerRingArea(geo)` — PLATEAU 側の面積を外側リングだけで測る内部関数。エクスポートしない。
- Produces: `findCandidates` が `type=multipolygon` + `building` の relation も候補にする。
- 単純な way に対する結果は変わらない。

- [ ] **Step 1: 失敗するテストを書く**

`test/browser/core/lib/HeightTransferMatcher.test.js` の `describe('findCandidates', ...)` の中、
既存のヘルパー定義の後ろに追加する。

```javascript
    // 中庭のある建物。asGeoJSON は MultiPolygon を返し、タグは relation にだけ付く。
    // outerCoords が外側リング、holeCoords が穴。
    function courtyard(id, outerCoords, holeCoords, tags, rp) {
      return { id, type: 'relation',
               tags: { type: 'multipolygon', building: 'yes', ...tags },
               representativePoint: rp,
               asGeoJSON: () => ({ type: 'MultiPolygon',
                                   coordinates: [[outerCoords, holeCoords]] }) };
    }

    // SQR の内側に収まる、一辺がおよそ 8 割の穴。面積比でおよそ 0.36 になる。
    const HOLE = [[139.7551, 35.6791], [139.75590, 35.6791],
                  [139.75590, 35.67990], [139.7551, 35.67990], [139.7551, 35.6791]];

    it('accepts a type=multipolygon building relation as a candidate', () => {
      const p = courtyard('r1', SQR, HOLE, { height: '12' }, SQR_CENTER);
      const o = osmBuilding('o1', SQR);
      const out = Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.have.lengthOf(1, '中庭建物が候補になっていない');
      expect(out[0].state).to.equal('CANDIDATE');
      expect(out[0].missingTags).to.eql(['height']);
    });

    it('measures the courtyard building by its outer ring, not its net area', () => {
      // 穴を差し引くと比は 0.5 を割り、AREA_RATIO_MIN で落ちる。
      // 外側リングで測れば OSM と同じ形なので比は 1 になる。
      const p = courtyard('r2', SQR, HOLE, { height: '12' }, SQR_CENTER);
      const o = osmBuilding('o2', SQR);
      const out = Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.have.lengthOf(1, '正味面積で測って落ちている');
      expect(out[0].ratio).to.be.closeTo(1, 0.05);
    });

    it('ignores a multipolygon that is not a building', () => {
      const forest = { id: 'r3', type: 'relation',
                       tags: { type: 'multipolygon', landuse: 'forest', height: '12' },
                       representativePoint: SQR_CENTER,
                       asGeoJSON: () => ({ type: 'MultiPolygon',
                                           coordinates: [[SQR, HOLE]] }) };
      const o = osmBuilding('o3', SQR);
      const out = Rapid.findCandidates({
        plateauEntities: [forest], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.have.lengthOf(0);
    });

    it('keeps the area of a plain way unchanged', () => {
      // 本番データの大半はこの経路。リングが 1 本なので外側リング = 全体。
      const p = outline('p1', SQR, { height: '12' }, SQR_CENTER);
      const o = osmBuilding('o1', SQR);
      const out = Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.have.lengthOf(1);
      expect(out[0].ratio).to.be.closeTo(1, 0.001);
    });

    it('sums every outer ring when a multipolygon has more than one', () => {
      // 1 本目だけを黙って測らないことを固定する。
      // SQR と、その東隣に同じ大きさの正方形をもう 1 つ置く。
      const EAST = SQR.map(([lon, lat]) => [lon + 0.001, lat]);
      const twoOuters = { id: 'r4', type: 'relation',
                          tags: { type: 'multipolygon', building: 'yes', height: '12' },
                          representativePoint: SQR_CENTER,
                          asGeoJSON: () => ({ type: 'MultiPolygon',
                                              coordinates: [[SQR], [EAST]] }) };
      const o = osmBuilding('o4', SQR);
      const out = Rapid.findCandidates({
        plateauEntities: [twoOuters], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      // 2 つ分の面積なので比はおよそ 2 になる。1 本目だけを測っていれば 1 になる。
      // このテストが見るのは比の値だけで、state は見ない。比が 2.0 の境界に乗るため
      // CANDIDATE と AREA_MISMATCH のどちらになるかは投影の誤差で変わりうる。
      expect(out).to.have.lengthOf(1);
      expect(out[0].ratio).to.be.closeTo(2, 0.1);
    });

    it('does not offer a courtyard building again after it was transferred', () => {
      // 転記後は relation の id が transferredIDs に入る。絞り込みが id で見ているので
      // way と同じ扱いになるが、relation でも効くことを固定しておく。
      const p = courtyard('r5', SQR, HOLE, { height: '12' }, SQR_CENTER);
      const o = osmBuilding('o5', SQR);
      const out = Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o],
        transferredIDs: new Set(['r5']), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.have.lengthOf(0);
    });
```

- [ ] **Step 2: テストが落ちることを確認する**

Run: `npm run build:bundle:modern:dev && npm run test:browser`
Expected: `accepts a type=multipolygon building relation as a candidate`、
`measures the courtyard building by its outer ring, not its net area`、
`sums every outer ring when a multipolygon has more than one` が FAIL（relation が絞り込みで落ちる）。
`ignores a multipolygon that is not a building`、`keeps the area of a plain way unchanged`、
`does not offer a courtyard building again after it was transferred` は PASS。

- [ ] **Step 3: 外側リングだけで面積を測る補助関数を足す**

`modules/core/lib/HeightTransferMatcher.js` の `AREA_RATIO_MAX` の定義の後ろに追加する。

```javascript
/**
 * PLATEAU 側の面積を外側リングだけで測る。
 *
 * turf の `area` は MultiPolygon の穴を差し引く。OSM 側は単純な way で総面積なので、
 * そのまま比べると正味面積と総面積の比較になり、中庭が広い建物ほど比が小さく出る。
 * AREA_RATIO_MIN は「OSM の建物よりずっと小さい PLATEAU の外形は塔屋や物置である」
 * という判定なので、中庭のある建物がそれと同じ理由で落ちてしまう。
 *
 * 外側リングだけで測れば、OSM 側と同種どうしの比較になる。
 * 単純な way はリングが 1 本なので、値は全体の面積と等しく、結果は変わらない。
 *
 * 描画は穴を抜いた形を見せるので、この面積は画面の見た目と一致しない。
 *
 * `osmWay.asGeoJSON` / `osmRelation.asGeoJSON` は素のジオメトリを返すが、
 * テストのモックは Feature を返すので、どちらの形も受ける。
 */
function outerRingArea(geo) {
  const g = geo?.geometry ?? geo;
  if (!g?.type) return 0;

  if (g.type === 'Polygon') {
    return area({ type: 'Polygon', coordinates: [g.coordinates[0]] });
  }
  if (g.type === 'MultiPolygon') {
    // outer が複数あるときは全部の外側リングを合算する。1 本目だけを測らない。
    return area({
      type: 'MultiPolygon',
      coordinates: g.coordinates.map(poly => [poly[0]])
    });
  }
  return area(geo);
}
```

- [ ] **Step 4: 絞り込みを relation にも広げる**

`findCandidates` の `outlines` を差し替える。

```javascript
  const outlines = plateauEntities.filter(f => {
    // 転記元になるのは 1 棟の建物である。way は自分のタグを持ち、
    // 中庭のある建物は type=multipolygon の relation で届いてタグは relation にだけ付く。
    // 建物でない multipolygon (森林など) は対象外なので building タグを要求する。
    const isWay = f.type === 'way';
    const isCourtyard = f.type === 'relation' && f.tags?.type === 'multipolygon';
    if (!isWay && !isCourtyard) return false;

    return f.tags?.building &&
      !f.tags['building:part'] &&
      !transferredIDs.has(f.id) &&
      !acceptIDs.has(f.id) &&
      !ignoreIDs.has(f.id) &&
      f.representativePoint;
  });
```

- [ ] **Step 5: 面積の計算を差し替える**

`findCandidates` の面積を求めている行を差し替える。OSM 側は変えない。

```javascript
    const outlineArea = outerRingArea(outlineGeo);
    const osmArea = area(osmGeo);
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `npm run build:bundle:modern:dev && npm run test:browser`
Expected: 追加した 6 件が PASS。既存の `findCandidates` テストも全件 PASS。

- [ ] **Step 7: 外側リングで測っていることを確かめる**

`outerRingArea` の `MultiPolygon` 分岐を一時的に `return area(geo);` に置き換え、
`measures the courtyard building by its outer ring, not its net area` が落ちることを確認してから戻す。
これで「穴を差し引くと落ちる」という前提が実際に成り立っていることが分かる。

戻したあと `git diff` が想定どおりであることを確認する。

- [ ] **Step 8: 全テストを実行する**

Run: `node --test-reporter dot --test "test/unit/**/*.test.js"`
Expected: `detect.test.js` の既存の失敗以外に失敗が無い

- [ ] **Step 9: コミット**

```bash
git add modules/core/lib/HeightTransferMatcher.js test/browser/core/lib/HeightTransferMatcher.test.js
git commit -m "feat(plateau): offer courtyard buildings for height transfer"
```

---

### Task 2: 形状置換ブランチを中庭建物に対して安全にする

**Files:**
- Modify: `modules/core/lib/HeightTransferMatcher.js`（**`feature/plateau-geometry-replacement` ブランチ上**）

**Interfaces:**
- Consumes: Task 1 で relation が候補になること。ただしコードとしては独立していて、Task 1 が無くても意味を持つ。
- Produces: PLATEAU 側が way でない候補は `replaceable: false` になる。

**このタスクは別のブランチで作業する。**
`isReplaceable` は `feature/plateau-geometry-replacement` にしか存在しない。
そのブランチは WIP で、まだデプロイもレビューも通していない。
本タスクは機能追加ではなく、そのブランチ単体を安全にする防御コミット 1 本である。

なぜ要るか。
`isReplaceable` は OSM 側しか見ておらず既定が `true` なので、中庭建物が候補になると
`replaceable: true` が付く。`actionReplaceBuildingGeometry` は `plateauWay.nodes` を回すが
relation に `.nodes` は無いので落ちる。

形状置換は「OSM の way の形状を差し替えて id を保つ」操作で、中庭のある形は 1 本の way では
表せない。置換するなら既存の way を multipolygon relation に作り変えることになり、別の設計が要る。
今回は候補から外すだけにする。

- [ ] **Step 1: ブランチを切り替える**

作業前に現ブランチがきれいであることを確認する。

```bash
git status --short          # 空であること
git branch --show-current   # feature/plateau-multipolygon-conflation
git checkout feature/plateau-geometry-replacement
git log --oneline -1        # 29c18e2ba feat(plateau): auto-preview replace + compare view + shortcuts (#5)
```

- [ ] **Step 2: 失敗するテストを書く**

`test/browser/core/lib/HeightTransferMatcher.test.js` の `describe('findCandidates', ...)` の中に追加する。
**このブランチのテストファイルには Task 1 のテストは無い。**ヘルパー `outline` / `osmBuilding` /
`SQR` / `SQR_CENTER` はこのブランチにも同じ形で存在するので、それを使う。

```javascript
    it('never offers a non-way plateau source for geometry replacement', () => {
      // 中庭のある建物は type=multipolygon の relation で届く。
      // 形状置換は OSM の way の形状を差し替える操作なので、1 本の way で表せない
      // 形は元にできない。候補として提示しない。
      const courtyard = { id: 'r1', type: 'relation',
                          tags: { type: 'multipolygon', building: 'yes', height: '12' },
                          representativePoint: SQR_CENTER,
                          asGeoJSON: () => ({ type: 'MultiPolygon', coordinates: [[SQR]] }) };
      const o = osmBuilding('o1', SQR);
      const out = Rapid.findCandidates({
        plateauEntities: [courtyard], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });

      // このブランチの絞り込みはまだ way しか通さないので候補は 0 件になる。
      // それでも、通るようになったときに replaceable が false であることを固定しておく。
      for (const c of out) {
        expect(c.replaceable).to.be.false;
      }
    });

    it('still offers a plain way for geometry replacement', () => {
      const p = outline('p1', SQR, { height: '12' }, SQR_CENTER);
      const o = osmBuilding('o1', SQR);
      const out = Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.have.lengthOf(1);
      expect(out[0].replaceable).to.be.true;
    });
```

1 件目はこのブランチ単体では候補が 0 件なので空ループになる。
**それでよい。**このブランチに Task 1 がマージされた瞬間に意味を持つ形で置いておく。
2 件目が既存の挙動を守る。

- [ ] **Step 3: テストを実行する**

Run: `npm run build:bundle:modern:dev && npm run test:browser`
Expected: 2 件とも PASS（1 件目は空ループ、2 件目は既存の挙動）。

- [ ] **Step 4: PLATEAU 側の条件を足す**

`modules/core/lib/HeightTransferMatcher.js` の `isReplaceable` を差し替える。

```javascript
function isReplaceable(osmWay, osmGraph, state, plateauFeature) {
  if (state === 'AREA_MISMATCH') return false;

  // 中庭のある建物は type=multipolygon の relation で届く。
  // この操作は OSM の way の形状を差し替えて id を保つものなので、1 本の way で
  // 表せない形は元にできない。既定が true なので、ここで明示的に落とす。
  if (plateauFeature?.type !== 'way') return false;

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

呼び出し側に `outline` を渡す。

```javascript
      replaceable: isReplaceable(osm, osmGraph, state, outline),
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `npm run build:bundle:modern:dev && npm run test:browser`
Expected: 追加した 2 件を含めて全件 PASS。

- [ ] **Step 6: 守りが効いていることを確かめる**

このブランチ単体では中庭建物が候補にならないので、guard が効くことを直接は見られない。
絞り込みを一時的に `f.type === 'way' ||
(f.type === 'relation' && f.tags?.type === 'multipolygon')` に広げ、
`never offers a non-way plateau source for geometry replacement` が
空ループでなく実際に 1 件を検査して PASS することを確認する。

そのうえで `if (plateauFeature?.type !== 'way') return false;` を消し、
同じテストが FAIL することを確認する。

両方戻したあと `git diff` に guard の追加だけが残っていることを確認する。

- [ ] **Step 7: コミット**

```bash
git add modules/core/lib/HeightTransferMatcher.js test/browser/core/lib/HeightTransferMatcher.test.js
git commit -m "fix(plateau): never offer a relation source for geometry replacement"
```

- [ ] **Step 8: 元のブランチに戻る**

```bash
git checkout feature/plateau-multipolygon-conflation
git log --oneline -1        # Task 1 のコミットであること
git status --short          # 空であること
```

戻ったことを報告に明記する。
