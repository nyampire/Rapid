import { uiSection } from '../section.js';
import { uiTooltip } from '../tooltip.js';


// States that get an explanatory note above the proposal. CANDIDATE needs none.
const NOTE_KEYS = {
  CONFLICT:      'height_transfer.conflict_note',
  AREA_MISMATCH: 'height_transfer.area_mismatch_note'
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

    const noteKey = NOTE_KEYS[cand.state];
    if (noteKey) {
      $panel.append('p')
        .attr('class', 'plateau-tags-note')
        .text(l10n.t(noteKey));
    }

    // The proposal itself depends only on whether there is anything to add, not
    // on the state. That gives AREA_MISMATCH the same table + Apply button as a
    // plain CANDIDATE (the note above it carries the warning), and leaves
    // CONFLICT with the note alone -- a CONFLICT always has an empty
    // `missingTags`, since state precedence puts `missing` ahead of
    // `conflicting`, so it needs no special case here.
    if (!cand.missingTags?.length) return;

    $panel.append('p')
      .attr('class', 'plateau-tags-note')
      .text(l10n.t('height_transfer.additions'));

    // Read-only key/value rows, reusing the raw tag editor's markup/CSS so they
    // match iD's tag editor (the "All fields" section below).
    const $list = $panel.append('ul')
      .attr('class', 'tag-list plateau-additions');

    for (const key of (cand.missingTags ?? [])) {
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

    $panel.append('div')
      .attr('class', 'plateau-tags-actions')
      .append('button')
      .attr('class', 'plateau-apply')
      .text(l10n.t('height_transfer.apply'))
      .on('click', () => heightTransfer.apply(cand))
      .call(_applyTooltip
        .title(l10n.t('height_transfer.apply_tooltip'))
        .shortcut(l10n.t('shortcuts.command.apply_plateau_tags.key'))
      );

    // --- geometry replace ---
    const inPreview = heightTransfer.replacePreview && heightTransfer.replacePreview.osmFeature?.id === cand.osmFeature?.id;

    if (!cand.replaceable && !inPreview) {
      // building shares nodes with a neighbour, or is AREA_MISMATCH: no replace here
    } else if (!inPreview) {
      $panel.append('div')
        .attr('class', 'plateau-tags-actions')
        .append('button')
        .attr('class', 'plateau-replace')
        .text(l10n.t('height_transfer.replace_geometry'))
        .on('click', () => heightTransfer.previewReplace(cand));
    } else {
      // preview mode: list tags that will be filled, then confirm/cancel
      const fillKeys = Object.keys(cand.plateauFeature?.tags ?? {}).filter(k => {
        const ov = cand.osmFeature?.tags?.[k];
        return (ov === undefined || ov === null || ov === '')
          && !['conn', 'dupe', 'orig_id', 'debug_way_id', 'import'].includes(k);
      });
      $panel.append('p')
        .attr('class', 'plateau-tags-note')
        .text(l10n.t('height_transfer.replace_preview_note'));
      if (fillKeys.length) {
        $panel.append('p').attr('class', 'plateau-tags-note')
          .text(l10n.t('height_transfer.additions'));
        const $list = $panel.append('ul').attr('class', 'tag-list plateau-additions');
        for (const key of fillKeys) {
          const $inner = $list.append('li').attr('class', 'tag-row readonly').append('div').attr('class', 'inner-wrap');
          $inner.append('div').attr('class', 'key-wrap').append('input')
            .attr('type', 'text').attr('class', 'key').attr('readonly', true).property('value', key);
          $inner.append('div').attr('class', 'value-wrap').append('input')
            .attr('type', 'text').attr('class', 'value').attr('readonly', true)
            .property('value', cand.plateauFeature.tags[key]);
        }
      }
      const $actions = $panel.append('div').attr('class', 'plateau-tags-actions');
      $actions.append('button').attr('class', 'plateau-replace-confirm')
        .text(l10n.t('height_transfer.replace_confirm'))
        .on('click', () => heightTransfer.confirmReplace());
      $actions.append('button').attr('class', 'plateau-replace-cancel')
        .text(l10n.t('height_transfer.replace_cancel'))
        .on('click', () => heightTransfer.cancelReplace());
    }
  }


  section.entityIDs = function(val) {
    if (val === undefined) return _entityIDs;
    _entityIDs = val ?? [];
    return section;
  };

  return section;
}
