import { selection } from 'd3-selection';

import { uiIcon } from '../icon.js';


/**
 * UiHeightTransferTool
 * A toolbar section that toggles the PLATEAU height-transfer mode: a QA workflow that
 * finds PLATEAU buildings whose height/building:levels tags are missing from their
 * matched OSM building, and highlights them (via `PixiLayerHeightTransfer`, Task 7) so
 * the user can review and apply each one from the preview panel (Task 9).
 *
 * Consumes `context.systems.heightTransfer` (`HeightTransferMode`, Task 6): reads
 * `.active` to render the pressed state, and calls `.activate()` / `.deactivate()` on
 * click. Subscribes to the mode's 'change' event so the button also reflects state
 * changes triggered elsewhere (e.g. `deactivate()` called from outside this button).
 */
export class UiHeightTransferTool {

  /**
   * @constructor
   * @param  `context`  Global shared application context
   */
  constructor(context) {
    this.context = context;
    this.id = 'height-transfer';
    this.stringID = 'toolbar.height_transfer';

    // D3 selections
    this.$parent = null;

    // Ensure methods used as callbacks always have `this` bound correctly.
    // (This is also necessary when using `d3-selection.call`)
    this.choose = this.choose.bind(this);
    this.render = this.render.bind(this);
    this.rerender = (() => this.render());  // call render without argument

    // Event listeners
    const mode = context.systems.heightTransfer;
    mode?.on?.('change', this.rerender);
  }


  /**
   * choose
   * Toggles the height-transfer mode on/off.
   * @param  {Event}  e? - triggering event (if any)
   */
  choose(e) {
    if (e) e.preventDefault();

    const mode = this.context.systems.heightTransfer;
    if (!mode) return;

    if (mode.active) {
      mode.deactivate();
    } else {
      mode.activate();
    }
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

    const context = this.context;
    const l10n = context.systems.l10n;
    const mode = context.systems.heightTransfer;
    if (!mode) return;   // dependency not available - nothing to render

    const title = l10n.t(this.stringID);

    let $button = $parent.selectAll('button.height-transfer-button')
      .data([0]);

    // enter
    const $$button = $button.enter()
      .append('button')
      .attr('class', 'bar-button height-transfer-button')
      .on('click', this.choose)
      .call(uiIcon('#fas-cube'));

    // update
    $button = $button.merge($$button)
      .attr('title', title)
      .classed('active', mode.active)
      .attr('aria-pressed', mode.active ? 'true' : 'false');
  }
}
