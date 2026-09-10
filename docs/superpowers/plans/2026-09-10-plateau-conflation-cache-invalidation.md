# 編集を確定したときに重なりの判定を作り直す 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** すでに OSM にある建物を編集したときに、重なっている Plateau の候補の表示が追従するようにします。

**Architecture:** `PlateauService` が編集システムの `stablechange` を購読し、差分に建物が含まれるときだけ重なりの判定の記憶（`_plateauConflationCache` の `checked` と `rejected`）を消します。描画は `MapSystem` が `stagingchange` を受けて予約済みなので、こちらからは要求しません。

**Tech Stack:** JavaScript (ES modules)、karma と mocha と chai による browser 試験、esbuild による配布物の生成。

## Global Constraints

- 設計文書は `docs/superpowers/specs/2026-09-10-plateau-conflation-cache-invalidation-design.ja.md` です。判断に迷ったらこちらが優先します。
- 上流のファイル（`modules/core/EditSystem.js`、`modules/core/MapSystem.js`、`modules/core/lib/Difference.js`、`modules/pixi/PixiLayerOsm.js`）には手を入れません。
- `merge` の購読は消さずに残します。
- 高さの転記の経路（`getData` の `skipConflation`）と、`isAddBlocked` の動きは変えません。
- Plateau 以外のデータセット（mapwithai、esri、overture）には触れません。
- コミットメッセージは日本語のですます調で書き、一文ごとに改行します。末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を付けます。
- コードコメントも一文ごとに改行します。文の途中で折り返さないでください。このファイルの既存のコメントと同じ書き方です。
- 公開リポジトリのため、ファイル、コミットメッセージ、Pull Request の本文の 3 つで機微情報を確認します。検査に使う文字列そのものを本文に書かない形にします。
- 起点は `28996a427` です。ブランチは `fix/plateau-conflation-cache-invalidation` で、設計文書のコミット `e5886c5a3` がすでに載っています。

## 試験の走らせ方

browser 試験は配布物（`dist/rapid.js`）を読みます。
コードを変えたら、必ず作り直してから走らせます。

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npm run test:browser
```

1 件だけ走らせる仕組みはありません。
出力の中から試験の名前を探して結果を見ます。
途中で速く回したいときは `describe.only` を一時的に使えますが、コミットの前に必ず外します。

起点の結果は 791 件成功、5 件スキップ、失敗 0 件です。
試験を 5 件足すので、最後は 796 件成功、5 件スキップ、失敗 0 件になります。

## ファイルの構成

- 変更: `modules/services/PlateauService.js`
  - `startAsync()` に `stablechange` の購読を足します（現在の 82 行目から 92 行目のあたり）。
  - `_differenceTouchesBuilding(difference)` を新しく足します。差分に建物が含まれるかだけを答える関数で、ほかの状態を持ちません。
- 変更: `test/browser/services/PlateauService.test.js`
  - `MockEditSystem` に購読の記録と合図の発生を足します。
  - 新しい `describe` を 1 つ足し、その中に 5 件の試験を書きます。

---

### Task 1: 編集を確定したときに記憶を消す

**Files:**
- Modify: `modules/services/PlateauService.js:82-92`
- Test: `test/browser/services/PlateauService.test.js`

**Interfaces:**
- Consumes: `_service._plateauConflationCache`（`checked` と `rejected` の 2 つの `Set`）、`_service.context.systems.editor`
- Produces: `MockEditSystem.emit(eventName, ...args)`。以降の Task の試験がこれで合図を出します。

- [ ] **Step 1: `MockEditSystem` を広げて合図を出せるようにする**

`test/browser/services/PlateauService.test.js` の先頭にある `MockEditSystem` を、次の内容に置き換えます。

```js
  class MockEditSystem {
    constructor() {
      this._graph = new Rapid.Graph();
      this._entities = [];
      this._listeners = new Map();   // Map(eventName -> Array(callback))
    }
    get staging() { return { graph: this._graph }; }
    intersects() { return this._entities; }
    on(eventName, callback) {
      if (!this._listeners.has(eventName)) this._listeners.set(eventName, []);
      this._listeners.get(eventName).push(callback);
      return this;
    }
    emit(eventName, ...args) {
      for (const callback of this._listeners.get(eventName) ?? []) {
        callback(...args);
      }
    }
  }
