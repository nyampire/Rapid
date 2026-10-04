# タグ転記の欄で、タグごとに OSM か Plateau のボタンを選べるようにする 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** URL に `plateau_overwrite=1` があるとき、タグ転記の欄を 1 つの表にし、OSM に無いタグと食い違うタグの各行に「OSM」と「Plateau」のボタンを置きます。

**Architecture:** 候補の計算部分（`HeightTransferMode`）の選択の状態を、「タグの名前と、`'osm'` か `'plateau'`」の組で覚える形に作り直します。
`getChoice` と `setChoice` を足し、最初の版の `getOverwriteKeys` と `setOverwrite` を消します。
タグ転記の欄は `getChoice` を読んで表を描き、ボタンが押されたら `setChoice` を呼ぶだけにします。
転記の操作（`actionTransferPlateauTags` の `replaceTags`）は最初の版のまま使います。

**Tech Stack:** JavaScript (ES modules)、karma と mocha と chai と sinon による browser 試験、d3 による画面の組み立て、esbuild による配布物の生成。

## Global Constraints

- 設計文書は `docs/superpowers/specs/2026-10-01-plateau-tag-overwrite-design.ja.md`（2026-10-03 の改訂版）です。判断に迷ったらこちらが優先します。
- URL に `plateau_overwrite=1` が無いときの画面と動作は、今と 1 つも変えません。パラメータが無いときの既存の試験は、すべてそのまま通る必要があります。
- OSM に無いタグの最初の選択は `'plateau'`、食い違うタグの最初の選択は `'osm'` です。
- 書き換えられない理由は `'disabled'`（パラメータ無し）、`'area'`（面積の不一致）、`'warning'`（高さの警告）の 3 つで、この順に調べます。この判定（`getOverwriteBlock`）は最初の版のまま変えません。
- 書き換えられない建物では、食い違うタグの「Plateau」のボタンだけを押せなくします。OSM に無いタグの行は、どちらのボタンも押せます。
- 表の行は `height`、`ele`、`building:levels` の順（`HeightTransferMatcher.js` の `TARGET_TAG_KEYS`）に並べ、OSM と PLATEAU で値が同じタグは出しません。
- 選んだボタンは濃い色（背景 `#e0a800`、枠 `#b88a00`、文字 `#ffffff`）で塗り、もう一方は白（背景 `#ffffff`、枠 `#e0c860`、文字 `#8a7a3a`）にします。選んだ状態は `aria-pressed` でも示します。
- 突き合わせの部分（`modules/core/lib/HeightTransferMatcher.js`）、地図の印（`modules/pixi/PixiLayerHeightTransfer.js`）、転記の操作（`modules/actions/transfer_plateau_tags.js`）は変えません。
- 上流のファイル（`modules/core/` の下）には手を入れません。
- 画面の文言は `data/core.yaml` に英語で、`data/l10n/core.ja.json` に日本語で足します。`npm run build` が作り直す `data/l10n/core.en.json` も一緒にコミットします。
- コミットメッセージは日本語のですます調で書き、一文ごとに改行します。末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` を付けます。
- コードコメントも一文ごとに改行します。1 つの文を 2 行に分けないでください。1 つの行に 2 つの文を入れないでください。
- 公開リポジトリのため、ファイル、コミットメッセージ、Pull Request の本文の 3 つで機微情報を確認します。
- `git add -A` と `git add .` は使わず、ファイルを名指しで加えます。
- 起点は `1e57bef1c` です。ブランチは `feature/plateau-tag-overwrite` で、最初の版の実装と改訂した設計文書が載っています。
- 起点の browser 試験の結果は 866 件成功、5 件スキップ、失敗 0 件です。

## 試験の走らせ方

browser 試験は配布物（`dist/rapid.js`）を読みます。
コードを変えたら、必ず作り直してから走らせます。

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run test:browser
```

1 件だけ走らせる仕組みはありません。
出力の中から試験の名前を探して結果を見ます。
最後の `SUMMARY:` の行で件数を確かめます。

Task 1 では、候補の計算部分の `describe('overwrite', ...)` の 13 件を、新しい `describe('choices', ...)` の 16 件に置き換えます（866 件 → 869 件）。
Task 2 では、タグ転記の欄の `describe('with overwriting enabled', ...)` の 8 件を、新しい `describe('with choice buttons', ...)` の 8 件に置き換えます（869 件のまま）。
最後は 869 件成功、5 件スキップ、失敗 0 件になります。

## ファイルの構成

| ファイル | 変更 | 役割 |
|---|---|---|
| `modules/modes/HeightTransferMode.js` | 変更 | 選択の状態を `getChoice` と `setChoice` で扱い、適用と A キーの条件をそれに合わせます。 |
| `modules/ui/sections/plateau_tags.js` | 変更 | パラメータがあるとき、見出し付きの表とタグごとの 2 つのボタンを描きます。 |
| `data/core.yaml` | 変更 | 文言を差し替えます。 |
| `data/l10n/core.ja.json` | 変更 | 日本語の文言を差し替えます。 |
| `data/l10n/core.en.json` | 生成 | `npm run build` が作り直します。 |
| `css/80_app.css` | 変更 | 最初の版の行の見た目を、表とボタンの見た目に差し替えます。 |
| `test/browser/modes/HeightTransferMode.test.js` | 変更 | Task 1 の試験です。 |
| `test/browser/ui/sections/plateau_tags.js` | 変更 | Task 2 の試験です。 |
| `PLATEAU.ja.md`、`PLATEAU.md` | 変更 | 上書きの説明を、新しい画面に合わせます。 |

---

### Task 1: 選択の状態を、タグの名前と選んだボタンの組で覚える

**Files:**
- Modify: `modules/modes/HeightTransferMode.js`
- Test: `test/browser/modes/HeightTransferMode.test.js`

**Interfaces:**
- Consumes: 既存の `actionTransferPlateauTags(entityID, addTags, replaceTags)`、既存の `getOverwriteBlock(candidate)`、`overwriteEnabled()`。
- Produces: `HeightTransferMode` の次の公開の関数。Task 2 の欄がこれを呼びます。
  - `getChoice(candidate, key: string): 'osm' | 'plateau' | null` … そのタグで選ばれているボタン。表に出ないタグ（OSM に無いタグでも食い違うタグでもないもの）には `null`。
  - `setChoice(candidate, key: string, source: 'osm' | 'plateau'): void` … 押されたボタンを覚え、`'change'` を出します。
  - `hasWorkToApply(candidate): boolean` … 追加か書き換えに回るタグが 1 つでもあれば真。
  - `getOverwriteBlock(candidate)` と `overwriteEnabled()` は変えません。
  - `getOverwriteKeys` と `setOverwrite` は消します。
  - 内部の状態の名前は `this._choices`（`Map<plateauFeatureID, Map<tagKey, 'osm'|'plateau'>>`）にします。

