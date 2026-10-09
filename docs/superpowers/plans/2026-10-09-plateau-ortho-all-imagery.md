# PLATEAUのオルソ画像（全年度）を背景画像に足す 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PLATEAU VIEWのタイル配信の`ortho-all`を、このエディタの背景画像の一覧に「MLIT Plateau Ortho (all years)」として足します。

**Architecture:** エディタ独自の背景画像の設定（`data/manual_imagery.json`）にeditor-layer-indexと同じ書き方で項目を足し、エディタが読む一覧（`data/imagery.json`）にも、`scripts/update_imagery.js`が作るのと同じ形の項目を手で1つ足します。
一覧全体を作り直す命令（`npm run imagery`）は使いません。
2つのファイルが食い違っていないことは、確かめ用のスクリプトで調べます。

**Tech Stack:** JSON、Node.js（ES modules）、`json-stringify-pretty-compact`、karmaによるbrowser試験、esbuildによる配布物の生成。

## Global Constraints

- 設計文書は`docs/superpowers/specs/2026-10-09-plateau-ortho-all-imagery-design.ja.md`です。判断に迷ったらこちらが優先します。
- 項目のidは`Plateau_orthophoto_all`、名前は`MLIT Plateau Ortho (all years)`です。
- タイルのURLは`https://tile.plateauview.mlit.go.jp/tiles/ortho-all/{zoom}/{x}/{y}.png`です。
- ズームは10〜19です。
- 一覧に出る範囲は、経度122.9〜146.0、緯度24.0〜45.6の四角形です。
- 出典の表示は`MLIT_PLATEAU`、リンク先は`https://docs.plateauview.mlit.go.jp/datasets/ortho/`です。変更セットの記録（`imagery_used`）に残るのは、出典の表示ではなく項目の名前です。
- 既存の項目`Plateau_orthophoto_official`（2020年版）は変えません。
- `npm run imagery`は実行しません。`data/imagery.json`は新しい項目を1つ足すだけで、ほかの行を変えません。
- 元のRapidのコアの部分（`modules/core/`の下）には手を入れません。
- 日本語の文章では、和文と英字、数字、コードの間に空白を入れません。
- コミットメッセージは日本語のですます調で書き、一文ごとに改行します。末尾に`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`を付けます。
- `git add -A`と`git add .`は使わず、ファイルを名指しで加えます。
- 起点はブランチ`feature/plateau-ortho-all-imagery`の、設計文書と本計画のコミットです。
- 起点のbrowser試験の結果は870件成功、5件スキップ、失敗0件です。

## 試験の走らせ方

browser試験は配布物（`dist/rapid.js`）を読みます。

```bash
cd /Users/nyampire/git/Rapid && npm run build && npm run test:browser
```

最後の`SUMMARY:`の行で件数を確かめます。
この計画では試験を足さないので、件数は870件成功、5件スキップのまま変わりません。

背景画像の一覧のデータには、既存の試験がありません。
代わりに、Task 1で確かめ用のスクリプトを作り、2つのファイルの項目が食い違っていないことを調べます。
スクリプトは`.superpowers/`の下に置き、コミットしません（このディレクトリはgitの対象外です）。

## ファイルの構成

| ファイル | 変更 | 役割 |
|---|---|---|
| `data/manual_imagery.json` | 変更 | エディタ独自の背景画像の設定。editor-layer-indexの書き方 |
| `data/imagery.json` | 変更 | エディタが読む背景画像の一覧 |
| `.superpowers/check_plateau_imagery.mjs` | 作成（コミットしない） | 2つのファイルの項目の食い違いを調べる |
| `PLATEAU.ja.md`、`PLATEAU.md` | 変更 | 背景画像の項目の説明 |

---

### Task 1: 背景画像の項目を足す

**Files:**
- Create: `.superpowers/check_plateau_imagery.mjs`（コミットしない）
- Modify: `data/manual_imagery.json`
- Modify: `data/imagery.json`

**Interfaces:**
- Consumes: なし
- Produces: 背景画像のid`Plateau_orthophoto_all`。Task 2の文書と、手元での確認がこのidを使います。

