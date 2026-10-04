import { AbstractSystem } from '../core/AbstractSystem.js';
import { actionTransferPlateauTags } from '../actions/transfer_plateau_tags.js';
import { findCandidates } from '../core/lib/HeightTransferMatcher.js';
import { utilStringQs } from '@rapid-sdk/util';
import { utilCmd, utilPlateauHasTransferWarning } from '../util/index.js';

const RECOMPUTE_DEBOUNCE_MS = 200;


/**
 * `HeightTransferMode`
 * Drives the PLATEAU height-transfer feature end to end at runtime:
 *   - Computes match candidates (PLATEAU outline <-> OSM building) for the current viewport,
 *     recomputed on a debounce whenever the viewport moves.
 *   - Tracks a session-scoped `transferredIDs` set of PLATEAU ids the user has already applied.
 *   - Dispatches `actionTransferPlateauTags` through the editor on `apply()`, integrating with
 *     Rapid's normal undo/redo (via `EditSystem#commit`), and keeps `transferredIDs` in sync
 *     with that history so undo/redo behaves correctly.
 *
 * Despite the "Mode" name (kept for continuity with the design doc), this is registered as a
 * `context.systems.heightTransfer` System, not an exclusive `context.modes` entry -- it needs to
 * run alongside whatever editing mode (browse/select/draw) the user is actually in, rather than
 * replacing it. Task 7 (Pixi layer) and Task 8 (toolbar) find it there.
 *
 * Events available:
 *   'change'       Fires on any state change: candidates recomputed, active toggled.
 *   'transferred'  Fires when `apply()` completes, receives the applied candidate.
 */
export class HeightTransferMode extends AbstractSystem {

  /**
   * @constructor
   * @param  `context`  Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'height-transfer';
    this.dependencies = new Set(['editor', 'map', 'rapid']);

    this.active = false;
    this.candidates = [];
    this.transferredIDs = new Set();   // Set<plateauFeatureID> -- session-scoped only, never persisted

    // PLATEAU の建物の id ごとに、利用者が押したボタンを「タグの名前と、'osm' か 'plateau'」の組で覚える。
    // 押していないタグは覚えず、getChoice が最初の選択を返す。
    // 候補から外れた建物の分は、_recompute で捨てる。
    this._choices = new Map();   // Map<plateauFeatureID, Map<tagKey, 'osm'|'plateau'>>

    this._recomputeTimer = null;
    this._applyKeys = null;   // keys currently bound for the Apply shortcut

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._onViewportMove = this._onViewportMove.bind(this);
    this._onStableChange = this._onStableChange.bind(this);
    this._onApplyShortcut = this._onApplyShortcut.bind(this);
    this._refreshApplyShortcut = this._refreshApplyShortcut.bind(this);
  }


  /**
   * activate
   * Turns the feature on: subscribes to viewport-move and edit-history events,
   * resyncs `transferredIDs` from the edit history (in case edits happened while
   * inactive), and computes the initial candidate list.
   */
  activate() {
    if (this.active) return;
    this.active = true;

    const context = this.context;
    const map = context.systems.map;
    const editor = context.systems.editor;
    map?.on?.('move', this._onViewportMove);
    editor?.on?.('stablechange', this._onStableChange);
    context.on?.('modechange', this._refreshApplyShortcut);

    // Re-derive from history rather than trust whatever `transferredIDs` last held --
    // an undo/redo may have happened while this system was inactive and unsubscribed.
    this._recomputeTransferredIDs();
    this._recompute();   // ends by calling _refreshApplyShortcut()
    this.emit('change');
  }


  /**
   * deactivate
   * Turns the feature off: unsubscribes, clears the transient candidate state.
   * `transferredIDs` is left alone -- it's session-scoped, not mode-scoped -- but it will
   * be resynced from history the next time `activate()` runs.
   */
  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.candidates = [];
    this._choices.clear();

    const context = this.context;
    const map = context.systems.map;
    const editor = context.systems.editor;
    map?.off?.('move', this._onViewportMove);
    editor?.off?.('stablechange', this._onStableChange);
    context.off?.('modechange', this._refreshApplyShortcut);

    const keybinding = context.keybinding?.();
    if (keybinding && this._applyKeys) {
      keybinding.off(this._applyKeys);
      this._applyKeys = null;
    }

    if (this._recomputeTimer) {
      clearTimeout(this._recomputeTimer);
      this._recomputeTimer = null;
    }
    this.emit('change');