この作業の間、タグ転記の欄はまだ消える関数（`getOverwriteKeys`、`setOverwrite`）を呼ぶ形のままです。
欄の試験は偽物を使うので通りますが、手元のエディタで試すのは Task 2 のあとにしてください。

- [ ] **Step 1: 試験を置き換える**

`test/browser/modes/HeightTransferMode.test.js` の `describe('overwrite', () => {` の行から、それに対応する `});` の行まで（`describe('getCandidateForOSM', ...)` の直前の空行の手前まで）を消し、次で置き換えます。

```js
  describe('choices', () => {
    // OSM に height=10 があり、PLATEAU は height=12、ele=45 を持つ建物。
    // height は食い違うタグ、ele は OSM に無いタグになる。
    function mixedCandidate(overrides = {}) {
      return makeCandidate(Object.assign({
        plateauFeature: { id: 'p1', tags: { height: '12', ele: '45' } },
        state: 'CANDIDATE',
        missingTags: ['ele'],
        conflictingTags: [{ key: 'height', osmValue: '10', plateauValue: '12' }]
      }, overrides));
    }

    function conflictCandidate(overrides = {}) {
      return mixedCandidate(Object.assign({ state: 'CONFLICT', missingTags: [] }, overrides));
    }

    function enabledMode(context) {
      const mode = new Rapid.HeightTransferMode(context);
      sinon.stub(mode, 'overwriteEnabled').returns(true);
      mode.activate();
      return mode;
    }

    function applyTo(context, tags) {
      const action = context.systems.editor.performCalls[0];
      const graph = new Rapid.Graph([ Rapid.osmWay({ id: 'w1', tags: tags }) ]);
      return action(graph).entity('w1').tags;
    }

    it('is disabled without the URL parameter', () => {
      const mode = new Rapid.HeightTransferMode(makeContext());
      mode.activate();
      expect(mode.overwriteEnabled()).to.equal(false);
      expect(mode.getOverwriteBlock(mixedCandidate())).to.equal('disabled');
    });

    it('allows overwriting a matched building with no height warning', () => {
      const mode = enabledMode(makeContext());
      expect(mode.getOverwriteBlock(mixedCandidate())).to.equal(null);
    });

    it('blocks overwriting when the Plateau building has a height warning', () => {
      const mode = enabledMode(makeContext());
      const cand = mixedCandidate({
        plateauFeature: { id: 'p1', tags: { height: '0.5', ele: '45' }, heightWarnings: ['absolute'] }
      });
      expect(mode.getOverwriteBlock(cand)).to.equal('warning');
    });

    it('reports the area mismatch before the height warning', () => {
      const mode = enabledMode(makeContext());
      const cand = mixedCandidate({
        state: 'AREA_MISMATCH',
        ratio: 4.0,
        plateauFeature: { id: 'p1', tags: { height: '0.5', ele: '45' }, heightWarnings: ['absolute'] }
      });
      expect(mode.getOverwriteBlock(cand)).to.equal('area');
    });

    it('starts with Plateau for a missing tag and OSM for a conflicting tag', () => {
      const mode = enabledMode(makeContext());
      const cand = mixedCandidate();
      expect(mode.getChoice(cand, 'ele')).to.equal('plateau');
      expect(mode.getChoice(cand, 'height')).to.equal('osm');
      expect(mode.getChoice(cand, 'building:levels')).to.equal(null);
    });

    it('always adds missing tags without the URL parameter', () => {
      const mode = new Rapid.HeightTransferMode(makeContext());
      mode.activate();
      const cand = mixedCandidate();
      mode.setChoice(cand, 'ele', 'osm');
      expect(mode.getChoice(cand, 'ele')).to.equal('plateau');
      expect(mode._choices.size).to.equal(0);
    });

    it('keeps OSM for a conflicting tag on a building that cannot be overwritten', () => {
      const mode = enabledMode(makeContext());
      mode.setChoice(mixedCandidate(), 'height', 'plateau');

      // 同じ PLATEAU の建物に、あとから高さの警告が付いた場合。
      const warned = mixedCandidate({
        plateauFeature: { id: 'p1', tags: { height: '12', ele: '45' }, heightWarnings: ['absolute'] }
      });
      expect(mode.getChoice(warned, 'height')).to.equal('osm');
      // OSM に無いタグは、警告があっても選べる。
      mode.setChoice(warned, 'ele', 'osm');
      expect(mode.getChoice(warned, 'ele')).to.equal('osm');
    });

    it('remembers a choice and emits change', () => {
      const mode = enabledMode(makeContext());
      const cand = mixedCandidate();
      const spy = sinon.spy();
      mode.on('change', spy);

      mode.setChoice(cand, 'height', 'plateau');
      mode.setChoice(cand, 'ele', 'osm');

      expect(mode.getChoice(cand, 'height')).to.equal('plateau');
      expect(mode.getChoice(cand, 'ele')).to.equal('osm');
      expect(spy.callCount).to.equal(2);
    });

    it('ignores choices it cannot honour', () => {
      const mode = enabledMode(makeContext());
      const area = mixedCandidate({ state: 'AREA_MISMATCH', ratio: 4.0 });
      const spy = sinon.spy();
      mode.on('change', spy);

      mode.setChoice(area, 'height', 'plateau');                  // 書き換えられない建物の食い違うタグ
      mode.setChoice(mixedCandidate(), 'building:levels', 'plateau');   // 表に出ないタグ
      mode.setChoice(mixedCandidate(), 'height', 'both');         // 知らない値

      expect(mode._choices.size).to.equal(0);
      expect(spy.called).to.equal(false);
    });

    it('forgets the choices of a building that left the candidates', () => {
      const mode = enabledMode(makeContext());
      const cand = mixedCandidate();
      mode.candidates = [cand];
      mode.setChoice(cand, 'height', 'plateau');
      expect(mode._choices.size).to.equal(1);

      mode._recompute();   // the mocked plateau service returns no buildings

      expect(mode._choices.size).to.equal(0);
    });

    it('forgets every choice when the mode is turned off', () => {
      const mode = enabledMode(makeContext());
      const cand = mixedCandidate();
      mode.setChoice(cand, 'height', 'plateau');

      mode.deactivate();

      expect(mode._choices.size).to.equal(0);
    });

    it('carries a choice over by tag name when the tag changes from missing to conflicting', () => {
      const mode = enabledMode(makeContext());
      mode.setChoice(mixedCandidate(), 'ele', 'osm');

      // 利用者が OSM の ele に手で 5 を入れたあと、候補が計算し直された場合。
      const recomputed = mixedCandidate({
        missingTags: [],
        conflictingTags: [
          { key: 'height', osmValue: '10', plateauValue: '12' },
          { key: 'ele', osmValue: '5', plateauValue: '45' }
        ]
      });
      expect(mode.getChoice(recomputed, 'ele')).to.equal('osm');
    });

    it('apply() adds and replaces only what is set to Plateau', () => {
      const context = makeContext();
      const mode = enabledMode(context);
      const cand = mixedCandidate();
      mode.setChoice(cand, 'height', 'plateau');
      mode.setChoice(cand, 'ele', 'osm');

      mode.apply(cand);

      expect(applyTo(context, { building: 'yes', height: '10' }))
        .to.eql({ building: 'yes', height: '12' });
      expect(context.systems.editor.commitCalls[0].annotation.overwrittenKeys).to.eql(['height']);
      expect(mode._choices.size).to.equal(0);
    });

    it('apply() only adds when overwriting became unavailable after choosing', () => {
      const context = makeContext();
      const mode = enabledMode(context);
      const cand = mixedCandidate();
      mode.setChoice(cand, 'height', 'plateau');
      mode.overwriteEnabled.returns(false);   // the URL parameter was removed

      mode.apply(cand);

      expect(applyTo(context, { building: 'yes', height: '10' }))
        .to.eql({ building: 'yes', height: '10', ele: '45' });
      expect(context.systems.editor.commitCalls[0].annotation.overwrittenKeys).to.eql([]);
    });

    it('hasWorkToApply() is false only when every row is set to OSM', () => {
      const mode = enabledMode(makeContext());
      const cand = mixedCandidate();
      expect(mode.hasWorkToApply(cand)).to.equal(true);    // ele は最初 Plateau

      mode.setChoice(cand, 'ele', 'osm');
      expect(mode.hasWorkToApply(cand)).to.equal(false);   // height は最初 OSM

      mode.setChoice(cand, 'height', 'plateau');
      expect(mode.hasWorkToApply(cand)).to.equal(true);
    });

    it('binds the apply shortcut once a Plateau value is chosen, and unbinds it when switched back', () => {
      const context = makeContext();
      const mode = enabledMode(context);
      const cand = conflictCandidate();
      mode.candidates = [cand];
      context._selectedIDs = ['w1'];
      context._emit('modechange');
      expect(context.keybinding().registered.length).to.equal(0);

      mode.setChoice(cand, 'height', 'plateau');
      expect(context.keybinding().registered.length).to.equal(1);

      mode.setChoice(cand, 'height', 'osm');
      expect(context.keybinding().registered.length).to.equal(0);
    });
  });
```

