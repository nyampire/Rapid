# PLATEAU Tags Editor-Section Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the PLATEAU tag-transfer proposal from the standalone floating panel into the entity editor as a dedicated section that reuses the validation issue UI but stays a separate table.

**Architecture:** Add `heightTransfer.getCandidateForOSM(entityID)` so any consumer can look up the single candidate for a selected OSM building. Build a new `uiSectionPlateauTags` entity-editor section that renders that candidate with the same `.issue-*` markup/CSS as `entity_issues`, but is a separate `uiSection` not routed through the validator. Register it in `entity_editor.js` after the Issues section. Change candidate-dot clicks to select the underlying OSM building (`select-osm` mode) so the editor opens. Remove the old floating panel.

**Tech Stack:** JavaScript (ES modules), d3-selection, Rapid's `uiSection` helper, Karma + Mocha + Chai browser tests.

## Global Constraints

- CONFLICT and AREA_MISMATCH states are **information only** — no Apply/overwrite action. Only CANDIDATE is actionable. COVERED is not shown. (Verbatim from spec.)
- `actionTransferPlateauTags` is reused unchanged: it adds only missing tags and never overwrites existing values.
- The toolbar toggle (`heightTransfer` system) remains the opt-in on/off. When `active === false`, `getCandidateForOSM` returns `null`.
- The PLATEAU section must NOT be a validator rule — it must not appear in the Issues count or Issues pane.
- Do not edit `data/l10n/*.json` by hand; l10n source is `data/core.yaml` (`core.en.json` is generated from it).
- Follow the existing no-Co-Authored-By commit convention on this repo.

---

### Task 1: `heightTransfer.getCandidateForOSM(entityID)`

**Files:**
- Modify: `modules/modes/HeightTransferMode.js` (add method near `apply()`, ~line 210)
- Test: `test/browser/modes/HeightTransferMode.test.js`

**Interfaces:**
- Consumes: existing `this.active` (boolean), `this.candidates` (Array of MatchCandidate; each has `osmFeature`, `plateauFeature`, `state`, `missingTags`, `conflictingTags`, `matchingTags`, `ratio`).
- Produces: `getCandidateForOSM(entityID: string): MatchCandidate | null` — returns the candidate whose `osmFeature.id === entityID`, or `null` when inactive / not found.

- [ ] **Step 1: Write the failing test**

Add inside the existing top-level `describe('HeightTransferMode', ...)` in `test/browser/modes/HeightTransferMode.test.js`:

```javascript
describe('getCandidateForOSM', () => {
  it('returns null when the system is inactive', () => {
    const mode = new Rapid.HeightTransferMode(new MockContext());
    mode.active = false;
    mode.candidates = [{ osmFeature: { id: 'w1' }, state: 'CANDIDATE' }];
    expect(mode.getCandidateForOSM('w1')).to.equal(null);
  });

  it('returns the matching candidate when active', () => {
    const mode = new Rapid.HeightTransferMode(new MockContext());
    mode.active = true;
    const cand = { osmFeature: { id: 'w1' }, state: 'CANDIDATE' };
    mode.candidates = [cand, { osmFeature: { id: 'w2' }, state: 'COVERED' }];
    expect(mode.getCandidateForOSM('w1')).to.equal(cand);
  });

  it('returns null when no candidate matches the id', () => {
    const mode = new Rapid.HeightTransferMode(new MockContext());
    mode.active = true;
    mode.candidates = [{ osmFeature: { id: 'w1' }, state: 'CANDIDATE' }];
    expect(mode.getCandidateForOSM('w999')).to.equal(null);
  });
});
```

If the file has no `MockContext`, reuse the existing context-construction pattern already used by the other tests in this file (check the top of the file and mirror it).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx karma start karma.conf.cjs --single-run`
Expected: FAIL — `getCandidateForOSM is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add this method to the `HeightTransferMode` class in `modules/modes/HeightTransferMode.js`, immediately after the `apply(candidate)` method:

