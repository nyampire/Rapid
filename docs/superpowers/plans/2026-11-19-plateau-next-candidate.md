# 次の Plateau の候補へ移るキー 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `4` を押すと、画面に残っている Plateau の候補のうち、いちばん近いものを選んで地図の中央に寄せる。

**Architecture:** 地図に描く候補を決める処理（`PixiLayerRapid._plateauRenderables` と、受け入れ済みと無視済みの除外）を `modules/util/plateau_candidates.js` に移し、描く処理と次の候補を探す処理の両方から呼びます。
いちばん近い候補を選ぶ計算は、ブラウザに依存しない関数として別のファイルに置きます。
キーとボタンと残りの数は `UiRapidInspector` に足します。

**Tech Stack:** JavaScript（ES modules）、d3-selection、`@rapid-sdk/math`、node:test（単体テスト）、Karma と Mocha と Chai（ブラウザのテスト）。

**Spec:** `docs/superpowers/specs/2026-11-18-plateau-next-candidate-design.ja.md`

## 設計からの変更（承認が必要）

設計文書では、次へ移る先を「読み込み済みの範囲」としていました。
計画では、これを「今の画面の中」に狭めます。

候補が OSM の建物と重なるかの判定は、OSM のデータが読み込まれている場所でしか正しく働きません。
画面の外は OSM のデータが読み込まれているとは限らず、読み込まれていない場所では、重なる候補も残りの候補に見えてしまいます。
これは設計文書の失敗の条件（「OSM の建物と重なる候補に移る」）に当たります。
画面の中だけを対象にすれば、地図に描いている候補とまったく同じ集まりになり、残りの数とも一致します。

画面の中に候補が無くなったら、利用者が自分で地図を動かします（今の作業の流れと同じです）。
承認されたら、Task 1 の最初に設計文書の該当の行を直します。

## Global Constraints

- キーは修飾キーなしの `4`。`data/core.yaml` の `shortcuts.command.next_plateau_candidate.key` に置き、`l10n.t()` で読む。
- 対象の候補は、地図に描いている Plateau の候補と同じ集まり（画面の中、OSM の建物と重ならない、受け入れ済みでも無視済みでもない）。
- ズームは変えない。中央に寄せるのは `context.systems.map.centerEase(loc)`。
- 追加や無視のあとに自動で次へ移らない。
- OSM のデータのレイヤーを消しているあいだ（`plateau.isAddBlocked()` が true）は移らず、既存の文言 `rapid_inspector.option_accept.disabled_osm_layer_off_flash` を `uiFlash` で出す。
- 英語の文言は `data/core.yaml` に書き、`npm run build:data` で `data/l10n/core.en.json` を作り直す。日本語は `data/l10n/core.ja.json` に直接書く。
- 日本語の文言: ボタン「次の候補へ」、残りの数「画面に残り {n} 件」、残りが無いとき「この画面に残りの候補はありません」。

## Review Focus

- タグの入力欄で `4` を打ったときに、候補へ移らないこと。キーは capture ではない登録にする（`utilKeybinding` の bubble 側は INPUT、SELECT、TEXTAREA を除く）。Task 3 にテストを足す。
- ズーム 17 未満では候補を読み込まないので、残りは 0 件として扱い、移らないこと。Task 1 にテストを足す。
- 候補を一つだけ選んでいるとき、その候補を除くと残りが無い場合に、同じ候補を選び直さず「残りの候補はありません」を出すこと。Task 2 と Task 3 にテストを足す。
- 中庭のある建物（`type=multipolygon` の relation）は、relation 一つを一つの候補として数え、メンバーの way を別に数えないこと。Task 1 にテストを足す。
- Plateau 以外のデータセットの候補（たとえば Esri の建物）を選んでいるときも、Plateau の候補だけを対象にすること。Task 3 にテストを足す。

---

### Task 1: 描く候補の集まりを共通の関数にする

**Files:**
- Create: `modules/util/plateau_candidates.js`
- Modify: `modules/util/index.js`（書き出しを足す）
- Modify: `modules/pixi/PixiLayerRapid.js:423-450`（`_plateauRenderables` を新しい関数に委ねる）
- Modify: `docs/superpowers/specs/2026-11-18-plateau-next-candidate-design.ja.md`（「設計からの変更」を反映する）
- Test: `test/browser/util/plateau_candidates.js`

**Interfaces:**
- Produces: `utilPlateauRenderables(entities: Entity[], graph: Graph, skip?: (Entity) => boolean) => { polygons: Entity[] }`（今の `_plateauRenderables` の中身をそのまま移したもの）
- Produces: `utilPlateauCandidates(context) => Array<{ entity: Entity, graph: Graph, datasetID: string }>`。有効な Plateau のデータセットごとに、`plateau.getData(datasetID)` を `utilPlateauRenderables` に通し、`rapid.acceptIDs` と `rapid.ignoreIDs` に入っているものを除いて返す。地図のズーム（`context.viewport.transform.zoom`）が `PLATEAU_BUILDINGS_MINZOOM` 未満なら空の配列を返す。

