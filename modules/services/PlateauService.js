import * as Polyclip from 'polyclip-ts';
import pointOnFeature from '@turf/point-on-feature';
import { Tiler } from '@rapid-sdk/math';
import { utilStringQs } from '@rapid-sdk/util';

import { AbstractSystem } from '../core/AbstractSystem.js';
import { Graph, Tree, RapidDataset } from '../core/lib/index.js';
import { osmEntity, osmNode, osmRelation, osmWay } from '../osm/index.js';
import { utilFetchResponse, utilBuildingRelationInfo } from '../util/index.js';


const PLATEAU_API_URL = 'https://rapid.nyampire.info/api/mapwithai/buildings';  // Production: nyampire/rapid_plateau_api
const TILEZOOM = 16;


/**
 * `PlateauService`
 * Connects to the Plateau Japan building API (nyampire/rapid_plateau_api).
 *
 * Originally lived inside `MapWithAIService`. Extracted to its own service so
 * that:
 *   - Plateau-specific code (relation handling, conflation, coverage, highlight
 *     handlers) is isolated from upstream changes to the MapWithAI/PMTiles flow.
 *   - Future `git merge upstream/main` runs leave Plateau untouched.
 *
 * Datums it emits carry `__service__ = 'plateau'`.
 *
 * Events available:
 *   `loadedData`
 */
export class PlateauService extends AbstractSystem {

  /**
   * @constructor
   * @param  `context`  Global shared application context
   */
  constructor(context) {
    super(context);
    this.id = 'plateau';

    this._tiler = new Tiler().zoomRange(TILEZOOM);
    this._datasets = {};
    this._deferred = new Set();

    // Cache for client-side conflation (overlap filtering with OSM buildings)
    this._plateauConflationCache = {
      checked: new Set(),    // Set(entityID) - already checked, not overlapping
      rejected: new Set()    // Set(entityID) - overlapping with OSM
    };

    // Cache for coverage area GeoJSON (loaded once, used by PixiLayerPlateauCoverage)
    this._coverageData = null;          // GeoJSON FeatureCollection or null
    this._coveragePromise = null;       // Promise<FeatureCollection> when inflight

    // Phase 4-B-2: hover で highlight class を set した relation member の ID 集合。
    // 同じ ID 群を自分で unsetClass するための追跡用 (他用途の 'highlight' に干渉しない)。
    this._hoveredRelationSiblings = new Set();

    // Phase 4-B-3: select で highlight class を set した relation member の ID 集合。
    // hover と同じ 'highlight' クラスを共有するため、cleanup 時に互いの claim を尊重する。
    this._selectedRelationSiblings = new Set();

    // Ensure methods used as callbacks always have `this` bound correctly.
    this._parseNode = this._parseNode.bind(this);
    this._parseWay = this._parseWay.bind(this);
    this._onHoverchange = this._onHoverchange.bind(this);
    this._onModeChange = this._onModeChange.bind(this);
  }


  /**
   * initAsync
   */
  initAsync() {
    return this.resetAsync();
  }


  /**
   * startAsync
   */
  startAsync() {
    this._started = true;

    // Invalidate conflation cache when OSM data changes
    const editor = this.context.systems.editor;
    if (editor) {
      editor.on('merge', () => {
        this._plateauConflationCache.checked.clear();
        this._plateauConflationCache.rejected.clear();
      });
    }

    // Phase 4-B-2: hover で relation の他 members を highlight
    const hover = this.context.behaviors && this.context.behaviors.hover;
    if (hover && typeof hover.on === 'function') {
      hover.on('hoverchange', this._onHoverchange);
    }

    // Phase 4-B-3: select 中も relation の他 members を highlight
    if (typeof this.context.on === 'function') {
      this.context.on('modechange', this._onModeChange);
    }

    return Promise.resolve();
  }


