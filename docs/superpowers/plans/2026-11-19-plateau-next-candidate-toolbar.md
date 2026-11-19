# 次の Plateau の候補へ移るボタンをツールバーに置く 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 上のツールバーに「次の候補」ボタンを置き、何も選んでいないときでも `4` と同じ動きで次の Plateau の候補へ移れるようにする。

**Architecture:** 押せるかどうかと残りの数を返す関数を `modules/util/plateau_candidates.js` に足す。ツールバーの新しいボタン `UiNextCandidateTool` はこの関数で見た目を決め、押されたら既存の `UiRapidInspector.selectNextCandidate()` を呼ぶ。名前の横の数は、ツールバーが道具ごとの名前を描く処理に、道具が名前を返す口を足して出す。

**Tech Stack:** Rapid（JavaScript、d3-selection）、ブラウザのテストは Karma（`npm run test:browser`）、文言は `data/core.yaml` と `data/l10n/core.ja.json`。

**Spec:** `docs/superpowers/specs/2026-11-19-plateau-next-candidate-toolbar-design.ja.md`

## Global Constraints

- ボタンの位置は、ツールバーの「タグ転記モード」（`this.HeightTransfer`）の直後。
- 押したときは `UiRapidInspector.selectNextCandidate()` を呼ぶ。移る先を決める処理を新しく書かない。
- 数と移る先の対象は `utilPlateauCandidates(context)` が返す集まり。
- 押せないのは次の4つ: Plateau のデータが使えない（Rapid のレイヤーを切っている、サービスが動いていない、Plateau のデータセットが有効でない）、ズーム 17 未満（`PLATEAU_BUILDINGS_MINZOOM`）、OSM のデータのレイヤーを切っている（`isAddBlocked()`）、候補が 0 件。
- 押せないときは押せない見た目にし、マウスを乗せたときの説明に理由を出す。押しても何もしない。
- 説明には「画面の中の次の Plateau の候補を選ぶ」とキー `4` を出す。
- 右の欄の「次の候補へ (4)」と「画面に残り n 件」は変えない。
- キーの一覧では `4` の項目を `shortcuts.with_plateau_selected` の節から `shortcuts.selecting_features` の節へ移す。
- 英語の文言は `data/core.yaml` に書き、`npm run build:data` で `data/l10n/core.en.json` を作り直す。日本語は `data/l10n/core.ja.json` を直接直す。
- コミットメッセージに `Co-Authored-By` の行を付けない。

## Review Focus

- 地図を速く動かしているあいだ、`draw` のたびに候補を数え直すと重くなる。数え直しは間引く（250ms に 1 回まで）。Task 2 のテストで、続けて `draw` が来ても数え直しが 1 回にまとまることを確かめる。
- 最後の候補を追加や無視したあと、ボタンは押せない見た目に変わるべき。Task 1 のテストで、追加済みと無視済みだけの画面では `none` になることを確かめる。
- 名前に数が付くとボタンの幅が変わり、幅の狭い画面ではツールバーがあふれる。名前を変えたあとに `ui.checkOverflow('.map-toolbar', true)` を呼ぶ。Task 2 のテストで呼ばれることを確かめる。
- 描画モードの途中でボタンを押しても、描画を抜けてはいけない。`selectNextCandidate()` がモードを見て何もしないので、Task 2 のテストで、描画モードのときに押しても `context.enter` が呼ばれないことを確かめる。
- 押せない状態のボタンを押しても、案内の表示（flash）が出たり候補に移ったりしてはいけない。Task 2 のテストで確かめる。

---

### Task 1: 押せるかどうかと残りの数を返す関数

**Files:**
- Modify: `modules/util/plateau_candidates.js`
- Modify: `modules/index.js`（`utilPlateauCandidates` と同じ場所から書き出す）
- Test: `test/browser/util/plateau_candidates.js`

**Interfaces:**
- Consumes: `utilPlateauCandidates(context)`（同じファイルの既存の関数）
- Produces: `utilPlateauCandidateStatus(context) -> { reason: 'ok' | 'layer-off' | 'zoom' | 'osm-layer-off' | 'none', count: number }`。`reason` が `'ok'` のときだけ `count > 0`。それ以外の `count` は 0。

