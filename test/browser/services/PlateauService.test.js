describe('PlateauService', () => {
  let _service;

  class MockEditSystem {
    constructor() {
      this._graph = new Rapid.Graph();
      this._entities = [];
    }
    get staging() { return { graph: this._graph }; }
    intersects() { return this._entities; }
    on() { return this; }
  }

  class MockContext {
    constructor() {
      this.systems = {
        editor: new MockEditSystem(),
        gfx: { deferredRedraw() {}, immediateRedraw() {} }
      };
      this.viewport = new Rapid.sdk.Viewport();
      this.viewport.transform = { x: 0, y: 0, k: Rapid.sdk.geoZoomToScale(16) };
      this.viewport.dimensions = [1000, 1000];
    }
  }


  beforeEach(() => {
    _service = new Rapid.PlateauService(new MockContext());
    return _service.initAsync();
  });


  describe('#_filterPlateauOverlaps', () => {
    // Helper: create an OSM closed way (building) in the graph
    function makeBuilding(graph, wayId, coords) {
      const nodeIds = [];
      for (let i = 0; i < coords.length; i++) {
        const nodeId = wayId + '-n' + i;
        nodeIds.push(nodeId);
        graph = graph.replace(Rapid.osmNode({ id: nodeId, loc: coords[i] }));
      }
      // Close the way
      nodeIds.push(nodeIds[0]);
      const way = Rapid.osmWay({ id: wayId, nodes: nodeIds, tags: { building: 'yes' } });
      graph = graph.replace(way);
      return { graph, way };
    }

    // Helper: create a Plateau entity (way) in a separate graph
    function makePlateauWay(graph, wayId, coords) {
      const nodeIds = [];
      for (let i = 0; i < coords.length; i++) {
        const nodeId = wayId + '-n' + i;
        nodeIds.push(nodeId);
        graph = graph.replace(Rapid.osmNode({ id: nodeId, loc: coords[i] }));
      }
      nodeIds.push(nodeIds[0]);
      const way = Rapid.osmWay({ id: wayId, nodes: nodeIds, tags: { building: 'yes' } });
      graph = graph.replace(way);
      return { graph, way };
    }

    it('returns all entities when there are no OSM buildings', () => {
      // editor.intersects returns no buildings
      _service.context.systems.editor._entities = [];

      const plateauGraph = new Rapid.Graph();
      const plateauNode = Rapid.osmNode({ id: 'pn1', loc: [1, 1] });
      const entities = [plateauNode];

      const result = _service._filterPlateauOverlaps(entities, plateauGraph);
      expect(result).to.have.lengthOf(1);
    });

    it('returns all entities when editor is not initialized', () => {
      _service.context.systems.editor = null;

      const entities = [Rapid.osmNode({ id: 'pn1', loc: [1, 1] })];
      const result = _service._filterPlateauOverlaps(entities, new Rapid.Graph());
      expect(result).to.have.lengthOf(1);
    });

    it('passes through node entities without filtering', () => {
      // Setup an OSM building at (0,0)-(1,1)
      let osmGraph = new Rapid.Graph();
      const osmResult = makeBuilding(osmGraph, 'osmB1', [[0,0], [1,0], [1,1], [0,1]]);
      osmGraph = osmResult.graph;
      _service.context.systems.editor._graph = osmGraph;
      _service.context.systems.editor._entities = [osmResult.way];

      // A Plateau node (not a way) should pass through
      const plateauNode = Rapid.osmNode({ id: 'pn1', loc: [0.5, 0.5] });
      const result = _service._filterPlateauOverlaps([plateauNode], new Rapid.Graph());
      expect(result).to.have.lengthOf(1);
      expect(result[0].id).to.eql('pn1');
    });

    it('filters out Plateau buildings that overlap with OSM buildings', () => {
      // OSM building at (0,0)-(1,1)
      let osmGraph = new Rapid.Graph();
      const osmResult = makeBuilding(osmGraph, 'osmB1', [[0,0], [1,0], [1,1], [0,1]]);
      osmGraph = osmResult.graph;
      _service.context.systems.editor._graph = osmGraph;
      _service.context.systems.editor._entities = [osmResult.way];

      // Plateau building overlapping at (0.5,0.5)-(1.5,1.5)
      let plateauGraph = new Rapid.Graph();
      const plateauResult = makePlateauWay(plateauGraph, 'pW1', [[0.5,0.5], [1.5,0.5], [1.5,1.5], [0.5,1.5]]);
      plateauGraph = plateauResult.graph;

      const result = _service._filterPlateauOverlaps([plateauResult.way], plateauGraph);
      expect(result).to.have.lengthOf(0);
    });

    it('keeps Plateau buildings that do not overlap with OSM buildings', () => {
      // OSM building at (0,0)-(1,1)
      let osmGraph = new Rapid.Graph();
      const osmResult = makeBuilding(osmGraph, 'osmB1', [[0,0], [1,0], [1,1], [0,1]]);
      osmGraph = osmResult.graph;
      _service.context.systems.editor._graph = osmGraph;
      _service.context.systems.editor._entities = [osmResult.way];

      // Plateau building far away at (5,5)-(6,6)
      let plateauGraph = new Rapid.Graph();
      const plateauResult = makePlateauWay(plateauGraph, 'pW2', [[5,5], [6,5], [6,6], [5,6]]);
      plateauGraph = plateauResult.graph;

      const result = _service._filterPlateauOverlaps([plateauResult.way], plateauGraph);
      expect(result).to.have.lengthOf(1);
      expect(result[0].id).to.eql('pW2');
    });

    it('caches rejected entities', () => {
      // OSM building at (0,0)-(1,1)
      let osmGraph = new Rapid.Graph();
      const osmResult = makeBuilding(osmGraph, 'osmB1', [[0,0], [1,0], [1,1], [0,1]]);
      osmGraph = osmResult.graph;
      _service.context.systems.editor._graph = osmGraph;
      _service.context.systems.editor._entities = [osmResult.way];

      // Overlapping Plateau building
      let plateauGraph = new Rapid.Graph();
      const plateauResult = makePlateauWay(plateauGraph, 'pW1', [[0.5,0.5], [1.5,0.5], [1.5,1.5], [0.5,1.5]]);
      plateauGraph = plateauResult.graph;

      // First call: filters it out and caches
      _service._filterPlateauOverlaps([plateauResult.way], plateauGraph);
      expect(_service._plateauConflationCache.rejected.has('pW1')).to.be.true;

      // Second call: still filtered (cache hit)
      const result2 = _service._filterPlateauOverlaps([plateauResult.way], plateauGraph);
      expect(result2).to.have.lengthOf(0);
    });

    it('caches checked (non-overlapping) entities', () => {
      // No OSM buildings
      _service.context.systems.editor._entities = [];

      // Plateau building
      let plateauGraph = new Rapid.Graph();
      const plateauResult = makePlateauWay(plateauGraph, 'pW2', [[5,5], [6,5], [6,6], [5,6]]);
      plateauGraph = plateauResult.graph;

      // With no OSM buildings, all pass through — but no cache entry is set
      // because the function returns early when osmBuildingData is empty
      const result = _service._filterPlateauOverlaps([plateauResult.way], plateauGraph);
      expect(result).to.have.lengthOf(1);
    });

    it('passes through non-closed ways', () => {
      // OSM building at (0,0)-(1,1)
      let osmGraph = new Rapid.Graph();
      const osmResult = makeBuilding(osmGraph, 'osmB1', [[0,0], [1,0], [1,1], [0,1]]);
      osmGraph = osmResult.graph;
      _service.context.systems.editor._graph = osmGraph;
      _service.context.systems.editor._entities = [osmResult.way];

      // An open way (not closed) should pass through
      const openWay = Rapid.osmWay({ id: 'pOpen', nodes: ['a', 'b', 'c'], tags: {} });
      const result = _service._filterPlateauOverlaps([openWay], new Rapid.Graph());
      expect(result).to.have.lengthOf(1);
    });


    // ----------------------------------------------------------------------
    // Phase 4-A: relation-aware conflation
    // PLATEAU LOD2 building (outline + parts + type=building relation) を
    // relation 単位で表示 / 非表示判定する
    // ----------------------------------------------------------------------

    function makeBuildingRelationWithParts(plateauGraph, outlineId, partIds, outlineCoords, partCoordsArr) {
      // outline way
      let g = plateauGraph;
      const outRes = makePlateauWay(g, outlineId, outlineCoords);
      g = outRes.graph;
      const outline = outRes.way;
      // parts
      const parts = [];
      for (let i = 0; i < partIds.length; i++) {
        const pRes = makePlateauWay(g, partIds[i], partCoordsArr[i]);
        g = pRes.graph;
        parts.push(pRes.way);
      }
      // relation
      const members = [{ id: outline.id, type: 'way', role: 'outline' }];
      for (const p of parts) members.push({ id: p.id, type: 'way', role: 'part' });
      const relation = Rapid.osmRelation({
        id: 'r_building_' + outlineId,
        tags: { type: 'building', building: 'yes' },
        members: members,
      });
      g = g.replace(relation);
      return { graph: g, outline, parts, relation };
    }

    it('rejects all relation members when outline overlaps OSM building', () => {
      // OSM building at (0,0)-(1,1)
      let osmGraph = new Rapid.Graph();
      const osmRes = makeBuilding(osmGraph, 'osmB1', [[0,0], [1,0], [1,1], [0,1]]);
      _service.context.systems.editor._graph = osmRes.graph;
      _service.context.systems.editor._entities = [osmRes.way];

      // Plateau relation: outline overlaps OSM, parts inside outline
      let plateauGraph = new Rapid.Graph();
      const rel = makeBuildingRelationWithParts(
        plateauGraph, 'pOutline', ['pPart1', 'pPart2'],
        [[0.5,0.5], [1.5,0.5], [1.5,1.5], [0.5,1.5]],  // outline overlaps
        [
          [[0.6,0.6], [0.9,0.6], [0.9,0.9], [0.6,0.9]],  // part inside outline (overlaps OSM)
          [[1.1,1.1], [1.4,1.1], [1.4,1.4], [1.1,1.4]],  // part outside OSM bbox (would normally pass)
        ]
      );
      plateauGraph = rel.graph;

      const entities = [rel.outline, rel.parts[0], rel.parts[1], rel.relation];
      const result = _service._filterPlateauOverlaps(entities, plateauGraph);

      // outline + parts は relation のおかげで一括 reject される
      const wayResults = result.filter(e => e.type === 'way');
      expect(wayResults).to.have.lengthOf(0);
      // relation 自体は filter 対象外なので残る
      const relResults = result.filter(e => e.type === 'relation');
      expect(relResults).to.have.lengthOf(1);
    });

    it('keeps all relation members when outline does NOT overlap OSM building', () => {
      // OSM building at (0,0)-(1,1)
      let osmGraph = new Rapid.Graph();
      const osmRes = makeBuilding(osmGraph, 'osmB1', [[0,0], [1,0], [1,1], [0,1]]);
      _service.context.systems.editor._graph = osmRes.graph;
      _service.context.systems.editor._entities = [osmRes.way];

      // Plateau relation: outline at (10,10)-(11,11), away from OSM building
      let plateauGraph = new Rapid.Graph();
      const rel = makeBuildingRelationWithParts(
        plateauGraph, 'pOutline2', ['pPart3'],
        [[10,10], [11,10], [11,11], [10,11]],
        [[[10.2,10.2], [10.8,10.2], [10.8,10.8], [10.2,10.8]]],
      );
      plateauGraph = rel.graph;

      const entities = [rel.outline, rel.parts[0], rel.relation];
      const result = _service._filterPlateauOverlaps(entities, plateauGraph);

      const wayResults = result.filter(e => e.type === 'way');
      expect(wayResults).to.have.lengthOf(2);  // outline + 1 part 両方残る
    });

    it('falls back to per-way check when relation has no outline member', () => {
      // OSM building at (0,0)-(1,1)
      let osmGraph = new Rapid.Graph();
      const osmRes = makeBuilding(osmGraph, 'osmB1', [[0,0], [1,0], [1,1], [0,1]]);
      _service.context.systems.editor._graph = osmRes.graph;
      _service.context.systems.editor._entities = [osmRes.way];

      // relation だが outline メンバー無し、parts のみ
      let g = new Rapid.Graph();
      const part1 = makePlateauWay(g, 'pPartA', [[0.5,0.5], [1.5,0.5], [1.5,1.5], [0.5,1.5]]); // overlaps
      g = part1.graph;
      const part2 = makePlateauWay(g, 'pPartB', [[10,10], [11,10], [11,11], [10,11]]); // no overlap
      g = part2.graph;
      const relation = Rapid.osmRelation({
        id: 'r_no_outline',
        tags: { type: 'building' },
        members: [
          { id: part1.way.id, type: 'way', role: 'part' },
          { id: part2.way.id, type: 'way', role: 'part' },
        ],
      });
      g = g.replace(relation);

      const entities = [part1.way, part2.way, relation];
      const result = _service._filterPlateauOverlaps(entities, g);

      // outline 無しなので個別判定にフォールバック: pPartA は reject、pPartB は pass
      const wayIds = result.filter(e => e.type === 'way').map(e => e.id);
      expect(wayIds).to.not.include('pPartA');
      expect(wayIds).to.include('pPartB');
    });

    it('non-building relation members are evaluated per-way', () => {
      // OSM building at (0,0)-(1,1)
      let osmGraph = new Rapid.Graph();
      const osmRes = makeBuilding(osmGraph, 'osmB1', [[0,0], [1,0], [1,1], [0,1]]);
      _service.context.systems.editor._graph = osmRes.graph;
      _service.context.systems.editor._entities = [osmRes.way];

      // 非 building relation (例: type=route) の member way → 個別判定
      let g = new Rapid.Graph();
      const w1 = makePlateauWay(g, 'pRouteWay', [[0.5,0.5], [1.5,0.5], [1.5,1.5], [0.5,1.5]]);
      g = w1.graph;
      const routeRel = Rapid.osmRelation({
        id: 'r_route',
        tags: { type: 'route', route: 'bus' },
        members: [{ id: w1.way.id, type: 'way', role: '' }],
      });
      g = g.replace(routeRel);

      const result = _service._filterPlateauOverlaps([w1.way, routeRel], g);
      // route relation 経由の cascade は無し、個別 way 判定で reject
      const wayResults = result.filter(e => e.type === 'way');
      expect(wayResults).to.have.lengthOf(0);
    });
  });


  describe('#_checkWayOverlapsOsmBuildings', () => {
    function makePlateauWay(graph, wayId, coords) {
      const nodeIds = [];
      for (let i = 0; i < coords.length; i++) {
        const nodeId = wayId + '-n' + i;
        nodeIds.push(nodeId);
        graph = graph.replace(Rapid.osmNode({ id: nodeId, loc: coords[i] }));
      }
      nodeIds.push(nodeIds[0]);
      const way = Rapid.osmWay({ id: wayId, nodes: nodeIds, tags: { building: 'yes' } });
      graph = graph.replace(way);
      return { graph, way };
    }

    function makeOsmBuildingData(coords) {
      const closed = coords.concat([coords[0]]);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of closed) {
        if (c[0] < minX) minX = c[0];
        if (c[0] > maxX) maxX = c[0];
        if (c[1] < minY) minY = c[1];
        if (c[1] > maxY) maxY = c[1];
      }
      return [{ coords: [closed], bbox: { minX, minY, maxX, maxY } }];
    }

    it('returns true when way overlaps OSM building', () => {
      const plateauResult = makePlateauWay(new Rapid.Graph(),
        'pW', [[0.5,0.5], [1.5,0.5], [1.5,1.5], [0.5,1.5]]);
      const osmData = makeOsmBuildingData([[0,0], [1,0], [1,1], [0,1]]);
      const result = _service._checkWayOverlapsOsmBuildings(plateauResult.way, plateauResult.graph, osmData);
      expect(result).to.be.true;
    });

    it('returns false when way does NOT overlap OSM building', () => {
      const plateauResult = makePlateauWay(new Rapid.Graph(),
        'pW', [[10,10], [11,10], [11,11], [10,11]]);
      const osmData = makeOsmBuildingData([[0,0], [1,0], [1,1], [0,1]]);
      const result = _service._checkWayOverlapsOsmBuildings(plateauResult.way, plateauResult.graph, osmData);
      expect(result).to.be.false;
    });

    it('returns null for open ways', () => {
      const openWay = Rapid.osmWay({ id: 'pOpen', nodes: ['a', 'b', 'c'] });
      const osmData = makeOsmBuildingData([[0,0], [1,0], [1,1], [0,1]]);
      const result = _service._checkWayOverlapsOsmBuildings(openWay, new Rapid.Graph(), osmData);
      expect(result).to.be.null;
    });
  });


  describe('#_onHoverchange', () => {
    /**
     * 必要な mock:
     * - context.systems.gfx.scene.layers.get(layerID) → layer-like object
     * - layer.setClass / layer.unsetClass を spy 対応
     * - service の datasets[].graph に entity + relation を仕込む
     * - hover data.__service__ === 'plateau', data.__datasetid__ === 'pj'
     */
    function makeLayerMock() {
      const setCalls = [];
      const unsetCalls = [];
      return {
        setClass(klass, id) { setCalls.push([klass, id]); },
        unsetClass(klass, id) { unsetCalls.push([klass, id]); },
        getSetCalls: () => setCalls,
        getUnsetCalls: () => unsetCalls,
      };
    }

    function makeBuildingRelationDataset(serviceInstance, datasetID) {
      // outline / part / relation を datasets[datasetID].graph に仕込む
      const outline = Rapid.osmWay({ id: 'w_outline', nodes: ['n1'], tags: { building: 'yes' } });
      const part = Rapid.osmWay({ id: 'w_part', nodes: ['n1'], tags: { 'building:part': 'yes' } });
      const relation = Rapid.osmRelation({
        id: 'r_building',
        tags: { type: 'building', building: 'yes' },
        members: [
          { id: outline.id, type: 'way', role: 'outline' },
          { id: part.id, type: 'way', role: 'part' },
        ],
      });
      const node = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
      let graph = new Rapid.Graph([node, outline, part, relation]);
      serviceInstance._datasets[datasetID] = {
        id: datasetID,
        graph: graph,
        tree: null,
        cache: { inflight: {}, loaded: new Set(), seen: new Set(), seenFirstNodeID: new Set(), splitWays: new Map() },
      };
      // service.graph() が data.__datasetid__ から graph を返すように
      // 既存の service.graph() メソッドがあれば自動的に動く想定。
      // (PlateauService に graph(datasetID) メソッドがあることを前提)
      return { outline, part, relation };
    }

    it('sets highlight on other relation members when hovering a member way', () => {
      const layer = makeLayerMock();
      const built = makeBuildingRelationDataset(_service, 'pj');

      // hover 対象 = part の Plateau データ
      // production と同じく way instance 自体に metadata を attach (prototype を残す)
      const hoverData = built.part;
      hoverData.__service__ = 'plateau';
      hoverData.__datasetid__ = 'pj';

      _service._onHoverchange({ target: { layer: layer, data: hoverData } });

      const sets = layer.getSetCalls();
      // outline と part のうち、自分 (part) 以外 = outline にだけ highlight が乗る
      const highlightedIDs = sets
        .filter(([klass, _]) => klass === 'highlight')
        .map(([_, id]) => id);
      expect(highlightedIDs).to.include('w_outline');
      expect(highlightedIDs).to.not.include('w_part');
    });

    it('does nothing for hover targets not in the mapwithai service', () => {
      const layer = makeLayerMock();
      makeBuildingRelationDataset(_service, 'pj');

      const hoverData = { id: 'w_other', type: 'way', __service__: 'osm', __datasetid__: 'pj' };

      _service._onHoverchange({ target: { layer: layer, data: hoverData } });

      expect(layer.getSetCalls()).to.have.lengthOf(0);
    });

    it('does nothing for ways with no parent building relation', () => {
      const layer = makeLayerMock();
      // dataset を仕込むが、way は relation の member ではない
      const solo = Rapid.osmWay({ id: 'w_solo', nodes: [] });
      const graph = new Rapid.Graph([solo]);
      _service._datasets.pj_solo = { id: 'pj_solo', graph: graph, tree: null, cache: {} };

      solo.__service__ = 'plateau';
      solo.__datasetid__ = 'pj_solo';

      _service._onHoverchange({ target: { layer: layer, data: solo } });
      expect(layer.getSetCalls()).to.have.lengthOf(0);
    });

    it('clears previous siblings when hover moves to a different feature', () => {
      const layer = makeLayerMock();

      // scene mock を context に仕込む (cleanup の経路で必要)
      const sceneLayers = new Map([['rapid', layer]]);
      _service.context.systems.gfx = {
        scene: { layers: sceneLayers },
        deferredRedraw() {},
        immediateRedraw() {},
      };

      const built = makeBuildingRelationDataset(_service, 'pj');

      // 1回目: part を hover → outline に highlight
      built.part.__service__ = 'plateau';
      built.part.__datasetid__ = 'pj';
      _service._onHoverchange({ target: { layer: layer, data: built.part } });

      // 2回目: hover を外す (target が null)
      _service._onHoverchange({ target: null });

      const unsets = layer.getUnsetCalls();
      const unsetIDs = unsets
        .filter(([klass, _]) => klass === 'highlight')
        .map(([_, id]) => id);
      expect(unsetIDs).to.include('w_outline');
    });

    it('does not unset highlight on IDs that the select handler still claims', () => {
      const layer = makeLayerMock();
      const sceneLayers = new Map([['rapid', layer]]);
      _service.context.systems.gfx = {
        scene: { layers: sceneLayers },
        deferredRedraw() {},
        immediateRedraw() {},
      };

      const built = makeBuildingRelationDataset(_service, 'pj');
      built.part.__service__ = 'plateau';
      built.part.__datasetid__ = 'pj';

      // select 側が outline を claim している状態を再現
      _service._selectedRelationSiblings.add('w_outline');
      _service._hoveredRelationSiblings.add('w_outline');

      // hover を外す (cleanup)
      _service._onHoverchange({ target: null });

      const unsetIDs = layer.getUnsetCalls()
        .filter(([klass, _]) => klass === 'highlight')
        .map(([_, id]) => id);
      expect(unsetIDs).to.not.include('w_outline');
    });
  });


  describe('#_onModeChange', () => {
    /**
     * Phase 4-B-3: select 時に relation の他 members を highlight するハンドラ。
     * MockContext には selectedData / mode が無いので必要なものを生やして検証する。
     */
    function makeLayerMock() {
      const setCalls = [];
      const unsetCalls = [];
      return {
        setClass(klass, id) { setCalls.push([klass, id]); },
        unsetClass(klass, id) { unsetCalls.push([klass, id]); },
        getSetCalls: () => setCalls,
        getUnsetCalls: () => unsetCalls,
      };
    }

    function attachScene(serviceInstance, rapidLayer) {
      const sceneLayers = new Map([['rapid', rapidLayer]]);
      serviceInstance.context.systems.gfx = {
        scene: { layers: sceneLayers },
        deferredRedraw() {},
        immediateRedraw() {},
      };
    }

    function makeBuildingRelationDataset(serviceInstance, datasetID) {
      const outline = Rapid.osmWay({ id: 'w_outline', nodes: ['n1'], tags: { building: 'yes' } });
      const part = Rapid.osmWay({ id: 'w_part', nodes: ['n1'], tags: { 'building:part': 'yes' } });
      const relation = Rapid.osmRelation({
        id: 'r_building',
        tags: { type: 'building', building: 'yes' },
        members: [
          { id: outline.id, type: 'way', role: 'outline' },
          { id: part.id, type: 'way', role: 'part' },
        ],
      });
      const node = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
      let graph = new Rapid.Graph([node, outline, part, relation]);
      serviceInstance._datasets[datasetID] = {
        id: datasetID,
        graph: graph,
        tree: null,
        cache: { inflight: {}, loaded: new Set(), seen: new Set(), seenFirstNodeID: new Set(), splitWays: new Map() },
      };
      return { outline, part, relation };
    }

    it('sets highlight on other relation members when selecting a Plateau member way', () => {
      const layer = makeLayerMock();
      attachScene(_service, layer);
      const built = makeBuildingRelationDataset(_service, 'pj');

      built.part.__service__ = 'plateau';
      built.part.__datasetid__ = 'pj';
      const selectedData = new Map([[built.part.id, built.part]]);
      _service.context.selectedData = () => selectedData;

      _service._onModeChange({ id: 'select' });

      const highlightedIDs = layer.getSetCalls()
        .filter(([klass, _]) => klass === 'highlight')
        .map(([_, id]) => id);
      expect(highlightedIDs).to.include('w_outline');
      expect(highlightedIDs).to.not.include('w_part');
    });

    it('does nothing when no Plateau feature is selected', () => {
      const layer = makeLayerMock();
      attachScene(_service, layer);
      makeBuildingRelationDataset(_service, 'pj');

      _service.context.selectedData = () => new Map();
      _service._onModeChange({ id: 'select' });

      expect(layer.getSetCalls()).to.have.lengthOf(0);
    });

    it('ignores non-select modes (browse, draw, save) and only cleans previous highlights', () => {
      const layer = makeLayerMock();
      attachScene(_service, layer);
      makeBuildingRelationDataset(_service, 'pj');

      // 過去の select で立てた sibling が残っている状態
      _service._selectedRelationSiblings.add('w_outline');

      _service._onModeChange({ id: 'browse' });

      // browse モードでは select-time highlight をしない
      expect(layer.getSetCalls()).to.have.lengthOf(0);
      // 過去 claim 分は unset される
      const unsetIDs = layer.getUnsetCalls()
        .filter(([klass, _]) => klass === 'highlight')
        .map(([_, id]) => id);
      expect(unsetIDs).to.include('w_outline');
      expect(_service._selectedRelationSiblings.size).to.eql(0);
    });

    it('does not unset highlight on IDs that hover still claims', () => {
      const layer = makeLayerMock();
      attachScene(_service, layer);
      makeBuildingRelationDataset(_service, 'pj');

      // hover と select が同じ outline を claim している状態
      _service._selectedRelationSiblings.add('w_outline');
      _service._hoveredRelationSiblings.add('w_outline');

      _service._onModeChange({ id: 'browse' });

      const unsetIDs = layer.getUnsetCalls()
        .filter(([klass, _]) => klass === 'highlight')
        .map(([_, id]) => id);
      expect(unsetIDs).to.not.include('w_outline');
    });

    it('ignores selected entities that do not belong to a building relation', () => {
      const layer = makeLayerMock();
      attachScene(_service, layer);

      const solo = Rapid.osmWay({ id: 'w_solo', nodes: [], tags: { building: 'yes' } });
      _service._datasets.pj_solo = { id: 'pj_solo', graph: new Rapid.Graph([solo]), tree: null, cache: {} };
      solo.__service__ = 'plateau';
      solo.__datasetid__ = 'pj_solo';

      _service.context.selectedData = () => new Map([[solo.id, solo]]);
      _service._onModeChange({ id: 'select' });

      expect(layer.getSetCalls()).to.have.lengthOf(0);
    });
  });

});
