import { selection } from 'd3-selection';

import { uiIcon } from '../icon.js';
import { uiTooltip } from '../tooltip.js';


/**
 * UiDashboardTool
 * A toolbar section linking out to the Rapid Plateau progress dashboard.
 * Uses a gauge icon (fas-tachometer-alt) so the column matches the neighbouring
 * Save / UndoRedo / etc. buttons (icon inside, l10n label underneath).
 */
export class UiDashboardTool {

  /**
   * @constructor
   * @param  `context`  Global shared application context
   */
  constructor(context) {
    this.context = context;
    this.id = 'plateau_dashboard';
    this.stringID = 'toolbar.dashboard_label';   // rendered as the item-label below the button
    this.url = 'https://rapid.nyampire.info/dashboard/';

    // Create child components
    this.Tooltip = uiTooltip(context);

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    this.render = this.render.bind(this);
  }


  /**
   * render
   * Accepts a parent selection, and renders the content under it.
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
      .title(l10n.t('toolbar.dashboard_tooltip'));

    let $link = $parent.selectAll('a.plateau-dashboard')
      .data([0]);

    // enter
    const $$link = $link.enter()
      .append('a')
      .attr('class', 'bar-button plateau-dashboard')
      .attr('href', this.url)
      .attr('target', '_blank')
      .attr('rel', 'noopener')
      .call(this.Tooltip)
      .call(uiIcon('#fas-tachometer-alt'));

    // update
    $link = $link.merge($$link);
  }
}