```javascript
  /**
   * getCandidateForOSM
   * Returns the single MatchCandidate for a selected OSM building, or null.
   * Used by `uiSectionPlateauTags` to render the proposal inside the entity editor.
   * Returns null when the feature is toggled off, so the section stays hidden.
   * @param  {string}  entityID  OSM entity id (e.g. 'w123')
   * @return {Object|null}  the MatchCandidate whose osmFeature.id matches, or null
   */
  getCandidateForOSM(entityID) {
    if (!this.active) return null;
    return this.candidates.find(c => c.osmFeature?.id === entityID) ?? null;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npx karma start karma.conf.cjs --single-run`
Expected: PASS for the three new tests; full suite still green.

- [ ] **Step 5: Commit**

```bash
git add modules/modes/HeightTransferMode.js test/browser/modes/HeightTransferMode.test.js
git commit -m "feat(plateau): add getCandidateForOSM lookup to HeightTransferMode"
```

---

### Task 2: `uiSectionPlateauTags` section component

**Files:**
- Create: `modules/ui/sections/plateau_tags.js`
- Modify: `modules/ui/sections/index.js` (add export)
- Modify: `data/core.yaml` (add `height_transfer.section_title` key)
- Test: `test/browser/ui/sections/plateau_tags.js`

**Interfaces:**
- Consumes: `context.systems.heightTransfer.getCandidateForOSM(entityID)` (Task 1); `context.systems.heightTransfer.apply(candidate)`; `context.systems.l10n.t(key, opts)`; `Rapid.uiSection(context, id)`.
- Produces: `uiSectionPlateauTags(context)` returning a `uiSection` object with `.entityIDs(ids)`, `.shouldDisplay()`, `.label()`, `.render(selection)`.

- [ ] **Step 1: Write the failing test**

Create `test/browser/ui/sections/plateau_tags.js`:

```javascript
describe('uiSectionPlateauTags', () => {
  let section, wrap, applied;

  class MockL10n {
    isRTL() { return false; }
    t(id) { return id; }
    tHtml(id) { return id; }
  }

  class MockHeightTransfer {
    constructor(candidate) { this._cand = candidate; applied = []; }
    getCandidateForOSM(id) { return (this._cand && this._cand.osmFeature.id === id) ? this._cand : null; }
    apply(cand) { applied.push(cand); }
  }

  class MockContext {
    constructor(candidate) {
      this.services = {};
      this.systems = {
        l10n: new MockL10n(),
        heightTransfer: new MockHeightTransfer(candidate)
      };
    }
  }

  function candidate(state, extra = {}) {
    return Object.assign({
      osmFeature: { id: 'w1', type: 'way', tags: { building: 'yes' } },
      plateauFeature: { tags: { height: '2.98', ele: '69.1' } },
      state,
      missingTags: [],
      conflictingTags: [],
      matchingTags: []
    }, extra);
  }

  function render(context) {
    section = Rapid.uiSectionPlateauTags(context).entityIDs(['w1']);
    wrap = d3.select('body').append('div').attr('class', 'ui-wrap').call(section.render);
  }

  afterEach(() => { d3.selectAll('.ui-wrap').remove(); });

  it('is hidden when there is no candidate', () => {
    render(new MockContext(null));
    expect(section.shouldDisplay()).to.be.false;
  });

  it('is hidden for a COVERED candidate', () => {
    render(new MockContext(candidate('COVERED')));
    expect(section.shouldDisplay()).to.be.false;
  });

  it('shows an actionable Apply fix for a CANDIDATE', () => {
    const cand = candidate('CANDIDATE', { missingTags: ['height', 'ele'] });
    render(new MockContext(cand));
    expect(section.shouldDisplay()).to.be.true;
    const buttons = wrap.selectAll('.issue-fix-item button').nodes();
    expect(buttons.length).to.equal(1);
    buttons[0].dispatchEvent(new MouseEvent('click'));
    expect(applied).to.eql([cand]);
  });

  it('shows CONFLICT as information only, with no fix button', () => {
    const cand = candidate('CONFLICT', {
      conflictingTags: [{ key: 'height', osmValue: '10', plateauValue: '2.98' }]
    });
    render(new MockContext(cand));
    expect(section.shouldDisplay()).to.be.true;
    expect(wrap.selectAll('.issue-fix-item button').nodes().length).to.equal(0);
    expect(wrap.selectAll('.issue-message').text()).to.contain('conflict_note');
  });

  it('shows AREA_MISMATCH as information only, with no fix button', () => {
    render(new MockContext(candidate('AREA_MISMATCH')));
    expect(section.shouldDisplay()).to.be.true;
    expect(wrap.selectAll('.issue-fix-item button').nodes().length).to.equal(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx karma start karma.conf.cjs --single-run`
