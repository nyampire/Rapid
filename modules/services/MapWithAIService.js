import * as Polyclip from 'polyclip-ts';
import { Tiler } from '@rapid-sdk/math';
import { utilStringQs } from '@rapid-sdk/util';

import { AbstractSystem } from '../core/AbstractSystem.js';
import { Graph, Tree, RapidDataset } from '../core/lib/index.js';
import { osmEntity, osmNode, osmRelation, osmWay } from '../osm/index.js';
import { utilFetchResponse, utilBuildingRelationInfo } from '../util/index.js';


const APIROOT = 'https://mapwith.ai/maps/ml_roads';
const PLATEAU_API_URL = 'https://rapid.nyampire.info/api/mapwithai/buildings';  // Production: nyampire/rapid_plateau_api
const TILEZOOM = 16;


/**
 * `MapWithAIService`
 * This service connects to the MapWithAI API to fetch data about Meta-hosted datasets.
 *
 * Events available:
 *   `loadedData`
 */
export class MapWithAIService extends AbstractSystem {

  /**
   * @constructor
   * @param  `context`  Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'mapwithai';

    this._tiler = new Tiler().zoomRange(TILEZOOM);
    this._datasets = {};
    this._deferred = new Set();

    // Cache for Plateau client-side conflation (overlap filtering with OSM buildings)
    this._plateauConflationCache = {
      checked: new Set(),    // Set(entityID) - already checked, not overlapping
      rejected: new Set()    // Set(entityID) - overlapping with OSM
    };

    // Cache for Plateau coverage area GeoJSON (loaded once, used by PixiLayerPlateauCoverage)
    this._coverageData = null;          // GeoJSON FeatureCollection or null
    this._coveragePromise = null;       // Promise<FeatureCollection> when inflight

    // Phase 4-B-2: hover で highlight class を set した relation member の ID 集合。
    // 同じ ID 群を自分で unsetClass するための追跡用 (他用途の 'highlight' に干渉しない)。
    this._hoveredRelationSiblings = new Set();

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._parseNode = this._parseNode.bind(this);
    this._parseWay = this._parseWay.bind(this);
    this._onHoverchange = this._onHoverchange.bind(this);
  }


  /**
   * initAsync
   * Called after all core objects have been constructed.
   * @return {Promise} Promise resolved when this component has completed initialization
   */
  initAsync() {
    return this.resetAsync()
      .then(() => {
        // allocate a special dataset for the rapid intro graph.
        const datasetID = 'rapid_intro_graph';
        const graph = new Graph();
        const tree = new Tree(graph);
        const cache = {
          inflight: {},
          loaded: new Set(),           // Set(tileID)
          seen: new Set(),             // Set(entityID)
          seenFirstNodeID: new Set(),  // Set(entityID)
          splitWays: new Map()         // Map(originalID -> Set(Entity))
        };
        const ds = {
          id: datasetID,
          graph: graph,
          tree: tree,
          cache: cache,
          lastv: null
        };
        this._datasets[datasetID] = ds;
      });
  }


  /**
   * startAsync
   * Called after all core objects have been initialized.
   * @return {Promise} Promise resolved when this component has completed startup
   */
  startAsync() {
    this._started = true;

    // Invalidate Plateau conflation cache when OSM data changes
    const editor = this.context.systems.editor;
    if (editor) {
      editor.on('merge', () => {
        this._plateauConflationCache.checked.clear();
        this._plateauConflationCache.rejected.clear();
      });
    }

    // Phase 4-B-2: PLATEAU LOD2 multi-section building の relation member を
    // hover した時、同じ relation の他 members も視覚的にハイライト。
    // 'highlight' クラス (Pixi で blue glow) を流用、独自スタイル追加なし。
    const hover = this.context.behaviors && this.context.behaviors.hover;
    if (hover && typeof hover.on === 'function') {
      hover.on('hoverchange', this._onHoverchange);
    }

    return Promise.resolve();
  }


