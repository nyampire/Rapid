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

  // Plain `.content()`, not `.disclosureContent()`: the disclosure wrapper
  // (expand/collapse chevron) unconditionally reads a user preference via
  // `context.systems.storage`, which this section has no need of and which
  // isn't guaranteed to exist on every context that mounts this section.
  const section = uiSection(context, 'plateau-tags')
    .label(() => l10n.t('height_transfer.section_title'))
    .shouldDisplay(_shouldDisplayNow)
    .content(renderContent);

  // `uiSection#shouldDisplay()` called with no arguments returns the raw
  // (possibly wrapped) function passed to the setter, not its invoked
  // result -- fine for the internal render loop (which calls it), but not
  // useful as a public "is this visible" query. Override it here so external
  // callers (and tests) get the boolean directly, the same way `.entityIDs()`
  // below is overridden to behave as a plain accessor.
  section.shouldDisplay = _shouldDisplayNow;


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