- [ ] **Step 1: 確かめ用のスクリプトを書く**

`/Users/nyampire/git/Rapid/.superpowers/check_plateau_imagery.mjs`を作り、次を書きます。
`scripts/update_imagery.js`の変換のうち、この項目に関わる部分だけを写しています。

```js
// data/manual_imagery.json と data/imagery.json の Plateau_orthophoto_all が食い違っていないかを調べる。
// update_imagery.js の変換のうち、この項目に関わる部分だけを写している。
import fs from 'node:fs';
import JSON5 from 'json5';
import prettyStringify from 'json-stringify-pretty-compact';

const ID = 'Plateau_orthophoto_all';
const errors = [];

const manual = JSON5.parse(fs.readFileSync('data/manual_imagery.json', 'utf8')).manualImagery;
const source = manual.find(s => s.id === ID);
if (!source) errors.push(`data/manual_imagery.json に ${ID} がありません`);

const raw = fs.readFileSync('data/imagery.json', 'utf8');
const imagery = JSON.parse(raw).imagery;
const actual = imagery.find(i => i.id === ID);
if (!actual) errors.push(`data/imagery.json に ${ID} がありません`);

if (source && actual) {
  const expected = { id: source.id, name: source.name, type: source.type, template: source.url };
  const extent = source.extent || {};
  if (extent.min_zoom || extent.max_zoom) {
    expected.zoomExtent = [extent.min_zoom || 0, extent.max_zoom || 22];
  }
  if (extent.bbox) {
    const b = extent.bbox;
    expected.polygon = [[
      [b.min_lon, b.min_lat], [b.min_lon, b.max_lat],
      [b.max_lon, b.max_lat], [b.max_lon, b.min_lat],
      [b.min_lon, b.min_lat]
    ]];
  }
  const attribution = source.attribution || {};
  if (attribution.url) expected.terms_url = attribution.url;
  if (attribution.text) expected.terms_text = attribution.text;
  for (const prop of ['best', 'default', 'description', 'encrypted', 'icon', 'overlay', 'tileSize']) {
    if (source[prop]) expected[prop] = source[prop];
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`data/imagery.json の ${ID} が、manual_imagery.json からの変換と一致しません`);
    errors.push(`  expected: ${JSON.stringify(expected)}`);
    errors.push(`  actual:   ${JSON.stringify(actual)}`);
  }
}

// update_imagery.js と同じ書式で書き出したときに、ファイルが1文字も変わらないこと。
if (prettyStringify({ imagery }) + '\n' !== raw) {
  errors.push('data/imagery.json の書式が、update_imagery.js の書き出しと一致しません');
}

// update_imagery.js と同じく、名前の順に並んでいること。
const names = imagery.map(i => i.name);
const sorted = [...names].sort((a, b) => a.localeCompare(b));
if (JSON.stringify(names) !== JSON.stringify(sorted)) {
  errors.push('data/imagery.json が名前の順に並んでいません');
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ok');
```

- [ ] **Step 2: スクリプトを走らせて失敗を確かめる**

Run: `cd /Users/nyampire/git/Rapid && node .superpowers/check_plateau_imagery.mjs`
Expected: 終了コード1で、`data/manual_imagery.json に Plateau_orthophoto_all がありません`と`data/imagery.json に Plateau_orthophoto_all がありません`の2行が出ます。

- [ ] **Step 3: 独自の設定に項目を足す**

`data/manual_imagery.json`の`manualImagery`の配列の最後の要素（`"id": "stamen-terrain-background"`の項目）の閉じ括弧`}`の後ろにカンマを付け、次の項目を足します。
字下げは、ほかの項目と同じく要素の`{`を4文字、中身を6文字にします。