  /**
   * _onHoverchange
   * Phase 4-B-2: hover 対象が PLATEAU LOD2 building relation のメンバー way なら、
   * 同 relation の他 members に 'highlight' クラスを set し、cascade 対象を視覚化する。
   *
   * 既存の `highlight` クラスは PixiFeaturePolygon 等で blue glow としてレンダリング済。
   * 他用途 (edit_menu 等) と衝突しないよう、自分が set した ID は `_hoveredRelationSiblings`
   * で追跡し、cleanup 時はその ID 群だけ unsetClass する (clearClass は使わない)。
   */
  _onHoverchange(eventData) {
    const target = eventData && eventData.target;
    const layer = target && target.layer;
    const data = target && target.data;

    // 1. 前回 set した siblings の highlight を解除 (自分が set した ID のみ)
    if (this._hoveredRelationSiblings.size > 0) {
      const scene = this.context.systems.gfx && this.context.systems.gfx.scene;
      if (scene) {
        for (const layerID of ['rapid', 'osm']) {
          const l = scene.layers && scene.layers.get && scene.layers.get(layerID);
          if (!l || typeof l.unsetClass !== 'function') continue;
          for (const id of this._hoveredRelationSiblings) {
            l.unsetClass('highlight', id);
          }
        }
      }
      this._hoveredRelationSiblings.clear();
    }

    // 2. hover 対象が無いか、自サービスの data でなければ何もしない
    if (!layer || !data || data.__service__ !== 'mapwithai') return;
    if (typeof layer.setClass !== 'function') return;

    const datasetGraph = this.graph(data.__datasetid__);
    if (!datasetGraph) return;

    const info = utilBuildingRelationInfo(data, datasetGraph);
    if (!info) return;

    // 3. relation の他メンバー (自分以外) に highlight を set
    for (const member of info.relation.members || []) {
      if (!member || member.id === data.id) continue;
      layer.setClass('highlight', member.id);
      this._hoveredRelationSiblings.add(member.id);
    }
  }


  /**
   * getAvailableDatasets
   * Called by `RapidSystem` to get the datasets that this service provides.
   * @return {Array<RapidDataset>}  The datasets this service provides
   */
  getAvailableDatasets() {
    const context = this.context;

    const fbRoads = new RapidDataset(context, {
      id: 'fbRoads',
      conflated: true,
      service: 'mapwithai',
      categories: new Set(['meta', 'roads', 'featured']),
      dataUsed: ['mapwithai', 'Facebook Roads'],
      itemUrl: 'https://github.com/facebookmicrosites/Open-Mapping-At-Facebook',
      licenseUrl: 'https://rapideditor.org/doc/license/MapWithAILicense.pdf',
      labelStringID: 'rapid_menu.fbRoads.label',
      descriptionStringID: 'rapid_menu.fbRoads.description'
    });

    const plateauJapan = new RapidDataset(context, {
      id: 'plateauJapan',
      conflated: false,
      service: 'mapwithai',
      categories: new Set(['plateau', 'buildings', 'featured', 'japan']),
      dataUsed: ['osmf.jp', 'Plateau Buildings'],
      itemUrl: 'https://osmf.jp/plateau-data',
      licenseUrl: 'https://osmf.jp/license',
      color: '#66BB6A',
      labelStringID: 'rapid_menu.plateauJapan.label',
      descriptionStringID: 'rapid_menu.plateauJapan.description'
    });

    const omdFootways = new RapidDataset(context, {
      id: 'omdFootways',
      conflated: true,
      service: 'mapwithai',
      categories: new Set(['meta', 'footways', 'featured']),
      tags: new Set(['opendata']),
      overlay: {
        url: 'https://external.xx.fbcdn.net/maps/vtp/rapid_overlay_footways/2/{z}/{x}/{y}/',
        minZoom: 1,
        maxZoom: 15,
      },
      dataUsed: ['mapwithai', 'Open Footways'],
      itemUrl: 'https://github.com/facebookmicrosites/Open-Mapping-At-Facebook/wiki/Footways-FAQ',
      licenseUrl: 'https://github.com/facebookmicrosites/Open-Mapping-At-Facebook/wiki/Footways-FAQ#attribution-and-license',
      labelStringID: 'rapid_menu.omdFootways.label',
      descriptionStringID: 'rapid_menu.omdFootways.description'
    });


    const metaSyntheticFootways = new RapidDataset(context, {
      id: 'metaSyntheticFootways',
      conflated: true,
      service: 'mapwithai',
      categories: new Set(['meta', 'footways', 'featured', 'preview']),
      tags: new Set(['opendata']),
      dataUsed: ['mapwithai', 'Meta Synthetic Footways'],
      itemUrl: 'https://github.com/facebookmicrosites/Open-Mapping-At-Facebook/wiki/Footways-FAQ',
      licenseUrl: 'https://github.com/facebookmicrosites/Open-Mapping-At-Facebook/wiki/Footways-FAQ#attribution-and-license',
      labelStringID: 'rapid_menu.metaSyntheticFootways.label',
      descriptionStringID: 'rapid_menu.metaSyntheticFootways.description'
    });

    const introGraph = new RapidDataset(context, {
      id: 'rapid_intro_graph',
      hidden: true,
      conflated: false,
      service: 'mapwithai',
      categories: new Set(['meta', 'roads']),
      color: '#da26d3',
      dataUsed: [],
      label: 'Rapid Walkthrough'
    });

    return [fbRoads, plateauJapan, omdFootways, metaSyntheticFootways, introGraph];
  }