- [ ] **Step 2: 試験を走らせて失敗を確かめる**

Run: `cd /Users/nyampire/git/Rapid && npm run build && npm run test:browser`
Expected: `choices` の 16 件のうち、`getChoice`、`setChoice`、`_choices` を使う 12 件が FAIL（関数が無い、`_choices` が undefined）。
`is disabled without the URL parameter`、`allows overwriting ...`、`blocks overwriting ...`、`reports the area mismatch ...` の 4 件は、今の実装でも通ります。

- [ ] **Step 3: 選択の状態の名前と形を変える**

`modules/modes/HeightTransferMode.js` のコンストラクタにある次の 3 行を探します。

```js
    // PLATEAU の建物の id ごとに、「PLATEAU の値」を選んだタグの集合を持つ。
    // 候補から外れた建物の分は、_recompute で捨てる。
    this._overwriteChoices = new Map();   // Map<plateauFeatureID, Set<tagKey>>
```

これを次で置き換えます。

```js
    // PLATEAU の建物の id ごとに、利用者が押したボタンを「タグの名前と、'osm' か 'plateau'」の組で覚える。
    // 押していないタグは覚えず、getChoice が最初の選択を返す。
    // 候補から外れた建物の分は、_recompute で捨てる。
    this._choices = new Map();   // Map<plateauFeatureID, Map<tagKey, 'osm'|'plateau'>>
```

ファイルの中の残りの `this._overwriteChoices` を、すべて `this._choices` に置き換えます。
`deactivate()` の `this._overwriteChoices.clear();`、`apply()` の `this._overwriteChoices.delete(...)`、`_recompute()` の `for (const id of this._overwriteChoices.keys())` とその中の `delete` の 4 か所です。

- [ ] **Step 4: 選択を読み書きする関数を置き換える**

`getOverwriteKeys` の説明のコメント（`/**` から）から、`setOverwrite` の関数の終わり（`}`）までを消し、次で置き換えます。
`overwriteEnabled` と `getOverwriteBlock` は残します。

