# OSM のレイヤー消灯をダイアログで伝える実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目標:** OSM のデータのレイヤーが消えているために PLATEAU の候補を伏せたことを、画面下端の一時的な通知ではなく、ページを開き直すごとに 1 回だけ出るダイアログで伝えます。

**構成:** `PlateauService` は `osmlayeroff` という出来事を 1 回だけ発生させるだけにし、画面に何を出すかは新しい部品 `UiPlateauOsmLayerOffDialog` が決めます。ダイアログは既存の `uiConfirm` で組み立て、「次から表示しない」の状態を `StorageSystem` に保存します。

**設計文書:** `docs/superpowers/specs/2026-09-08-plateau-osm-layer-off-dialog-design.ja.md`

**使う道具:** JavaScript (ES modules)、d3-selection、karma と mocha と chai、happen

## 全体の制約

- リポジトリは `/Users/nyampire/git/Rapid`、ブランチは `feature/plateau-osm-layer-off-notice`、起点は `fb97052fc` です。
- 保存する名前は `plateau.osm-layer-off-dialog.hidden` です。値は文字列の `'true'` だけを使います。
- 出来事の名前は `osmlayeroff` です。
- 文言の名前は `plateau_conflation.osm_layer_off_title`、`plateau_conflation.osm_layer_off`、`plateau_conflation.dont_show_again` の 3 つです。
- 試験を動かす前に `npm run build` と `npm run dist` を実行します。実行しないと古い版を測ります。
- 起点での試験は 770 件成功、5 件スキップ、失敗 0 件です。
- 日本語のコメントはですます調では書かず、既存のコメントの文体に合わせます。

---

### Task 1: 判定の側を、出来事を 1 回発生させるだけにする

**ファイル:**
- 変更: `modules/services/PlateauService.js`（47 行目、340 行目から 350 行目、390 行目から 408 行目）
- 試験: `test/browser/services/PlateauService.test.js`（777 行目から 820 行目）

**やり取りする名前:**
- 提供するもの: `PlateauService` が `osmlayeroff` を発生させます。引数はありません。ページを開き直すまでに 1 回だけです。
- 消えるもの: `PlateauService.prototype._notifyOsmLayerOff` を削除します。以後どこからも呼びません。

- [ ] **手順 1: 落ちる試験を書く**

`test/browser/services/PlateauService.test.js` の 777 行目から 820 行目、つまり `// 候補が出ない理由を利用者に伝える。` で始まるコメントから `it('tells the user again after the layer is switched on and off', ...)` の終わりまでを、次の内容で置き換えます。

```js
    // 候補を伏せた理由がレイヤーの消灯であることを、一度だけ知らせる。
    // 画面に何を出すかは `UiPlateauOsmLayerOffDialog` が決める。
    function countOsmLayerOff(service) {
      const seen = { count: 0 };
      service.on('osmlayeroff', () => { seen.count++; });
      return seen;
    }

    it('announces the switched-off OSM layer', () => {
      const seen = countOsmLayerOff(_service);
      setOsmState(_service, { layerEnabled: false });
      _service.getData('ds1');
      expect(seen.count).to.equal(1);
    });

    it('announces it only once while the layer stays switched off', () => {
      const seen = countOsmLayerOff(_service);
      setOsmState(_service, { layerEnabled: false });
      _service.getData('ds1');
      _service.getData('ds1');
      expect(seen.count).to.equal(1, '同じ状態で何度も知らせない');
    });

    it('does not announce it again after the layer is switched on and off', () => {
      const seen = countOsmLayerOff(_service);
      setOsmState(_service, { layerEnabled: false });
      _service.getData('ds1');
      setOsmState(_service, { layerEnabled: true });
      _service.getData('ds1');
      setOsmState(_service, { layerEnabled: false });
      _service.getData('ds1');
      expect(seen.count).to.equal(1, 'ページを開き直すまでは 1 回だけ');
    });

    it('stays quiet while the tiles are still loading', () => {
      const seen = countOsmLayerOff(_service);
      setOsmState(_service, { tilesLoaded: false });
      _service.getData('ds1');
      expect(seen.count).to.equal(0);
    });
```

`_service` は一番外側の `beforeEach`（27 行目）で毎回作り直されるので、`on()` で足した受け取り口と `_osmLayerOffNotified` は試験ごとに初期化されます。

- [ ] **手順 2: 落ちることを確かめる**

