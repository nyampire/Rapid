import * as PIXI from 'pixi.js';
import { AbstractLayer } from './AbstractLayer.js';


const MIN_CANDIDATE_ZOOM = 17;
const MIN_INFO_ZOOM = 18;

// State visual specs (PLATEAU Height Transfer spec Section 3).
const STATE_STYLE = {
  CANDIDATE:      { color: 0xD500F9, radius: 6, glyph: null,  minZoom: MIN_CANDIDATE_ZOOM },
  COVERED:        { color: 0x66BB6A, radius: 8, glyph: '✓',   minZoom: MIN_INFO_ZOOM },
  CONFLICT:       { color: 0xFFC107, radius: 8, glyph: '!?',  minZoom: MIN_INFO_ZOOM },
  AREA_MISMATCH:  { color: 0xFF9800, radius: 8, glyph: '!?',  minZoom: MIN_INFO_ZOOM }
};


/**
 * PixiLayerHeightTransfer
 * Draws one icon per candidate produced by `context.systems.heightTransfer`
 * (see `HeightTransferMode`), colored/shaped by `candidate.state`. A click on
 * an icon forwards the candidate back to `heightTransfer.select(candidate)`.
 *
 * Visible only while `heightTransfer.active` is true. Within that:
 *  - CANDIDATE icons appear at zoom >= 17
 *  - COVERED / CONFLICT / AREA_MISMATCH icons appear at zoom >= 18
 *
 * The whole icon set is rebuilt on every render (candidates are recomputed on
 * a debounce by the mode itself, not every frame, so this stays cheap).
 *
 * @class
 */
export class PixiLayerHeightTransfer extends AbstractLayer {

  /**
   * @constructor
   * @param  scene    The Scene that owns this Layer
   * @param  layerID  Unique string to use for the name of this Layer
   */
  constructor(scene, layerID) {
    super(scene, layerID);
    this._enabled = true;   // Default ON - visibility is gated by `heightTransfer.active`, not layer toggle
    this._container = null;
  }


  /**
   * supported
   * @return {boolean} `true` if the heightTransfer system is available
   */
  get supported() {
    return !!this.context.systems.heightTransfer;
  }


  /**
   * reset
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  reset() {
    super.reset();

    if (this._container) {
      this._container.destroy({ children: true });
      this._container = null;
    }

    const container = new PIXI.Container();
    container.label = this.layerID;
    container.sortableChildren = false;
    this._container = container;

    const groupContainer = this.scene.groups.get('qa');
    if (groupContainer) {
      groupContainer.addChild(container);
    }
  }


  /**
   * render
   * Draw the candidate icons for the current zoom level.
   * @param  frame      Integer frame being rendered
   * @param  viewport   Pixi viewport to use for rendering
   * @param  zoom       Effective zoom to use for rendering
   */
  render(frame, viewport, zoom) {
    if (!this._container) return;

    // Always start from a clean slate - the candidate list, zoom, and active
    // state can each change between renders, and this layer is cheap enough
    // to fully rebuild rather than diff.
    // `Container#removeChildren()` only unparents children, it does not call
    // `.destroy()` on them - so destroy the old icons explicitly to release
    // their GPU-backed resources (a canvas texture, for PIXI.Text glyphs)
    // instead of silently orphaning them on every re-render.
    const stale = this._container.removeChildren();
    for (const child of stale) {
      child.destroy({ children: true });
    }

    const mode = this.context.systems.heightTransfer;
    if (!mode || !mode.active) return;

    for (const candidate of mode.candidates ?? []) {
      const style = STATE_STYLE[candidate.state];
      if (!style) continue;
      if (zoom < style.minZoom) continue;

      const icon = this._makeIcon(candidate, style, viewport, mode);
      if (icon) this._container.addChild(icon);
    }
  }


  /**
   * _makeIcon
   * Builds one interactive Pixi icon for a candidate.
   * @param  candidate  MatchCandidate (see HeightTransferMatcher)
   * @param  style      Entry from STATE_STYLE for `candidate.state`
   * @param  viewport   Pixi viewport, used to project the representative point to screen space
   * @param  mode       The heightTransfer system, so the click handler can call `.select()`
   * @return {PIXI.Graphics|null}
   */
  _makeIcon(candidate, style, viewport, mode) {
    const rp = candidate.plateauFeature?.representativePoint;
    if (!rp) return null;

    const [x, y] = viewport.project(rp);

    const g = new PIXI.Graphics()
      .circle(0, 0, style.radius)
      .fill({ color: style.color, alpha: 0.9 })
      .stroke({ width: 1.5, color: 0xFFFFFF, alpha: 1.0 });

    if (style.glyph) {
      const label = new PIXI.Text({
        text: style.glyph,
        style: { fontFamily: 'sans-serif', fontSize: 10, fill: 0xFFFFFF, fontWeight: 'bold' }
      });
      label.anchor.set(0.5);
      g.addChild(label);
    }

    g.position.set(x, y);
    g.label = `height-transfer-${candidate.plateauFeature.id}`;
    g.eventMode = 'static';
    g.cursor = 'pointer';
    g.on('pointertap', () => mode.select(candidate));

    return g;
  }

}
