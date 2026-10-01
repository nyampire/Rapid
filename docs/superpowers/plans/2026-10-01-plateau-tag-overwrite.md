# タグ転記で既存の値と PLATEAU の値を選べるようにする 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** URL に `plateau_overwrite=1` があるとき、タグ転記の欄で、食い違うタグごとに既存の値と PLATEAU の値のどちらを使うかを選べるようにします。

**Architecture:** 転記の操作に「書き換えるタグ」の引数を足します。
選択の状態と、書き換えられるかの判定は、候補を計算している `HeightTransferMode` に持たせます。
タグ転記の欄は選択の状態を自分では持たず、`HeightTransferMode` から読んで描くだけにします。
これで、ボタンと A キーの結果が一致します。

**Tech Stack:** JavaScript (ES modules)、karma と mocha と chai と sinon による browser 試験、d3 による画面の組み立て、esbuild による配布物の生成。

## Global Constraints

- 設計文書は `docs/superpowers/specs/2026-10-01-plateau-tag-overwrite-design.ja.md` です。判断に迷ったらこちらが優先します。
- URL に `plateau_overwrite=1` が無いときの画面と動作は、今と 1 つも変えません。既存の試験はすべてそのまま通る必要があります。
- 有効にするパラメータの名前は `plateau_overwrite`、値は `1` だけを有効とみなします。
- 最初の選択は「OSM の値」です。
- 書き換えられない理由は `'disabled'`（パラメータ無し）、`'area'`（面積の不一致）、`'warning'`（高さの警告）の 3 つで、この順に調べます。
- 高さの警告の有無は、既存の `utilPlateauHasTransferWarning` で調べます。新しい判定を作りません。
- 突き合わせの部分（`modules/core/lib/HeightTransferMatcher.js`）と地図の印（`modules/pixi/PixiLayerHeightTransfer.js`）は変えません。
- 上流のファイル（`modules/core/` の下）には手を入れません。
- 画面の文言は、この欄の既存の文言と同じく `data/core.yaml` に英語で足します。`npm run build` が作り直す `data/l10n/core.en.json` も一緒にコミットします。
- コミットメッセージは日本語のですます調で書き、一文ごとに改行します。末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` を付けます。
- コードコメントも一文ごとに改行します。1 つの行に 2 つの文を入れないでください。
- 公開リポジトリのため、ファイル、コミットメッセージ、Pull Request の本文の 3 つで機微情報を確認します。
- `git add -A` と `git add .` は使わず、ファイルを名指しで加えます。
- 起点は `3102319e3` です。ブランチは `feature/plateau-tag-overwrite` で、設計文書がすでに載っています。
- 起点の browser 試験の結果は 841 件成功、5 件スキップ、失敗 0 件です。

## 試験の走らせ方

browser 試験は配布物（`dist/rapid.js`）を読みます。
コードを変えたら、必ず作り直してから走らせます。

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run test:browser
```

1 件だけ走らせる仕組みはありません。
出力の中から試験の名前を探して結果を見ます。
最後の `SUMMARY:` の行で件数を確かめます。

設計文書は転記の操作の試験を `node --test` で回すと書いていますが、既存の試験は browser 試験（`test/browser/actions/transfer_plateau_tags.test.js`）です。
既存に合わせて browser 試験に足し、Task 4 で設計文書の記述を直します。

足す試験は 23 件です（Task 1 で 4 件、Task 2 で 12 件、Task 3 で 7 件）。
最後は 864 件成功、5 件スキップ、失敗 0 件になります。

## ファイルの構成

| ファイル | 変更 | 役割 |
|---|---|---|
| `modules/actions/transfer_plateau_tags.js` | 変更 | 3 つ目の引数 `replaceTags` で、既存の値を書き換えます。 |
| `modules/modes/HeightTransferMode.js` | 変更 | 選択の状態、書き換えられるかの判定、適用、A キーの条件を持ちます。 |
| `modules/ui/sections/plateau_tags.js` | 変更 | 食い違うタグの行と理由の文を描きます。 |
| `data/core.yaml` | 変更 | 文言を足します。 |
| `data/l10n/core.en.json` | 生成 | `npm run build` が作り直します。 |
| `css/80_app.css` | 変更 | 食い違うタグの行と、無効のボタンの見た目を足します。 |
| `test/browser/actions/transfer_plateau_tags.test.js` | 変更 | Task 1 の試験です。 |
| `test/browser/modes/HeightTransferMode.test.js` | 変更 | Task 2 の試験です。 |
| `test/browser/ui/sections/plateau_tags.js` | 変更 | Task 3 の試験です。 |
| `PLATEAU.ja.md`、`PLATEAU.md` | 変更 | パラメータの一覧と、上書きの説明を直します。 |
| `docs/superpowers/specs/2026-10-01-plateau-tag-overwrite-design.ja.md` | 変更 | 試験の置き場所の記述を直します。 |

---

### Task 1: 転記の操作に書き換えを足す

**Files:**
- Modify: `modules/actions/transfer_plateau_tags.js`
- Test: `test/browser/actions/transfer_plateau_tags.test.js`

**Interfaces:**
- Consumes: なし
- Produces: `actionTransferPlateauTags(entityID: string, addTags: Object<string,string>, replaceTags?: Object<string,string>) => (graph) => Graph`。
  `replaceTags` を省くと今と同じ動作です。
  返す関数の `actionName` は今と同じ `'transfer_plateau_tags'` です。

- [ ] **Step 1: 失敗する試験を書く**

`test/browser/actions/transfer_plateau_tags.test.js` の最後の `it(...)` の後ろ（`});` で閉じる直前）に足します。