```js
  /**
   * getChoice
   * 表の 1 行について、「OSM」と「Plateau」のどちらのボタンが選ばれているかを返す。
   * OSM に無いタグの最初の選択は 'plateau'、食い違うタグの最初の選択は 'osm' とする。
   * URL のパラメータが無いときは、今までと同じく OSM に無いタグを必ず追加するので、そのタグには 'plateau' を返す。
   * 書き換えられない建物の食い違うタグには、覚えた選択にかかわらず 'osm' を返す。
   * 選択はタグの名前で引くので、OSM の値が手で変えられてタグの種類が変わっても、利用者の選択が引き継がれる。
   * @param  {Object}  candidate  MatchCandidate
   * @param  {string}  key        タグの名前
   * @return {'osm'|'plateau'|null}  表に出ないタグには null
   */
  getChoice(candidate, key) {
    const kind = this._rowKind(candidate, key);
    if (!kind) return null;

    const block = this.getOverwriteBlock(candidate);
    if (block === 'disabled') return (kind === 'missing') ? 'plateau' : 'osm';
    if (kind === 'conflict' && block !== null) return 'osm';

    const chosen = this._choices.get(candidate.plateauFeature?.id)?.get(key);
    if (chosen) return chosen;
    return (kind === 'missing') ? 'plateau' : 'osm';
  }


  /**
   * setChoice
   * 表の 1 行で押されたボタンを覚え、'change' を知らせる。
   * URL のパラメータが無いとき、表に出ないタグ、知らない値、書き換えられない建物の食い違うタグに 'plateau' を渡されたときは、何もしない。
   * @param  {Object}  candidate  MatchCandidate
   * @param  {string}  key        タグの名前
   * @param  {string}  source     'osm' か 'plateau'
   */
  setChoice(candidate, key, source) {
    if (source !== 'osm' && source !== 'plateau') return;
    const kind = this._rowKind(candidate, key);
    if (!kind) return;

    const block = this.getOverwriteBlock(candidate);
    if (block === 'disabled') return;
    if (kind === 'conflict' && block !== null && source === 'plateau') return;

    const id = candidate.plateauFeature.id;
    const chosen = new Map(this._choices.get(id) ?? []);
    chosen.set(key, source);
    this._choices.set(id, chosen);

    this._refreshApplyShortcut();
    this.emit('change');
  }


  /**
   * _rowKind
   * タグが表のどの種類の行になるかを返す。
   * @return {'missing'|'conflict'|null}  OSM に無いタグは 'missing'、食い違うタグは 'conflict'、表に出ないタグは null
   */
  _rowKind(candidate, key) {
    if ((candidate.missingTags ?? []).includes(key)) return 'missing';
    if ((candidate.conflictingTags ?? []).some(c => c.key === key)) return 'conflict';
    return null;
  }


  /**
   * _tagsToApply
   * 「Plateau」が選ばれたタグを、OSM に無いものは追加に、食い違うものは書き換えに振り分ける。
   * PLATEAU の建物に値が無いタグは、どちらにも入れない。
   * @return {{ add: Object<string,string>, replace: Object<string,string> }}
   */
  _tagsToApply(candidate) {
    const add = {};
    const replace = {};
    const plateauTags = candidate.plateauFeature?.tags ?? {};

    for (const key of candidate.missingTags ?? []) {
      const value = plateauTags[key];
      if (value !== undefined && this.getChoice(candidate, key) === 'plateau') add[key] = value;
    }
    for (const c of candidate.conflictingTags ?? []) {
      const value = plateauTags[c.key];
      if (value !== undefined && this.getChoice(candidate, c.key) === 'plateau') replace[c.key] = value;
    }
    return { add, replace };
  }
```

`hasWorkToApply` の関数の本体を、次で置き換えます。
説明のコメントの `追加するタグがあるか、書き換えられる候補で「PLATEAU の値」を選んだタグがあれば真にする。` の行は、`追加か書き換えに回るタグが 1 つでもあれば真にする。` に直します。

```js
  hasWorkToApply(candidate) {
    if (!candidate) return false;
    const { add, replace } = this._tagsToApply(candidate);
    return Object.keys(add).length > 0 || Object.keys(replace).length > 0;
  }
```

- [ ] **Step 5: 適用の処理を変える**

`apply` の中の、次の部分を探します。

```js
    const tagsToAdd = {};
    for (const key of candidate.missingTags) {
      const value = candidate.plateauFeature.tags?.[key];
      if (value !== undefined) tagsToAdd[key] = value;
    }
```

これを消し、同じ関数の中の次の部分も探します。

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
```

これを次で置き換えます。

```js
    // 適用の時点の選択で、追加と書き換えを決め直す。
    // 選んだあとにパラメータが外された場合などは、getChoice が最初の選択を返すので、追加だけになる。
    const { add: tagsToAdd, replace: tagsToReplace } = this._tagsToApply(candidate);

    // 記録すると候補が計算し直されるので、その前に選択を捨てる。
    // 取り消したときは、最初の選択に戻る。
```

`apply` の説明のコメントの次の 2 行を探します。

```js
   * 書き換えられる候補では、「PLATEAU の値」を選んだタグの既存の値も置き換える。
   * 追加と書き換えは 1 回の編集として記録し、1 回の取り消しで戻る。
```

これを次で置き換えます。

```js
   * 「Plateau」が選ばれたタグのうち、OSM に無いものを追加し、食い違うものは既存の値を置き換える。
   * 追加と書き換えは 1 回の編集として記録し、1 回の取り消しで戻る。
```

- [ ] **Step 6: 試験を走らせて通ることを確かめる**

Run: `cd /Users/nyampire/git/Rapid && npm run build && npm run test:browser`
Expected: `SUMMARY:` が 869 件成功、5 件スキップ、失敗 0 件。
`apply() only forwards missing tags that actually have a Plateau value` など、`choices` の外にある既存の試験もすべて通ること。

Run: `cd /Users/nyampire/git/Rapid && grep -n "_overwriteChoices\|getOverwriteKeys\|setOverwrite" modules/modes/HeightTransferMode.js test/browser/modes/HeightTransferMode.test.js`
Expected: 何も出ません。

- [ ] **Step 7: コミットする**

```bash
cd /Users/nyampire/git/Rapid
git add modules/modes/HeightTransferMode.js test/browser/modes/HeightTransferMode.test.js
git commit -F - <<'EOF'
feat(plateau): 選択の状態を、タグの名前と選んだボタンの組で覚える

食い違うタグだけを扱っていた選択の状態を、OSM に無いタグも含めて扱えるようにします。
getChoice と setChoice で、タグごとに OSM と Plateau のどちらが選ばれているかを読み書きします。
OSM に無いタグで OSM を選ぶと、そのタグは追加しません。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: タグ転記の欄を、見出し付きの表とタグごとの 2 つのボタンにする

**Files:**
- Modify: `modules/ui/sections/plateau_tags.js`
- Modify: `data/core.yaml`
- Modify: `data/l10n/core.ja.json`
- Modify: `css/80_app.css`
- Generated: `data/l10n/core.en.json`
- Test: `test/browser/ui/sections/plateau_tags.js`

**Interfaces:**
- Consumes: Task 1 の `getChoice(candidate, key)`、`setChoice(candidate, key, source)`、`hasWorkToApply(candidate)`、既存の `getOverwriteBlock(candidate)`、`apply(candidate)`。
  `getOverwriteBlock` を持たない `heightTransfer`（既存の試験の偽物）では、今と同じ表示にします。
  `TARGET_TAG_KEYS` を `modules/core/lib/HeightTransferMatcher.js` から読み込みます。