  /**
   * resetAsync
   * Called after completing an edit session to reset any internal state
   * @return {Promise} Promise resolved when this component has completed resetting
   */
  resetAsync() {
    for (const handle of this._deferred) {
      window.cancelIdleCallback(handle);
      this._deferred.delete(handle);
    }

    for (const ds of Object.values(this._datasets)) {
      if (ds.cache.inflight) {
        Object.values(ds.cache.inflight).forEach(controller => this._abortRequest(controller));
      }
      ds.lastv = null;
      ds.graph = new Graph();
      ds.tree = new Tree(ds.graph);
      ds.cache = {
        inflight: {},
        loaded: new Set(),           // Set(tileID)
        seen: new Set(),             // Set(entityID)
        seenFirstNodeID: new Set(),  // Set(entityID)
        splitWays: new Map()         // Map(originalID -> Set(Entity))
      };
    }
    return Promise.resolve();
  }


  /**
   * loadCoverage
   * Fetch Plateau coverage area GeoJSON once and cache it.
   * Used by PixiLayerPlateauCoverage to display where Plateau data exists
   * at zoom 5-14.
   *
   * The endpoint returns a FeatureCollection where each Feature is a
   * convex-hull polygon of one city's buildings, with properties:
   *   { city_code, building_count }
   *
   * @return {Promise<Object|null>}  GeoJSON FeatureCollection, or null on failure
   */
  loadCoverage() {
    // Return cached data immediately if already loaded
    if (this._coverageData) {
      return Promise.resolve(this._coverageData);
    }
    // Return inflight promise to coalesce concurrent calls
    if (this._coveragePromise) {
      return this._coveragePromise;
    }

    // Derive coverage URL from the buildings URL
    // PLATEAU_API_URL is .../api/mapwithai/buildings → .../api/mapwithai/coverage
    const customPlateauUrl = utilStringQs(window.location.hash).plateau_api_url;
    const buildingsUrl = customPlateauUrl || PLATEAU_API_URL;
    const coverageUrl = buildingsUrl.replace(/\/buildings(\?.*)?$/, '/coverage');

    this._coveragePromise = fetch(coverageUrl)
      .then(utilFetchResponse)
      .then(data => {
        if (data && data.type === 'FeatureCollection') {
          this._coverageData = data;
          return data;
        }
        throw new Error('Invalid coverage response');
      })
      .catch(err => {
        // Graceful degradation: log and return null so the layer can hide itself
        console.warn('Failed to load Plateau coverage:', err);  // eslint-disable-line no-console
        return null;
      })
      .finally(() => {
        this._coveragePromise = null;
      });

    return this._coveragePromise;
  }


  /**
   * getData
   * Get already loaded data that appears in the current map view
   * @param   {string}  datasetID - datasetID to get data for
   * @return  {Array}   Array of data (OSM Entities)
   */
  getData(datasetID) {
    const ds = this._datasets[datasetID];
    if (!ds || !ds.tree || !ds.graph) return [];

    const extent = this.context.viewport.visibleExtent();
    let entities = ds.tree.intersects(extent, ds.graph);

    // Plateau: client-side conflation to filter out buildings overlapping with OSM
    const baseID = datasetID.replace(/-conflated$/, '');
    if (baseID === 'plateauJapan') {
      const useConflationStr = utilStringQs(window.location.hash).plateau_conflation;
      if (useConflationStr !== 'false' && useConflationStr !== 'no') {
        entities = this._filterPlateauOverlaps(entities, ds.graph);
      }
    }

    return entities;
  }