```js
  it('replaces existing values for the keys given in replaceTags', () => {
    const way = Rapid.osmWay({ id: 'w1', tags: { building: 'yes', height: '10' } });
    const graph = new Rapid.Graph([way]);
    const g2 = Rapid.actionTransferPlateauTags('w1', {}, { height: '12.5' })(graph);
    expect(g2.entity('w1').tags).to.eql({ building: 'yes', height: '12.5' });
  });

  it('adds and replaces in one call', () => {
    const way = Rapid.osmWay({ id: 'w1', tags: { building: 'yes', height: '10' } });
    const graph = new Rapid.Graph([way]);
    const g2 = Rapid.actionTransferPlateauTags('w1', { ele: '45' }, { height: '12.5' })(graph);
    expect(g2.entity('w1').tags).to.eql({ building: 'yes', height: '12.5', ele: '45' });
  });

  it('leaves the entity untouched when replaceTags already matches', () => {
    const way = Rapid.osmWay({ id: 'w1', tags: { building: 'yes', height: '12' } });
    const graph = new Rapid.Graph([way]);
    const g2 = Rapid.actionTransferPlateauTags('w1', {}, { height: '12' })(graph);
    expect(g2.entity('w1')).to.equal(graph.entity('w1'));   // reference equality
  });

  it('keeps the original graph unchanged so undo restores the old value', () => {
    const way = Rapid.osmWay({ id: 'w1', tags: { building: 'yes', height: '10' } });
    const graph = new Rapid.Graph([way]);
    Rapid.actionTransferPlateauTags('w1', {}, { height: '12.5' })(graph);
    expect(graph.entity('w1').tags.height).to.equal('10');
  });
```

- [ ] **Step 2: 試験を走らせて失敗を確かめる**

Run: `cd /Users/nyampire/git/Rapid && npm run build && npm run test:browser`
Expected: `replaces existing values for the keys given in replaceTags` と `adds and replaces in one call` が FAIL（`height` が `'10'` のまま）。
残りの 2 件は今の実装でも通ります。

- [ ] **Step 3: 実装する**

`modules/actions/transfer_plateau_tags.js` の関数の先頭のコメントから `return graph.replace(...)` までを、次で置き換えます。
`action.actionName` とその上のコメントは変えません。

```js
// PLATEAU の値を OSM の entity に転記する。
// addTags は、entity に値が無いキーだけを足し、既存の値は書き換えない。
// replaceTags は、entity の値を渡された値で置き換える。
// replaceTags を省いたときは、既存の値を 1 つも書き換えない。
export function actionTransferPlateauTags(entityID, addTags, replaceTags = {}) {
  const action = function(graph) {
    const entity = graph.entity(entityID);
    const existing = entity.tags ?? {};
    const merged = { ...existing };
    let changed = false;
    for (const [k, v] of Object.entries(addTags ?? {})) {
      if (existing[k] !== undefined && existing[k] !== null && existing[k] !== '') continue;
      merged[k] = v;
      changed = true;
    }
    for (const [k, v] of Object.entries(replaceTags ?? {})) {
      if (existing[k] === v) continue;
      merged[k] = v;
      changed = true;
    }
    if (!changed) return graph;
    return graph.replace(entity.update({ tags: merged }));
  };
```

- [ ] **Step 4: 試験を走らせて通ることを確かめる**

Run: `cd /Users/nyampire/git/Rapid && npm run build && npm run test:browser`
Expected: `SUMMARY:` が 845 件成功、5 件スキップ、失敗 0 件。

- [ ] **Step 5: コミットする**