Expected: FAIL — `Rapid.uiSectionPlateauTags is not a function`.

- [ ] **Step 3a: Add the l10n key**

In `data/core.yaml`, under the existing `height_transfer:` block (the one with `current_tags`, `additions`, etc.), add one line:

```yaml
    section_title: PLATEAU tags
```

- [ ] **Step 3b: Create the section component**

Create `modules/ui/sections/plateau_tags.js`:

```javascript
import { uiSection } from '../section.js';


/**
 * uiSectionPlateauTags
 * A dedicated entity-editor section that surfaces the PLATEAU tag-transfer
 * proposal for the selected OSM building. It reuses the validation issue
 * markup/CSS (`.issue-*`, `.issue-fix-*`) so it reads like the Issues section,
 * but is a separate `uiSection` fed by `heightTransfer.getCandidateForOSM`,
 * not routed through the validator (so it never inflates the Issues count).
 *
 * States (see HeightTransferMatcher):
 *   CANDIDATE      -> lists missing tags + an actionable "Apply" fix
 *   CONFLICT       -> information only (conflict note), no fix
 *   AREA_MISMATCH  -> information only (area note), no fix
 *   COVERED        -> section hidden
 */
export function uiSectionPlateauTags(context) {
  const l10n = context.systems.l10n;
  const heightTransfer = context.systems.heightTransfer;

  let _entityIDs = [];

  const section = uiSection(context, 'plateau-tags')
    .label(() => l10n.t('height_transfer.section_title'))
    .shouldDisplay(() => {
      const cand = _candidate();
      return !!cand && cand.state !== 'COVERED';
    })
    .disclosureContent(renderDisclosureContent);


  function _candidate() {
    if (!heightTransfer?.getCandidateForOSM) return null;
    if (_entityIDs.length !== 1) return null;
    return heightTransfer.getCandidateForOSM(_entityIDs[0]);
  }


  function renderDisclosureContent(selection) {
    selection.classed('grouped-items-area', true);
    const cand = _candidate();

    let containers = selection.selectAll('.issue-container')
      .data(cand ? [cand] : [], d => d.osmFeature.id);

    containers.exit().remove();

    const containersEnter = containers.enter()
      .append('div')
      .attr('class', 'issue-container');

    const itemsEnter = containersEnter
      .append('div')
      .attr('class', d => `issue severity-${d.state === 'CANDIDATE' ? 'warning' : 'other'}`);

    const labelsEnter = itemsEnter
      .append('div')
      .attr('class', 'issue-label');

    labelsEnter
      .append('span')
      .attr('class', 'issue-message');

    itemsEnter
      .append('ul')
      .attr('class', 'issue-fix-list');

    containers = containers.merge(containersEnter);

    containers.selectAll('.issue-message')
      .text(d => _message(d));

    // Fix list: only CANDIDATE is actionable.
    const fixLists = containers.selectAll('.issue-fix-list');
    const fixes = fixLists.selectAll('.issue-fix-item')
      .data(d => (d.state === 'CANDIDATE' ? [d] : []), d => d.osmFeature.id);

    fixes.exit().remove();

    const fixesEnter = fixes.enter()
      .append('li')
      .attr('class', 'issue-fix-item');

    fixesEnter
      .append('button')
      .attr('class', 'actionable')
      .on('click', (d3_event, d) => heightTransfer.apply(d))
      .append('span')
      .attr('class', 'fix-message')
      .text(d => _fixTitle(d));
  }


  function _message(cand) {
    if (cand.state === 'CANDIDATE') {
      const keys = (cand.missingTags ?? []).join(', ');
      return l10n.t('height_transfer.additions') + ': ' + keys;
    } else if (cand.state === 'CONFLICT') {
      return l10n.t('height_transfer.conflict_note');
    } else if (cand.state === 'AREA_MISMATCH') {
      return l10n.t('height_transfer.area_mismatch_note');
    }
    return '';
  }


  function _fixTitle(cand) {
    const plateauTags = cand.plateauFeature?.tags ?? {};
    const added = (cand.missingTags ?? [])
      .map(k => `${k}=${plateauTags[k]}`)
      .join(', ');
    return `${l10n.t('height_transfer.apply')} (${added})`;
  }


  section.entityIDs = function(val) {
    if (val === undefined) return _entityIDs;
    _entityIDs = val ?? [];
    return section;
  };

  return section;
}
```