実行:

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npx karma start karma.conf.cjs --single-run
```

期待する結果: `announces it only once while the layer stays switched off` と `does not announce it again after the layer is switched on and off` が失敗します。前者は `osmlayeroff` を誰も発生させないため `0` になり、後者も `0` になります。

- [ ] **手順 3: 出来事を発生させる**

`modules/services/PlateauService.js` の 46 行目から 47 行目を次のように書き換えます。

変更前:

```js
    // OSM のレイヤーが消えている件を伝えたかどうか。レイヤーが戻ると false に戻す。
    this._osmLayerOffNotified = false;
```

変更後:

```js
    // OSM のレイヤーが消えている件を知らせたかどうか。ページを開き直すまで戻さない。
    this._osmLayerOffNotified = false;
```

次に `getData()` の中（340 行目付近）を書き換えます。

変更前:

```js
      const missing = this._osmDataMissing();
      if (missing) {
        if (missing === 'layer-off') this._notifyOsmLayerOff();
        return [];
      }
```

変更後:

```js
      const missing = this._osmDataMissing();
      if (missing) {
        if (missing === 'layer-off' && !this._osmLayerOffNotified) {
          this._osmLayerOffNotified = true;
          this.emit('osmlayeroff');
        }
        return [];
      }
```

次に `_osmDataMissing()` の中から、印を戻す 1 行を削除します。

変更前:

```js
    const layer = this.context.systems.gfx?.scene?.layers?.get('osm');
    if (layer && layer.enabled === false) return 'layer-off';
    this._osmLayerOffNotified = false;
```

変更後:

```js
    const layer = this.context.systems.gfx?.scene?.layers?.get('osm');
    if (layer && layer.enabled === false) return 'layer-off';
```

最後に `_notifyOsmLayerOff()` を、その直前の説明コメントごと削除します。削除する範囲は次のとおりです。

```js
  /**
   * _notifyOsmLayerOff
   * 候補が出ない理由を利用者に伝える。
   * レイヤーが消えたままなのは利用者が直せる状態なので伝える。
   * タイルの取得は待てば終わるので伝えない。
   * 同じ状態が続くあいだは一度だけ出し、レイヤーが戻ったときに出し直せるようにする。
   */
  _notifyOsmLayerOff() {
    if (this._osmLayerOffNotified) return;
    this._osmLayerOffNotified = true;

    const flash = this.context.systems.ui?.Flash;
    if (typeof flash !== 'function') return;

    const l10n = this.context.systems.l10n;
    const key = 'plateau_conflation.osm_layer_off';
    flash.duration(5000).label(l10n ? l10n.t(key) : key);
    flash();
  }
```

- [ ] **手順 4: 通ることを確かめる**

実行:

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npx karma start karma.conf.cjs --single-run
```

期待する結果: 771 件成功、5 件スキップ、失敗 0 件。試験の数は、消した 3 件と足した 4 件の差で 1 件増えます。

- [ ] **手順 5: 記録する**

```bash
cd /Users/nyampire/git/Rapid
git add modules/services/PlateauService.js test/browser/services/PlateauService.test.js
git commit -m "$(cat <<'EOF'
refactor(plateau): レイヤー消灯の知らせを出来事に変える

画面下端の通知を出す処理を削除し、候補を伏せた理由がレイヤーの消灯で
あることを osmlayeroff として 1 回だけ発生させる。何を画面に出すかは
受け取る側が決める。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: ダイアログを出す部品を作る

**ファイル:**
- 作成: `modules/ui/UiPlateauOsmLayerOffDialog.js`
- 変更: `modules/ui/index.js`（55 行目の次）
- 変更: `data/core.yaml`（28 行目の次）
- 変更: `data/l10n/core.en.json`（31 行目）
- 変更: `data/l10n/core.ja.json`（2966 行目）
- 試験: `test/browser/ui/UiPlateauOsmLayerOffDialog.js`（作成）

**やり取りする名前:**
- 使うもの: Task 1 の `osmlayeroff`。`context.services.plateau.on('osmlayeroff', fn)` で受け取ります。
- 提供するもの: `UiPlateauOsmLayerOffDialog` という class。`new UiPlateauOsmLayerOffDialog(context)` で組み立て、`show()` を持ちます。`show()` はダイアログの d3 選択を返すか、出さなかった場合は `undefined` を返します。

- [ ] **手順 1: 文言を足す**

`data/core.yaml` の 28 行目の次に、2 行を足します。足したあとは次の形になります。

```yaml
  plateau_conflation:
    osm_layer_off: "Plateau buildings stay hidden while the OpenStreetMap data layer is off, because existing buildings cannot be checked for duplicates. Press Shift+O to turn it back on."
    osm_layer_off_title: PLATEAU buildings are hidden
    dont_show_again: Do not show this again