- Produces: 画面の要素の class。
  - `table.plateau-choices` … 表
  - `table.plateau-choices thead th` … 見出し（空、「OSM」、「Plateau」の 3 つ）
  - `tr.plateau-choice-row[data-key]` … タグの行
  - `button.plateau-choice.plateau-choice-osm`、`button.plateau-choice.plateau-choice-plateau` … ボタン。選ばれたものは `.selected` と `aria-pressed="true"`
  - `p.plateau-overwrite-blocked` … 理由の文
  - `button.plateau-apply[disabled]` … 押せない適用のボタン

- [ ] **Step 1: 試験を置き換える**

`test/browser/ui/sections/plateau_tags.js` の、次の 3 つを消します。

- `// 書き換えの関数を持つ heightTransfer の偽物。` のコメントから始まる `class MockOverwriteTransfer` の定義
- `function overwriteContext(cand, block) { ... }`
- `const heightConflict = [...];`

消した場所に、次を書きます。

```js
  // 選択の関数を持つ heightTransfer の偽物。
  // 選択はタグの名前で自分で持ち、押されたら 'change' を出す。
  class MockChoiceTransfer extends MockHeightTransfer {
    constructor(candidate, block) {
      super(candidate);
      this._block = block;
      this._choices = new Map();
      this.setCalls = [];
    }
    getOverwriteBlock() { return this._block; }
    getChoice(cand, key) {
      const isMissing = cand.missingTags.includes(key);
      const isConflict = cand.conflictingTags.some(c => c.key === key);
      if (!isMissing && !isConflict) return null;
      if (isConflict && this._block !== null) return 'osm';
      return this._choices.get(key) ?? (isMissing ? 'plateau' : 'osm');
    }
    setChoice(cand, key, source) {
      this.setCalls.push([key, source]);
      this._choices.set(key, source);
      this.emit('change');
    }
    hasWorkToApply(cand) {
      const keys = [...cand.missingTags, ...cand.conflictingTags.map(c => c.key)];
      return keys.some(k => this.getChoice(cand, k) === 'plateau');
    }
  }

  function choiceContext(cand, block) {
    const context = new MockContext(cand);
    context.systems.heightTransfer = new MockChoiceTransfer(cand, block);
    return context;
  }

  // OSM に building:levels=2 があり、PLATEAU は height、ele、building:levels=1 を持つ建物。
  function mixed(state = 'CANDIDATE') {
    return candidate(state, {
      osmFeature: { id: 'w1', type: 'way', tags: { building: 'yes', 'building:levels': '2' } },
      plateauFeature: { tags: { height: '2.98', ele: '69.1', 'building:levels': '1' } },
      missingTags: ['height', 'ele'],
      conflictingTags: [{ key: 'building:levels', osmValue: '2', plateauValue: '1' }]
    });
  }

  function texts(selector) {
    return wrap.selectAll(selector).nodes().map(n => n.textContent);
  }

  function selected(key) {
    const row = wrap.select(`tr.plateau-choice-row[data-key="${key}"]`);
    const osm = row.select('button.plateau-choice-osm');
    const plateau = row.select('button.plateau-choice-plateau');
    return {
      osm: osm.classed('selected') && osm.attr('aria-pressed') === 'true',
      plateau: plateau.classed('selected') && plateau.attr('aria-pressed') === 'true'
    };
  }
```

`describe('with overwriting enabled', () => {` の行から、それに対応する `});` の行までを消し、次で置き換えます。

```js
  describe('with choice buttons', () => {
    it('shows one table with OSM and Plateau headings and value-only buttons', () => {
      render(choiceContext(mixed(), null));

      expect(texts('table.plateau-choices thead th')).to.eql(['', 'height_transfer.column_osm', 'height_transfer.column_plateau']);
      expect(wrap.selectAll('tr.plateau-choice-row').nodes().map(n => n.dataset.key))
        .to.eql(['height', 'ele', 'building:levels']);
      expect(texts('button.plateau-choice-osm'))
        .to.eql(['height_transfer.osm_none', 'height_transfer.osm_none', '2']);
      expect(texts('button.plateau-choice-plateau')).to.eql(['2.98', '69.1', '1']);
      // 表が、これまでの見出しと読み取り専用の表の代わりになる。
      expect(wrap.selectAll('.plateau-additions').nodes().length).to.equal(0);
      expect(wrap.selectAll('.plateau-tags-note').nodes().map(n => n.textContent).join(' '))
        .not.to.contain('additions');
    });

    it('starts with Plateau for missing tags and OSM for conflicting tags', () => {
      render(choiceContext(mixed(), null));
      expect(selected('height')).to.eql({ osm: false, plateau: true });
      expect(selected('ele')).to.eql({ osm: false, plateau: true });
      expect(selected('building:levels')).to.eql({ osm: true, plateau: false });
      expect(wrap.select('button.plateau-apply').property('disabled')).to.equal(false);
    });

    it('keeps a pressed button selected until the other one in the row is pressed', () => {
      const context = choiceContext(mixed(), null);
      render(context);

      wrap.select('tr[data-key="building:levels"] button.plateau-choice-plateau').node().click();
      expect(selected('building:levels')).to.eql({ osm: false, plateau: true });

      wrap.select('tr[data-key="ele"] button.plateau-choice-osm').node().click();
      expect(selected('ele')).to.eql({ osm: true, plateau: false });
      // ほかの行の選択は変わらない。
      expect(selected('building:levels')).to.eql({ osm: false, plateau: true });

      expect(context.systems.heightTransfer.setCalls)
        .to.eql([['building:levels', 'plateau'], ['ele', 'osm']]);
    });

    it('enables Apply only while something is set to Plateau', () => {
      const cand = mixed('CONFLICT');
      cand.missingTags = [];
      render(choiceContext(cand, null));
      expect(wrap.select('button.plateau-apply').property('disabled')).to.equal(true);
      // 食い違いの注記の代わりに、表が出る。
      expect(wrap.selectAll('.plateau-tags-note').nodes().map(n => n.textContent).join(' '))
        .not.to.contain('conflict_note');

      wrap.select('button.plateau-choice-plateau').node().click();
      const button = wrap.select('button.plateau-apply');
      expect(button.property('disabled')).to.equal(false);
      button.node().dispatchEvent(new MouseEvent('click'));
      expect(applied).to.eql([cand]);
    });

    it('disables Plateau only for conflicting tags and explains why when the height may be wrong', () => {
      render(choiceContext(mixed(), 'warning'));

      expect(wrap.select('tr[data-key="building:levels"] button.plateau-choice-plateau').property('disabled')).to.equal(true);
      expect(wrap.select('tr[data-key="height"] button.plateau-choice-plateau').property('disabled')).to.equal(false);
      expect(wrap.select('tr[data-key="height"] button.plateau-choice-osm').property('disabled')).to.equal(false);
      expect(wrap.select('p.plateau-overwrite-blocked').text()).to.contain('overwrite_blocked_warning');
    });

    it('shows the area note and the reason for an area mismatch', () => {
      render(choiceContext(mixed('AREA_MISMATCH'), 'area'));

      expect(wrap.select('tr[data-key="building:levels"] button.plateau-choice-plateau').property('disabled')).to.equal(true);
      expect(wrap.select('p.plateau-overwrite-blocked').text()).to.contain('overwrite_blocked_area');
      expect(wrap.selectAll('.plateau-tags-note').nodes().map(n => n.textContent).join(' '))
        .to.contain('area_mismatch_note');
    });

    it('does not explain anything when nothing is blocked or nothing conflicts', () => {
      render(choiceContext(mixed(), null));
      expect(wrap.select('p.plateau-overwrite-blocked').empty()).to.equal(true);

      d3.selectAll('.ui-wrap').remove();
      const cand = mixed();
      cand.conflictingTags = [];
      render(choiceContext(cand, 'warning'));
      expect(wrap.select('p.plateau-overwrite-blocked').empty()).to.equal(true);
    });

    it('looks the same as before without the URL parameter', () => {
      render(choiceContext(mixed(), 'disabled'));

      expect(wrap.selectAll('table.plateau-choices').nodes().length).to.equal(0);
      const keys = wrap.selectAll('.plateau-additions li.tag-row input.key').nodes().map(n => n.value);
      expect(keys).to.eql(['height', 'ele']);
      expect(wrap.select('button.plateau-apply').property('disabled')).to.equal(false);
    });
  });
```

