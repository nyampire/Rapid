import * as PIXI from 'pixi.js';
import { AbstractLayer } from './AbstractLayer.js';
import { DashLine } from './lib/DashLine.js';


const MIN_CANDIDATE_ZOOM = 17;
const MIN_INFO_ZOOM = 18;

// State visual specs (PLATEAU Height Transfer spec Section 3).
const STATE_STYLE = {
  CANDIDATE:      { color: 0xD500F9, radius: 6, glyph: null,  minZoom: MIN_CANDIDATE_ZOOM },
  COVERED:        { color: 0x66BB6A, radius: 8, glyph: '✓',   minZoom: MIN_INFO_ZOOM },
  CONFLICT:       { color: 0xFFC107, radius: 8, glyph: '!?',  minZoom: MIN_INFO_ZOOM },
  AREA_MISMATCH:  { color: 0xFF9800, radius: 8, glyph: '!?',  minZoom: MIN_INFO_ZOOM }
};

// Geometry-replace preview visual spec (Task 5): a translucent dashed "ghost"
// of the Plateau outline the OSM building would become, plus a solid
// highlight stroke on the OSM building being replaced.
const PREVIEW_GHOST_COLOR = 0x29B6F6;       // light blue - proposed Plateau outline
const PREVIEW_HIGHLIGHT_COLOR = 0xFFD600;   // amber - target OSM building