  /**
   * loadTiles
   * Schedule any data requests needed to cover the current map view
   * @param   {string}  datasetID - datasetID to load tiles for
   */
  loadTiles(datasetID) {
    if (this._paused) return;

    let ds = this._datasets[datasetID];
    let graph, tree, cache;

    if (ds) {
      graph = ds.graph;
      tree = ds.tree;
      cache = ds.cache;

    } else {
      // as tile requests arrive, setup the resources needed to hold the results
      graph = new Graph();
      tree = new Tree(graph);
      cache = {
        inflight: {},
        loaded: new Set(),           // Set(tileID)
        seen: new Set(),             // Set(entityID)
        seenFirstNodeID: new Set(),  // Set(entityID)
        splitWays: new Map()         // Map(originalID -> Set(Entity))
      };
      ds = {
        id: datasetID,
        graph: graph,
        tree: tree,
        cache: cache,
        lastv: null
      };
      this._datasets[datasetID] = ds;
    }

    const locations = this.context.systems.locations;

    const viewport = this.context.viewport;
    if (ds.lastv === viewport.v) return;  // exit early if the view is unchanged
    ds.lastv = viewport.v;

    // Determine the tiles needed to cover the view..
    const tiles = this._tiler.getTiles(viewport).tiles;

    // Abort inflight requests that are no longer needed..
    for (const k of Object.keys(cache.inflight)) {
      const wanted = tiles.find(tile => tile.id === k);
      if (!wanted) {
        this._abortRequest(cache.inflight[k]);
        delete cache.inflight[k];
      }
    }

    for (const tile of tiles) {
      if (cache.loaded.has(tile.id) || cache.inflight[tile.id]) continue;

      // Exit if this tile covers a blocked region (all corners are blocked)
      const corners = tile.wgs84Extent.polygon().slice(0, 4);
      const tileBlocked = corners.every(loc => locations.blocksAt(loc).length);
      if (tileBlocked) {
        cache.loaded.add(tile.id);  // don't try again
        continue;
      }

      const resource = this._tileURL(ds, tile.wgs84Extent);
      const controller = new AbortController();
      fetch(resource, { signal: controller.signal })
        .then(utilFetchResponse)
        .then(xml => {
          delete cache.inflight[tile.id];
          if (!xml) return;
          this._parseXML(ds, xml, tile, (err, result) => {
            if (err) return;

            graph.rebase(result, [graph], true);   // true = force replace entities
            tree.rebase(result, true);

            cache.loaded.add(tile.id);

            const gfx = this.context.systems.gfx;
            gfx.deferredRedraw();
            this.emit('loadedData');
          });
        })
        .catch(e => {
          if (e.name === 'AbortError') return;
          console.error(e);  // eslint-disable-line
        });

      cache.inflight[tile.id] = controller;
    }
  }

  graph(datasetID) {
    const ds = this._datasets[datasetID];
    return ds?.graph;
  }


  /**
   * _filterPlateauOverlaps
   * Client-side conflation for Plateau buildings.
   * Filters out Plateau entities that overlap with existing OSM buildings,
   * using the same bbox + Polyclip polygon intersection approach as OvertureService.
   *
   * Phase 4-A: PLATEAU LOD2 building は outline + parts + type=building relation で
   * 1つの semantic 単位を成すため、relation のメンバー way は **outline の判定結果に従う**。
   * outline と各 parts が個別に reject される結果として「親 outline が消えて parts だけ宙に浮く」
   * 等のジオメトリ不整合を防ぐ。
   *
   * @param   {Array}  entities - Plateau entities from the tree
   * @param   {Graph}  plateauGraph - The Plateau dataset graph (for resolving node coords)
   * @return  {Array}  Filtered entities (non-overlapping only)
   */
  _filterPlateauOverlaps(entities, plateauGraph) {
    const cache = this._plateauConflationCache;
    const editor = this.context.systems.editor;
    if (!editor?.staging?.graph) return entities;

    const osmGraph = editor.staging.graph;
    const extent = this.context.viewport.visibleExtent();

    // 1. Collect OSM buildings in the visible extent
    const osmEntities = editor.intersects(extent);
    const osmBuildings = osmEntities.filter(entity =>
      entity.type === 'way' &&
      entity.tags.building &&
      entity.tags.building !== 'no'
    );

    // 2. Prepare OSM building bounding boxes + polygon coordinates for fast filtering
    const osmBuildingData = [];
    for (const way of osmBuildings) {
      try {
        if (!way.isClosed()) continue;
        const coords = way.nodes.map(nodeID => osmGraph.entity(nodeID).loc);
        if (coords.length < 4) continue;  // Valid polygon needs at least 3 unique points + closing

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const c of coords) {
          if (c[0] < minX) minX = c[0];
          if (c[0] > maxX) maxX = c[0];
          if (c[1] < minY) minY = c[1];
          if (c[1] > maxY) maxY = c[1];
        }
        osmBuildingData.push({
          coords: [coords],  // Polyclip expects [[ring]]
          bbox: { minX, minY, maxX, maxY }
        });
      } catch (e) {
        continue;
      }
    }