```bash
cd /Users/nyampire/git/Rapid
git add modules/actions/transfer_plateau_tags.js test/browser/actions/transfer_plateau_tags.test.js
git commit -F - <<'EOF'
feat(plateau): 転記の操作で既存の値を書き換えられるようにする

3 つ目の引数に渡したタグは、既存の値を置き換えます。
省いたときは今と同じく、既存の値を書き換えません。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: 選択の状態と、書き換えられるかの判定を持たせる

**Files:**
- Modify: `modules/modes/HeightTransferMode.js`
- Test: `test/browser/modes/HeightTransferMode.test.js`

**Interfaces:**
- Consumes: Task 1 の `actionTransferPlateauTags(entityID, addTags, replaceTags)`。
- Produces: `HeightTransferMode` の次の公開の関数。Task 3 の欄がこれを呼びます。
  - `overwriteEnabled(): boolean` … URL に `plateau_overwrite=1` があれば真。試験ではこの関数を `sinon.stub` で差し替えます。
  - `getOverwriteBlock(candidate): null | 'disabled' | 'area' | 'warning'` … 書き換えられるときは `null`。
  - `getOverwriteKeys(candidate): Set<string>` … 「PLATEAU の値」を選んだタグのうち、今も `candidate.conflictingTags` にあるもの。
  - `setOverwrite(candidate, key: string, usePlateau: boolean): void` … 選択を切り替え、`'change'` を出します。書き換えられない候補では何もしません。
  - `hasWorkToApply(candidate): boolean` … 適用して変わるものがあるか。ボタンの有効と無効、A キーの割り当ての両方がこれを使います。
  - `apply(candidate)` は、書き換えたタグの名前を `annotation.overwrittenKeys: string[]` に残すようになります。

- [ ] **Step 1: 失敗する試験を書く**

`test/browser/modes/HeightTransferMode.test.js` の `describe('getCandidateForOSM', ...)` の直前に、次の `describe` を足します。
`makeContext` と `makeCandidate` は、このファイルの上のほうにある既存の関数です。

```js
  describe('overwrite', () => {
    function conflictCandidate(overrides = {}) {
      return makeCandidate(Object.assign({
        plateauFeature: { id: 'p1', tags: { height: '12', ele: '45' } },
        state: 'CONFLICT',
        missingTags: [],
        conflictingTags: [{ key: 'height', osmValue: '10', plateauValue: '12' }]
      }, overrides));
    }

    function enabledMode(context) {
      const mode = new Rapid.HeightTransferMode(context);
      sinon.stub(mode, 'overwriteEnabled').returns(true);
      mode.activate();
      return mode;
    }

    it('is disabled without the URL parameter', () => {
      const mode = new Rapid.HeightTransferMode(makeContext());
      mode.activate();
      expect(mode.overwriteEnabled()).to.equal(false);
      expect(mode.getOverwriteBlock(conflictCandidate())).to.equal('disabled');
    });

    it('allows overwriting a matched building with no height warning', () => {
      const mode = enabledMode(makeContext());
      expect(mode.getOverwriteBlock(conflictCandidate())).to.equal(null);
    });

    it('blocks overwriting when the Plateau building has a height warning', () => {
      const mode = enabledMode(makeContext());
      const cand = conflictCandidate({
        plateauFeature: { id: 'p1', tags: { height: '0.5' }, heightWarnings: ['absolute'] }
      });
      expect(mode.getOverwriteBlock(cand)).to.equal('warning');
    });

    it('reports the area mismatch before the height warning', () => {
      const mode = enabledMode(makeContext());
      const cand = conflictCandidate({
        state: 'AREA_MISMATCH',
        ratio: 4.0,
        plateauFeature: { id: 'p1', tags: { height: '0.5' }, heightWarnings: ['absolute'] }
      });
      expect(mode.getOverwriteBlock(cand)).to.equal('area');
    });

    it('keeps the chosen keys and emits change', () => {
      const mode = enabledMode(makeContext());
      const cand = conflictCandidate();
      const spy = sinon.spy();
      mode.on('change', spy);

      mode.setOverwrite(cand, 'height', true);
      expect([...mode.getOverwriteKeys(cand)]).to.eql(['height']);
      expect(spy.called).to.equal(true);

      mode.setOverwrite(cand, 'height', false);
      expect([...mode.getOverwriteKeys(cand)]).to.eql([]);
    });

    it('ignores choices on a building that cannot be overwritten', () => {
      const mode = enabledMode(makeContext());
      const cand = conflictCandidate({ state: 'AREA_MISMATCH', ratio: 4.0 });
      mode.setOverwrite(cand, 'height', true);
      expect([...mode.getOverwriteKeys(cand)]).to.eql([]);
    });

    it('drops a chosen key that no longer conflicts', () => {
      const mode = enabledMode(makeContext());
      const cand = conflictCandidate();
      mode.setOverwrite(cand, 'height', true);

      // 欄を出したあとに、利用者が OSM の値を手で PLATEAU と同じ値に直した場合。
      const recomputed = conflictCandidate({ conflictingTags: [] });
      expect([...mode.getOverwriteKeys(recomputed)]).to.eql([]);
    });

    it('forgets the choices of a building that left the candidates', () => {
      const mode = enabledMode(makeContext());
      const cand = conflictCandidate();
      mode.candidates = [cand];
      mode.setOverwrite(cand, 'height', true);

      mode._recompute();   // the mocked plateau service returns no buildings

      expect([...mode.getOverwriteKeys(cand)]).to.eql([]);
    });

    it('binds the apply shortcut once a Plateau value is chosen, and unbinds it when switched back', () => {
      const context = makeContext();
      const mode = enabledMode(context);
      const cand = conflictCandidate();
      mode.candidates = [cand];
      context._selectedIDs = ['w1'];
      context._emit('modechange');
      expect(context.keybinding().registered.length).to.equal(0);

      mode.setOverwrite(cand, 'height', true);
      expect(context.keybinding().registered.length).to.equal(1);

      mode.setOverwrite(cand, 'height', false);
      expect(context.keybinding().registered.length).to.equal(0);
    });

    it('apply() replaces the chosen values and records them on the annotation', () => {
      const context = makeContext();
      const mode = enabledMode(context);
      const cand = conflictCandidate({ missingTags: ['ele'] });
      mode.setOverwrite(cand, 'height', true);

      mode.apply(cand);

      const action = context.systems.editor.performCalls[0];
      const graph = new Rapid.Graph([ Rapid.osmWay({ id: 'w1', tags: { building: 'yes', height: '10' } }) ]);
      expect(action(graph).entity('w1').tags).to.eql({ building: 'yes', height: '12', ele: '45' });
      expect(context.systems.editor.commitCalls[0].annotation.overwrittenKeys).to.eql(['height']);
    });

    it('apply() only adds when overwriting became unavailable after choosing', () => {
      const context = makeContext();
      const mode = enabledMode(context);
      const cand = conflictCandidate({ missingTags: ['ele'] });
      mode.setOverwrite(cand, 'height', true);
      mode.overwriteEnabled.returns(false);   // the URL parameter was removed

      mode.apply(cand);

      const action = context.systems.editor.performCalls[0];
      const graph = new Rapid.Graph([ Rapid.osmWay({ id: 'w1', tags: { building: 'yes', height: '10' } }) ]);
      expect(action(graph).entity('w1').tags).to.eql({ building: 'yes', height: '10', ele: '45' });
      expect(context.systems.editor.commitCalls[0].annotation.overwrittenKeys).to.eql([]);
    });

    it('hasWorkToApply() is false for a conflict-only building until a Plateau value is chosen', () => {
      const mode = enabledMode(makeContext());
      const cand = conflictCandidate();
      expect(mode.hasWorkToApply(cand)).to.equal(false);
      mode.setOverwrite(cand, 'height', true);
      expect(mode.hasWorkToApply(cand)).to.equal(true);
    });
  });
```

- [ ] **Step 2: 試験を走らせて失敗を確かめる**

Run: `cd /Users/nyampire/git/Rapid && npm run build && npm run test:browser`
Expected: `overwrite` の 12 件が FAIL（`mode.overwriteEnabled` などが関数でない、`sinon.stub` が存在しない関数を差し替えられない）。

- [ ] **Step 3: import と状態を足す**

`modules/modes/HeightTransferMode.js` の 4 行目の import を置き換え、1 行足します。

```js
import { utilStringQs } from '@rapid-sdk/util';
import { utilCmd, utilPlateauHasTransferWarning } from '../util/index.js';
```

コンストラクタの `this.transferredIDs = new Set();` の行の直後に足します。

```js
    // PLATEAU の建物の id ごとに、「PLATEAU の値」を選んだタグの集合を持つ。
    // 候補から外れた建物の分は、_recompute で捨てる。
    this._overwriteChoices = new Map();   // Map<plateauFeatureID, Set<tagKey>>