```json
    {
      "id": "Plateau_orthophoto_all",
      "name": "MLIT Plateau Ortho (all years)",
      "type": "tms",
      "category": "photo",
      "url": "https://tile.plateauview.mlit.go.jp/tiles/ortho-all/{zoom}/{x}/{y}.png",
      "extent": {
        "min_zoom": 10,
        "max_zoom": 19,
        "bbox": { "min_lon": 122.9, "min_lat": 24.0, "max_lon": 146.0, "max_lat": 45.6 }
      },
      "attribution": {
        "required": true,
        "text": "MLIT_PLATEAU",
        "url": "https://docs.plateauview.mlit.go.jp/datasets/ortho/"
      },
      "license_url": "https://www.mlit.go.jp/plateau/site-policy/",
      "permission_osm": "explicit",
      "country_code": "JP",
      "description": "Japan MLIT Project PLATEAU orthophotos of all years, newest on top. Blank where no imagery is available."
    }
```

- [ ] **Step 4: エディタが読む一覧に項目を足す**

`data/imagery.json`で`"id": "Plateau_orthophoto_official"`の項目を探します。
その項目の最後の行`"description": "Japan MLIT, Plateau project official tile distribution"`の次の行の`},`と、その次の`{`（`"id": "mml-tausta"`の項目の始まり）の間に、次を入れます。
名前の順で、`MLIT Plateau Official`の次、`MML Background Map`の前に当たります。

```json
    {
      "id": "Plateau_orthophoto_all",
      "name": "MLIT Plateau Ortho (all years)",
      "type": "tms",
      "template": "https://tile.plateauview.mlit.go.jp/tiles/ortho-all/{zoom}/{x}/{y}.png",
      "zoomExtent": [10, 19],
      "polygon": [
        [[122.9, 24], [122.9, 45.6], [146, 45.6], [146, 24], [122.9, 24]]
      ],
      "terms_url": "https://docs.plateauview.mlit.go.jp/datasets/ortho/",
      "terms_text": "MLIT_PLATEAU",
      "description": "Japan MLIT Project PLATEAU orthophotos of all years, newest on top. Blank where no imagery is available."
    },
```

入れたあとの並びは、次のようになります。

```json
      "description": "Japan MLIT, Plateau project official tile distribution"
    },
    {
      "id": "Plateau_orthophoto_all",
      ...
      "description": "Japan MLIT Project PLATEAU orthophotos of all years, newest on top. Blank where no imagery is available."
    },
    {
      "id": "mml-tausta",
```

- [ ] **Step 5: スクリプトを走らせて通ることを確かめる**

Run: `cd /Users/nyampire/git/Rapid && node .superpowers/check_plateau_imagery.mjs`
Expected: `ok`と出て、終了コード0。

Run: `cd /Users/nyampire/git/Rapid && git diff --stat`
Expected: `data/imagery.json`は13行の追加だけ、`data/manual_imagery.json`は追加とカンマの1行の変更だけです。

- [ ] **Step 6: 試験を走らせる**

Run: `cd /Users/nyampire/git/Rapid && npm run build && npm run test:browser`
Expected: `SUMMARY:`が870件成功、5件スキップ、失敗0件。

Run: `cd /Users/nyampire/git/Rapid && git status --short`
Expected: `data/imagery.json`と`data/manual_imagery.json`だけが変わっています。
`npm run build`が`data/l10n/imagery.en.json`などを作り直して差分が出た場合は、コミットに含めずに理由を報告します。

- [ ] **Step 7: コミットする**

```bash
cd /Users/nyampire/git/Rapid
git add data/manual_imagery.json data/imagery.json
git commit -F - <<'EOF'
feat(plateau): PLATEAUのオルソ画像（全年度）を背景画像の一覧に足す

PLATEAU VIEWのタイル配信のortho-allを、MLIT Plateau Ortho (all years)として足します。
すべての年の画像を、新しい年のものを上に重ねた配信です。
エディタ独自の設定に足し、エディタが読む一覧にも同じ項目を手で足します。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: 説明を書く

**Files:**
- Modify: `PLATEAU.ja.md`
- Modify: `PLATEAU.md`

**Interfaces:**
- Consumes: Task 1の背景画像のid`Plateau_orthophoto_all`
- Produces: なし

- [ ] **Step 1: 日本語の説明を書く**

`PLATEAU.ja.md`で`## クライアントサイドConflation`の見出しを探し、その直前（前の節の最後の行のあとの空行の後ろ）に次の節を入れます。