- [ ] **Step 1: 設計文書の「動き」の「対象にする候補」と「目標」の行を、「読み込み済みの範囲」から「今の画面の中」に直す**

- [ ] **Step 2: 失敗するテストを書く**

`test/browser/util/plateau_candidates.js` に、`PixiLayerRapid.test.js` の `#_plateauRenderables` と同じ作りの模擬の context を使って次を書く。

```js
it('returns the polygons the layer would draw', ...)
  // getData が way 2 本を返す → 2 件。entity.id が一致する
it('skips accepted and ignored candidates', ...)
  // acceptIDs に w1、ignoreIDs に w2 → 残りは w3 だけ
it('counts a courtyard relation once, not its member ways', ...)
  // multipolygon の relation r1（メンバー w1, w2）→ 1 件で entity.id === 'r1'
it('returns nothing below the Plateau minimum zoom', ...)
  // transform.zoom = 16.9 → []
it('ignores datasets that are not Plateau', ...)
  // service が 'esri' のデータセットだけ有効 → []
```

- [ ] **Step 3: テストが失敗することを確かめる**

Run: `npx karma start karma.conf.cjs --single-run --grep "utilPlateauCandidates"`（`--grep` が効かなければ `npm run test:browser`）
Expected: `utilPlateauCandidates is not a function` で失敗する。

- [ ] **Step 4: `utilPlateauRenderables` と `utilPlateauCandidates` を実装し、`_plateauRenderables` を `return utilPlateauRenderables(entities, dsGraph, isAcceptedOrIgnored);` にする**

- [ ] **Step 5: 新しいテストと、`PixiLayerRapid.test.js` の既存のテストが通ることを確かめる**

Run: `npm run test:browser`
Expected: すべて成功。

- [ ] **Step 6: コミット**

```bash
git add modules/util/plateau_candidates.js modules/util/index.js modules/pixi/PixiLayerRapid.js test/browser/util/plateau_candidates.js docs/superpowers/specs/2026-11-18-plateau-next-candidate-design.ja.md
git commit -m "refactor(plateau): 地図に描くPlateauの候補を決める処理を共通の関数にする"
```

### Task 2: いちばん近い候補を選ぶ関数

**Files:**
- Create: `modules/util/plateau_nearest_candidate.js`
- Modify: `modules/util/index.js`
- Test: `test/unit/util/plateau_nearest_candidate.test.js`

**Interfaces:**
- Consumes: Task 1 の `utilPlateauCandidates` が返す要素の形 `{ entity, graph, datasetID }`
- Produces: `utilNearestPlateauCandidate(candidates, fromLoc: [lon, lat], excludeID?: string) => candidate | null`。距離は `geoSphericalDistance(fromLoc, entity.extent(graph).center())`（`@rapid-sdk/math`）。`excludeID` と同じ `entity.id` は除く。候補が無ければ null。

- [ ] **Step 1: 失敗するテストを書く**

`building_relation.test.js` と同じく `modules/headless.js` から `osmNode`、`osmWay`、`Graph` を読み、四角い way を3つ作って次を書く。

```js
it('returns the candidate closest to the given location', ...)
  // 中心が [139.700,35.000]、[139.701,35.000]、[139.710,35.000] の3棟、fromLoc [139.7008,35.0] → 2番目の棟
it('skips the excluded candidate', ...)
  // 同じ3棟と fromLoc で excludeID に2番目の棟 → 1番目の棟
it('returns null when the only candidate is excluded', ...)
it('returns null for an empty list', ...)
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm run test:unit`
Expected: `utilNearestPlateauCandidate is not a function` で失敗する。

- [ ] **Step 3: `utilNearestPlateauCandidate` を実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm run test:unit`
Expected: すべて成功。

- [ ] **Step 5: コミット**

```bash
git add modules/util/plateau_nearest_candidate.js modules/util/index.js test/unit/util/plateau_nearest_candidate.test.js
git commit -m "feat(plateau): いちばん近いPlateauの候補を選ぶ関数を足す"
```

### Task 3: `4` のキー、右の欄のボタン、残りの数

**Files:**
- Modify: `modules/ui/UiRapidInspector.js`（`selectNextCandidate()`、`_setupKeybinding()`、右の欄の描画）
- Modify: `data/core.yaml`（`shortcuts.command.next_plateau_candidate`、`rapid_inspector.next_candidate`）
- Modify: `data/l10n/core.en.json`（`npm run build:data` で作り直す）
- Modify: `data/l10n/core.ja.json`
- Modify: `data/shortcuts.json`（`with_plateau_selected` の節に1行足す）
- Test: `test/browser/ui/UiRapidInspector.js`

**Interfaces:**
- Consumes: `utilPlateauCandidates(context)`（Task 1）、`utilNearestPlateauCandidate(candidates, fromLoc, excludeID)`（Task 2）
- Produces: `UiRapidInspector#selectNextCandidate() => boolean`。移ったら true。
  - `plateau.isAddBlocked()` が true なら `disabled_osm_layer_off_flash` を出して false。
  - 選んでいるのが Plateau の候補（`this.datum?.__service__ === 'plateau'`）なら、起点はその候補の外形の中心、除くのはその id。そうでなければ起点は `context.viewport.centerLoc()`、除くものは無し。
  - 見つからなければ `rapid_inspector.next_candidate.none` を出して false。
  - 見つかったら `context.enter('select', { selection: new Map().set(entity.id, entity) })` と `map.centerEase(中心)` をして true。