```

`data/l10n/core.en.json` の 30 行目から 32 行目を、次の形にします。

```json
    "plateau_conflation": {
      "osm_layer_off": "Plateau buildings stay hidden while the OpenStreetMap data layer is off, because existing buildings cannot be checked for duplicates. Press Shift+O to turn it back on.",
      "osm_layer_off_title": "PLATEAU buildings are hidden",
      "dont_show_again": "Do not show this again"
    },
```

`data/l10n/core.ja.json` の 2965 行目から 2967 行目を、次の形にします。

```json
    "plateau_conflation": {
      "osm_layer_off": "OpenStreetMap のデータのレイヤーが消えているあいだは、Plateau の建物を表示しません。既存の建物と重なるかを確かめられないためです。Shift+O で戻せます。",
      "osm_layer_off_title": "PLATEAU の建物を表示していません",
      "dont_show_again": "次から表示しない"
    },
```

- [ ] **手順 2: 落ちる試験を書く**

`test/browser/ui/UiPlateauOsmLayerOffDialog.js` を作り、次の内容を書きます。

```js
describe('UiPlateauOsmLayerOffDialog', () => {
  const HIDDEN_KEY = 'plateau.osm-layer-off-dialog.hidden';
  let elem;

  class MockLocalizationSystem {
    constructor() { }
    initAsync()   { return Promise.resolve(); }
    t(id)         { return id; }
    tHtml(id)     { return id; }
  }

  class MockStorageSystem {
    constructor()      { this._map = new Map(); }
    getItem(k)         { return this._map.has(k) ? this._map.get(k) : null; }
    setItem(k, v)      { this._map.set(k, v); return true; }
    removeItem(k)      { this._map.delete(k); }
  }

  class MockPlateauService {
    constructor()      { this._handlers = new Map(); }
    on(type, fn) {
      if (!this._handlers.has(type)) this._handlers.set(type, []);
      this._handlers.get(type).push(fn);
      return this;
    }
    emit(type) {
      for (const fn of this._handlers.get(type) ?? []) fn();
    }
  }

  class MockContext {
    constructor() {
      this.systems = {
        l10n: new MockLocalizationSystem(),
        storage: new MockStorageSystem()
      };
      this.services = { plateau: new MockPlateauService() };
    }
    container() { return elem; }
  }

  let context;

  beforeEach(() => {
    elem = d3.select('body')
      .append('div')
      .attr('class', 'plateau-dialog-wrap');
    context = new MockContext();
  });

  afterEach(() => {
    d3.select('.plateau-dialog-wrap').remove();
    d3.selectAll('.shaded').remove();
  });


  it('opens the dialog when the service announces the switched-off layer', () => {
    new Rapid.UiPlateauOsmLayerOffDialog(context);
    context.services.plateau.emit('osmlayeroff');
    expect(elem.selectAll('.modal').size()).to.equal(1);
  });

  it('shows the title, the reason and the checkbox', () => {
    new Rapid.UiPlateauOsmLayerOffDialog(context);
    context.services.plateau.emit('osmlayeroff');
    expect(elem.selectAll('.modal-section.header h3').text())
      .to.equal('plateau_conflation.osm_layer_off_title');
    expect(elem.selectAll('.modal-section.message-text p').text())
      .to.equal('plateau_conflation.osm_layer_off');
    expect(elem.selectAll('.plateau-dont-show-again input').size()).to.equal(1);
  });

  it('does not open the dialog when the user asked not to see it', () => {
    context.systems.storage.setItem(HIDDEN_KEY, 'true');
    new Rapid.UiPlateauOsmLayerOffDialog(context);
    context.services.plateau.emit('osmlayeroff');
    expect(elem.selectAll('.modal').size()).to.equal(0);
  });

  it('remembers the choice when the checkbox is ticked', () => {
    new Rapid.UiPlateauOsmLayerOffDialog(context);
    context.services.plateau.emit('osmlayeroff');
    const node = elem.select('.plateau-dont-show-again input').node();
    node.checked = true;
    happen.once(node, { type: 'change' });
    expect(context.systems.storage.getItem(HIDDEN_KEY)).to.equal('true');
  });

  it('forgets the choice when the checkbox is unticked', () => {
    context.systems.storage.setItem(HIDDEN_KEY, 'true');
    const dialog = new Rapid.UiPlateauOsmLayerOffDialog(context);
    dialog.show({ force: true });
    const node = elem.select('.plateau-dont-show-again input').node();
    node.checked = false;
    happen.once(node, { type: 'change' });
    expect(context.systems.storage.getItem(HIDDEN_KEY)).to.be.null;
  });
});
```

最後の試験だけ `show({ force: true })` を直接呼びます。保存された印がある状態で出来事を発生させてもダイアログが開かないため、チェックを外す操作を試せないからです。

- [ ] **手順 3: 落ちることを確かめる**

実行:

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npx karma start karma.conf.cjs --single-run
```