- [ ] **Step 2: 試験を走らせて失敗を確かめる**

Run: `cd /Users/nyampire/git/Rapid && npm run build && npm run test:browser`
Expected: `with choice buttons` の 8 件のうち 6 件が FAIL（`table.plateau-choices` と `button.plateau-choice-*` が無い）。
`does not explain anything when nothing is blocked or nothing conflicts` と `looks the same as before without the URL parameter` の 2 件は、今の実装でも通ります。

- [ ] **Step 3: 文言を差し替える**

`data/core.yaml` の `height_transfer:` の下にある次の 4 行を消します。

```yaml
    conflicts: Differs from Plateau
    keep_osm: "Keep OSM: {value}"
    use_plateau: "Use Plateau: {value}"
    conflict_values: "OSM: {osm} / Plateau: {plateau}"
```

同じ場所（`overwrite_blocked_warning:` の行の前）に、次の 3 行を足します。
字下げは 4 文字です。

```yaml
    column_osm: OSM
    column_plateau: Plateau
    osm_none: none
```

`data/l10n/core.ja.json` の `"height_transfer"` の中にある次の 4 行を消します。

```json
      "conflicts": "Plateau と異なる値",
      "keep_osm": "OSM の値を使う: {value}",
      "use_plateau": "Plateau の値を使う: {value}",
      "conflict_values": "OSM: {osm} / Plateau: {plateau}",
```

同じ場所に、次の 3 行を足します。

```json
      "column_osm": "OSM",
      "column_plateau": "Plateau",
      "osm_none": "なし",
```

`python3 -c "import json;json.load(open('data/l10n/core.ja.json'))"` で、JSON が壊れていないことを確かめます。

- [ ] **Step 4: 欄を描く処理を変える**

`modules/ui/sections/plateau_tags.js` の先頭の import の最後に、1 行足します。

```js
import { TARGET_TAG_KEYS } from '../../core/lib/HeightTransferMatcher.js';
```

`uiSectionPlateauTags` の説明のコメントの次の 2 行を探します。

```js
 * URL パラメータ `plateau_overwrite=1` で書き換えを有効にすると、食い違うタグに専用の行が付き、OSM と PLATEAU の値を選べます（`_renderConflicts` を参照）。
 * 有効にしないときは、上に書いたとおりに表示します。
```

これを次で置き換えます。

```js
 * URL パラメータ `plateau_overwrite=1` があるときは、OSM に無いタグと食い違うタグを 1 つの表に並べ、行ごとに「OSM」と「Plateau」のボタンを置きます（`_renderChoices` を参照）。
 * パラメータが無いときは、上に書いたとおりに表示します。
```

`renderContent` の中の、次の行から関数の終わり（`.shortcut(...)` と `);` で閉じる行、その次の `}`）までを探します。

```js
    // 書き換えが有効なときだけ、食い違うタグの行を出す。
```

ここから、その後ろの `_renderConflicts` と `_renderChoice` の関数の終わりまで（`section.entityIDs = function(val) {` の手前の空行まで）を消し、次で置き換えます。
`_renderAdditions` は消さずに残すので、置き換えのあとに `_renderAdditions` が 1 つだけあることを確かめます。