```markdown
## 背景画像

背景画像の一覧に、PLATEAU VIEWのタイル配信のオルソ画像（`ortho-all`）を「MLIT Plateau Ortho (all years)」として足しています。
すべての年の画像を、新しい年のものを上に重ねて1つにした配信です。
項目はエディタ独自の設定の`data/manual_imagery.json`にあり、エディタが読む`data/imagery.json`にも同じ項目を手で足しています。
`npm run imagery`で一覧を作り直しても、独自の設定から同じ項目が作られます。

一覧に出る範囲は、日本のおおまかな四角形です。
画像の無い場所（木更津、岡山の中心部など）では、選ぶと背景が空白になります。

`ortho-all`は配信元の案内のページに載っておらず、配信が続く保証はありません。
そのため、editor-layer-index由来の2020年版（「MLIT Plateau Official」）も残しています。

```

- [ ] **Step 2: 英語の説明を書く**

`PLATEAU.md`で`## Client-side conflation`の見出しを探し、その直前に次の節を入れます。

```markdown
## Background imagery

The imagery list includes the PLATEAU VIEW orthophoto tiles (`ortho-all`) as "MLIT Plateau Ortho (all years)".
It combines the imagery of every year into one tileset, with the newest year on top.
The entry lives in this fork's own settings, `data/manual_imagery.json`, and the same entry is added by hand to `data/imagery.json`, which the editor reads.
Regenerating the list with `npm run imagery` produces the same entry from the fork's settings.

The entry is offered within a rough rectangle around Japan.
Where there is no imagery (for example Kisarazu or central Okayama), choosing it leaves the background blank.

`ortho-all` is not listed on the provider's documentation page, and its availability is not guaranteed.
The 2020 imagery from editor-layer-index ("MLIT Plateau Official") is therefore kept as well.

```

- [ ] **Step 3: 確かめる**

Run: `cd /Users/nyampire/git/Rapid && git diff --stat && git diff PLATEAU.ja.md | grep '^+' | grep -nP '[\x{3040}-\x{30ff}\x{4e00}-\x{9fff}] [A-Za-z0-9`]|[A-Za-z0-9`\)] [\x{3040}-\x{30ff}\x{4e00}-\x{9fff}]'`
Expected: 2つのファイルだけが変わり、2つ目のコマンドは何も出しません（和文と英字の間に空白がない）。

- [ ] **Step 4: コミットする**

```bash
cd /Users/nyampire/git/Rapid
git add PLATEAU.ja.md PLATEAU.md
git commit -F - <<'EOF'
docs(plateau): PLATEAUのオルソ画像（全年度）の背景画像の項目を説明する

開発者向けの説明に、背景画像の節を足します。
配信の保証が無いことと、2020年版を予備として残していることを書きます。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## 手元での確認（作業の最後に、まとめ役が行う）

手元でエディタを起動し（`npm run start:server`）、次を確かめます。
変更はOSMに保存しません。

1. `http://127.0.0.1:8080/#map=18.00/35.6810/139.7670`を開き、背景画像の一覧に「MLIT Plateau Ortho (all years)」が出て、選ぶと画像が出ること
2. `http://127.0.0.1:8080/#map=18.00/35.3800/139.9200`（木更津）で、一覧には出るが、選ぶと背景が空白になること
3. `http://127.0.0.1:8080/#map=16.00/51.5070/-0.1270`（ロンドン）で、一覧に出ないこと
4. `http://127.0.0.1:8080/#map=18.00/35.6810/139.7670&background=Plateau_orthophoto_all`で開いたときに、この画像が選ばれていること
5. 東京駅の付近で建物に小さな変更を加え、保存の画面を開いて、変更セットの記録（`imagery_used`）に`MLIT Plateau Ortho (all years)`が出ること。確かめたら保存せずに閉じ、変更を取り消す
6. 地図の右下の出典の表示に`MLIT_PLATEAU`が出ること