    // Clear the dots at once (the renderer is on-demand -- see `_recompute`).
    this.context.systems.gfx?.immediateRedraw?.();
  }


  /**
   * onViewportChange
   * Public hook so tests and integrations can simulate a viewport move directly.
   * Debounced internally -- a burst of calls collapses into a single recompute.
   */
  onViewportChange() {
    this._onViewportMove();
  }


  _onViewportMove() {
    if (!this.active) return;
    if (this._recomputeTimer) clearTimeout(this._recomputeTimer);
    this._recomputeTimer = setTimeout(() => {
      this._recomputeTimer = null;
      this._recompute();
    }, RECOMPUTE_DEBOUNCE_MS);
  }


  /**
   * _onStableChange
   * `EditSystem` has no 'undone'/'redone' events -- it emits 'stablechange' whenever the
   * history actually changes (commit, undo, redo, or restore). Re-derive `transferredIDs`
   * from history each time, the same way `RapidSystem#_stablechange` re-derives its
   * accept/ignore sets, rather than trying to increment/decrement it in place.
   */
  _onStableChange() {
    if (!this.active) return;
    this._recomputeTransferredIDs();
    this._recompute();
  }


  /**
   * _recomputeTransferredIDs
   * Walks the accepted (non-redo) portion of the edit history and rebuilds `transferredIDs`
   * from any `transfer_plateau_tags` annotations found there. This is what makes undo/redo
   * "just work": undoing past a transfer edit drops its plateauID out of history[1..index],
   * redoing it puts it back in.
   */
  _recomputeTransferredIDs() {
    const editor = this.context.systems.editor;
    if (!editor) return;

    const history = editor.history ?? [];
    const index = editor.index ?? 0;
    const next = new Set();

    // Start at 1 -- the base edit (index 0) never carries an annotation.
    // End at `index` -- don't walk into redo-only history.
    for (let i = 1; i <= index; i++) {
      const annotation = history[i]?.annotation;
      if (annotation?.type === 'transfer_plateau_tags' && annotation.plateauID) {
        next.add(annotation.plateauID);
      }
    }
    this.transferredIDs = next;
  }


  /**
   * apply
   * Transfers a candidate's missing tags onto its matched OSM feature, as a normal
   * undoable edit. Only tags the PLATEAU feature actually has a value for are sent --
   * `candidate.missingTags` is filtered through `candidate.plateauFeature.tags`, so a
   * key listed as "missing" but with an undefined Plateau value is silently dropped.
   *
   * 「Plateau」が選ばれたタグのうち、OSM に無いものを追加し、食い違うものは既存の値を置き換える。
   * 追加と書き換えは 1 回の編集として記録し、1 回の取り消しで戻る。
   *
   * @param  `candidate`  A `MatchCandidate` to apply
   */
  apply(candidate) {
    if (!this.active) return;
    const editor = this.context.systems.editor;
    if (!editor) return;

    // `editor.commit()` below fires 'stablechange' synchronously, which `_onStableChange()`
    // handles by re-deriving `transferredIDs` from history (already includes this candidate's
    // plateauID once committed) and calling `_recompute()` -- which re-runs `findCandidates()`
    // (already excludes this candidate, since `findCandidates` filters against `transferredIDs`)
    // and emits 'change'. That means there's no need for a second manual emit here.
    // The changeset `source` is assembled from the `dataUsed` on each edit's
    // annotation (see `EditSystem#_gatherSources`). Without it the transfer
    // records no provenance at all -- no `MLIT_PLATEAU`, no `RapiD_Plateau_JP`,
    // no `source_ref` -- while accepting a building records all three.
    // Same lookup the accept path uses in `UiRapidInspector`.
    const rapid = this.context.systems.rapid;
    const datasetID = (candidate.plateauFeature.__datasetid__ ?? 'plateauJapan')
      .replace('-conflated', '');
    const dataset = rapid?.datasets?.get(datasetID);

    // 適用の時点の選択で、追加と書き換えを決め直す。
    // 選んだあとにパラメータが外された場合などは、getChoice が最初の選択を返すので、追加だけになる。
    const { add: tagsToAdd, replace: tagsToReplace } = this._tagsToApply(candidate);

    // 記録すると候補が計算し直されるので、その前に選択を捨てる。
    // 取り消したときは、最初の選択に戻る。
    this._choices.delete(candidate.plateauFeature.id);

    const action = actionTransferPlateauTags(candidate.osmFeature.id, tagsToAdd, tagsToReplace);
    editor.perform(action);
    editor.commit({
      annotation: {
        type: action.actionName,
        plateauID: candidate.plateauFeature.id,
        entityID: candidate.osmFeature.id,
        dataUsed: dataset?.dataUsed || [datasetID],
        overwrittenKeys: Object.keys(tagsToReplace)
      },
      selectedIDs: [ candidate.osmFeature.id ]
    });

    this.emit('transferred', candidate);
  }


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
   * 面積の不一致と高さの警告の両方に当たるときは、欄に面積の理由の文を出すためである。
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


  /**
   * hasWorkToApply
   * 適用して変わるものがあるか。
   * 追加か書き換えに回るタグが 1 つでもあれば真にする。
   * 欄のボタンの有効と無効、A キーの割り当ての両方がこの関数を使う。
   * @param  {Object}  candidate  MatchCandidate
   * @return {boolean}
   */
  hasWorkToApply(candidate) {
    if (!candidate) return false;
    const { add, replace } = this._tagsToApply(candidate);
    return Object.keys(add).length > 0 || Object.keys(replace).length > 0;
  }


  /**
   * _refreshApplyShortcut
   * Binds the Apply shortcut (A) only while a single building whose candidate
   * has something to apply (`hasWorkToApply`) is selected, and unbinds it otherwise. That is the same
   * condition `uiSectionPlateauTags` uses to show its Apply button, so the key
   * and the button are never out of step. This keeps it exclusive with Rapid's
   * own `A` (accept feature): that binds only when a Rapid feature is selected,
   * and since selection is single, the two never coexist on the shared global
   * keybinding (where a duplicate key would otherwise clobber the other).
   * Called on `modechange` (selection changed) and after `_recompute`.
   */
  _refreshApplyShortcut() {
    const context = this.context;
    const keybinding = context.keybinding?.();
    const l10n = context.systems.l10n;
    if (!keybinding || !l10n) return;

    const ids = context.selectedIDs?.() ?? [];
    const candidate = (ids.length === 1) ? this.getCandidateForOSM(ids[0]) : null;
    const wantBound = this.hasWorkToApply(candidate);

    if (wantBound && !this._applyKeys) {
      this._applyKeys = [ utilCmd(l10n.t('shortcuts.command.apply_plateau_tags.key')) ];
      keybinding.on(this._applyKeys, this._onApplyShortcut);
    } else if (!wantBound && this._applyKeys) {
      keybinding.off(this._applyKeys);
      this._applyKeys = null;
    }
  }


  /**
   * _onApplyShortcut
   * 選択中の OSM の建物に対応する候補を適用します。
   * 建物がちょうど 1 つ選ばれていて、その候補で `hasWorkToApply` が真のときだけ適用します。
   */
  _onApplyShortcut(e) {
    const ids = this.context.selectedIDs?.() ?? [];
    if (ids.length !== 1) return;

    const candidate = this.getCandidateForOSM(ids[0]);
    if (!this.hasWorkToApply(candidate)) return;

    e?.preventDefault?.();
    this.apply(candidate);
  }


  /**
   * _recompute
   * Rebuilds `candidates` for the current viewport by gathering all loaded PLATEAU
   * entities and the OSM entities in view, then running them through `findCandidates`.
   */
  _recompute() {
    const context = this.context;
    const plateau = context.services?.plateau;
    const editor = context.systems.editor;
    const rapid = context.systems.rapid;

    if (!plateau || !editor) {
      this.candidates = [];
      this.emit('change');
      return;
    }

    const extent = context.systems.map?.extent ? context.systems.map.extent() : undefined;
    const osmEntities = editor.intersects ? editor.intersects(extent) : [];
    // `asGeoJSON(resolver)` needs the graph the OSM entities were resolved
    // against; that's the editor's current (staging) graph.
    const osmGraph = editor.staging?.graph;

    const acceptIDs = rapid?.acceptIDs ?? new Set();
    const ignoreIDs = rapid?.ignoreIDs ?? new Set();

    // Plateau entities live in per-dataset graphs (their node refs resolve only
    // there), so match each dataset's entities with its own graph resolver.
    const candidates = [];
    const datasets = plateau.getAvailableDatasets ? plateau.getAvailableDatasets() : [];
    for (const dataset of datasets) {
      // skipConflation: the default `getData()` conflation hides Plateau
      // buildings that overlap OSM, but height transfer needs exactly those
      // overlapping pairs to work.
      const entities = plateau.getData ? plateau.getData(dataset.id, { skipConflation: true }) : null;
      if (!entities || !entities.length) continue;
      const plateauGraph = plateau.graph ? plateau.graph(dataset.id) : undefined;
      candidates.push(...findCandidates({
        plateauEntities: entities,
        osmEntities,
        plateauGraph,
        osmGraph,
        transferredIDs: this.transferredIDs,
        acceptIDs,
        ignoreIDs
      }));
    }

    this.candidates = candidates;

    // 候補から外れた建物の選択は捨てる。
    // 地図を動かして画面の外に出た建物も外れるので、戻ってきたときは最初の選択に戻る。
    const liveIDs = new Set(candidates.map(c => c.plateauFeature.id));
    for (const id of this._choices.keys()) {
      if (!liveIDs.has(id)) this._choices.delete(id);
    }

    this.emit('change');

    // The selected building may have gained/lost candidate status (e.g. after an
    // apply removes it), so re-evaluate the Apply shortcut binding.
    this._refreshApplyShortcut();

    // Repaint the candidate-dot layer now. The renderer is on-demand, and
    // nothing else marks it dirty when candidates change, so without this the
    // dots only appear on the next incidental redraw (a pan, a hover) -- a
    // multi-second delay after toggling the mode on.
    this.context.systems.gfx?.immediateRedraw?.();
  }

}