```js
    // パラメータがあるときだけ、ボタンの表を出す。
    // heightTransfer が getOverwriteBlock を持たないときは、パラメータが無いとみなして今までと同じ表示にする。
    // getOverwriteBlock は、書き換えられるときに null を返す。
    // null をパラメータ無しと取り違えないように、関数の有無で分ける。
    const hasBlock = typeof heightTransfer.getOverwriteBlock === 'function';
    const block = hasBlock ? heightTransfer.getOverwriteBlock(cand) : 'disabled';
    if (block === 'disabled') {
      _renderPlain($panel, cand);
    } else {
      _renderChoices($panel, cand, block);
    }
  }


  // パラメータが無いときの表示。
  // 状態ごとの注記、追加するタグの読み取り専用の表、適用のボタンを出す。
  function _renderPlain($panel, cand) {
    const noteKey = NOTE_KEYS[cand.state];
    if (noteKey) {
      $panel.append('p')
        .attr('class', 'plateau-tags-note')
        .text(l10n.t(noteKey));
    }

    const missing = cand.missingTags ?? [];
    if (!missing.length) return;

    _renderAdditions($panel, cand, missing);
    _renderApply($panel, cand, true);
  }


  // パラメータがあるときの表示。
  // OSM に無いタグと食い違うタグを 1 つの表に並べ、行ごとに「OSM」と「Plateau」のボタンを置く。
  // 食い違いの注記は出さず、表がその代わりになる。
  function _renderChoices($panel, cand, block) {
    if (cand.state === 'AREA_MISMATCH') {
      $panel.append('p')
        .attr('class', 'plateau-tags-note')
        .text(l10n.t(NOTE_KEYS.AREA_MISMATCH));
    }

    const missing = cand.missingTags ?? [];
    const conflicts = cand.conflictingTags ?? [];
    const keys = TARGET_TAG_KEYS.filter(k => missing.includes(k) || conflicts.some(c => c.key === k));
    if (!keys.length) return;

    // 理由の文は、押せない「Plateau」のボタンがあるときだけ出す。
    const reasonKey = OVERWRITE_BLOCK_KEYS[block];
    if (reasonKey && conflicts.length) {
      $panel.append('p')
        .attr('class', 'plateau-tags-note plateau-overwrite-blocked')
        .text(l10n.t(reasonKey));
    }

    const $table = $panel.append('table')
      .attr('class', 'plateau-choices');
    const $head = $table.append('thead').append('tr');
    $head.append('th');
    $head.append('th').text(l10n.t('height_transfer.column_osm'));
    $head.append('th').text(l10n.t('height_transfer.column_plateau'));

    const $body = $table.append('tbody');
    for (const key of keys) {
      const conflict = conflicts.find(c => c.key === key);
      const osmValue = conflict ? conflict.osmValue : l10n.t('height_transfer.osm_none');
      const plateauValue = cand.plateauFeature?.tags?.[key];
      const choice = heightTransfer.getChoice(cand, key);
      // 書き換えられない建物では、食い違うタグの「Plateau」だけを押せなくする。
      const plateauDisabled = !!conflict && block !== null;

      const $row = $body.append('tr')
        .attr('class', 'plateau-choice-row')
        .attr('data-key', key);
      $row.append('th')
        .attr('class', 'plateau-choice-key')
        .text(key);
      _renderChoiceButton($row, cand, key, 'osm', osmValue, choice === 'osm', false);
      _renderChoiceButton($row, cand, key, 'plateau', plateauValue, choice === 'plateau', plateauDisabled);
    }

    _renderApply($panel, cand, heightTransfer.hasWorkToApply(cand));
  }


  // 表の 1 つのボタン。
  // 選ばれたボタンは .selected と aria-pressed で示し、色は css の規則で付ける。
  function _renderChoiceButton($row, cand, key, source, value, isSelected, isDisabled) {
    $row.append('td')
      .append('button')
      .attr('class', `plateau-choice plateau-choice-${source}`)
      .classed('selected', isSelected)
      .attr('aria-pressed', String(isSelected))
      .property('disabled', isDisabled)
      .text(value)
      .on('click', () => heightTransfer.setChoice(cand, key, source));
  }


  // 適用のボタン。
  // 何も変わらないときは、押せない表示にする。
  function _renderApply($panel, cand, canApply) {
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
```

`_renderAdditions` は、`_renderApply` の後ろではなく元の位置（`renderContent` の後ろ）に残っていて構いません。
同じ関数の中の関数どうしなので、並び順は動作に関係しません。

置き換えたあと、`renderContent` の前半（`selection.html('')`、`$panel` の作成、高さの警告の表示）が残っていることを確かめます。

- [ ] **Step 5: 見た目を差し替える**

`css/80_app.css` の、次のコメントから始まる規則のまとまりを探します。

```css
/* 食い違うタグの行。
```

このコメントから、`.plateau-conflict-values { ... }` の規則の終わりまで（`ul.plateau-conflicts`、`li.plateau-conflict`、`.plateau-conflict-key`、`label.plateau-conflict-choice`、`label.plateau-conflict-choice input`、`.plateau-conflict-values`）を消し、次で置き換えます。

```css
/* タグごとに OSM か Plateau の値を選ぶ表。
   選んだボタンは濃い色で塗り、エディタの既定のボタンの見た目に上書きされないよう、欄の class から指定する。 */
table.plateau-choices {
    width: 100%;
    margin: 6px 0 8px;
    border-collapse: collapse;
    table-layout: fixed;
}
table.plateau-choices thead th {
    padding: 0 0 4px;
    color: #7a6a1a;
    font-size: 12px;
    font-weight: normal;
    text-align: center;
}
table.plateau-choices thead th:first-child {
    width: 40%;
}
table.plateau-choices tbody tr {
    border-top: 1px solid #ecdd9a;
}
table.plateau-choices th.plateau-choice-key {
    padding: 5px 4px 5px 0;
    font-family: monospace;
    font-weight: normal;
    text-align: left;
    overflow-wrap: anywhere;
}
table.plateau-choices td {
    padding: 5px 0;
}
.plateau-tags-panel button.plateau-choice {
    width: 100%;
    height: auto;
    padding: 4px 6px;
    border: 1px solid #e0c860;
    border-radius: 0;
    background: #ffffff;
    color: #8a7a3a;
    font-size: 13px;
    font-weight: normal;
}
.plateau-tags-panel button.plateau-choice-osm {
    border-radius: 4px 0 0 4px;
}
.plateau-tags-panel button.plateau-choice-plateau {
    border-left: none;
    border-radius: 0 4px 4px 0;
}
.plateau-tags-panel button.plateau-choice.selected {
    border-color: #b88a00;
    background: #e0a800;
    color: #ffffff;
    font-weight: bold;
}
@media (hover: hover) {
    .plateau-tags-panel button.plateau-choice:not(.selected):not(:disabled):hover {
        background: #fff6c8;
    }
    .plateau-tags-panel button.plateau-choice.selected:hover {
        background: #e0a800;
    }
}
.plateau-tags-panel button.plateau-choice:disabled {
    opacity: 0.4;
    cursor: default;
}
```

- [ ] **Step 6: 試験を走らせて通ることを確かめる**

Run: `cd /Users/nyampire/git/Rapid && npm run build && npm run test:browser`
Expected: `SUMMARY:` が 869 件成功、5 件スキップ、失敗 0 件。
パラメータが無いときの既存の欄の試験（`shows an actionable Apply fix for a CANDIDATE`、`shows CONFLICT as information only, with no fix button` など 11 件）も通ること。