```

- [ ] **Step 4: 判定と選択の関数を足す**

`getCandidateForOSM` の関数の直後（`_refreshApplyShortcut` の説明のコメントの前）に足します。

```js
  /**
   * overwriteEnabled
   * URL に `plateau_overwrite=1` があるときだけ、既存の値の書き換えを有効にする。
   * コミュニティとの協議の前は、既定で隠しておくためである。
   * API の接続先の指定（`plateau_api_url`）と同じく、URL のハッシュから読む。
   * @return {boolean}
   */
  overwriteEnabled() {
    return utilStringQs(window.location.hash).plateau_overwrite === '1';
  }


  /**
   * getOverwriteBlock
   * 候補の食い違うタグを書き換えられるかを調べ、書き換えられない理由を返す。
   * 面積を警告より先に調べる。
   * 面積の不一致では欄の行の形が変わり、警告の有無にかかわらず書き換えられないためである。
   * @param  {Object}  candidate  MatchCandidate
   * @return {null|'disabled'|'area'|'warning'}  書き換えられるときは null
   */
  getOverwriteBlock(candidate) {
    if (!this.overwriteEnabled()) return 'disabled';
    if (candidate.state === 'AREA_MISMATCH') return 'area';

    const plateauFeature = candidate.plateauFeature;
    const graph = this.context.services?.plateau?.graph?.(plateauFeature?.__datasetid__) ?? null;
    if (utilPlateauHasTransferWarning(plateauFeature, graph)) return 'warning';
    return null;
  }


  /**
   * getOverwriteKeys
   * 「PLATEAU の値」を選んだタグのうち、今も食い違っているものを返す。
   * 欄を出したあとに OSM の値が手で直されると、選択の状態に古いタグが残りうるためである。
   * @param  {Object}  candidate  MatchCandidate
   * @return {Set<string>}
   */
  getOverwriteKeys(candidate) {
    const result = new Set();
    const chosen = this._overwriteChoices.get(candidate.plateauFeature?.id);
    if (!chosen) return result;
    for (const c of candidate.conflictingTags ?? []) {
      if (chosen.has(c.key)) result.add(c.key);
    }
    return result;
  }


  /**
   * setOverwrite
   * 食い違うタグ 1 つについて、「PLATEAU の値」を使うかを切り替える。
   * 書き換えられない候補では何もしない。
   * @param  {Object}   candidate   MatchCandidate
   * @param  {string}   key         タグの名前
   * @param  {boolean}  usePlateau  真なら「PLATEAU の値」、偽なら「OSM の値」
   */
  setOverwrite(candidate, key, usePlateau) {
    if (this.getOverwriteBlock(candidate) !== null) return;

    const id = candidate.plateauFeature.id;
    const chosen = new Set(this._overwriteChoices.get(id) ?? []);
    if (usePlateau) {
      chosen.add(key);
    } else {
      chosen.delete(key);
    }

    if (chosen.size) {
      this._overwriteChoices.set(id, chosen);
    } else {
      this._overwriteChoices.delete(id);
    }

    this._refreshApplyShortcut();
    this.emit('change');
  }


  /**
   * hasWorkToApply
   * 適用して変わるものがあるか。
   * 追加するタグがあるか、書き換えられる候補で「PLATEAU の値」を選んだタグがあれば真にする。
   * 欄のボタンの有効と無効、A キーの割り当ての両方がこの関数を使う。
   * @param  {Object}  candidate  MatchCandidate
   * @return {boolean}
   */
  hasWorkToApply(candidate) {
    if (!candidate) return false;
    if (candidate.missingTags?.length) return true;
    if (this.getOverwriteBlock(candidate) !== null) return false;
    return this.getOverwriteKeys(candidate).size > 0;
  }
```

- [ ] **Step 5: 適用の処理を変える**

`apply` の中の、次の行を探します。

```js
    const action = actionTransferPlateauTags(candidate.osmFeature.id, tagsToAdd);
    editor.perform(action);
```

これを次で置き換えます。

```js
    // 書き換えは、適用の時点で書き換えられる候補のときだけ行う。
    // 選んだあとにパラメータが外された場合などは、追加だけを行う。
    const tagsToReplace = {};
    if (this.getOverwriteBlock(candidate) === null) {
      for (const key of this.getOverwriteKeys(candidate)) {
        const value = candidate.plateauFeature.tags?.[key];
        if (value !== undefined) tagsToReplace[key] = value;
      }
    }

    // 記録すると候補が計算し直されるので、その前に選択を捨てる。
    // 取り消したときは、最初の「OSM の値」の状態に戻る。
    this._overwriteChoices.delete(candidate.plateauFeature.id);

    const action = actionTransferPlateauTags(candidate.osmFeature.id, tagsToAdd, tagsToReplace);
    editor.perform(action);
```

同じ `apply` の中の `editor.commit({ annotation: { ... } })` の注記に、`dataUsed` の行の後ろへ 1 行足します。
`dataUsed` の行の末尾にカンマを付けます。

```js
        dataUsed: dataset?.dataUsed || [datasetID],
        overwrittenKeys: Object.keys(tagsToReplace)
```

`apply` の説明のコメントの最初の 1 文 `Transfers a candidate's missing tags onto its matched OSM feature, as a normal` の段落の後ろに、次の 2 行を足します。

```js
   * 書き換えられる候補では、「PLATEAU の値」を選んだタグの既存の値も置き換える。
   * 追加と書き換えは 1 回の編集として記録し、1 回の取り消しで戻る。
```

- [ ] **Step 6: A キーの条件を変える**