    // If no OSM buildings in view, skip conflation
    if (osmBuildingData.length === 0) return entities;

    // Phase 4-A: way_id → building relation のマップを構築。
    // 並行して relation_id → outline way_id を記録 (outline で代表判定するため)。
    const wayToBuildingRelation = new Map();        // way_id → relation entity
    const buildingRelationOutline = new Map();      // relation_id → outline way_id (or undefined)
    for (const e of entities) {
      if (e.type !== 'relation') continue;
      if (e.tags?.type !== 'building') continue;
      let outlineWayId;
      for (const m of e.members ?? []) {
        if (m.type !== 'way') continue;
        if (!wayToBuildingRelation.has(m.id)) {
          wayToBuildingRelation.set(m.id, e);
        }
        if (m.role === 'outline' && outlineWayId === undefined) {
          outlineWayId = m.id;
        }
      }
      buildingRelationOutline.set(e.id, outlineWayId);
    }

    // relation 単位の判定結果キャッシュ (このバッチ内のみ)。
    // outline の overlap 判定を1回行い、relation の全 member で再利用。
    const relationOverlapDecision = new Map();  // relation_id → true (overlap) / false (no overlap) / null (unknown)

    const evalRelationOverlap = (relation) => {
      if (relationOverlapDecision.has(relation.id)) {
        return relationOverlapDecision.get(relation.id);
      }
      const outlineWayId = buildingRelationOutline.get(relation.id);
      if (!outlineWayId) {
        relationOverlapDecision.set(relation.id, null);
        return null;
      }
      const outlineWay = plateauGraph.hasEntity(outlineWayId);
      if (!outlineWay) {
        relationOverlapDecision.set(relation.id, null);
        return null;
      }
      const decision = this._checkWayOverlapsOsmBuildings(outlineWay, plateauGraph, osmBuildingData);
      // decision: true = overlap, false = no overlap, null = couldn't evaluate (open way etc.)
      relationOverlapDecision.set(relation.id, decision);
      return decision;
    };

