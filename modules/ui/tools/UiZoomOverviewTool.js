import { selection } from 'd3-selection';

import { uiIcon } from '../icon.js';
import { uiTooltip } from '../tooltip.js';


/**
 * UiZoomOverviewTool
 * A toolbar section that snaps the map to zoom 14 — below the z16 threshold at
 * which OsmService / MapWithAIService start loading tiles. Useful for fast
 * panning between far-apart cities without waiting for buildings to render.
 */
export class UiZoomOverviewTool {

  /**
   * @constructor
   * @param  `context`  Global shared application context
   */
  constructor(context) {
    this.context = context;
    this.id = 'zoom_overview';
    this.stringID = 'toolbar.zoom_overview_label';
    this.targetZoom = 14;

    // Create child components
    this.Tooltip = uiTooltip(context);

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
    this.choose = this.choose.bind(this);
  }


  /**
   * choose
   * @param  {Event}  e? - triggering event (if any)
   */
  choose(e) {
    if (e) e.preventDefault();
    const map = this.context.systems.map;
    if (map.zoom() !== this.targetZoom) {
      map.zoom(this.targetZoom, 250);
    }
  }


  /**
   * render
   * @param {d3-selection} $parent - A d3-selection to a HTMLElement that this component should render itself into
   */
  render($parent = this.$parent) {
    if ($parent instanceof selection) {
      this.$parent = $parent;
    } else {
      return;   // no parent - called too early?
    }

    const context = this.context;
    const l10n = context.systems.l10n;

    this.Tooltip
      .placement('bottom')
      .scrollContainer(context.container().select('.map-toolbar'))
      .title(l10n.t('toolbar.zoom_overview_tooltip'));

    let $button = $parent.selectAll('button.zoom-overview')
      .data([0]);

    // enter
    const $$button = $button.enter()
      .append('button')
      .attr('class', 'bar-button zoom-overview')
      .on('click', this.choose)
      .call(this.Tooltip)
      .call(uiIcon('#fas-compress-arrows-alt'));

    // update
    $button = $button.merge($$button);
  }
}