`_refreshApplyShortcut` の中の次の行を置き換えます。

```js
    const wantBound = !!candidate?.missingTags?.length;
```

```js
    const wantBound = this.hasWorkToApply(candidate);
```

同じ関数の説明のコメントの `Binds the Apply shortcut (A) only while a single building whose candidate` から始まる 2 行を、次で置き換えます。

```js
   * Binds the Apply shortcut (A) only while a single building whose candidate
   * has something to apply (`hasWorkToApply`) is selected, and unbinds it otherwise.
```

`_onApplyShortcut` の中の次の行を置き換えます。

```js
    if (!candidate?.missingTags?.length) return;
```

```js
    if (!this.hasWorkToApply(candidate)) return;
```

- [ ] **Step 7: 候補から外れた建物の選択を捨てる**

`_recompute` の中の `this.candidates = candidates;` の行の直後に足します。

```js
    // 候補から外れた建物の選択は捨てる。
    // 地図を動かして画面の外に出た建物も外れるので、戻ってきたときは「OSM の値」から選び直しになる。
    const liveIDs = new Set(candidates.map(c => c.plateauFeature.id));
    for (const id of this._overwriteChoices.keys()) {
      if (!liveIDs.has(id)) this._overwriteChoices.delete(id);
    }
```

- [ ] **Step 8: 試験を走らせて通ることを確かめる**

Run: `cd /Users/nyampire/git/Rapid && npm run build && npm run test:browser`
Expected: `SUMMARY:` が 857 件成功、5 件スキップ、失敗 0 件。
既存の `does not bind the shortcut for a candidate with nothing to add` も通ること（パラメータが無いので書き換えは無効）。

- [ ] **Step 9: コミットする**

```bash
cd /Users/nyampire/git/Rapid
git add modules/modes/HeightTransferMode.js test/browser/modes/HeightTransferMode.test.js
git commit -F - <<'EOF'
feat(plateau): 食い違うタグの選択の状態と、書き換えられるかの判定を持たせる

URL に plateau_overwrite=1 があるときだけ、食い違うタグを PLATEAU の値で書き換えられます。
面積の不一致と高さの警告がある建物では書き換えず、理由を返します。
適用のボタンと A キーは、同じ条件で有効になります。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: タグ転記の欄に食い違うタグの行と理由の文を出す

**Files:**
- Modify: `modules/ui/sections/plateau_tags.js`
- Modify: `data/core.yaml`
- Modify: `css/80_app.css`
- Generated: `data/l10n/core.en.json`
- Test: `test/browser/ui/sections/plateau_tags.js`

**Interfaces:**
- Consumes: Task 2 の `getOverwriteBlock`、`getOverwriteKeys`、`setOverwrite`、`hasWorkToApply`、`apply`。
  これらが無い `heightTransfer`（既存の試験の偽物）では、今と同じ表示にします。
- Produces: 画面の要素の class。
  - `ul.plateau-conflicts > li.plateau-conflict[data-key]` … 食い違うタグの行
  - `input[type=radio][value=osm]`、`input[type=radio][value=plateau]` … 選択肢
  - `.plateau-conflict-values` … 面積の不一致のときの値の対比
  - `p.plateau-overwrite-blocked` … 理由の文
  - `button.plateau-apply[disabled]` … 無効のボタン

- [ ] **Step 1: 失敗する試験を書く**

`test/browser/ui/sections/plateau_tags.js` の `MockContext` の class の直後に、偽物を足します。

```js
  // 書き換えの関数を持つ heightTransfer の偽物。
  // 選択の状態は自分で持ち、切り替えたら 'change' を出す。
  class MockOverwriteTransfer extends MockHeightTransfer {
    constructor(candidate, block) {
      super(candidate);
      this._block = block;
      this._keys = new Set();
    }
    getOverwriteBlock() { return this._block; }
    getOverwriteKeys() { return this._keys; }
    setOverwrite(cand, key, usePlateau) {
      if (usePlateau) {
        this._keys.add(key);
      } else {
        this._keys.delete(key);
      }
      this.emit('change');
    }
    hasWorkToApply(cand) {
      return !!cand.missingTags?.length || (this._block === null && this._keys.size > 0);
    }
  }

  function overwriteContext(cand, block) {
    const context = new MockContext(cand);
    context.systems.heightTransfer = new MockOverwriteTransfer(cand, block);
    return context;
  }

  const heightConflict = [{ key: 'height', osmValue: '10', plateauValue: '2.98' }];