    // 3. Filter each Plateau entity against OSM buildings
    return entities.filter(entity => {
      if (entity.type === 'node') return true;  // Keep nodes (needed for way coordinate resolution)
      if (entity.type === 'relation') return true;  // relations 自体は filter 対象外 (member way の判定で実質決まる)
      if (entity.type !== 'way') return true;

      // Cache hit - already determined (across batches via _plateauConflationCache)
      if (cache.rejected.has(entity.id)) return false;
      if (cache.checked.has(entity.id)) return true;

      // Phase 4-A: building relation の member なら relation の判定結果を採用
      const parentRel = wayToBuildingRelation.get(entity.id);
      if (parentRel) {
        const decision = evalRelationOverlap(parentRel);
        if (decision === true) {
          cache.rejected.add(entity.id);
          return false;
        }
        if (decision === false) {
          cache.checked.add(entity.id);
          return true;
        }
        // decision === null → relation 判定不能、個別 way 判定にフォールバック
      }

      // 個別 way 判定 (relation 非 member、または relation 判定不能のフォールバック)
      const decision = this._checkWayOverlapsOsmBuildings(entity, plateauGraph, osmBuildingData);
      if (decision === true) {
        cache.rejected.add(entity.id);
        return false;
      }
      // decision === false または null → pass として扱う (open way 等)
      cache.checked.add(entity.id);
      return true;
    });
  }


  /**
   * _checkWayOverlapsOsmBuildings
   * 1つの Plateau way が OSM 建物群と重複するか判定する純粋ロジック。
   * `_filterPlateauOverlaps` から呼ばれ、個別判定と relation outline 代表判定で再利用される。
   *
   * @return {boolean | null} true = overlap, false = no overlap, null = couldn't evaluate (open way / invalid coords)
   */
  _checkWayOverlapsOsmBuildings(way, plateauGraph, osmBuildingData) {
    try {
      if (!way.isClosed()) return null;

      const coords = way.nodes.map(nodeID => plateauGraph.entity(nodeID).loc);
      if (coords.length < 4) return null;

      let oMinX = Infinity, oMinY = Infinity, oMaxX = -Infinity, oMaxY = -Infinity;
      for (const c of coords) {
        if (c[0] < oMinX) oMinX = c[0];
        if (c[0] > oMaxX) oMaxX = c[0];
        if (c[1] < oMinY) oMinY = c[1];
        if (c[1] > oMaxY) oMaxY = c[1];
      }

      for (const osm of osmBuildingData) {
        const ob = osm.bbox;
        if (oMaxX < ob.minX || oMinX > ob.maxX || oMaxY < ob.minY || oMinY > ob.maxY) {
          continue;
        }
        try {
          const intersection = Polyclip.intersection([coords], osm.coords);
          if (intersection && intersection.length > 0) {
            return true;
          }
        } catch (e) {
          continue;  // Polyclip can throw on invalid geometries
        }
      }

      return false;
    } catch (e) {
      return null;
    }
  }


  /* this is called to merge in the rapid_intro_graph */
  merge(datasetID, entities) {
    const ds = this._datasets[datasetID];
    if (!ds || !ds.tree || !ds.graph) return;
    ds.graph.rebase(entities, [ds.graph], false);
    ds.tree.rebase(entities, false);
  }


  _abortRequest(controller) {
    controller.abort();
  }


  _tileURL(dataset, extent) {
    // Conflated datasets have a different ID, so they get stored in their own graph/tree
    const isConflated = /-conflated$/.test(dataset.id);
    const datasetID = dataset.id.replace('-conflated', '');

    const qs = {
      conflate_with_osm: isConflated,
      theme: 'ml_road_vector',
      collaborator: 'fbid',
      token: 'ASZUVdYpCkd3M6ZrzjXdQzHulqRMnxdlkeBJWEKOeTUoY_Gwm9fuEd2YObLrClgDB_xfavizBsh0oDfTWTF7Zb4C',
      hash: 'ASYM8LPNy8k1XoJiI7A'
    };

    if (datasetID === 'fbRoads') {
      qs.result_type = 'road_vector_xml';
    } else if (datasetID === 'metaSyntheticFootways' ) {
      qs.result_type = 'extended_osc';
      qs.sources = 'META_SYNTHETIC_FOOTWAYS';
    } else if (datasetID === 'omdFootways' ) {
      qs.result_type = 'extended_osc';
      qs.sources = 'OPEN_MAP_DATA_FOOTWAYS';
    } else if (datasetID === 'msBuildings') {
      qs.result_type = 'road_building_vector_xml';
      qs.building_source = 'microsoft';
    }  else if (datasetID === 'plateauJapan') {
      // Plateau Japan: bypass Facebook API, call Plateau API directly
      const bbox = `${extent.min[0]},${extent.min[1]},${extent.max[0]},${extent.max[1]}`;
      const params = new URLSearchParams({
        bbox: bbox,
        use_intersects: 'true',
        limit: '1000'
      });
      // Support runtime override via URL hash (e.g. #plateau_api_url=http://localhost:8000/api/mapwithai/buildings)
      const customPlateauUrl = utilStringQs(window.location.hash).plateau_api_url;
      const plateauUrl = customPlateauUrl || PLATEAU_API_URL;
      return `${plateauUrl}?${params.toString()}`;
    } else {
      qs.result_type = 'osm_xml';
      qs.sources = `esri_building.${datasetID}`;
    }

    qs.bbox = extent.toParam();

    const taskExtent = this.context.systems.rapid.taskExtent;
    if (taskExtent) {
      qs.crop_bbox = taskExtent.toParam();
    }

    const customUrlRoot = utilStringQs(window.location.hash).fb_ml_road_url;

    const urlRoot = customUrlRoot || APIROOT;
    const url = urlRoot + '?' + mapwithaiQsString(qs, true);  // true = noencode
    return url;


    // This utilQsString does not sort the keys, because the MapWithAI service needs them to be ordered a certain way.
    function mapwithaiQsString(obj, noencode) {
      // encode everything except special characters used in certain hash parameters:
      // "/" in map states, ":", ",", {" and "}" in background
      function softEncode(s) {
        return encodeURIComponent(s).replace(/(%2F|%3A|%2C|%7B|%7D)/g, decodeURIComponent);
      }

      return Object.keys(obj).map(key => {  // NO SORT
        return encodeURIComponent(key) + '=' + (
          noencode ? softEncode(obj[key]) : encodeURIComponent(obj[key]));
      }).join('&');
    }
  }


  _getLoc(attrs) {
    const lon = attrs.lon?.value;
    const lat = attrs.lat?.value;
    return [ parseFloat(lon), parseFloat(lat) ];
  }


  _getNodes(xml) {
    const elems = Array.from(xml.getElementsByTagName('nd'));
    const nodeIds = elems.map(elem => 'n' + elem.attributes.ref.value);

    return nodeIds;
  }


  /**
   * _getMembers
   * Parse `<member>` children of a relation element into Rapid's member objects.
   * `id` is prefixed with the type's initial letter (n/w/r), matching osmEntity.id.fromOSM.
   */
  _getMembers(xml) {
    const elems = Array.from(xml.getElementsByTagName('member'));
    return elems.map(elem => {
      const attrs = elem.attributes;
      const type = attrs.type.value;
      return {
        id: type[0] + attrs.ref.value,
        type: type,
        role: attrs.role?.value ?? ''
      };
    });
  }


  _getTags(xml) {
    const elems = Array.from(xml.getElementsByTagName('tag'));
    const tags = {};
    for (const elem of elems) {
      const attrs = elem.attributes;
      const k = (attrs.k.value ?? '').trim();
      const v = (attrs.v.value ?? '').trim();
      if (k && v) {
        tags[k] = v;
      }
    }
    return tags;
  }


  _getVisible(attrs) {
    return (!attrs.visible || attrs.visible.value !== 'false');
  }


  _parseNode(obj, uid) {
    const attrs = obj.attributes;
    const node = new osmNode({
      id: uid,
      visible: this._getVisible(attrs),
      loc: this._getLoc(attrs),
      tags: this._getTags(obj)
    });

    return node;
  }

  _parseWay(obj, uid) {
    const attrs = obj.attributes;
    const nodes = this._getNodes(obj);
    const tags = this._getTags(obj);

    const way = new osmWay({
      id: uid,
      visible: this._getVisible(attrs),
      tags: tags,
      nodes: nodes,
    });

    return way;
  }

  _parseRelation(obj, uid) {
    const attrs = obj.attributes;
    const relation = new osmRelation({
      id: uid,
      visible: this._getVisible(attrs),
      tags: this._getTags(obj),
      members: this._getMembers(obj),
    });

    return relation;
  }


  _parseXML(dataset, xml, tile, callback) {
    if (!xml || !xml.childNodes) {
      return callback({ message: 'No XML', status: -1 });
    }

    const root = xml.childNodes[0];
    const children = root.childNodes;

    const handle = window.requestIdleCallback(() => {
      this._deferred.delete(handle);
      let results = [];

      for (const child of children) {
        const result = this._parseEntity(dataset, tile, child);
        if (result) results.push(result);
      }

      results = results.concat(this._connectSplitWays(dataset));

      callback(null, results);
    });

    this._deferred.add(handle);
  }


  _parseEntity(dataset, tile, element) {
    const cache = dataset.cache;

    const type = element.nodeName;
    if (!['node', 'way', 'relation'].includes(type)) return null;

    let entityID, entity;
    entityID = osmEntity.id.fromOSM(type, element.attributes.id.value);

    if (type === 'node') {
      if (cache.seen.has(entityID)) {
        return null;
      } else {
        entity = this._parseNode(element, entityID);
        cache.seen.add(entityID);
      }

    } else if (type === 'way') {
      if (element.attributes.orig_id) {
        const origEntityID = osmEntity.id.fromOSM(type, element.attributes.orig_id.value);
        entity = this._parseWay(element, entityID);
        let ways = cache.splitWays.get(origEntityID);
        if (!ways) {
          ways = new Set();
          cache.splitWays.set(origEntityID, ways);
        }
        ways.add(entity);
        return null;

      } else {
        if (cache.seen.has(entityID)) {
          return null;
        } else {
          entity = this._parseWay(element, entityID);
          cache.seen.add(entityID);

          if (/^msBuildings/.test(dataset.id)) {
            const firstNodeID = entity.nodes[0];
            if (cache.seenFirstNodeID.has(firstNodeID)) {
              return null;
            }
            cache.seenFirstNodeID.add(firstNodeID);
          }
        }
      }

    } else if (type === 'relation') {
      // Phase 3: PLATEAU LOD2 type=building relation (outline + parts) のような
      // 構造をクライアント graph に取り込む。relation 単独では geometry を持たず
      // メンバー way がレンダリングを担うため、parse + graph 追加だけで十分。
      if (cache.seen.has(entityID)) {
        return null;
      } else {
        entity = this._parseRelation(element, entityID);
        cache.seen.add(entityID);
      }

    } else {
      return null;
    }

    const metadata = {
      __fbid__: entityID,
      __service__: 'mapwithai',
      __datasetid__: dataset.id
    };

    const result = Object.assign(entity, metadata);

    return result;
  }


  /**
   * _connectSplitWays
   * Call this sometimes to reassemble ways that were split by the server.
   */
  _connectSplitWays(dataset) {
    const graph = dataset.graph;
    const cache = dataset.cache;
    const results = [];

    for (const [origEntityID, ways] of cache.splitWays) {
      let survivor = graph.hasEntity(origEntityID);   // if we've done this before, the graph will have it

      // Check each way that shares this `origEntityID`.
      // Pick one to be the "survivor" (it doesn't matter which one).
      // Merge the nodes into the survivor (this will bump internal version `v`, so it gets redrawn)
      //
      // some implementation notes:
      // 1. `actionJoin` is similar to this, but does more than we need and uses `osmJoinWays`,
      // 2. `osmJoinWays` could almost do this, but it only can join head-tail, it can't
      //  deal with situations where ways partially overlap or reverse, which we get from this server.
      //  see examples below

      for (const candidate of ways) {
        if (!survivor || !survivor.nodes.length) {   // first time, just pick first way we see.
          survivor = candidate.update({ id: origEntityID });  // but use the original (stable) id
          ways.delete(candidate);
          continue;
        }

        // We will attempt to merge the `candidate.nodes` into the `survivor.nodes` somewhere.
        // Here are some situations we account for (candidate can be forward or reverse):
        // survivor.nodes = [C, D, E, F, G, H, J, K]
        // candidate.nodes = [G, F, E, D], indexes = [4, 3, 2, 1]      (candidate aleady contained)
        // candidate.nodes = [A, B, C, D], indexes = [-1, -1, 0, 1]    (prepend at beginning)
        // candidate.nodes = [J, I, H, G], indexes = [6, -1, 5, 4]     (splice into middle)
        // candidate.nodes = [M, L, K, J], indexes = [-1, -1, 7, 6]    (append at end)
        // candidate.nodes = [N, O, P, Q], indexes = [-1, -1, -1, -1]  (discontinuity)
        const indexes = [];
        for (const nodeID of candidate.nodes) {
         indexes.push(survivor.nodes.indexOf(nodeID));
        }

        if (indexes.every(ix => ix !== -1)) {  // candidate already contained in survivor
          ways.delete(candidate);              // remove candidate
          continue;

        } else if (indexes.every(ix => ix === -1)) {  // discontinuity, keep candidate around
          continue;                                   // in case we load more map and can connect it
        }

        // We consider the survivor to be going in the forward direction.
        // We want to make sure the candidate also matches this direction.
        // To determine direction - do the matched (not `-1`) indexes go up or down?
        let isReverse = false;
        let onlyOneIndex = false;  // if only one matched index, we expect it at start or end
        let prev;
        for (const curr of indexes) {
          if (curr === -1) continue;   // ignore these

          if (prev === undefined) {  // found one
            onlyOneIndex = true;
            prev = curr;
          } else {    // found two, compare them
            onlyOneIndex = false;
            isReverse = curr < prev;
            break;
          }
        }

        if (onlyOneIndex) {   // new nodes (-1's) should go before the beginning or after the end
          if (indexes.at(0) === 0)  isReverse = true;   // indexes look like [ 0, -1, -1, -1 ]   move -1's to beginning
          if (indexes.at(-1) !== 0) isReverse = true;   // indexes look like [ -1, -1, -1, N ]   move -1's to end
        }

        if (isReverse) {
          candidate.nodes.reverse();  // ok to reverse it, candidate isn't an actual way in the graph
          indexes.reverse();
        }

        // Take nodes from either survivor or candidate
        const nodeIDs = [];
        let s = 0;  // s = survivor index

        for (let c = 0; c < indexes.length; c++) {   // c = candidate index
          const i = indexes[c];
          if (i === -1) {
            nodeIDs.push(candidate.nodes[c]);  // take next candidate
          } else {
            while (s <= i) {
              nodeIDs.push(survivor.nodes[s]);   // take survivors up to i
              s++;
            }
          }
        }
        while (s < survivor.nodes.length) {   // take any remaining survivors
          nodeIDs.push(survivor.nodes[s]);
          s++;
        }

        ways.delete(candidate);    // remove candidate
        survivor = survivor.update({ nodes: nodeIDs });   // note, update bumps 'v' version automatically
      }


      // Include the survivor entity in the result.
      // (calling code will merge it into the graph).
      if (survivor) {
        const metadata = {
          __fbid__: survivor.id,
          __service__: 'mapwithai',
          __datasetid__: dataset.id
        };
        results.push(Object.assign(survivor, metadata));
      }

    }

    return results;
  }


}
