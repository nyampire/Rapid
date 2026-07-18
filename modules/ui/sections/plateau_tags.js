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
      .attr('class', 'issue');

    const labelsEnter = itemsEnter
      .append('div')
      .attr('class', 'issue-label');

    const textEnter = labelsEnter
      .append('button')
      .attr('class', 'issue-text');

    textEnter
      .append('span')
      .attr('class', 'issue-message');

    itemsEnter
      .append('ul')
      .attr('class', 'issue-fix-list');

    containers = containers.merge(containersEnter);

    // Keep the severity class current on every render (not only on enter), so it
    // stays correct if a candidate's state changes in place. CANDIDATE is
    // actionable (warning); CONFLICT/AREA_MISMATCH are informational only and use
    // `severity-suggestion`, the closest styled "informational" severity (there is
    // no `severity-other` in css/80_app.css, so that class rendered unstyled).
    containers.select('.issue')
      .attr('class', d => `issue severity-${d.state === 'CANDIDATE' ? 'warning' : 'suggestion'}`);

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