```

ファイルの最後の `it(...)` の後ろ（`});` で閉じる直前）に足します。

```js
  describe('with overwriting enabled', () => {
    it('shows each conflicting tag with OSM chosen first and a disabled Apply', () => {
      const cand = candidate('CONFLICT', { conflictingTags: heightConflict });
      render(overwriteContext(cand, null));

      const rows = wrap.selectAll('ul.plateau-conflicts li.plateau-conflict').nodes();
      expect(rows.map(n => n.dataset.key)).to.eql(['height']);
      expect(wrap.select('input[value=osm]').property('checked')).to.equal(true);
      expect(wrap.select('input[value=plateau]').property('checked')).to.equal(false);
      expect(wrap.select('input[value=plateau]').property('disabled')).to.equal(false);
      expect(wrap.select('button.plateau-apply').property('disabled')).to.equal(true);
      // 食い違うタグの行が、食い違いの注記の代わりになる。
      expect(wrap.selectAll('.plateau-tags-note').text()).not.to.contain('conflict_note');
    });

    it('enables Apply once the Plateau value is chosen', () => {
      const cand = candidate('CONFLICT', { conflictingTags: heightConflict });
      render(overwriteContext(cand, null));

      wrap.select('input[value=plateau]').node().click();

      expect(wrap.select('input[value=plateau]').property('checked')).to.equal(true);
      const button = wrap.select('button.plateau-apply');
      expect(button.property('disabled')).to.equal(false);
      button.node().dispatchEvent(new MouseEvent('click'));
      expect(applied).to.eql([cand]);
    });

    it('disables the Plateau choice and explains why when the height may be wrong', () => {
      const cand = candidate('CONFLICT', { conflictingTags: heightConflict });
      render(overwriteContext(cand, 'warning'));

      expect(wrap.select('input[value=plateau]').property('disabled')).to.equal(true);
      expect(wrap.select('p.plateau-overwrite-blocked').text()).to.contain('overwrite_blocked_warning');
      expect(wrap.select('button.plateau-apply').property('disabled')).to.equal(true);
    });

    it('shows the values without choices and explains why for an area mismatch', () => {
      const cand = candidate('AREA_MISMATCH', { missingTags: ['ele'], conflictingTags: heightConflict });
      render(overwriteContext(cand, 'area'));

      expect(wrap.selectAll('input[type=radio]').nodes().length).to.equal(0);
      expect(wrap.selectAll('.plateau-conflict-values').nodes().length).to.equal(1);
      expect(wrap.select('p.plateau-overwrite-blocked').text()).to.contain('overwrite_blocked_area');
      expect(wrap.selectAll('.plateau-tags-note').text()).to.contain('area_mismatch_note');
      // 追加するタグがあるので、適用はできる。
      expect(wrap.select('button.plateau-apply').property('disabled')).to.equal(false);
    });

    it('shows both the additions and the conflicting tags for a CANDIDATE', () => {
      const cand = candidate('CANDIDATE', { missingTags: ['ele'], conflictingTags: heightConflict });
      render(overwriteContext(cand, null));

      const keys = wrap.selectAll('.plateau-additions li.tag-row input.key').nodes().map(n => n.value);
      expect(keys).to.eql(['ele']);
      expect(wrap.selectAll('li.plateau-conflict').nodes().length).to.equal(1);
      expect(wrap.select('button.plateau-apply').property('disabled')).to.equal(false);
    });

    it('does not show an explanation when overwriting is allowed', () => {
      const cand = candidate('CONFLICT', { conflictingTags: heightConflict });
      render(overwriteContext(cand, null));
      expect(wrap.select('p.plateau-overwrite-blocked').empty()).to.equal(true);
    });

    it('looks the same as before without the URL parameter', () => {
      const cand = candidate('CONFLICT', { conflictingTags: heightConflict });
      render(overwriteContext(cand, 'disabled'));

      expect(wrap.selectAll('li.plateau-conflict').nodes().length).to.equal(0);
      expect(wrap.selectAll('button.plateau-apply').nodes().length).to.equal(0);
      expect(wrap.selectAll('.plateau-tags-note').text()).to.contain('conflict_note');
    });
  });
```

- [ ] **Step 2: 試験を走らせて失敗を確かめる**

Run: `cd /Users/nyampire/git/Rapid && npm run build && npm run test:browser`
Expected: `with overwriting enabled` の 7 件のうち、`looks the same as before without the URL parameter` と `does not show an explanation when overwriting is allowed` 以外の 5 件が FAIL（`li.plateau-conflict` が無い、ボタンが無い）。

- [ ] **Step 3: 文言を足す**

`data/core.yaml` の `height_transfer:` の下、`area_mismatch_note:` の行の後ろに足します。
字下げは `area_mismatch_note:` と同じ 4 文字です。

```yaml
    conflicts: Differs from Plateau
    keep_osm: "Keep OSM: {value}"
    use_plateau: "Use Plateau: {value}"
    conflict_values: "OSM: {osm} / Plateau: {plateau}"
    overwrite_blocked_warning: The Plateau height of this building may be wrong, so existing values can't be replaced.
    overwrite_blocked_area: The outlines differ greatly in area, so existing values can't be replaced.
```

- [ ] **Step 4: 欄を描く処理を変える**

`modules/ui/sections/plateau_tags.js` の `NOTE_KEYS` の定義の直後に足します。

```js
// 書き換えられない理由の文。
// 'disabled'（URL のパラメータが無い）では食い違うタグの行を出さないので、文も無い。
const OVERWRITE_BLOCK_KEYS = {
  area:    'height_transfer.overwrite_blocked_area',
  warning: 'height_transfer.overwrite_blocked_warning'
};
```

`renderContent` の中の、次の部分を探します。

```js
    const noteKey = NOTE_KEYS[cand.state];
