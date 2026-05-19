import { AbstractLayer } from './AbstractLayer.js';
import { PixiFeaturePolygon } from './PixiFeaturePolygon.js';


const LAYERID = 'plateau-coverage';
const MINZOOM = 5;
const MAXZOOM = 14;
// Vivid orange — colorblind-safe (IBM Accessible Color Palette),
// stands out against Japan's green-heavy OSM background (forests, parks).
const PLATEAU_COVERAGE_COLOR = 0xFE6100;


/**
 * PixiLayerPlateauCoverage
 * Shows where Plateau building data exists, as semi-transparent polygons.
 *
 * Each polygon is a convex hull of one city's building centroids,
 * fetched from the rapid_plateau_api server.
 *
 * Visible at zoom 5-14. Above zoom 14, the actual building data starts
 * loading (see PixiLayerRapid), so this overview layer hides itself.
 *
 * @class
 */
export class PixiLayerPlateauCoverage extends AbstractLayer {

  /**
   * @constructor
   * @param  scene    The Scene that owns this Layer
   * @param  layerID  Unique string to use for the name of this Layer
   */
  constructor(scene, layerID) {
    super(scene, layerID);
    this._enabled = true;             // Default ON
    this._fetched = false;            // True after coverage has loaded successfully
    this._fetchInProgress = false;    // True while a fetch is inflight (prevents storm)
  }


  /**
   * supported
   * @return {boolean} `true` if the plateau service is available
   */
  get supported() {
    return !!this.context.services.plateau;
  }


  /**
   * reset
   * Every Layer should have a reset function to replace any Pixi objects and internal state.
   */
  reset() {
    super.reset();
  }


  /**
   * render
   * Draw the coverage polygons at appropriate zoom levels.
   * @param  frame      Integer frame being rendered
   * @param  viewport   Pixi viewport to use for rendering
   * @param  zoom       Effective zoom to use for rendering
   */
  render(frame, viewport, zoom) {
    if (!this.enabled) return;
    if (zoom < MINZOOM || zoom > MAXZOOM) return;

    const service = this.context.services.plateau;
    if (!service) return;

    // Trigger fetch lazily. Promise resolves with FeatureCollection or null.
    // - `_fetchInProgress` blocks concurrent fetches from successive renders
    //   (one render → one inflight request → service-side coalesce handles
    //   any extras anyway, but skipping the .then() noise here is cheaper).
    // - `_fetched` flips to true ONLY on successful load, so a transient
    //   failure (network blip, 500) can be retried by the next render.
    if (!this._fetched && !this._fetchInProgress) {
      this._fetchInProgress = true;
      service.loadCoverage().then(data => {
        this._fetchInProgress = false;
        if (data) {
          this._fetched = true;
          this.context.systems.gfx.deferredRedraw();
        }
        // On null (failure or invalid shape), `_fetched` stays false so a
        // future render will retry.
      });
    }

    // Read cached data from the service
    const data = service._coverageData;
    if (!data || !data.features) return;

    this._renderFeatures(frame, viewport, zoom, data.features);
  }


  /**
   * _renderFeatures
   * @param  frame      Integer frame being rendered
   * @param  viewport   Pixi viewport to use for rendering
   * @param  zoom       Effective zoom to use for rendering
   * @param  features   Array of GeoJSON Features
   */
  _renderFeatures(frame, viewport, zoom, features) {
    const parentContainer = this.scene.groups.get('basemap');

    const style = {
      fill: { color: PLATEAU_COVERAGE_COLOR, alpha: 0.15 },
      stroke: { width: 1.5, color: PLATEAU_COVERAGE_COLOR, alpha: 0.6, cap: 'round' },
      labelTint: PLATEAU_COVERAGE_COLOR
    };

    for (const feat of features) {
      if (!feat || !feat.geometry) continue;

      const props = feat.properties || {};
      const cityCode = feat.id || props.city_code || 'unknown';

      // Support Polygon and MultiPolygon
      const parts = (feat.geometry.type === 'Polygon') ? [feat.geometry.coordinates]
        : (feat.geometry.type === 'MultiPolygon') ? feat.geometry.coordinates
        : [];

      for (let i = 0; i < parts.length; ++i) {
        const coords = parts[i];
        const featureID = `${this.layerID}-${cityCode}-${i}`;

        let pixiFeature = this.features.get(featureID);
        if (pixiFeature && pixiFeature.type !== 'polygon') {
          pixiFeature.destroy();
          pixiFeature = null;
        }

        if (!pixiFeature) {
          pixiFeature = new PixiFeaturePolygon(this, featureID);
          pixiFeature.style = style;
          pixiFeature.parentContainer = parentContainer;
          pixiFeature.geometry.setCoords(coords);
          pixiFeature.setData(cityCode, feat);
        }

        this.syncFeatureClasses(pixiFeature);
        pixiFeature.update(viewport, zoom);
        this.retainFeature(pixiFeature, frame);
      }
    }
  }
}