期待する結果: `UiPlateauOsmLayerOffDialog` の 5 件がすべて失敗します。理由は `Rapid.UiPlateauOsmLayerOffDialog is not a constructor` です。

- [ ] **手順 4: 部品を作る**

`modules/ui/UiPlateauOsmLayerOffDialog.js` を作り、次の内容を書きます。

```js
import { uiConfirm } from './confirm.js';

const HIDDEN_KEY = 'plateau.osm-layer-off-dialog.hidden';


/**
 * UiPlateauOsmLayerOffDialog
 * OSM のデータのレイヤーが消えているために PLATEAU の候補を伏せたことを、
 * 画面中央のダイアログで伝える。
 *
 * 出すかどうかの判断は `PlateauService` が持ち、この部品は `osmlayeroff` を
 * 受け取るだけ。`PlateauService` はページを開き直すまでに 1 回しか発生させない。
 *
 * 「次から表示しない」を選んだ利用者には、以後まったく出さない。
 */
export class UiPlateauOsmLayerOffDialog {

  /**
   * @constructor
   * @param  `context`  Global shared application context
   */
  constructor(context) {
    this.context = context;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.show = this.show.bind(this);

    const plateau = context.services?.plateau;
    if (plateau) {
      plateau.on('osmlayeroff', this.show);
    }
  }


  /**
   * show
   * ダイアログを開く。
   * @param   {Object}   options?
   * @param   {boolean}  options.force?  true なら保存された印を無視して開く
   * @return  {d3-selection?}  開いたダイアログ。開かなかった場合は undefined
   */
  show(options = {}) {
    const context = this.context;
    const storage = context.systems.storage;
    const l10n = context.systems.l10n;

    if (!options.force && storage?.getItem(HIDDEN_KEY) === 'true') return;

    const $modal = uiConfirm(context, context.container());

    $modal.select('.modal-section.header')
      .append('h3')
      .text(l10n.t('plateau_conflation.osm_layer_off_title'));

    const $message = $modal.select('.modal-section.message-text');

    $message
      .append('p')
      .text(l10n.t('plateau_conflation.osm_layer_off'));

    const $label = $message
      .append('label')
      .attr('class', 'plateau-dont-show-again');

    $label
      .append('input')
      .attr('type', 'checkbox')
      .on('change', function() {
        if (this.checked) {
          storage?.setItem(HIDDEN_KEY, 'true');
        } else {
          storage?.removeItem(HIDDEN_KEY);
        }
      });

    $label
      .append('span')
      .text(l10n.t('plateau_conflation.dont_show_again'));

    $modal.okButton();

    return $modal;
  }

}
```

`modules/ui/index.js` の 55 行目（`export { UiPhotoViewer } ...`）の次に、次の 1 行を足します。

```js
export { UiPlateauOsmLayerOffDialog } from './UiPlateauOsmLayerOffDialog.js';
```

- [ ] **手順 5: 通ることを確かめる**

実行:

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run dist && npx karma start karma.conf.cjs --single-run
```

期待する結果: 776 件成功、5 件スキップ、失敗 0 件。Task 1 の 771 件に、この課題の 5 件が足されます。

- [ ] **手順 6: 記録する**

```bash
cd /Users/nyampire/git/Rapid
git add modules/ui/UiPlateauOsmLayerOffDialog.js modules/ui/index.js \
        data/core.yaml data/l10n/core.en.json data/l10n/core.ja.json \
        test/browser/ui/UiPlateauOsmLayerOffDialog.js