```

- [ ] **Step 2: 失敗する試験を書く**

同じファイルの末尾、いちばん外側の `describe('PlateauService', () => {` の閉じ括弧の直前に、次を足します。

```js
  describe('#_plateauConflationCache invalidation', () => {
    // 建物 1 棟だけを持つグラフを作る。
    function graphWithBuilding(wayID, coords, tags = { building: 'yes' }) {
      let graph = new Rapid.Graph();
      const nodeIDs = [];
      for (let i = 0; i < coords.length; i++) {
        const nodeID = `${wayID}-n${i}`;
        nodeIDs.push(nodeID);
        graph = graph.replace(Rapid.osmNode({ id: nodeID, loc: coords[i] }));
      }
      nodeIDs.push(nodeIDs[0]);   // 閉じる
      graph = graph.replace(Rapid.osmWay({ id: wayID, nodes: nodeIDs, tags: tags }));
      return graph;
    }

    const SQUARE = [[0, 0], [0, 0.001], [0.001, 0.001], [0.001, 0]];

    // 記憶に印を 2 つ置く。消えたかどうかはこの 2 つで見る。
    function seedCache(service) {
      service._plateauConflationCache.checked.add('plateau-checked');
      service._plateauConflationCache.rejected.add('plateau-rejected');
    }

    function cacheSizes(service) {
      return [
        service._plateauConflationCache.checked.size,
        service._plateauConflationCache.rejected.size
      ];
    }

    beforeEach(() => {
      return _service.startAsync();   // 購読は startAsync で足される
    });


    it('clears the cache when a building way itself changes', () => {
      const editor = _service.context.systems.editor;
      const base = graphWithBuilding('w-1', SQUARE);
      const way = base.entity('w-1');
      const head = base.replace(way.update({ nodes: way.nodes.slice().reverse() }));

      seedCache(_service);
      editor.emit('stablechange', new Rapid.Difference(base, head));

      expect(cacheSizes(_service)).to.eql([0, 0]);
    });
  });
```

- [ ] **Step 3: 試験を走らせて失敗を確認する**

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npm run test:browser
```

`clears the cache when a building way itself changes` が失敗します。
`expected [ 1, 1 ] to deeply equal [ 0, 0 ]` の形の誤りが出ます。
購読が無いため記憶がそのまま残ります。

- [ ] **Step 4: 購読を足す**

`modules/services/PlateauService.js` の `startAsync()` にある `merge` の購読のうしろに、次を足します。
置き換える前の内容はこれです。

```js
    // Invalidate conflation cache when OSM data changes
    const editor = this.context.systems.editor;
    if (editor) {
      editor.on('merge', () => {
        this._plateauConflationCache.checked.clear();
        this._plateauConflationCache.rejected.clear();
      });
    }
```

置き換えたあとの内容はこれです。

```js
    // Invalidate conflation cache when OSM data changes
    const editor = this.context.systems.editor;
    if (editor) {
      editor.on('merge', () => {
        this._plateauConflationCache.checked.clear();
        this._plateauConflationCache.rejected.clear();
      });

      // 編集が確定したときも、重なりの判定をやり直す必要がある。
      // すでに OSM にある建物を動かすと重なりの有無が変わる。
      // 記憶が残っていると、候補の表示が古いままになる。
      editor.on('stablechange', () => {
        this._plateauConflationCache.checked.clear();
        this._plateauConflationCache.rejected.clear();
      });
    }
```

- [ ] **Step 5: 試験を走らせて通ることを確認する**

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npm run test:browser
```

`clears the cache when a building way itself changes` が成功します。
全体は 792 件成功、5 件スキップ、失敗 0 件になります。

- [ ] **Step 6: コミットする**

```bash
cd /Users/nyampire/git/Rapid && git add modules/services/PlateauService.js test/browser/services/PlateauService.test.js && git commit -F- <<'EOF'
fix(plateau): 編集が確定したときに重なりの判定を作り直す

すでに OSM にある建物を動かしても、重なっている候補の表示が変わりませんでした。
判定の結果を記憶している集合を消しているのが、新しいデータを取り込んだときの合図だけだったためです。

編集が確定したときの合図を購読し、記憶を消すようにしました。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: 建物と無関係な編集では記憶を残す

**Files:**
- Modify: `modules/services/PlateauService.js`（Task 1 で足した `stablechange` の購読）
- Test: `test/browser/services/PlateauService.test.js`（Task 1 で足した `describe` の中）

**Interfaces:**
- Consumes: Task 1 の `MockEditSystem.emit`、`graphWithBuilding`、`seedCache`、`cacheSizes`
- Produces: `PlateauService._differenceTouchesBuilding(difference)` → `boolean`。差分に建物が含まれれば `true` を返します。

- [ ] **Step 1: 失敗する試験を書く**

Task 1 で足した `describe` の中、`clears the cache when a building way itself changes` のうしろに足します。

```js
    it('keeps the cache when only non-building features change', () => {
      const editor = _service.context.systems.editor;
      let base = new Rapid.Graph();
      base = base.replace(Rapid.osmNode({ id: 'n-1', loc: [0, 0] }));
      base = base.replace(Rapid.osmNode({ id: 'n-2', loc: [0, 0.001] }));
      base = base.replace(Rapid.osmWay({ id: 'w-road', nodes: ['n-1', 'n-2'], tags: { highway: 'residential' } }));

      const head = base.replace(base.entity('n-2').move([0, 0.002]));

      seedCache(_service);
      editor.emit('stablechange', new Rapid.Difference(base, head));

      expect(cacheSizes(_service)).to.eql([1, 1]);
    });
```

- [ ] **Step 2: 試験を走らせて失敗を確認する**

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npm run test:browser
```

`keeps the cache when only non-building features change` が失敗します。
`expected [ 0, 0 ] to deeply equal [ 1, 1 ]` の形の誤りが出ます。
いまは差分の中身を見ずに消しているためです。

- [ ] **Step 3: 差分に建物が含まれるかを見る関数を足す**

`modules/services/PlateauService.js` の `startAsync()` のうしろ（`startAsync()` の閉じ括弧の直後）に、次の関数を足します。

```js
  /**
   * _differenceTouchesBuilding
   * 編集の差分に建物が含まれるかどうか。
   *
   * 重なりの判定が見ているのは OSM の建物だけなので、建物が含まれない編集では
   * 判定の結果は変わらない。記憶を残して無駄な作り直しを避ける。
   *
   * 差分の形は上流のファイルの持ち物で、上流を取り込んだときに変わりうる。
   * 読めないときは判断せず、記憶を消す側に倒す。
   *
   * @param   {Difference}  difference - 編集システムが渡す差分
   * @return  {boolean}     建物が含まれれば true
   */
  _differenceTouchesBuilding(difference) {
    if (!difference) return true;

    const isBuilding = (entity) => {
      const building = entity?.tags?.building;
      return Boolean(building) && building !== 'no';
    };

    try {
      for (const change of difference.changes.values()) {
        if (isBuilding(change?.head)) return true;
      }
    } catch (e) {
      return true;
    }

    return false;
  }
```

- [ ] **Step 4: 記憶を消す 2 行を関数にまとめる**

`merge` と `stablechange` の両方が同じ 2 行を持っています。
片方だけを直したときに食い違わないよう、関数にまとめます。

Step 3 で足した `_differenceTouchesBuilding` の手前に、次の関数を足します。

```js
  /**
   * _invalidateConflationCache
   * 重なりの判定の記憶を消す。
   * 次に `getData()` が呼ばれたときに、表示範囲の候補を計算し直す。
   */
  _invalidateConflationCache() {
    this._plateauConflationCache.checked.clear();
    this._plateauConflationCache.rejected.clear();
  }


```

- [ ] **Step 5: 購読を書き換える**

`startAsync()` の中の 2 つの購読を、次の内容に置き換えます。

```js
    // Invalidate conflation cache when OSM data changes
    const editor = this.context.systems.editor;
    if (editor) {
      editor.on('merge', () => this._invalidateConflationCache());

      // 編集が確定したときも、重なりの判定をやり直す必要がある。
      // すでに OSM にある建物を動かすと重なりの有無が変わる。
      // 記憶が残っていると、候補の表示が古いままになる。
      // 判定が見ているのは建物だけなので、差分に建物が含まれるときだけ消す。
      editor.on('stablechange', difference => {
        if (!this._differenceTouchesBuilding(difference)) return;
        this._invalidateConflationCache();
      });
    }
```

- [ ] **Step 6: 試験を走らせて通ることを確認する**

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npm run test:browser
```

`keeps the cache when only non-building features change` が成功します。
Task 1 の試験も引き続き成功します。
全体は 793 件成功、5 件スキップ、失敗 0 件になります。

- [ ] **Step 7: コミットする**

```bash
cd /Users/nyampire/git/Rapid && git add modules/services/PlateauService.js test/browser/services/PlateauService.test.js && git commit -F- <<'EOF'
fix(plateau): 建物と無関係な編集では判定を作り直さない

判定が見ているのは OSM の建物だけです。
建物が含まれない編集で記憶を消すと、次の描画で表示範囲の候補すべてを計算し直すことになります。

差分に建物が含まれるかを見る関数を足し、含まれるときだけ消すようにしました。
記憶を消す 2 行は、`merge` の側と共通の関数にまとめました。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: 建物の node だけが変わった場合も作り直す

**Files:**
- Modify: `modules/services/PlateauService.js`（`_differenceTouchesBuilding`）
- Test: `test/browser/services/PlateauService.test.js`（Task 1 で足した `describe` の中）

**Interfaces:**
- Consumes: Task 2 の `_differenceTouchesBuilding(difference)`
- Produces: 変更なし。関数の名前と戻り値の型は Task 2 のままです。

- [ ] **Step 1: 失敗する試験を書く**

`keeps the cache when only non-building features change` のうしろに足します。

```js
    it('clears the cache when a node of a building moves', () => {
      const editor = _service.context.systems.editor;
      const base = graphWithBuilding('w-1', SQUARE);
      const head = base.replace(base.entity('w-1-n0').move([0.0005, 0.0005]));

      seedCache(_service);
      editor.emit('stablechange', new Rapid.Difference(base, head));

      expect(cacheSizes(_service)).to.eql([0, 0]);
    });
```

- [ ] **Step 2: 試験を走らせて失敗を確認する**

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npm run test:browser
```

`clears the cache when a node of a building moves` が失敗します。
`expected [ 1, 1 ] to deeply equal [ 0, 0 ]` の形の誤りが出ます。
`difference.changes` には動かした node しか載らず、その node には `building` タグが無いためです。

- [ ] **Step 3: 親をたどる形に変える**

`_differenceTouchesBuilding` の `try` の中を、次の内容に置き換えます。

```js
    try {
      // `complete()` は変わった地物に加えて、親の way と relation も返す。
      // 建物の node を動かした場合は、ここに親の建物が現れる。
      for (const entity of difference.complete().values()) {
        if (isBuilding(entity)) return true;
      }
    } catch (e) {
      return true;
    }
```

あわせて、関数の説明の `@param` の上に、次の 2 行を足します。

```js
   * 変更後の地物は `complete()` から取る。親の way と relation を含むため、
   * 建物の node を動かした場合もここに建物が現れる。
```

- [ ] **Step 4: 試験を走らせて通ることを確認する**

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npm run test:browser
```

`clears the cache when a node of a building moves` が成功します。
Task 1 と Task 2 の試験も引き続き成功します。
`complete()` は道路の node を動かした場合に親の道路の way を返しますが、道路には `building` タグが無いので Task 2 の試験は通ったままです。
全体は 794 件成功、5 件スキップ、失敗 0 件になります。

- [ ] **Step 5: コミットする**

```bash
cd /Users/nyampire/git/Rapid && git add modules/services/PlateauService.js test/browser/services/PlateauService.test.js && git commit -F- <<'EOF'
fix(plateau): 建物の node を動かした場合も判定を作り直す

建物の node を動かすと、差分にはその node しか載りません。
node には building タグが無いため、建物の変更として数えられませんでした。

変更後の地物を complete() から取る形に変えました。
親の way と relation を含むため、node を動かした場合も親の建物が現れます。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: 建物を消した場合とタグを外した場合も作り直す

**Files:**
- Modify: `modules/services/PlateauService.js`（`_differenceTouchesBuilding`）
- Test: `test/browser/services/PlateauService.test.js`（Task 1 で足した `describe` の中）

**Interfaces:**
- Consumes: Task 3 の `_differenceTouchesBuilding(difference)`
- Produces: 変更なし。

- [ ] **Step 1: 失敗する試験を 2 件書く**

`clears the cache when a node of a building moves` のうしろに足します。

```js
    it('clears the cache when a building is deleted', () => {
      const editor = _service.context.systems.editor;
      const base = graphWithBuilding('w-1', SQUARE);
      const head = base.remove(base.entity('w-1'));

      seedCache(_service);
      editor.emit('stablechange', new Rapid.Difference(base, head));

      expect(cacheSizes(_service)).to.eql([0, 0]);
    });


    it('clears the cache when the building tag is removed', () => {
      const editor = _service.context.systems.editor;
      const base = graphWithBuilding('w-1', SQUARE);
      const head = base.replace(base.entity('w-1').update({ tags: { barrier: 'wall' } }));

      seedCache(_service);
      editor.emit('stablechange', new Rapid.Difference(base, head));

      expect(cacheSizes(_service)).to.eql([0, 0]);
    });
```

- [ ] **Step 2: 試験を走らせて 2 件とも失敗することを確認する**

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npm run test:browser
```

`clears the cache when a building is deleted` と `clears the cache when the building tag is removed` の 2 件が失敗します。
どちらも `expected [ 1, 1 ] to deeply equal [ 0, 0 ]` の形の誤りが出ます。
削除では変更後の地物が `undefined` になり、タグを外した場合は変更後の地物に `building` タグがありません。

- [ ] **Step 3: 変更前の地物も見る**

`_differenceTouchesBuilding` の `try` の中を、次の内容に置き換えます。

```js
    try {
      // `complete()` は変わった地物に加えて、親の way と relation も返す。
      // 建物の node を動かした場合は、ここに親の建物が現れる。
      // 削除された地物は値が undefined になるので、isBuilding が false を返す。
      for (const entity of difference.complete().values()) {
        if (isBuilding(entity)) return true;
      }

      // 建物を削除した場合と building タグを外した場合は、変更後の地物に建物が
      // 現れない。変更前の地物でしか分からないので、こちらも見る。
      for (const change of difference.changes.values()) {
        if (isBuilding(change?.base)) return true;
      }
    } catch (e) {
      return true;
    }
```

あわせて、関数の説明の `@param` の上に、次の 2 行を足します。

```js
   * 変更前の地物は `changes` から取る。建物を削除した場合と `building` タグを
   * 外した場合は、変更後の地物に建物が現れないため、こちらでしか分からない。
```

- [ ] **Step 4: 試験を走らせて通ることを確認する**

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npm run test:browser
```

新しい 2 件が成功します。
Task 1 から Task 3 までの試験も引き続き成功します。
全体は 796 件成功、5 件スキップ、失敗 0 件になります。

- [ ] **Step 5: コミットする**

```bash
cd /Users/nyampire/git/Rapid && git add modules/services/PlateauService.js test/browser/services/PlateauService.test.js && git commit -F- <<'EOF'
fix(plateau): 建物を消した場合とタグを外した場合も判定を作り直す

どちらも変更後の地物に建物が現れません。
削除では値が無く、タグを外した場合は building タグが残らないためです。

変更前の地物も見るようにしました。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: 仕上げと Pull Request

**Files:**
- 変更なし（確認とコミット済みの内容の送信だけです）

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

796 件成功、5 件スキップ、失敗 0 件になります。

- [ ] **Step 3: `describe.only` と `it.only` が残っていないことを確かめる**

```bash
cd /Users/nyampire/git/Rapid && grep -rn "describe.only\|it.only" test/browser/services/PlateauService.test.js || echo "残っていません"
```

`残っていません` と出ます。

- [ ] **Step 4: 機微情報を確認する**

このブランチで足した差分とコミットメッセージを、目で読んで確認します。
確認する対象は次の 4 種類です。

- 認証情報（パスワード、接続文字列、client_secret）
- サーバの識別子（ホスト名、SSH の別名、IP アドレス）
- 本番環境の内部パス
- 本番環境での操作手順

検査に使う語そのものは、この文書にも Pull Request の本文にも書きません。

```bash
cd /Users/nyampire/git/Rapid && git diff 28996a427..HEAD
```

```bash
cd /Users/nyampire/git/Rapid && git log 28996a427..HEAD --format=%B
```

どちらの出力にも、上の 4 種類が現れないことを確かめます。
今回の変更は編集ソフトの中だけで完結するため、本来どれも現れません。

- [ ] **Step 5: ブランチを送る**

```bash
cd /Users/nyampire/git/Rapid && git push -u origin fix/plateau-conflation-cache-invalidation
```

- [ ] **Step 6: Pull Request を作る**

本文を一時ファイルに書いてから渡します。
本文にも機微情報を書きません。

```bash
cd /Users/nyampire/git/Rapid && cat > /tmp/pr-body.md <<'EOF'
## 直したこと

すでに OSM にある建物を動かしても、重なっている Plateau の候補が消えたり現れたりしませんでした。
報告者はモードを往復させて、候補を作り直させていました。

重なりの判定の結果は `PlateauService._plateauConflationCache` に記憶されます。
この記憶を消していたのは `merge` の合図だけで、編集システムが新しい OSM のデータを取り込んだときにしか出ません。
編集が確定したときに出る `stablechange` を購読していませんでした。

## 変えたこと

`PlateauService.startAsync()` に `stablechange` の購読を足しました。
差分に建物が含まれるときだけ、`checked` と `rejected` の両方を消します。

建物が含まれるかどうかは `_differenceTouchesBuilding()` で見ます。
変更後の地物は `complete()` から取ります。親の way と relation を含むため、建物の node を動かした場合もここに建物が現れます。
変更前の地物は `changes` から取ります。建物を削除した場合と `building` タグを外した場合は、こちらでしか分かりません。

記憶は Plateau の候補の id で引く形で、OSM の建物の id からは引けません。
当たった候補だけを消すには位置での探索が要るため、今回は全部消します。
同じ量の計算は `merge` のたびにすでに起きています。

描画はこちらから要求していません。
`MapSystem` が `stagingchange` を受けて次の描画を予約し、その予約は `stablechange` の後で実行されるためです。
取り消しとやり直しも同じ経路を通ります。

`merge` の購読はそのまま残しています。

## 変えていないもの

高さの転記の経路（`skipConflation`）と `isAddBlocked` の動きは変えていません。
Plateau 以外のデータセットにも触れていません。
上流のファイルには手を入れていません。

## 試験

`npm run build && npm run dist && npm run test:browser` で 796 件成功、5 件スキップ、失敗 0 件です。
起点の `28996a427` では 791 件成功、5 件スキップ、失敗 0 件でした。

足した 5 件は次のとおりです。

1. 建物の way そのものが変わったとき、記憶が消えます。
2. 建物と無関係な地物だけが変わったとき、記憶が残ります。
3. 建物の node を動かしたとき、記憶が消えます。
4. 建物を削除したとき、記憶が消えます。
5. `building` タグを外したとき、記憶が消えます。

各段の 1 件目は、実装の前に失敗することを確認しています。

`npm run lint` は誤り 0 件、警告 42 件で、起点と同じ内容です。

## 設計

`docs/superpowers/specs/2026-09-10-plateau-conflation-cache-invalidation-design.ja.md` に置いています。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
gh pr create --repo nyampire/Rapid --base main --head fix/plateau-conflation-cache-invalidation --title "fix(plateau): 編集が確定したときに重なりの判定を作り直す" --body-file /tmp/pr-body.md```

- [ ] **Step 7: 実機で 1 度だけ確かめる**

自動の試験は差分を組み立てて合図を出す形で、実際の編集操作は通っていません。
手元の開発サーバで 1 度だけ通しの動作を見ます。

```bash
cd /Users/nyampire/git/Rapid && npm run start
```

`http://127.0.0.1:8080/` を開き、Plateau の対応エリアの中で、すでに OSM にある建物と重なって隠れている場所を探します。
その OSM の建物を選んで少し動かし、指を離した時点で、隠れていた候補が現れることを見ます。
取り消し（`Cmd` + `Z`）で元に戻すと、候補がふたたび隠れることも見ます。

確認が済んだら開発サーバを止めます。

## 積み残し

報告のもう 1 つの内容（隠している建物を薄く描く案）は、この計画に含めません。
報告者への確認の返事待ちのためです。
