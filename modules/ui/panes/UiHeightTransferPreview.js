import { selection } from 'd3-selection';


/**
 * UiHeightTransferPreview
 * A self-contained overlay panel for the PLATEAU height-transfer QA workflow (Task 9).
 * Shows/hides itself based on `context.systems.heightTransfer.selectedCandidate` --
 * unlike `UiRapidInspector`, this doesn't hook into `UiSidebar`'s hover-driven datum
 * dispatch (selection here comes from clicking a `PixiLayerHeightTransfer` icon and
 * calling `mode.select(candidate)`, not from hovering a map feature), so it renders
 * itself as a standalone floating panel instead.
 *
 * For a `CANDIDATE` state candidate, shows the OSM feature's current tags plus the
 * PLATEAU tags that would be added, with an Apply button that calls `mode.apply()`.
 * For `COVERED` / `CONFLICT` / `AREA_MISMATCH`, shows read-only informational text
 * with no Apply button. A Cancel button (always present once a candidate is
 * selected) calls `mode.clearSelection()`.
 *
 * @example
 *  <div class='height-transfer-preview'>
 *    <h4/>                                  // "OSM way #123"
 *    <h5/><ul class='current-tags'/>         // Current OSM tags
 *    <h5/><ul class='additions'/>            // CANDIDATE only: tags that would be added
 *    <p class='note'/>                       // COVERED/CONFLICT/AREA_MISMATCH only
 *    <table class='conflict-table'/>         // CONFLICT only
 *    <button class='apply'/>                 // CANDIDATE only
 *    <button class='cancel'/>
 *  </div>
 */
export class UiHeightTransferPreview {

  /**
   * @constructor
   * @param  `context`  Global shared application context
   */
  constructor(context) {
    this.context = context;
    this._mode = context.systems?.heightTransfer;

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.render = this.render.bind(this);
    this._rerender = (() => this.render());  // call render without argument

    // Event listeners
    this._mode?.on?.('change', this._rerender);
  }


  /**
   * render
   * Accepts a parent selection, and renders the content under it.
   * (The parent selection is required the first time, but can be inferred on subsequent renders)
   * @param {d3-selection} $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  render($parent = this.$parent) {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const cand = this._mode?.selectedCandidate ?? null;

    let $panel = $parent.selectAll('.height-transfer-preview')
      .data(cand ? [cand] : []);

    $panel.exit().remove();

    const $$panel = $panel.enter()
      .append('div')
      .attr('class', 'height-transfer-preview');

    $panel = $panel.merge($$panel);
    if (!cand) return;

    // Rebuild the panel body from scratch on every render. The panel is small,
    // only re-renders on selection/state changes (not per frame), and a full
    // rebuild is far simpler to keep correct across the four candidate states
    // than hand-rolling enter/update/exit for each conditional section.
    $panel.selectAll('*').remove();
    this._renderContent($panel, cand);
  }


  /**
   * _renderContent
   * Renders the body of the panel for the given candidate.
   * @param {d3-selection} $panel - The `.height-transfer-preview` selection to render into
   * @param {Object} cand - The selected `MatchCandidate` (see HeightTransferMatcher)
   */
  _renderContent($panel, cand) {
    const context = this.context;
    const l10n = context.systems.l10n;
    const mode = this._mode;

    const osmFeature = cand.osmFeature ?? {};
    const plateauFeature = cand.plateauFeature ?? {};
    const osmTags = osmFeature.tags ?? {};
    const plateauTags = plateauFeature.tags ?? {};

    $panel.append('h4')
      .attr('class', 'height-transfer-preview-title')
      .text(`OSM ${osmFeature.type ?? 'feature'} #${osmFeature.id ?? ''}`);

    // Current tags
    $panel.append('h5')
      .text(l10n.t('height_transfer.current_tags'));

    const $currentList = $panel.append('ul')
      .attr('class', 'current-tags');

    for (const [k, v] of Object.entries(osmTags)) {
      const $li = $currentList.append('li');
      $li.append('span').attr('class', 'tag-key').text(k);
      $li.append('span').attr('class', 'tag-value').text(` = ${v}`);
    }

    if (cand.state === 'CANDIDATE') {
      const missing = cand.missingTags ?? [];
      if (missing.length) {
        $panel.append('h5')
          .text(l10n.t('height_transfer.additions'));

        const $addList = $panel.append('ul')
          .attr('class', 'additions');

        for (const key of missing) {
          const $li = $addList.append('li');
          $li.append('span').attr('class', 'tag-key').text(key);
          $li.append('span').attr('class', 'tag-value').text(` = ${plateauTags[key]}`);
          $li.append('span').attr('class', 'tag-source').text('  ← PLATEAU');
        }
      }

      $panel.append('button')
        .attr('class', 'apply')
        .text(l10n.t('height_transfer.apply'))
        .on('click', () => mode.apply(cand));

    } else if (cand.state === 'CONFLICT') {
      $panel.append('p')
        .attr('class', 'note')
        .text(l10n.t('height_transfer.conflict_note'));

      const conflicting = cand.conflictingTags ?? [];
      if (conflicting.length) {
        const $tbl = $panel.append('table')
          .attr('class', 'conflict-table');

        for (const c of conflicting) {
          const $tr = $tbl.append('tr');
          $tr.append('td').text(c.key);
          $tr.append('td').text(`OSM: ${c.osmValue}`);
          $tr.append('td').text(`PLATEAU: ${c.plateauValue}`);
        }
      }

    } else if (cand.state === 'COVERED') {
      $panel.append('p')
        .attr('class', 'note')
        .text(l10n.t('height_transfer.covered_note'));

    } else if (cand.state === 'AREA_MISMATCH') {
      $panel.append('p')
        .attr('class', 'note')
        .text(l10n.t('height_transfer.area_mismatch_note'));
    }

    $panel.append('button')
      .attr('class', 'cancel')
      .text(l10n.t('height_transfer.cancel'))
      .on('click', () => mode.clearSelection());
  }

}
