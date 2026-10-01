import { uiSection } from '../section.js';
import { uiTooltip } from '../tooltip.js';
import { uiPlateauHeightWarning } from '../plateau_height_warning.js';
import { utilPlateauTransferWarningMessages } from '../../util/plateau_height_warning.js';


// States that get an explanatory note above the proposal. CANDIDATE needs none.
const NOTE_KEYS = {
  CONFLICT:      'height_transfer.conflict_note',
  AREA_MISMATCH: 'height_transfer.area_mismatch_note'
};

// 書き換えられない理由の文。
// 'disabled'（URL のパラメータが無い）では食い違うタグの行を出さないので、文も無い。
const OVERWRITE_BLOCK_KEYS = {
  area:    'height_transfer.overwrite_blocked_area',
  warning: 'height_transfer.overwrite_blocked_warning'
};


/**
 * uiSectionPlateauTags
 * A dedicated entity-editor section that surfaces the PLATEAU tag-transfer
 * proposal for the selected OSM building. It is a standalone `uiSection` fed by
 * `heightTransfer.getCandidateForOSM`, not routed through the validator (so it
 * never inflates the Issues count). The added tags render as read-only
 * key/value rows reusing the raw tag editor's `.tag-list`/`.tag-row` markup, so
 * the layout matches iD's neutral tag editor rather than a validation warning.
 *
 * The state decides whether an explanatory note appears; the presence of tags to
 * add decides whether the read-only key/value table and Apply button appear.
 * Those two are independent, which is what lets AREA_MISMATCH warn and still
 * offer the fix (see HeightTransferMatcher):
 *   CANDIDATE      -> table + Apply, no note
 *   CONFLICT       -> conflict note only (its `missingTags` is always empty)
 *   AREA_MISMATCH  -> area note, plus table + Apply when there is something to add
 *   COVERED        -> section hidden
 *
 * With overwriting enabled (`plateau_overwrite=1`), conflicting tags get their
 * own rows with an OSM / Plateau choice; see `_renderConflicts`. Without it the
 * section renders exactly as described above.
 */
export function uiSectionPlateauTags(context) {
  const l10n = context.systems.l10n;
  const heightTransfer = context.systems.heightTransfer;
  // Place the tooltip to the LEFT of the button. The button is right-aligned at
  // the sidebar edge, so a top/bottom (horizontally centered) tooltip overflows
  // past the sidebar and gets clipped; opening leftward keeps it inside.
  const _applyTooltip = uiTooltip(context).placement('left');   // description + shortcut badge

  let _entityIDs = [];

  function _shouldDisplayNow() {
    const cand = _candidate();
    return !!cand && cand.state !== 'COVERED';
  }

  const section = uiSection(context, 'plateau-tags')
    .label(() => l10n.t('height_transfer.section_title'))
    .shouldDisplay(_shouldDisplayNow)
    .disclosureContent(renderContent);

  // `HeightTransferMode` recomputes its candidates on `stablechange` (which fires
  // after the entity editor's `stagingchange`, the only event that normally causes
  // this section to re-render) and then emits its own 'change'. Without this
  // subscription the section keeps showing a stale candidate + Apply button after
  // the user clicks Apply, until the building is reselected.
  const _onChange = () => section.reRender();
  heightTransfer?.off?.('change', _onChange);
  heightTransfer?.on?.('change', _onChange);


  function _candidate() {
    if (!heightTransfer?.getCandidateForOSM) return null;
    if (_entityIDs.length !== 1) return null;
    return heightTransfer.getCandidateForOSM(_entityIDs[0]);
  }


  function renderContent(selection) {
    const cand = _candidate();

    // Full rebuild: this only re-renders on selection/candidate changes (not per
    // frame), and a clean neutral layout is far simpler to keep correct across
    // the states than a d3 enter/update dance.
    selection.html('');
    if (!cand) return;

    // A soft-yellow panel marks this as the special PLATEAU proposal, distinct
    // from the regular tag editor, without the harsh validation-warning look.
    const $panel = selection.append('div')
      .attr('class', 'plateau-tags-panel');

    // 転記元の PLATEAU の建物の高さが怪しいときは、提案の前に警告を出す。
    // 適用の操作は止めない。
    const plateauFeature = cand.plateauFeature;
    const plateauGraph = context.services?.plateau?.graph?.(plateauFeature?.__datasetid__) ?? null;
    const warnings = utilPlateauTransferWarningMessages(plateauFeature, plateauGraph, l10n);
    uiPlateauHeightWarning($panel, warnings, l10n);

    // 書き換えが有効なときだけ、食い違うタグの行を出す。
    // heightTransfer が書き換えの関数を持たないときは、無効とみなして今までと同じ表示にする。
    // getOverwriteBlock は、書き換えられるときに null を返す。
    // null を無効と取り違えないように、関数の有無で分ける。
    const hasOverwrite = typeof heightTransfer.getOverwriteBlock === 'function';
    const block = hasOverwrite ? heightTransfer.getOverwriteBlock(cand) : 'disabled';
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


  section.entityIDs = function(val) {
    if (val === undefined) return _entityIDs;
    _entityIDs = val ?? [];
    return section;
  };

  return section;
}