- [ ] **Step 3c: Export the section**

In `modules/ui/sections/index.js`, add (keep alphabetical-ish with the others):

```javascript
export { uiSectionPlateauTags } from './plateau_tags.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npx karma start karma.conf.cjs --single-run`
Expected: PASS for all five `uiSectionPlateauTags` tests; full suite still green.

- [ ] **Step 5: Commit**

```bash
git add modules/ui/sections/plateau_tags.js modules/ui/sections/index.js data/core.yaml test/browser/ui/sections/plateau_tags.js
git commit -m "feat(plateau): add PLATEAU tags entity-editor section reusing validation UI"
```

---

### Task 3: Register the section in the entity editor

**Files:**
- Modify: `modules/ui/entity_editor.js` (import at ~line 15; sections array at ~line 32-39)

**Interfaces:**
- Consumes: `uiSectionPlateauTags(context)` (Task 2). The render loop already calls `section.entityIDs(_entityIDs)` for every section, so no loop changes are needed.
- Produces: the section rendered in the editor body immediately after the Issues section.

- [ ] **Step 1: Add the import**

In `modules/ui/entity_editor.js`, after the existing `uiSectionEntityIssues` import (line 9), add:

```javascript
import { uiSectionPlateauTags } from './sections/plateau_tags.js';
```

- [ ] **Step 2: Add to the sections array**

In the `sections` array (currently lines 32-39), insert immediately after `uiSectionEntityIssues(context),`:

```javascript
    uiSectionPlateauTags(context),
```

Resulting order: SelectionList, FeatureType, EntityIssues, **PlateauTags**, PresetFields, RawTagEditor, RawMemberEditor, RawMembershipEditor.

- [ ] **Step 3: Verify the build and suite**

Run: `npm run build && npx karma start karma.conf.cjs --single-run`
Expected: build succeeds; full suite green (no dedicated unit test here — entity_editor composes real systems and is verified end-to-end in Task 6).

- [ ] **Step 4: Commit**

```bash
git add modules/ui/entity_editor.js
git commit -m "feat(plateau): render PLATEAU tags section after Issues in entity editor"
```

---

### Task 4: Candidate dot click selects the OSM building

**Files:**
- Modify: `modules/pixi/PixiLayerHeightTransfer.js:148` (the `pointertap` handler)
- Test: `test/browser/pixi/PixiLayerHeightTransfer.test.js`

**Interfaces:**
- Consumes: `context.enter('select-osm', { selection: { osm: [id] } })` — same API used in `modules/ui/maproulette_details.js:101`.
- Produces: clicking a candidate icon enters `select-osm` on `candidate.osmFeature.id` instead of calling `mode.select(candidate)`.

- [ ] **Step 1: Write the failing test**

In `test/browser/pixi/PixiLayerHeightTransfer.test.js`, find the existing click/pointertap test (it currently asserts `mode.select` is called). Replace that assertion, or add a new test, so it asserts the layer enters select-osm. Mirror the mock style already in the file:

```javascript
it('selecting a candidate icon enters select-osm on the OSM building', () => {
  const entered = [];
  context.enter = (modeID, opts) => entered.push([modeID, opts]);
  const candidate = { osmFeature: { id: 'w42' }, state: 'CANDIDATE' };

  // Build the icon graphic the same way the existing tests do, then invoke
  // its 'pointertap' handler. (Reuse whatever helper the file already uses to
  // reach `_makeIcon` / the graphic; match the existing test's approach.)
  const g = layer._makeIcon(candidate, mode);
  g.emit('pointertap');

  expect(entered).to.eql([['select-osm', { selection: { osm: ['w42'] } }]]);
});
```

If `_makeIcon`'s signature or the graphic's event API differs, match exactly what the existing passing tests in this file do — do not invent a new mock shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx karma start karma.conf.cjs --single-run`
Expected: FAIL — the handler still calls `mode.select`, so `entered` is empty.

- [ ] **Step 3: Change the handler**

In `modules/pixi/PixiLayerHeightTransfer.js`, change line 148 from:

```javascript
    g.on('pointertap', () => mode.select(candidate));
```

to:

```javascript
    g.on('pointertap', () => {
      this.context.enter('select-osm', { selection: { osm: [candidate.osmFeature.id] } });
    });