/**
 * PixiLayerHeightTransfer
 * Draws one icon per candidate produced by `context.systems.heightTransfer`
 * (see `HeightTransferMode`), colored/shaped by `candidate.state`. A click on
 * an icon selects the candidate's underlying OSM building via `select-osm` mode.
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
    this._previewContainer = null;
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
    if (this._previewContainer) {
      this._previewContainer.destroy({ children: true });
      this._previewContainer = null;
    }

    const container = new PIXI.Container();
    container.label = this.layerID;
    container.sortableChildren = false;
    this._container = container;

    // Separate container for the geometry-replace ghost preview (Task 5), so
    // it can be fully rebuilt each render independently of the candidate dots
    // above without disturbing them.
    const previewContainer = new PIXI.Container();
    previewContainer.label = `${this.layerID}-preview`;
    previewContainer.sortableChildren = false;
    this._previewContainer = previewContainer;

    const groupContainer = this.scene.groups.get('qa');
    if (groupContainer) {
      groupContainer.addChild(container);
      groupContainer.addChild(previewContainer);
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

    this._renderPreview(mode, viewport);

    if (!mode || !mode.active) return;

    for (const candidate of mode.candidates ?? []) {
      const style = STATE_STYLE[candidate.state];
      if (!style) continue;
      if (zoom < style.minZoom) continue;

      const icon = this._makeIcon(candidate, style, viewport);
      if (icon) this._container.addChild(icon);
    }
  }


  /**
   * _renderPreview
   * Draws (or clears) the geometry-replace ghost preview: a translucent
   * dashed outline of the Plateau shape the OSM building would become, plus
   * a solid highlight stroke on the OSM building itself. Lives in its own
   * container (`this._previewContainer`), rebuilt fully every render just
   * like the candidate dots, and independent of `mode.active` / zoom gating
   * so the preview stays visible while the user is mid-confirmation even if
   * something else about the mode's display state changes.
   * @param  mode      `context.systems.heightTransfer`, or falsy
   * @param  viewport  Pixi viewport to use for rendering
   */
  _renderPreview(mode, viewport) {
    if (!this._previewContainer) return;

    const stale = this._previewContainer.removeChildren();
    for (const child of stale) {
      child.destroy({ children: true });
    }

    const cand = mode?.replacePreview;
    if (!cand) return;

    const plateauGeo = this._safeGeoJSON(cand.plateauFeature, cand.plateauGraph);
    if (plateauGeo?.type === 'Polygon') {
      for (const ring of plateauGeo.coordinates) {
        const ghost = this._makeGhostRing(ring, viewport);
        if (ghost) this._previewContainer.addChild(ghost);
      }
    }

    // `cand.osmFeature` was resolved against the graph at candidate-compute
    // time, not stored on the candidate - resolve it against the editor's
    // current (staging) graph, same as `HeightTransferMode._recompute()` does.
    const osmGraph = this.context.systems.editor?.staging?.graph;
    const osmGeo = this._safeGeoJSON(cand.osmFeature, osmGraph);
    if (osmGeo?.type === 'Polygon') {
      for (const ring of osmGeo.coordinates) {
        const highlight = this._makeHighlightRing(ring, viewport);
        if (highlight) this._previewContainer.addChild(highlight);
      }
    }
  }


  /**
   * _safeGeoJSON
   * `asGeoJSON()` can throw if the entity's nodes don't resolve in the given
   * graph (e.g. stale reference after an edit) - treat that as "nothing to
   * draw this frame" rather than letting it break rendering.
   * @param  feature  An OSM-way-like entity with an `asGeoJSON(resolver)` method, or falsy
   * @param  graph    Graph/resolver to resolve the feature's nodes against
   * @return {Object|null}
   */
  _safeGeoJSON(feature, graph) {
    if (!feature || typeof feature.asGeoJSON !== 'function') return null;
    try {
      return feature.asGeoJSON(graph);
    } catch (_err) {
      return null;
    }
  }


  /**
   * _makeGhostRing
   * Builds the translucent-fill + dashed-stroke ghost for one polygon ring
   * of the proposed Plateau outline.
   * @param  ring      Array of [lon,lat] coordinates (closed ring)
   * @param  viewport  Pixi viewport, used to project coordinates to screen space
   * @return {PIXI.Container|null}
   */
  _makeGhostRing(ring, viewport) {
    if (!Array.isArray(ring) || ring.length < 3) return null;
    const flat = ring.map(coord => viewport.project(coord)).flat();
    if (flat.length < 6) return null;

    const wrap = new PIXI.Container();
    wrap.label = 'height-transfer-preview-ghost';

    const fill = new PIXI.Graphics();
    fill.poly(flat).fill({ color: PREVIEW_GHOST_COLOR, alpha: 0.25 });

    const dash = new PIXI.Graphics();
    new DashLine(this.gfx, dash, { dash: [6, 4], width: 2, color: PREVIEW_GHOST_COLOR, alpha: 0.9 }).poly(flat);

    wrap.addChild(fill, dash);
    return wrap;
  }


  /**
   * _makeHighlightRing
   * Builds a solid highlight stroke for one polygon ring of the OSM building
   * being replaced.
   * @param  ring      Array of [lon,lat] coordinates (closed ring)
   * @param  viewport  Pixi viewport, used to project coordinates to screen space
   * @return {PIXI.Graphics|null}
   */
  _makeHighlightRing(ring, viewport) {
    if (!Array.isArray(ring) || ring.length < 3) return null;
    const flat = ring.map(coord => viewport.project(coord)).flat();
    if (flat.length < 6) return null;

    const g = new PIXI.Graphics();
    g.label = 'height-transfer-preview-highlight';
    g.poly(flat).stroke({ width: 3, color: PREVIEW_HIGHLIGHT_COLOR, alpha: 1.0 });
    return g;
  }


  /**
   * _makeIcon
   * Builds one interactive Pixi icon for a candidate.
   * @param  candidate  MatchCandidate (see HeightTransferMatcher)
   * @param  style      Entry from STATE_STYLE for `candidate.state`
   * @param  viewport   Pixi viewport, used to project the representative point to screen space
   * @return {PIXI.Graphics|null}
   */
  _makeIcon(candidate, style, viewport) {
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
    g.on('pointertap', () => {
      this.context.enter('select-osm', { selection: { osm: [candidate.osmFeature.id] } });
    });

    return g;
  }

}