  /**
   * _onHoverchange
   * Phase 4-B-2: hover 対象が PLATEAU LOD2 building relation のメンバー way なら、
   * 同 relation の他 members に 'highlight' クラスを set し、cascade 対象を視覚化する。
   */
  _onHoverchange(eventData) {
    const target = eventData && eventData.target;
    const layer = target && target.layer;
    const data = target && target.data;

    // 1. 前回 set した siblings の highlight を解除。
    //    ただし select 側がまだ claim している ID は select cleanup に任せるので残す。
    if (this._hoveredRelationSiblings.size > 0) {
      const scene = this.context.systems.gfx && this.context.systems.gfx.scene;
      if (scene) {
        for (const layerID of ['rapid', 'osm']) {
          const l = scene.layers && scene.layers.get && scene.layers.get(layerID);
          if (!l || typeof l.unsetClass !== 'function') continue;
          for (const id of this._hoveredRelationSiblings) {
            if (this._selectedRelationSiblings.has(id)) continue;  // select が claim 中
            l.unsetClass('highlight', id);
          }
        }
      }
      this._hoveredRelationSiblings.clear();
    }

    // 2. hover 対象が無いか、自サービスの data でなければ何もしない
    if (!layer || !data || data.__service__ !== 'plateau') return;
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
   * _onModeChange
   * Phase 4-B-3: モード遷移時に、select 中の PLATEAU LOD2 building relation
   * メンバーがあれば同 relation の他 members に 'highlight' を set する。
   */
  _onModeChange(mode) {
    const scene = this.context.systems.gfx && this.context.systems.gfx.scene;

    // 1. 前回 set した select siblings の highlight を解除。
    //    hover が同じ ID をまだ claim していたら、それは hover cleanup に任せる。
    if (this._selectedRelationSiblings.size > 0) {
      if (scene) {
        for (const layerID of ['rapid', 'osm']) {
          const l = scene.layers && scene.layers.get && scene.layers.get(layerID);
          if (!l || typeof l.unsetClass !== 'function') continue;
          for (const id of this._selectedRelationSiblings) {
            if (this._hoveredRelationSiblings.has(id)) continue;
            l.unsetClass('highlight', id);
          }
        }
      }
      this._selectedRelationSiblings.clear();
    }

    // 2. select 系モードでなければここで終了 (browse / draw / save 等は無視)
    const modeID = mode && mode.id;
    if (!modeID || !/^select/.test(modeID)) return;

    // 3. 選択中の entity から PLATEAU LOD2 building relation のメンバーを探す
    const selectedData = typeof this.context.selectedData === 'function'
      ? this.context.selectedData()
      : null;
    if (!selectedData || typeof selectedData.values !== 'function') return;

    const rapidLayer = scene && scene.layers && scene.layers.get && scene.layers.get('rapid');
    if (!rapidLayer || typeof rapidLayer.setClass !== 'function') return;

    for (const datum of selectedData.values()) {
      if (!datum || datum.__service__ !== 'plateau') continue;

      const datasetGraph = this.graph(datum.__datasetid__);
      if (!datasetGraph) continue;

      const info = utilBuildingRelationInfo(datum, datasetGraph);
      if (!info) continue;

      for (const member of info.relation.members || []) {
        if (!member || member.id === datum.id) continue;
        rapidLayer.setClass('highlight', member.id);
        this._selectedRelationSiblings.add(member.id);
      }
    }

    // 4. setClass はそれ自体では再描画を起こさないので、念のため redraw を要求。
    const gfx = this.context.systems.gfx;
    if (gfx && typeof gfx.deferredRedraw === 'function' && this._selectedRelationSiblings.size > 0) {
      gfx.deferredRedraw();
    }
  }


  /**
   * getAvailableDatasets
   * @return {Array<RapidDataset>}
   */
  getAvailableDatasets() {
    const context = this.context;

    const plateauJapan = new RapidDataset(context, {
      id: 'plateauJapan',
      conflated: false,
      service: 'plateau',
      categories: new Set(['plateau', 'buildings', 'featured', 'japan']),
      dataUsed: ['osmf.jp', 'Plateau Buildings'],
      itemUrl: 'https://osmf.jp/plateau-data',
      licenseUrl: 'https://osmf.jp/license',
      color: '#66BB6A',
      labelStringID: 'rapid_menu.plateauJapan.label',
      descriptionStringID: 'rapid_menu.plateauJapan.description'
    });

    return [plateauJapan];
  }


  /**
   * resetAsync
   */
  resetAsync() {
    for (const handle of this._deferred) {
      window.cancelIdleCallback(handle);
      this._deferred.delete(handle);
    }

    for (const ds of Object.values(this._datasets)) {
      if (ds.cache?.inflight) {
        Object.values(ds.cache.inflight).forEach(controller => this._abortRequest(controller));
      }
      ds.lastv = null;
      ds.graph = new Graph();
      ds.tree = new Tree(ds.graph);
      ds.cache = {
        inflight: {},
        loaded: new Set(),           // Set(tileID)
        seen: new Set(),             // Set(entityID)
        splitWays: new Map()         // unused for Plateau but kept for parity
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
    if (this._coverageData) {
      return Promise.resolve(this._coverageData);
    }
    if (this._coveragePromise) {
      return this._coveragePromise;
    }

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
   * Get already-loaded entities that appear in the current map view, optionally
   * filtered through client-side conflation against OSM buildings.
   *
   * The default conflation filter hides Plateau buildings that overlap an
   * existing OSM building, so the "add new" flow does not surface duplicates.
   * The `HeightTransferMode` needs the OPPOSITE — Plateau buildings that DO
   * overlap OSM buildings, so it can transfer missing tags to them. That path
   * passes `options.skipConflation = true`.
   *
   * @param   {string} datasetID
   * @param   {{skipConflation?: boolean}} [options]
   * @return  {Array}  osmEntity[]
   */
  getData(datasetID, options = {}) {
    const ds = this._datasets[datasetID];
    if (!ds || !ds.tree || !ds.graph) return [];

    const extent = this.context.viewport.visibleExtent();
    let entities = ds.tree.intersects(extent, ds.graph);

    if (options.skipConflation) return entities;

    // Client-side conflation: hide Plateau buildings that overlap existing OSM
    const useConflationStr = utilStringQs(window.location.hash).plateau_conflation;
    if (useConflationStr !== 'false' && useConflationStr !== 'no') {
      entities = this._filterPlateauOverlaps(entities, ds.graph);
    }

    return entities;
  }


  /**
   * loadTiles
   * Schedule any data requests needed to cover the current map view
   * @param   {string}  datasetID
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
      graph = new Graph();
      tree = new Tree(graph);
      cache = {
        inflight: {},
        loaded: new Set(),
        seen: new Set(),
        splitWays: new Map()
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
    if (ds.lastv === viewport.v) return;
    ds.lastv = viewport.v;

    const tiles = this._tiler.getTiles(viewport).tiles;

    for (const k of Object.keys(cache.inflight)) {
      const wanted = tiles.find(tile => tile.id === k);
      if (!wanted) {
        this._abortRequest(cache.inflight[k]);
        delete cache.inflight[k];
      }
    }

    for (const tile of tiles) {
      if (cache.loaded.has(tile.id) || cache.inflight[tile.id]) continue;

      const corners = tile.wgs84Extent.polygon().slice(0, 4);
      const tileBlocked = corners.every(loc => locations.blocksAt(loc).length);
      if (tileBlocked) {
        cache.loaded.add(tile.id);
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

            graph.rebase(result, [graph], true);
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
   * using bbox + Polyclip polygon intersection.
   *
   * Phase 4-A: PLATEAU LOD2 building は outline + parts + type=building relation で
   * 1つの semantic 単位を成すため、relation のメンバー way は outline の判定結果に従う。
   * outline と各 parts が個別に reject される結果として「親 outline が消えて parts だけ宙に浮く」
   * 等のジオメトリ不整合を防ぐ。
   *
   * @param   {Array}  entities
   * @param   {Graph}  plateauGraph
   * @return  {Array}  Filtered entities
   */
  _filterPlateauOverlaps(entities, plateauGraph) {
    const cache = this._plateauConflationCache;
    const editor = this.context.systems.editor;
    if (!editor?.staging?.graph) return entities;

    const extent = this.context.viewport.visibleExtent();
    const osmGraph = editor.staging.graph;

    // 1. Collect OSM buildings in the visible extent
    const osmEntities = editor.intersects(extent);
    const osmBuildings = osmEntities.filter(entity =>
      entity.type === 'way' &&
      entity.tags.building &&
      entity.tags.building !== 'no'
    );

    // 2. Prepare OSM building bounding boxes + polygon coordinates
    const osmBuildingData = [];
    for (const way of osmBuildings) {
      try {
        if (!way.isClosed()) continue;
        const coords = way.nodes.map(nodeID => osmGraph.entity(nodeID).loc);
        if (coords.length < 4) continue;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const c of coords) {
          if (c[0] < minX) minX = c[0];
          if (c[0] > maxX) maxX = c[0];
          if (c[1] < minY) minY = c[1];
          if (c[1] > maxY) maxY = c[1];
        }
        osmBuildingData.push({
          coords: [coords],
          bbox: { minX, minY, maxX, maxY }
        });
      } catch (e) {
        continue;
      }
    }

    if (osmBuildingData.length === 0) return entities;

    // way_id → building relation のマップ + relation_id → 外形 way_id を記録
    //
    // 対象は 2 種類ある。
    // type=building は PLATEAU LOD2 の outline + parts で、外形の役割は 'outline'。
    // type=multipolygon は中庭のある建物で、外形の役割は 'outer'、穴が 'inner'。
    // どちらも「1 棟の建物」なので、外形の判定にメンバー全員が従う。
    //
    // multipolygon のメンバー way はタグを持たないため、個別に判定すると穴が
    // 単独の建物として扱われる。ここでまとめて拾うことでその経路を塞ぐ。
    const wayToBuildingRelation = new Map();
    const buildingRelationOutline = new Map();
    for (const e of entities) {
      if (e.type !== 'relation') continue;
      const relType = e.tags?.type;
      if (relType !== 'building' && relType !== 'multipolygon') continue;
      let outlineWayId;
      for (const m of e.members ?? []) {
        if (m.type !== 'way') continue;
        if (!wayToBuildingRelation.has(m.id)) {
          wayToBuildingRelation.set(m.id, e);
        }
        if ((m.role === 'outline' || m.role === 'outer') && outlineWayId === undefined) {
          outlineWayId = m.id;
        }
      }
      buildingRelationOutline.set(e.id, outlineWayId);
    }

    const relationOverlapDecision = new Map();

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
      relationOverlapDecision.set(relation.id, decision);
      return decision;
    };

    return entities.filter(entity => {
      if (entity.type === 'node') return true;

      if (entity.type === 'relation') {
        // 追跡対象でない relation (type=route など) は素通しする。
        if (!buildingRelationOutline.has(entity.id)) return true;
        // メンバーが隠れる relation は relation 自身も隠す。
        // 判定できない (null) ときは隠さない。way 側のフォールバックと同じ。
        //
        // 一覧に残っているメンバーを数えないこと。getData は表示範囲で切り取った
        // スライスに filter をかけるので、範囲外のメンバーは単に一覧に含まれない。
        // 数える方式にすると、パンして relation が範囲の端にかかった時点で
        // 「メンバー 0 件」と見えて、OSM に無い建物まで消える。
        return evalRelationOverlap(entity) !== true;
      }

      if (entity.type !== 'way') return true;

      if (cache.rejected.has(entity.id)) return false;
      if (cache.checked.has(entity.id)) return true;

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

      const decision = this._checkWayOverlapsOsmBuildings(entity, plateauGraph, osmBuildingData);
      if (decision === true) {
        cache.rejected.add(entity.id);
        return false;
      }
      cache.checked.add(entity.id);
      return true;
    });
  }


  /**
   * _checkWayOverlapsOsmBuildings
   * 1つの Plateau way が OSM 建物群と重複するか判定する純粋ロジック。
   *
   * @return {boolean | null} true = overlap, false = no overlap, null = couldn't evaluate
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
          continue;
        }
      }

      return false;
    } catch (e) {
      return null;
    }
  }


  /* this is called to merge in the rapid_intro_graph (kept for parity even though Plateau doesn't use it) */
  merge(datasetID, entities) {
    const ds = this._datasets[datasetID];
    if (!ds || !ds.tree || !ds.graph) return;
    ds.graph.rebase(entities, [ds.graph], false);
    ds.tree.rebase(entities, false);
  }


  _abortRequest(controller) {
    controller.abort();
  }


  /**
   * _tileURL
   * Build a Plateau API URL for the given extent.
   */
  _tileURL(dataset, extent) {
    const bbox = `${extent.min[0]},${extent.min[1]},${extent.max[0]},${extent.max[1]}`;
    // A single z16 tile (~500m × 500m) over dense central-Tokyo neighbourhoods
    // (e.g. 豊島区 池袋) can hold ~1,300+ Plateau outlines. With the previous
    // limit=1000 the server truncated each response, dropping a random ~25% of
    // buildings — they appeared on the map as a N-S strip with no outlines
    // (#34). 5,000 gives ~3× headroom over the observed worst case while keeping
    // any one tile response under ~7 MB.
    const params = new URLSearchParams({
      bbox: bbox,
      use_intersects: 'true',
      limit: '5000'
    });
    // Support runtime override via URL hash, e.g.
    //   #plateau_api_url=http://localhost:8000/api/mapwithai/buildings
    const customPlateauUrl = utilStringQs(window.location.hash).plateau_api_url;
    const plateauUrl = customPlateauUrl || PLATEAU_API_URL;
    return `${plateauUrl}?${params.toString()}`;
  }


  // ---- XML parsing helpers (duplicated from MapWithAIService) -------------
  // Kept in this service so that upstream changes to MapWithAIService.js
  // (e.g. PMTiles switchover) do not affect Plateau.

  _getLoc(attrs) {
    const lon = attrs.lon?.value;
    const lat = attrs.lat?.value;
    return [ parseFloat(lon), parseFloat(lat) ];
  }


  _getNodes(xml) {
    const elems = Array.from(xml.getElementsByTagName('nd'));
    return elems.map(elem => 'n' + elem.attributes.ref.value);
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
    return new osmNode({
      id: uid,
      visible: this._getVisible(attrs),
      loc: this._getLoc(attrs),
      tags: this._getTags(obj)
    });
  }


  /**
   * _extractRepresentativePoint
   * Pulls the `representative_point` tag (added server-side — see Task 2 of
   * the PLATEAU height-transfer plan) off an entity's tags map and parses it
   * into a `[lon, lat]` pair. The tag must never leak into OSM tag machinery
   * (changeset uploads, the tag editor, validation, etc), so it is deleted
   * from `tags` regardless of whether it parses successfully.
   *
   * @param   {Object} tags  Mutable tags map (as built by `_getTags`)
   * @return  {[number, number]|null}
   */
  _extractRepresentativePoint(tags) {
    const raw = tags.representative_point;
    if (!raw) return null;
    delete tags.representative_point;

    const parts = raw.split(',');
    if (parts.length !== 2) return null;
    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return [lon, lat];
  }


  _parseWay(obj, uid) {
    const attrs = obj.attributes;
    const tags = this._getTags(obj);
    const representativePoint = this._extractRepresentativePoint(tags);
    const way = new osmWay({
      id: uid,
      visible: this._getVisible(attrs),
      tags: tags,
      nodes: this._getNodes(obj),
    });
    if (representativePoint) way.representativePoint = representativePoint;
    return way;
  }


  _parseRelation(obj, uid) {
    const attrs = obj.attributes;
    const tags = this._getTags(obj);
    const representativePoint = this._extractRepresentativePoint(tags);
    const relation = new osmRelation({
      id: uid,
      visible: this._getVisible(attrs),
      tags: tags,
      members: this._getMembers(obj),
    });
    if (representativePoint) relation.representativePoint = representativePoint;
    return relation;
  }


  /**
   * _fillMissingRepresentativePoints
   * Fallback for PLATEAU sources that haven't been upgraded to emit the
   * `representative_point` tag yet (Task 2, server side). For building ways
   * still missing the property after XML parsing, compute one client-side
   * with turf's `pointOnFeature`. Silently skips entities whose geometry
   * can't be resolved (e.g. a way whose nodes weren't included in this same
   * XML batch) — a Plateau tile should never fail to load just because one
   * building lacks a representative point.
   *
   * @param  {Array}  entities  Entities parsed from one XML batch
   * @param  {Graph}  graph     Graph seeded with that same batch, so that
   *                            `entity.nodes` refs resolve for `asGeoJSON()`
   */
  _fillMissingRepresentativePoints(entities, graph) {
    for (const entity of entities) {
      // Relations are intentionally excluded from this fallback (Phase 1 scope
      // decision, Task 3 review Finding 2 — see task-3-report.md). A relation's
      // own geometry lives on its member ways (the outline `role='outline'`
      // way, per the Simple 3D Buildings pattern this repo follows), so
      // deriving a point for the relation would mean locating that outline
      // member and running it through the same turf logic below — real work
      // for a path that mostly won't be hit: Task 2 (server) already emits
      // `representative_point` on relations, so this fallback for relations
      // only fires against un-upgraded servers, and even then the outline
      // way itself still gets filled here, which downstream matching can
      // key off directly. A relation arriving with a genuinely missing tag
      // and no outline fallback is a rare pre-upgrade edge case; full
      // relation-geometry derivation is deferred to the Phase 2 work that
      // adds deeper `building:part` support.
      if (entity.type !== 'way' || entity.representativePoint) continue;
      if (!entity.tags?.building && !entity.tags?.['building:part']) continue;
      try {
        const geojson = entity.asGeoJSON(graph);
        const point = pointOnFeature(geojson);
        if (point?.geometry?.coordinates) {
          entity.representativePoint = point.geometry.coordinates;
        }
      } catch (_err) {
        // skip unfillable entities silently
      }
    }
  }


  _parseXML(dataset, xml, tile, callback) {
    if (!xml || !xml.childNodes) {
      return callback({ message: 'No XML', status: -1 });
    }

    const root = xml.childNodes[0];
    const children = root.childNodes;

    const handle = window.requestIdleCallback(() => {
      this._deferred.delete(handle);
      const results = [];

      for (const child of children) {
        const result = this._parseEntity(dataset, tile, child);
        if (result) results.push(result);
      }

      // Turf fallback needs a graph so `way.asGeoJSON()` can resolve node
      // refs. `results` from one tile batch already includes the nodes for
      // any ways in that same batch, so a throwaway Graph seeded from just
      // this batch is sufficient — we don't need the accumulated dataset graph.
      this._fillMissingRepresentativePoints(results, new Graph(results));

      callback(null, results);
    });

    this._deferred.add(handle);
  }


  _parseEntity(dataset, tile, element) {
    const cache = dataset.cache;

    const type = element.nodeName;
    if (!['node', 'way', 'relation'].includes(type)) return null;

    const entityID = osmEntity.id.fromOSM(type, element.attributes.id.value);
    if (cache.seen.has(entityID)) return null;

    let entity;
    if (type === 'node') {
      entity = this._parseNode(element, entityID);
    } else if (type === 'way') {
      entity = this._parseWay(element, entityID);
    } else if (type === 'relation') {
      // Phase 3: PLATEAU LOD2 type=building relation (outline + parts) のような
      // 構造をクライアント graph に取り込む。relation 単独では geometry を持たず
      // メンバー way がレンダリングを担うため、parse + graph 追加だけで十分。
      entity = this._parseRelation(element, entityID);
    } else {
      return null;
    }

    cache.seen.add(entityID);

    const metadata = {
      __fbid__: entityID,
      __service__: 'plateau',
      __datasetid__: dataset.id
    };

    return Object.assign(entity, metadata);
  }
}