```

Confirm `this.context` is available in this scope (the layer holds `context`). If the enclosing function isn't an arrow/bound method with `this` as the layer, capture `const context = this.context;` at the top of the method that builds the icon and use `context.enter(...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npx karma start karma.conf.cjs --single-run`
Expected: PASS; full suite green.

- [ ] **Step 5: Commit**

```bash
git add modules/pixi/PixiLayerHeightTransfer.js test/browser/pixi/PixiLayerHeightTransfer.test.js
git commit -m "feat(plateau): candidate dot click selects the OSM building in select-osm mode"
```

---

### Task 5: Remove the floating preview panel

**Files:**
- Delete: `modules/ui/panes/UiHeightTransferPreview.js`
- Delete: `test/browser/ui/panes/UiHeightTransferPreview.test.js`
- Modify: `modules/ui/index.js:27` (remove export)
- Modify: `modules/core/UiSystem.js` (remove field decl ~line 45, construction ~line 108, render call ~line 275, and the `UiHeightTransferPreview` name from the import on ~line 8)
- Modify: `modules/modes/HeightTransferMode.js` (remove now-unused `select` / `clearSelection` / `selectedCandidate` if nothing else references them)

**Interfaces:**
- Consumes: nothing new.
- Produces: the floating panel and its wiring are gone; the feature now surfaces only through the entity-editor section.

- [ ] **Step 1: Grep for all references**

Run: `grep -rn "HeightTransferPreview\|selectedCandidate\|\.select(" modules/ | grep -i "heighttransfer\|Preview"`
Note every hit so none are missed. Also check `mode.select`/`selectedCandidate` usages: `grep -rn "selectedCandidate\|select(" modules/modes/HeightTransferMode.js modules/pixi/PixiLayerHeightTransfer.js`.

- [ ] **Step 2: Delete the panel files**

```bash
git rm modules/ui/panes/UiHeightTransferPreview.js test/browser/ui/panes/UiHeightTransferPreview.test.js
```

- [ ] **Step 3: Remove the export**

In `modules/ui/index.js`, delete line 27:

```javascript
export { UiHeightTransferPreview } from './panes/UiHeightTransferPreview.js';
```

- [ ] **Step 4: Remove the UiSystem wiring**

In `modules/core/UiSystem.js`:
- Remove `UiHeightTransferPreview` from the `import { ... }` list (~line 8).
- Remove the field declaration `this.HeightTransferPreview = null;` (~line 45).
- Remove the construction `this.HeightTransferPreview = new UiHeightTransferPreview(context);` (~line 108).
- Remove the render call line `.call(this.HeightTransferPreview.render)` (~line 275).

- [ ] **Step 5: Remove now-dead mode API**

In `modules/modes/HeightTransferMode.js`, remove `select()`, `clearSelection()`, and the `this.selectedCandidate` field **only if** Step 1's grep confirms nothing else references them (the panel was the sole consumer). Keep `apply()` — the section still uses it. If `_onStableChange`/`deactivate` reference `selectedCandidate`, remove those references too. Re-run the grep to confirm zero remaining references before deleting.

- [ ] **Step 6: Run the full suite**

Run: `npm run build && npx karma start karma.conf.cjs --single-run`
Expected: build succeeds; full suite green with no references to the deleted panel.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(plateau): remove floating preview panel, superseded by editor section"
```

---

### Task 6: End-to-end verification in the real app

**Files:** none (manual/browser verification; no code unless a defect is found).

- [ ] **Step 1: Build and start the dev server**

Run: `npm run build`, then start the dev server via the preview tooling (launch config `rapid-dev`, port 8080).

- [ ] **Step 2: Load a PLATEAU area and enable the feature**

In real foreground Chrome (hard reload), open `http://localhost:8080/#map=19.61/35.66400/139.40486`. Turn on the toolbar "PLATEAU tag transfer mode". Confirm candidate dots appear over OSM buildings.

Note: the background preview pane does not auto-load PLATEAU/OSM data (idle-callback + auth limitation). Use the user's real Chrome for this step, or the documented `requestIdleCallback` polyfill to force-load in the pane.

- [ ] **Step 3: Verify the section**

Click a magenta (CANDIDATE) dot. Confirm: the left sidebar entity editor opens for that OSM building, and shows TWO sections — the normal "Issues" section (if any) and a separate "PLATEAU tags" section styled like validation. Confirm the PLATEAU section lists the missing tags and an "Apply" fix.

- [ ] **Step 4: Verify Apply and state handling**

Click "Apply". Confirm the tags are added to the OSM building (check the raw tag editor below), the dot for that building clears, and the PLATEAU section disappears (now COVERED). Undo (Ctrl/Cmd-Z) and confirm it reverts.

- [ ] **Step 5: Verify CONFLICT/AREA_MISMATCH are info-only**

Select a building with a CONFLICT (yellow) or AREA_MISMATCH (orange) dot. Confirm the PLATEAU section shows the note text and NO Apply button. Confirm the global Issues count did not increase from PLATEAU (the section is separate from the validator).

- [ ] **Step 6: Confirm the floating panel is gone**

Confirm no floating panel appears anywhere on candidate selection.

- [ ] **Step 7: Update the SDD ledger**

Append the completion note to `.superpowers/sdd/progress.md` (relocation done, floating panel removed, section integrated). Commit:

```bash
git add .superpowers/sdd/progress.md
git commit -m "docs(plateau): record editor-section integration completion"
```

---

## Self-Review

**Spec coverage:**
- New `uiSectionPlateauTags` reusing validation UI, separate table → Task 2 + Task 3. ✓
- `getCandidateForOSM` data supply → Task 1. ✓
- Dot click → `select-osm` → Task 4. ✓
- Toolbar toggle governs (inactive → null) → Task 1 (`if (!this.active) return null`). ✓
- CANDIDATE actionable / CONFLICT + AREA_MISMATCH info-only / COVERED hidden → Task 2 (`_message`, fix-list data filter, `shouldDisplay`). ✓
- Floating panel removed, l10n reused → Task 5 (removal) + Task 2 (`section_title` added; existing keys reused in `_message`/`_fixTitle`). ✓
- Not routed through validator (no Issues-count pollution) → Task 2 builds a standalone `uiSection`; verified in Task 6 Step 5. ✓
- Tests for section + getCandidateForOSM; delete panel test → Tasks 1, 2, 5. ✓

**Placeholder scan:** No TBD/TODO. Task 4 and Task 5 explicitly instruct matching the existing test mock shape / grepping before deletion rather than inventing details, because those depend on file-local specifics the implementer must read; the required behavior and exact API calls are given.

**Type consistency:** `getCandidateForOSM(entityID)` defined in Task 1 and consumed with that exact name/shape in Task 2. Candidate fields (`osmFeature.id`, `state`, `missingTags`, `plateauFeature.tags`) match `HeightTransferMatcher` output used throughout. `heightTransfer.apply(candidate)` matches the existing method. Section API (`.entityIDs`, `.shouldDisplay`, `.label`, `.render`) matches `uiSection`.