判定の順番は `layer-off`、`zoom`、`osm-layer-off`、`none` の順。
`layer-off` は、`utilPlateauCandidates` が空を返す条件のうちズーム以外のもの（Rapid のシステムかサービスが無い、`rapid` レイヤーが無効、`service.started` が偽）と、`added && enabled` の Plateau のデータセットが一つも無いこと。

- [ ] **Step 1: 失敗するテストを書く**

既存の `describe('utilPlateauCandidates')` と同じ偽の `context` の作り方を使い、`describe('utilPlateauCandidateStatus')` を足す。

```js
it('Rapid のレイヤーが無効なら layer-off', () => {
  expect(utilPlateauCandidateStatus(contextWith({ layerEnabled: false }))).to.eql({ reason: 'layer-off', count: 0 });
});
it('有効な Plateau のデータセットが無ければ layer-off', () => {
  expect(utilPlateauCandidateStatus(contextWith({ datasetEnabled: false }))).to.eql({ reason: 'layer-off', count: 0 });
});
it('ズーム 16 なら zoom', () => {
  expect(utilPlateauCandidateStatus(contextWith({ zoom: 16 }))).to.eql({ reason: 'zoom', count: 0 });
});
it('OSM のレイヤーを切っていれば osm-layer-off', () => {
  expect(utilPlateauCandidateStatus(contextWith({ addBlocked: true }))).to.eql({ reason: 'osm-layer-off', count: 0 });
});
it('追加済みと無視済みしか無ければ none', () => {
  expect(utilPlateauCandidateStatus(contextWith({ allAcceptedOrIgnored: true }))).to.eql({ reason: 'none', count: 0 });
});
it('候補が 2 件あれば ok と 2', () => {
  expect(utilPlateauCandidateStatus(contextWith({ candidates: 2 }))).to.eql({ reason: 'ok', count: 2 });
});
```

`contextWith` は既存のテストの組み立てを引数で切り替えられるようにした補助関数。既存のテストにすでに同じ役のものがあれば、それを使う。

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm run build && npm run test:browser`
Expected: `utilPlateauCandidateStatus` が無いため、上の 6 件が失敗する。

- [ ] **Step 3: `utilPlateauCandidateStatus(context)` を `modules/util/plateau_candidates.js` に書き、`modules/index.js` から書き出す**

数は `utilPlateauCandidates(context).length` を使い、候補の数え方を別に書かない。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm run build && npm run test:browser`
Expected: 失敗 0 件。

- [ ] **Step 5: コミットする**

```bash
git add modules/util/plateau_candidates.js modules/index.js test/browser/util/plateau_candidates.js
git commit -m "feat(plateau): 次の候補を押せるかどうかと残りの数を返す関数を足す"
```

### Task 2: ツールバーの「次の候補」ボタンとキーの一覧

**Files:**
- Create: `modules/ui/tools/UiNextCandidateTool.js`
- Modify: `modules/ui/tools/index.js`（既存の道具と同じく書き出す）
- Modify: `modules/ui/UiMapToolbar.js`（道具を足し、名前を描く処理に道具の `label()` を使う口を足す）
- Modify: `data/core.yaml`、`data/l10n/core.en.json`（作り直す）、`data/l10n/core.ja.json`
- Modify: `data/shortcuts.json`
- Test: `test/browser/ui/tools/UiNextCandidateTool.test.js`

**Interfaces:**
- Consumes: `utilPlateauCandidateStatus(context)`（Task 1）、`context.systems.ui.Sidebar.RapidInspector.selectNextCandidate() -> boolean`（既存）
- Produces: `class UiNextCandidateTool`。`id = 'next_candidate'`、`stringID = 'toolbar.next_candidate.label'`、`choose(e)`、`render($parent)`、`label() -> string`。

ツールバーの名前の処理は、道具に `label()` があればその戻り値を、無ければ今までどおり `l10n.t(d.stringID)` を出す。
道具は自分の `render` のたびに、同じ `.toolbar-item` の中の `.item-label` を `label()` で書き換え、そのあと `ui.checkOverflow('.map-toolbar', true)` を呼ぶ。

文言（英語は `data/core.yaml`、日本語は `core.ja.json`）:

| キー | 英語 | 日本語 |
|---|---|---|
| `toolbar.next_candidate.label` | `Next candidate` | `次の候補` |
| `toolbar.next_candidate.label_count` | `Next candidate {n}` | `次の候補 {n}` |
| `toolbar.next_candidate.tooltip` | `Select the next Plateau candidate on screen.` | `画面の中の次の Plateau の候補を選ぶ` |
| `toolbar.next_candidate.layer_off` | `Turn on Plateau data in the Rapid layer to use this.` | `Rapid のデータで Plateau を有効にすると使えます。` |
| `toolbar.next_candidate.zoom` | `Zoom in to 17 or closer to use this.` | `ズーム 17 以上で使えます。` |
| `toolbar.next_candidate.osm_layer_off` | `Show the OSM data layer to use this.` | `OSM のデータのレイヤーを表示すると使えます。` |

候補が 0 件のときの理由は、既存の `rapid_inspector.next_candidate.none` を使う。

- [ ] **Step 1: 失敗するテストを書く**

`test/browser/ui/tools/UiHeightTransferTool.test.js` と同じく、偽の `context` で組み立てる。`utilPlateauCandidateStatus` の結果は、道具の `_status()` を差し替えて与える。

```js
it('ok のとき、名前に数が付き、押せる', () => {
  // _status() → { reason: 'ok', count: 24 }
  expect(tool.label()).to.equal('toolbar.next_candidate.label_count');   // MockL10n は id を返す。{n} は 24 を渡していること
  expect($button.classed('disabled')).to.be.false;
});
it('押すと selectNextCandidate を 1 回呼ぶ', () => { /* click → 呼ばれた回数 1 */ });
it('zoom のとき、押せない見た目で、説明が toolbar.next_candidate.zoom', () => { /* ... */ });
it('none のとき、説明が rapid_inspector.next_candidate.none', () => { /* ... */ });
it('押せないときに押しても、selectNextCandidate も flash も呼ばない', () => { /* ... */ });
it('描画モードで押しても context.enter を呼ばない', () => { /* 本物の selectNextCandidate を使い、mode.id = 'draw-area' */ });
it('draw が 250ms のあいだに 5 回来ても、数え直しは 1 回', () => { /* 偽のタイマーで確かめる */ });
it('名前を書き換えたあと checkOverflow を呼ぶ', () => { /* ... */ });
```

ツールバー側は、既存のツールバーのテストがあればそこに、無ければこのファイルに、`label()` を持つ道具の名前がその戻り値になることを 1 件足す。

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm run build && npm run test:browser`
Expected: `UiNextCandidateTool` が無いため失敗する。

- [ ] **Step 3: `UiNextCandidateTool` を書き、ツールバーの `this.HeightTransfer` の直後に足す**

見た目は既存の `UiZoomOverviewTool` と同じ `bar-button`。説明は `uiTooltip(context)` で出し、`.keys(['4'])` を付ける。押せないときは `disabled` のクラスを付け、説明の文言を理由に替える。数え直しは地図の `draw` で行い、250ms に 1 回までに間引く。アイコンは既存のアイコンから選ぶ。

- [ ] **Step 4: 文言を足し、`npm run build:data` で `core.en.json` を作り直す**

- [ ] **Step 5: `data/shortcuts.json` で `shortcuts.command.next_plateau_candidate` の行を `shortcuts.selecting_features` の節の最後へ移す**

- [ ] **Step 6: テストと lint が通ることを確かめる**

Run: `npm run build && npm run test:unit && npm run test:browser && npm run lint`
Expected: 失敗 0 件、lint のエラー 0 件（既存の警告 42 件は残ってよい）。

- [ ] **Step 7: 手元のエディタで確かめる**

`http://localhost:8080` で、Plateau の候補がある画面をズーム 17 以上で開く。何も選んでいない状態でボタンを押すと候補が選ばれて中央に寄ること、名前の数が地図を動かすと変わること、ズーム 16 で押せない見た目になり説明に理由が出ること、`?` の一覧で `4` が「地物を選ぶ」の節にあることを確かめる。

- [ ] **Step 8: コミットする**

```bash
git add modules/ui/tools/UiNextCandidateTool.js modules/ui/tools/index.js modules/ui/UiMapToolbar.js data/core.yaml data/l10n/core.en.json data/l10n/core.ja.json data/shortcuts.json test/browser/ui/tools/UiNextCandidateTool.test.js
git commit -m "feat(plateau): ツールバーに次の候補へ移るボタンを足し、キーの一覧の節を直す"
```