```

ここから関数の最後（`.shortcut(...)` と `);` で閉じる行、その次の `}`）までを、次で置き換えます。

```js
    // 書き換えが有効なときだけ、食い違うタグの行を出す。
    // heightTransfer が書き換えの関数を持たないときは、無効とみなして今までと同じ表示にする。
    const block = heightTransfer.getOverwriteBlock?.(cand) ?? 'disabled';
    const conflicts = (block === 'disabled') ? [] : (cand.conflictingTags ?? []);

    // 食い違うタグの行を出すときは、その行が食い違いの注記の代わりになる。
    const noteKey = (cand.state === 'CONFLICT' && conflicts.length) ? null : NOTE_KEYS[cand.state];
    if (noteKey) {
      $panel.append('p')
        .attr('class', 'plateau-tags-note')
        .text(l10n.t(noteKey));
    }

    const missing = cand.missingTags ?? [];
    if (missing.length) {
      _renderAdditions($panel, cand, missing);
    }
    if (conflicts.length) {
      _renderConflicts($panel, cand, conflicts, block);
    }

    // ボタンは、追加するタグか、選べる食い違いの行があるときに出す。
    // 何も変わらないときは、無効の表示にする。
    const selectable = conflicts.length > 0 && block !== 'area';
    if (!missing.length && !selectable) return;

    const canApply = heightTransfer.hasWorkToApply?.(cand) ?? missing.length > 0;
    $panel.append('div')
      .attr('class', 'plateau-tags-actions')
      .append('button')
      .attr('class', 'plateau-apply')
      .property('disabled', !canApply)
      .text(l10n.t('height_transfer.apply'))
      .on('click', () => {
        if (canApply) heightTransfer.apply(cand);
      })
      .call(_applyTooltip
        .title(l10n.t('height_transfer.apply_tooltip'))
        .shortcut(l10n.t('shortcuts.command.apply_plateau_tags.key'))
      );
  }


  // OSM に無いタグを、読み取り専用の行で並べる。
  // 行の見た目は、下の「All fields」のタグの表とそろえる。
  function _renderAdditions($panel, cand, missing) {
    $panel.append('p')
      .attr('class', 'plateau-tags-note')
      .text(l10n.t('height_transfer.additions'));

    const $list = $panel.append('ul')
      .attr('class', 'tag-list plateau-additions');

    for (const key of missing) {
      const value = cand.plateauFeature?.tags?.[key];
      const $inner = $list.append('li')
        .attr('class', 'tag-row readonly')
        .append('div').attr('class', 'inner-wrap');
      $inner.append('div').attr('class', 'key-wrap')
        .append('input').attr('type', 'text').attr('class', 'key').attr('readonly', true)
        .property('value', key);
      $inner.append('div').attr('class', 'value-wrap')
        .append('input').attr('type', 'text').attr('class', 'value').attr('readonly', true)
        .property('value', value);
    }
  }


  // 食い違うタグを 1 行ずつ並べる。
  // 書き換えられる候補と高さの警告がある候補では、「OSM の値」と「PLATEAU の値」の選択肢を出す。
  // 高さの警告がある候補では、「PLATEAU の値」を選べなくする。
  // 面積の不一致の候補では、選択肢を出さず、2 つの値の対比だけを出す。
  function _renderConflicts($panel, cand, conflicts, block) {
    $panel.append('p')
      .attr('class', 'plateau-tags-note')
      .text(l10n.t('height_transfer.conflicts'));

    const reasonKey = OVERWRITE_BLOCK_KEYS[block];
    if (reasonKey) {
      $panel.append('p')
        .attr('class', 'plateau-tags-note plateau-overwrite-blocked')
        .text(l10n.t(reasonKey));
    }

    const chosen = heightTransfer.getOverwriteKeys?.(cand) ?? new Set();
    const $list = $panel.append('ul')
      .attr('class', 'plateau-conflicts');

    for (const c of conflicts) {
      const $row = $list.append('li')
        .attr('class', 'plateau-conflict')
        .attr('data-key', c.key);
      $row.append('div')
        .attr('class', 'plateau-conflict-key')
        .text(c.key);

      if (block === 'area') {
        $row.append('div')
          .attr('class', 'plateau-conflict-values')
          .text(l10n.t('height_transfer.conflict_values', { osm: c.osmValue, plateau: c.plateauValue }));
        continue;
      }

      const name = `plateau-overwrite-${c.key}`;
      _renderChoice($row, name, 'osm',
        l10n.t('height_transfer.keep_osm', { value: c.osmValue }),
        !chosen.has(c.key), false,
        () => heightTransfer.setOverwrite(cand, c.key, false));
      _renderChoice($row, name, 'plateau',
        l10n.t('height_transfer.use_plateau', { value: c.plateauValue }),
        chosen.has(c.key), block === 'warning',
        () => heightTransfer.setOverwrite(cand, c.key, true));
    }
  }


  function _renderChoice($row, name, value, text, checked, disabled, onChange) {
    const $label = $row.append('label')
      .attr('class', `plateau-conflict-choice plateau-conflict-${value}`);
    $label.append('input')
      .attr('type', 'radio')
      .attr('name', name)
      .attr('value', value)
      .property('checked', checked)
      .property('disabled', disabled)
      .on('change', onChange);
    $label.append('span')
      .text(text);
  }
```

置き換えたあと、`renderContent` の前半（`selection.html('')`、`$panel` の作成、高さの警告の表示）が残っていることを確かめます。
ファイルの上のほうにある `uiSectionPlateauTags` の説明のコメントの表（`CANDIDATE -> table + Apply, no note` など）の後ろ、`*/` の前に、次の 3 行を足します。

```js
 * With overwriting enabled (`plateau_overwrite=1`), conflicting tags get their
 * own rows with an OSM / Plateau choice; see `_renderConflicts`. Without it the
 * section renders exactly as described above.
```

- [ ] **Step 5: 見た目を足す**

`css/80_app.css` の `ul.plateau-additions.tag-list { ... }` の規則の直後に足します。

```css
/* 食い違うタグの行。
   選択肢は 1 行に 1 つ並べ、値が長くても折り返せるようにする。 */
ul.plateau-conflicts {
    margin: 6px 0 8px;
    padding: 0;
    list-style: none;
}
li.plateau-conflict {
    padding: 4px 0;
    border-top: 1px solid #ecdd9a;
}
.plateau-conflict-key {
    font-family: monospace;
    font-weight: bold;
}
label.plateau-conflict-choice {
    display: block;
    font-size: 12px;
}
label.plateau-conflict-choice input {
    margin-right: 4px;
}
.plateau-conflict-values {
    font-size: 12px;
}
```

`button.plateau-apply:focus { ... }` の規則の直後に足します。

```css
/* 適用して変わるものが無いときのボタン。 */
button.plateau-apply:disabled {
    opacity: 0.5;
    cursor: default;
}
```

- [ ] **Step 6: 試験を走らせて通ることを確かめる**

Run: `cd /Users/nyampire/git/Rapid && npm run build && npm run test:browser`
Expected: `SUMMARY:` が 864 件成功、5 件スキップ、失敗 0 件。
既存の 11 件の欄の試験も通ること。

- [ ] **Step 7: 生成された文言のファイルを確かめる**

Run: `cd /Users/nyampire/git/Rapid && git status --short && git diff --stat data/l10n/core.en.json`
Expected: `data/l10n/core.en.json` に、Step 3 の 6 つの文言だけが足されています。
ほかのファイルが変わっていたら、コミットせずに理由を調べます。

- [ ] **Step 8: コミットする**

```bash
cd /Users/nyampire/git/Rapid
git add modules/ui/sections/plateau_tags.js data/core.yaml data/l10n/core.en.json css/80_app.css test/browser/ui/sections/plateau_tags.js
git commit -F - <<'EOF'
feat(plateau): タグ転記の欄で、食い違うタグの値を選べるようにする

