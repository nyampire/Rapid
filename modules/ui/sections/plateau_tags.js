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
 *   COVERED        -> section hidden, unless `replaceable` (see below)
 *
 * Geometry replace ("replace shape") is a separate, independent affordance gated
 * only by `candidate.replaceable` (HeightTransferMatcher: state is CANDIDATE,
 * CONFLICT, or COVERED, and the outline isn't excluded by AREA_MISMATCH or a
 * too-small area ratio). It shows a "Replace" button alongside whatever the tag
 * Apply block renders -- including when the Apply block renders nothing, as for
 * CONFLICT/COVERED. `heightTransfer.replacePreview` being this candidate switches
 * the panel into a dedicated preview view (fill-tag list + confirm/cancel) that
 * replaces (not augments) the normal tag Apply block, so tags never double up.
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
    // A COVERED candidate is normally fully handled already and has nothing to
    // show here -- except when it's still `replaceable`: the OSM building may be
    // fully tagged already but still worth swapping onto the Plateau outline.
    return !!cand && (cand.state !== 'COVERED' || cand.replaceable);
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

    // A replace preview takes over the panel entirely: it shows its own note,
    // its own fill-tag list, and confirm/cancel in place of the normal tag Apply
    // block, so the two never render their tag lists side by side (which would
    // otherwise show every fillable key twice -- once per list).
    const inPreview = heightTransfer.replacePreview && heightTransfer.replacePreview.osmFeature?.id === cand.osmFeature?.id;
    if (inPreview) {
      _renderReplacePreview($panel, cand);
      return;
    }

    // The tag-Apply proposal depends only on whether there is anything to add,
    // not on the state. That gives AREA_MISMATCH the same table + Apply button as
    // a plain CANDIDATE (the note above it carries the warning), and leaves
    // CONFLICT with the note alone -- a CONFLICT always has an empty
    // `missingTags`, since state precedence puts `missing` ahead of
    // `conflicting`, so it needs no special case here.
    if (cand.missingTags?.length) {
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
    }

    // Geometry replace is independent of the tag-Apply proposal above: a
    // `replaceable` candidate (state CANDIDATE, CONFLICT, or COVERED per
    // HeightTransferMatcher) gets a Replace button regardless of whether there is
    // anything left for Apply to do -- e.g. CONFLICT/COVERED always have empty
    // `missingTags`, so this must not live inside the `if` above.
    if (cand.replaceable) {
      $panel.append('div')
        .attr('class', 'plateau-tags-actions')
        .append('button')
        .attr('class', 'plateau-replace')
        .text(l10n.t('height_transfer.replace_geometry'))
        .on('click', () => heightTransfer.previewReplace(cand));
    }
  }


  // Renders the dedicated preview view: a note, an optional read-only list of
  // the tags the replace will fill in (empty for e.g. a COVERED building that's
  // already fully tagged), and confirm/cancel. Used in place of (never alongside)
  // the normal tag-Apply block -- see the `inPreview` branch in renderContent.
  function _renderReplacePreview($panel, cand) {
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


  section.entityIDs = function(val) {
    if (val === undefined) return _entityIDs;
    _entityIDs = val ?? [];
    return section;
  };

  return section;
}
