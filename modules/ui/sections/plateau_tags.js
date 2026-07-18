import { uiSection } from '../section.js';


/**
 * uiSectionPlateauTags
 * A dedicated entity-editor section that surfaces the PLATEAU tag-transfer
 * proposal for the selected OSM building. It is a standalone `uiSection` fed by
 * `heightTransfer.getCandidateForOSM`, not routed through the validator (so it
 * never inflates the Issues count). The added tags render as read-only
 * key/value rows reusing the raw tag editor's `.tag-list`/`.tag-row` markup, so
 * the layout matches iD's neutral tag editor rather than a validation warning.
 *
 * States (see HeightTransferMatcher):
 *   CANDIDATE      -> read-only key/value table of missing tags + an Apply button
 *   CONFLICT       -> information only (conflict note), no Apply
 *   AREA_MISMATCH  -> information only (area note), no Apply
 *   COVERED        -> section hidden
 */
export function uiSectionPlateauTags(context) {
  const l10n = context.systems.l10n;
  const heightTransfer = context.systems.heightTransfer;

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

    if (cand.state !== 'CANDIDATE') {
      const noteKey = cand.state === 'CONFLICT'
        ? 'height_transfer.conflict_note'
        : 'height_transfer.area_mismatch_note';
      $panel.append('p')
        .attr('class', 'plateau-tags-note')
        .text(l10n.t(noteKey));
      return;
    }

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
      .attr('title', `${l10n.t('height_transfer.apply')} (⇧${l10n.t('shortcuts.command.apply_plateau_tags.key')})`)
      .text(l10n.t('height_transfer.apply'))
      .on('click', () => heightTransfer.apply(cand));
  }


  section.entityIDs = function(val) {
    if (val === undefined) return _entityIDs;
    _entityIDs = val ?? [];
    return section;
  };

  return section;
}