URL に plateau_overwrite=1 があるとき、食い違うタグごとに OSM の値と PLATEAU の値の選択肢を出します。
最初は OSM の値を選んだ状態で、何も変わらないときは適用のボタンを無効にします。
高さの警告と面積の不一致で書き換えられないときは、その理由の文を出します。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: 文書を直し、手元のエディタで確かめる

**Files:**
- Modify: `PLATEAU.ja.md`
- Modify: `PLATEAU.md`
- Modify: `docs/superpowers/specs/2026-10-01-plateau-tag-overwrite-design.ja.md`

**Interfaces:**
- Consumes: Task 1〜3 のすべて。
- Produces: なし。

- [ ] **Step 1: 利用者向けの文書を直す**

`PLATEAU.ja.md` の「URLハッシュパラメータ一覧」の表の最後の行の後ろに足します。

```markdown
| `plateau_overwrite` | タグ転記で、食い違うタグを PLATEAU の値で書き換えられるようにする（協議の前の試用） | `#plateau_overwrite=1` |
```

同じファイルの次の 2 行を探します。

```markdown
値の上書きは行いません。既存の OSM の値と食い違う場合は注記を出すだけで、
上書きするかどうかはコミュニティでの合意を待っている段階です。
```

これを次で置き換えます。

```markdown
既定では値の上書きは行いません。
既存の OSM の値と食い違う場合は注記を出すだけです。
上書きするかどうかは、コミュニティでの合意を待っている段階です。

協議で実物を試してもらうため、URL に `plateau_overwrite=1` を付けたときだけ、食い違うタグごとに「OSM の値」と「PLATEAU の値」を選べます。
最初は「OSM の値」が選ばれています。
転記元の建物に高さの警告があるときと、面積の不一致のときは、「PLATEAU の値」を選べず、その理由の文が出ます。
```

`PLATEAU.md` の URL ハッシュパラメータの表（`plateau_api_url` の行がある表）の最後の行の後ろに足します。

```markdown
| `plateau_overwrite` | Let tag transfer replace conflicting values with Plateau values (trial before community consultation) | `#plateau_overwrite=1` |
```

`PLATEAU.md` に上書きをしないと書いた段落があれば、`PLATEAU.ja.md` と同じ内容を英語で足します。
探すときは `grep -n "overwrit\|override" PLATEAU.md` を使います。

- [ ] **Step 2: 設計文書の試験の置き場所を直す**

`docs/superpowers/specs/2026-10-01-plateau-tag-overwrite-design.ja.md` の次の行を探します。

```markdown
転記の操作の試験（`node --test` で 1 ファイルずつ回すもの）で、次を確かめます。
```

これを次で置き換えます。

```markdown
転記の操作の試験（ブラウザの試験、既存の `test/browser/actions/transfer_plateau_tags.test.js`）で、次を確かめます。
```

同じ文書の「URL のパラメータは、地図を動かしたあとも URL に残る必要があります。」から始まる 2 行を、次で置き換えます。

```markdown
URL のパラメータは、地図を動かしたあとも URL に残ります。
エディタの URL の管理は、知らないパラメータを消さず、決まった数個（`comment`、`source` など）だけを外すためです。
```

- [ ] **Step 3: コミットする**

```bash
cd /Users/nyampire/git/Rapid
git add PLATEAU.ja.md PLATEAU.md docs/superpowers/specs/2026-10-01-plateau-tag-overwrite-design.ja.md
git commit -F - <<'EOF'
docs(plateau): タグ転記で値を選ぶ機能と、有効にするパラメータを書く

利用者向けの文書の URL のパラメータの一覧に plateau_overwrite を足します。
設計文書の試験の置き場所を、既存の試験に合わせて直します。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 4: 手元のエディタで確かめる**

`.claude/launch.json` の `rapid-dev` で手元のエディタを起動し、本番の API のデータで確かめます。

1. `http://127.0.0.1:8080/#map=19.00/34.6650/133.9350&datasets=plateauJapan&plateau_overwrite=1` を開きます。
2. タグ転記の機能を有効にし、黄色の「!?」の印がある建物（食い違い）を選びます。
3. 欄に食い違うタグの行が出て、「Keep OSM」が選ばれ、適用のボタンが無効であることを確かめます。
4. 「Use Plateau」を選び、ボタンが有効になることと、A キーで適用できることを確かめます。
5. 「All fields」のタグの表で、値が PLATEAU の値に変わったことを確かめます。
6. 取り消し（Cmd+Z）を 1 回押し、元の値に戻ることを確かめます。
7. 地図を少し動かし、URL に `plateau_overwrite=1` が残っていることを確かめます。
8. URL から `plateau_overwrite=1` を外して読み込み直し、欄が今までと同じ表示（注記だけ）になることを確かめます。

この確かめの中では、変更を OSM に保存しません。
最後に、編集を取り消すか、ページを閉じて保存しない変更を捨てます。

黄色の「!?」の建物が見つからないときは、別の都市の中心部で探します。
高さの警告がある建物と面積の不一致の建物も見つかれば、理由の文が出ることを確かめます。
見つからなかったものは、確かめられなかったと報告します。

- [ ] **Step 5: 機微情報を確かめる**

Run: `cd /Users/nyampire/git/Rapid && git log --format=%B 3102319e3..HEAD && git diff 3102319e3..HEAD --stat`
Expected: コミットメッセージと変更したファイルに、パスワード、サーバの名前や IP アドレス、サーバ上のパス、サーバの操作の手順が含まれていません。