Run: `cd /Users/nyampire/git/Rapid && grep -rn "getOverwriteKeys\|setOverwrite\|_renderConflicts\|plateau-conflict\|keep_osm\|use_plateau\|conflict_values\|\"conflicts\"" modules css data/core.yaml data/l10n/core.ja.json data/l10n/core.en.json test/browser`
Expected: 何も出ません。

Run: `cd /Users/nyampire/git/Rapid && npx eslint modules/ui/sections/plateau_tags.js modules/modes/HeightTransferMode.js test/browser/ui/sections/plateau_tags.js`
Expected: 何も出ません。

- [ ] **Step 7: 生成された文言のファイルを確かめる**

Run: `cd /Users/nyampire/git/Rapid && git status --short && git diff data/l10n/core.en.json`
Expected: `data/l10n/core.en.json` では、Step 3 で消した 4 つの文言が消え、足した 3 つの文言が足されています。
ほかのファイルが変わっていたら、コミットせずに理由を調べます。

- [ ] **Step 8: コミットする**

```bash
cd /Users/nyampire/git/Rapid
git add modules/ui/sections/plateau_tags.js data/core.yaml data/l10n/core.ja.json data/l10n/core.en.json css/80_app.css test/browser/ui/sections/plateau_tags.js
git commit -F - <<'EOF'
feat(plateau): タグ転記の欄を、タグごとに OSM か Plateau のボタンを選ぶ表にする

URL に plateau_overwrite=1 があるとき、OSM に無いタグと食い違うタグを 1 つの表に並べます。
表の上に OSM と Plateau の見出しを置き、各行の 2 つのボタンには値だけを書きます。
選んだボタンは濃い色で塗り、同じ行のもう一方を押すまで変わりません。
食い違うタグをラジオボタンで選ぶ最初の版の表示は消します。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: 利用者向けの文書を新しい画面に合わせ、手元のエディタで確かめる

**Files:**
- Modify: `PLATEAU.ja.md`
- Modify: `PLATEAU.md`

**Interfaces:**
- Consumes: Task 1 と Task 2 のすべて。
- Produces: なし。

- [ ] **Step 1: 利用者向けの文書を直す**

`PLATEAU.ja.md` の次の 3 行を探します。

```markdown
協議で実物を試してもらうため、URL に `plateau_overwrite=1` を付けたときだけ、食い違うタグごとに「OSM の値」と「PLATEAU の値」を選べます。
最初は「OSM の値」が選ばれています。
転記元の建物に高さの警告があるときと、面積の不一致のときは、「PLATEAU の値」を選べず、その理由の文が出ます。
```

これを次で置き換えます。

```markdown
協議で実物を試してもらうため、URL に `plateau_overwrite=1` を付けたときだけ、OSM に無いタグと食い違うタグを 1 つの表に並べ、行ごとに「OSM」と「Plateau」のボタンで使う値を選べます。
最初は、OSM に無いタグでは「Plateau」、食い違うタグでは「OSM」が選ばれています。
OSM に無いタグで「OSM」を選ぶと、そのタグは追加しません。
転記元の建物に高さの警告があるときと、面積の不一致のときは、食い違うタグの「Plateau」を選べず、その理由の文が出ます。
```

`PLATEAU.md` の次の 3 行を探します。

```markdown
So that people taking part in the consultation can try it, adding `plateau_overwrite=1` to the URL lets each conflicting tag be set to either the OSM value or the Plateau value.
The OSM value is selected initially.
When the source building has a height warning, or in an `AREA_MISMATCH`, the Plateau value cannot be selected and the reason is shown.
```

これを次で置き換えます。

```markdown
So that people taking part in the consultation can try it, adding `plateau_overwrite=1` to the URL lists missing and conflicting tags in one table, with an "OSM" and a "Plateau" button on each row to pick the value to use.
Plateau is selected initially for missing tags, and OSM for conflicting tags.
Choosing OSM for a missing tag leaves that tag out.
When the source building has a height warning, or in an `AREA_MISMATCH`, Plateau cannot be selected for conflicting tags and the reason is shown.
```

- [ ] **Step 2: コミットする**

```bash
cd /Users/nyampire/git/Rapid
git add PLATEAU.ja.md PLATEAU.md
git commit -F - <<'EOF'
docs(plateau): タグごとに OSM か Plateau のボタンを選ぶ画面を説明する

利用者向けの文書の上書きの説明を、1 つの表とタグごとの 2 つのボタンの画面に合わせます。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 3: 手元のエディタで確かめる**

手元のエディタを起動し（`npm run start:server`、配布物は Task 2 の Step 6 で作り直し済み）、本番の API のデータで確かめます。

1. `http://127.0.0.1:8080/#map=19.00/34.66492/133.93463&background=Bing&datasets=plateauJapan&plateau_overwrite=1` を開き、タグ転記の機能を有効にします。
2. 検索の欄で `w755795603` を選びます（OSM は `building:levels=2`、PLATEAU は `height=8.2`、`ele=6.4`、`building:levels=1`）。
3. 表の見出しに「OSM」と「Plateau」が出て、最初は height と ele で「Plateau」、building:levels で「OSM」が塗られていることを確かめます。
4. ele の「OSM」と building:levels の「Plateau」を押し、押したボタンが塗られたまま残ることを確かめます。
5. A キーで適用し、height が追加され、building:levels が 1 に書き換わり、ele が追加されないことを確かめます。
6. 取り消しを 1 回押し、元のタグ（`building=yes`、`building:levels=2`）に戻ることを確かめます。
7. 大阪市の `w179076135`（面積の不一致）で、食い違うタグの「Plateau」が押せず、理由の文が出ることを確かめます。
8. URL から `plateau_overwrite=1` を外して読み込み直し、欄が今までと同じ表示に戻ることを確かめます。

この確かめの中では、変更を OSM に保存しません。
最後に編集を取り消し、編集の数が 0 であることを確かめます。

- [ ] **Step 4: 機微情報を確かめる**

Run: `cd /Users/nyampire/git/Rapid && git log --format=%B 1e57bef1c..HEAD && git diff 1e57bef1c..HEAD --stat`
Expected: コミットメッセージと変更したファイルに、パスワード、サーバの名前や IP アドレス、サーバ上のパス、サーバの操作の手順が含まれていません。