- Produces: `UiRapidInspector#remainingCandidateCount() => number`。`utilPlateauCandidates(context).length`。

文言（`data/core.yaml`）:

```yaml
rapid_inspector:
  next_candidate:
    label: Next candidate
    remaining: "{n} left on screen"
    none: No candidates left on this screen.
shortcuts:
  command:
    next_plateau_candidate:
      label: Select the next Plateau candidate on screen
      key: '4'
```

日本語（`data/l10n/core.ja.json`）は、label「次の候補へ」、remaining「画面に残り {n} 件」、none「この画面に残りの候補はありません」、ショートカットの label「画面の中の次の Plateau の候補を選ぶ」。

- [ ] **Step 1: 失敗するテストを書く**

既存の `MockContext` に `viewport.centerLoc()`、`systems.map.centerEase`（呼び出しを記録する）、`enter`（呼び出しを記録する）を足し、`utilPlateauCandidates` の代わりに候補を返す差し替え口を inspector に持たせる（`inspector._candidates = () => [...]` のように、既定では `utilPlateauCandidates(context)` を呼ぶ）。

```js
it('selects the nearest candidate and centers the map on it', ...)
  // 2件、何も選んでいない → enter の selection が近いほうの id、centerEase が1回
it('moves from the selected Plateau candidate to the nearest other one', ...)
  // datum = 候補A → 選ばれるのは A 以外で最も近いもの
it('does not move when the only candidate is the selected one', ...)
  // 戻り値 false、enter は呼ばれない
it('does not move while the OSM layer is switched off', ...)
  // isAddBlocked = () => true → false、enter は呼ばれない
it('starts from the map center when a non-Plateau feature is selected', ...)
  // datum = { __service__: 'esri' } → 地図の中央に近い候補
it('counts the remaining candidates on screen', ...)
  // 3件 → remainingCandidateCount() === 3
it('does not react to 4 typed into a text field', ...)
  // input に focus して keydown '4' を送る → enter は呼ばれない
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm run test:browser`
Expected: 足した7件が `selectNextCandidate is not a function` などで失敗する。

- [ ] **Step 3: `selectNextCandidate()` と `remainingCandidateCount()` を実装し、`_setupKeybinding()` で `4` を capture なしで登録する（`this._keys` にも足す）**

- [ ] **Step 4: 右の欄の選択肢の下に、「次の候補へ (4)」のボタンと「画面に残り {n} 件」を描く。Plateau の候補を選んでいるときだけ描き、残りが 0 件ならボタンを無効にして `none` の文言を出す**

残りの数は、今選んでいる候補を含めずに数える（`remainingCandidateCount() - 1` ではなく、`this.datum.id` を除いた件数）。

- [ ] **Step 5: 文言を足し、`npm run build:data` で `data/l10n/core.en.json` を作り直す。`data/shortcuts.json` の `with_plateau_selected` の節に `{ "shortcuts": ["shortcuts.command.next_plateau_candidate.key"], "text": "shortcuts.command.next_plateau_candidate.label" }` を足す**

- [ ] **Step 6: テストがすべて通ることを確かめる**

Run: `npm run test:unit && npm run test:browser && npm run lint`
Expected: すべて成功。

- [ ] **Step 7: 手元のエディタで動きを確かめる**

`npm start` で開き、ズーム 18 で候補が複数ある場所に移動する。
何も選ばずに `4` を押して候補が選ばれ中央に寄ること、続けて `4` で別の候補に移ること、画面に候補が無いときに案内が出ること、タグの入力欄で `4` を打っても移らないことを確かめる。

- [ ] **Step 8: コミット**

```bash
git add modules/ui/UiRapidInspector.js data/core.yaml data/l10n/core.en.json data/l10n/core.ja.json data/shortcuts.json test/browser/ui/UiRapidInspector.js
git commit -m "feat(plateau): 4のキーで画面の中の次のPlateauの候補を選ぶ"
```