git commit -m "$(cat <<'EOF'
feat(plateau): レイヤー消灯の理由をダイアログで出す部品を足す

osmlayeroff を受け取り、見出しと理由と「次から表示しない」を持つ
ダイアログを開く。印は StorageSystem に保存し、選ばれていれば開かない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 部品を組み立てて、画面でつながるようにする

**ファイル:**
- 変更: `modules/core/UiSystem.js`（8 行目から 11 行目の読み込み、100 行目付近の組み立て）

**やり取りする名前:**
- 使うもの: Task 2 の `UiPlateauOsmLayerOffDialog`。
- 提供するもの: `context.systems.ui.PlateauOsmLayerOffDialog`。他の場所からは参照しません。

- [ ] **手順 1: 読み込みに足す**

`modules/core/UiSystem.js` の 7 行目から 11 行目を、次の形にします。

変更前:

```js
import {
  UiApiStatus, UiDefs, uiEditMenu, uiFlash, UiFullscreen, uiIntro,
  uiLoading, UiMapFooter, UiMapToolbar, uiMapRouletteMenu, UiOvermap,
  uiSplash, uiRestore, UiShortcuts, UiSidebar, uiWhatsNew
} from '../ui/index.js';
```

変更後:

```js
import {
  UiApiStatus, UiDefs, uiEditMenu, uiFlash, UiFullscreen, uiIntro,
  uiLoading, UiMapFooter, UiMapToolbar, uiMapRouletteMenu, UiOvermap,
  UiPlateauOsmLayerOffDialog, uiSplash, uiRestore, UiShortcuts, UiSidebar,
  uiWhatsNew
} from '../ui/index.js';
```

- [ ] **手順 2: 組み立てに足す**

`modules/core/UiSystem.js` の `this.Overmap = new UiOvermap(context);` の次の行に、1 行を足します。足したあとは次の形になります。

```js
        this.Overmap = new UiOvermap(context);
        this.PlateauOsmLayerOffDialog = new UiPlateauOsmLayerOffDialog(context);
        this.Shortcuts = new UiShortcuts(context);
```

描画処理には手を入れません。この部品は出来事を受け取ったときだけ画面に要素を足します。

- [ ] **手順 3: 静的検査と試験を通す**

実行:

```bash
cd /Users/nyampire/git/Rapid && npm run lint && npm run build && npm run dist && npx karma start karma.conf.cjs --single-run
```

期待する結果: `npm run lint` はエラー 0 件です。警告は起点と同じ 42 件で、すべて元からある todo コメントです。試験は 776 件成功、5 件スキップ、失敗 0 件です。

- [ ] **手順 4: 画面で確かめる**

リポジトリに入っている開発用サーバを起動します。`scripts/server.js` がリポジトリの根をポート 8080 で配信します。

```bash
cd /Users/nyampire/git/Rapid && npm run start:server
```

ブラウザで `http://localhost:8080/dist/#map=17.50/35.64780/139.70200` を開き、次の 3 点を確かめます。

1. `Shift` + `O` で OSM のデータのレイヤーを消すと、ダイアログが 1 回出ること
2. OK で閉じたあと、もう一度 `Shift` + `O` を 2 回押しても、ダイアログが出ないこと
3. 「次から表示しない」を選んで閉じ、ページを開き直してから `Shift` + `O` を押しても、ダイアログが出ないこと

3 を試したあとは、開発者コンソールで印を消して元に戻します。

```js
localStorage.removeItem('plateau.osm-layer-off-dialog.hidden');
```

この確認は自動の試験では代えられません。`PlateauService` と画面部品のつなぎ込みが実際に動くかは、組み立てた `UiSystem` の上でしか分からないためです。

- [ ] **手順 5: 記録する**

```bash
cd /Users/nyampire/git/Rapid
git add modules/core/UiSystem.js
git commit -m "$(cat <<'EOF'
feat(plateau): レイヤー消灯のダイアログを画面に組み込む

UiSystem で 1 度だけ組み立てる。描画処理には手を入れない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 完了の条件

- `npm run lint` がエラー 0 件で通ること
- 試験が 776 件成功、5 件スキップ、失敗 0 件であること
- Task 3 手順 4 の 3 点が画面で確かめられていること
- `_notifyOsmLayerOff` がコードのどこにも残っていないこと（`grep -rn "_notifyOsmLayerOff" modules test` が 0 件）
