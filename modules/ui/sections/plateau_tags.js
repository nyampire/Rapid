import { uiSection } from '../section.js';
import { uiTooltip } from '../tooltip.js';
import { uiPlateauHeightWarning } from '../plateau_height_warning.js';
import { utilPlateauTransferWarningMessages } from '../../util/plateau_height_warning.js';
import { TARGET_TAG_KEYS } from '../../core/lib/HeightTransferMatcher.js';


// States that get an explanatory note above the proposal. CANDIDATE needs none.
const NOTE_KEYS = {
  CONFLICT:      'height_transfer.conflict_note',
  AREA_MISMATCH: 'height_transfer.area_mismatch_note'
};

// 書き換えられない理由の文。
// 'disabled'（URL のパラメータが無い）では選ぶ表を出さない。
// そのため、理由の文も無い。
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
 * URL パラメータ `plateau_overwrite=1` があるときは、OSM に無いタグと食い違うタグを 1 つの表に並べ、行ごとに「OSM」と「Plateau」のボタンを置きます（`_renderChoices` を参照）。
 * パラメータが無いときは、上に書いたとおりに表示します。
 */
export function uiSectionPlateauTags(context) {
  const l10n = context.systems.l10n;
  const heightTransfer = context.systems.heightTransfer;
  // Place the tooltip to the LEFT of the button. The button is right-aligned at
  // the sidebar edge, so a top/bottom (horizontally centered) tooltip overflows
  // past the sidebar and gets clipped; opening leftward keeps it inside.
  const _applyTooltip = uiTooltip(context).placement('left');   // description + shortcut badge

  let _entityIDs = [];
  // 押したボタンの位置。
  // 表は作り直されるので、押したボタンと同じ位置のボタンへ、あとでフォーカスを戻す。
  let _refocus = null;

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
    if (!keys.length) {
      _refocus = null;
      return;
    }

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
    $head.append('th').attr('scope', 'col');
    $head.append('th').attr('scope', 'col').text(l10n.t('height_transfer.column_osm'));
    $head.append('th').attr('scope', 'col').text(l10n.t('height_transfer.column_plateau'));

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
        .attr('scope', 'row')
        .attr('class', 'plateau-choice-key')
        .text(key);
      _renderChoiceButton($row, cand, key, 'osm', osmValue, choice === 'osm', false);
      _renderChoiceButton($row, cand, key, 'plateau', plateauValue, choice === 'plateau', plateauDisabled);
    }

    _renderApply($panel, cand, heightTransfer.hasWorkToApply(cand));

    // 押したボタンは作り直されて消えているので、同じ位置のボタンへフォーカスを戻す。
    if (_refocus) {
      const $again = $table.selectAll('tr.plateau-choice-row')
        .filter(function() { return this.dataset.key === _refocus.key; })
        .select(`button.plateau-choice-${_refocus.source}`);
      if (!$again.empty()) $again.node().focus();
      _refocus = null;
    }
  }


  // 表の 1 つのボタン。
  // 選ばれたボタンは .selected と aria-pressed で示し、色は css の規則で付ける。
  function _renderChoiceButton($row, cand, key, source, value, isSelected, isDisabled) {
    $row.append('td')
      .append('button')
      .attr('class', `plateau-choice plateau-choice-${source}`)
      .attr('aria-label', `${key} ${l10n.t(source === 'osm' ? 'height_transfer.column_osm' : 'height_transfer.column_plateau')} ${value}`)
      .classed('selected', isSelected)
      .attr('aria-pressed', String(isSelected))
      .property('disabled', isDisabled)
      .text(value)
      .on('click', () => {
        _refocus = { key, source };
        heightTransfer.setChoice(cand, key, source);
      });
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


  section.entityIDs = function(val) {
    if (val === undefined) return _entityIDs;
    _entityIDs = val ?? [];
    return section;
  };

  return section;
}
