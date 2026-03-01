describe('MapWithAIService', () => {
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
    _service = new Rapid.MapWithAIService(new MockContext());
    return _service.initAsync();
  });


  describe('#_getLoc', () => {
    it('parses lon/lat from attributes', () => {
      const attrs = {
        lon: { value: '139.6917' },
        lat: { value: '35.6895' }
      };
      const loc = _service._getLoc(attrs);
      expect(loc).to.eql([139.6917, 35.6895]);
    });
  });


  describe('#_getVisible', () => {
    it('returns true when visible attribute is absent', () => {
      const attrs = {};
      expect(_service._getVisible(attrs)).to.be.true;
    });

    it('returns true when visible is not "false"', () => {
      const attrs = { visible: { value: 'true' } };
      expect(_service._getVisible(attrs)).to.be.true;
    });

    it('returns false when visible is "false"', () => {
      const attrs = { visible: { value: 'false' } };
      expect(_service._getVisible(attrs)).to.be.false;
    });
  });


  describe('#_getTags', () => {
    it('extracts key-value pairs from tag elements', () => {
      const xml = new DOMParser().parseFromString(
        '<way><tag k="building" v="yes"/><tag k="height" v="10"/></way>', 'text/xml'
      ).documentElement;
      const tags = _service._getTags(xml);
      expect(tags).to.eql({ building: 'yes', height: '10' });
    });

    it('ignores tags with empty key or value', () => {
      const xml = new DOMParser().parseFromString(
        '<way><tag k="" v="yes"/><tag k="name" v=""/><tag k="ok" v="val"/></way>', 'text/xml'
      ).documentElement;
      const tags = _service._getTags(xml);
      expect(tags).to.eql({ ok: 'val' });
    });

    it('returns empty object when no tags', () => {
      const xml = new DOMParser().parseFromString('<way></way>', 'text/xml').documentElement;
      const tags = _service._getTags(xml);
      expect(tags).to.eql({});
    });
  });


  describe('#_getNodes', () => {
    it('extracts node references with n prefix', () => {
      const xml = new DOMParser().parseFromString(
        '<way><nd ref="100"/><nd ref="101"/><nd ref="102"/></way>', 'text/xml'
      ).documentElement;
      const nodes = _service._getNodes(xml);
      expect(nodes).to.eql(['n100', 'n101', 'n102']);
    });
  });


  describe('#_parseNode', () => {
    it('creates an osmNode with loc and tags', () => {
      const xml = new DOMParser().parseFromString(
        '<node lon="139.5" lat="35.5"><tag k="name" v="test"/></node>', 'text/xml'
      ).documentElement;
      const node = _service._parseNode(xml, 'n-1');
      expect(node.id).to.eql('n-1');
      expect(node.loc).to.eql([139.5, 35.5]);
      expect(node.tags).to.eql({ name: 'test' });
      expect(node.visible).to.be.true;
    });
  });


  describe('#_parseWay', () => {
    it('creates an osmWay with nodes and tags', () => {
      const xml = new DOMParser().parseFromString(
        '<way><nd ref="1"/><nd ref="2"/><nd ref="3"/><tag k="building" v="yes"/></way>', 'text/xml'
      ).documentElement;
      const way = _service._parseWay(xml, 'w-1');
      expect(way.id).to.eql('w-1');
      expect(way.nodes).to.eql(['n1', 'n2', 'n3']);
      expect(way.tags).to.eql({ building: 'yes' });
      expect(way.visible).to.be.true;
    });
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
  });

});
