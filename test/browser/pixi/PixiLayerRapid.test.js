describe('PixiLayerRapid', () => {
  // `osmWay#geometry()` calls `isArea()`, which consults `osmAreaKeys`.
  // That map is normally populated by `PresetSystem.init()` at app boot;
  // these mock-based tests never boot a real context, so we seed it here.
  // Same pattern as `test/unit/osm/way.test.js` and
  // `test/browser/validations/mismatched_geometry.js`.
  let _savedAreaKeys;

  before(() => {
    _savedAreaKeys = Rapid.osmAreaKeys;
    Rapid.osmSetAreaKeys({ building: {}, 'building:part': {} });
  });

  after(() => {
    Rapid.osmSetAreaKeys(_savedAreaKeys);
  });

  function makeScene() {
    const gfx = {
      scene: null,
      deferredRedraw() {},
      immediateRedraw() {}
    };
    const context = { services: {}, systems: { gfx: gfx } };
    const scene = { gfx: gfx, context: context, groups: new Map([['basemap', null]]) };
    gfx.scene = scene;
    return scene;
  }

  describe('#_plateauRenderables', () => {
    function makeWay(graph, id, coords, tags) {
      let g = graph;
      const nodeIds = [];
      for (let i = 0; i < coords.length; i++) {
        const nodeId = id + '-n' + i;
        nodeIds.push(nodeId);
        g = g.replace(Rapid.osmNode({ id: nodeId, loc: coords[i] }));
      }
      nodeIds.push(nodeIds[0]);
      const way = Rapid.osmWay({ id, nodes: nodeIds, tags: tags || {} });
      g = g.replace(way);
      return { graph: g, way };
    }

    function makeCourtyard(graph) {
      let g = graph;
      const o = makeWay(g, 'w_outer', [[0,0], [1,0], [1,1], [0,1]]);
      g = o.graph;
      const i = makeWay(g, 'w_inner', [[0.4,0.4], [0.6,0.4], [0.6,0.6], [0.4,0.6]]);
      g = i.graph;
      const relation = Rapid.osmRelation({
        id: 'r_mp',
        tags: { type: 'multipolygon', building: 'yes' },
        members: [
          { id: 'w_outer', type: 'way', role: 'outer' },
          { id: 'w_inner', type: 'way', role: 'inner' }
        ]
      });
      g = g.replace(relation);
      return { graph: g, outer: o.way, inner: i.way, relation };
    }

    it('renders a courtyard relation as one polygon', () => {
      const mp = makeCourtyard(new Rapid.Graph());
      const layer = new Rapid.PixiLayerRapid(makeScene(), 'rapid');
      const out = layer._plateauRenderables(
        [mp.outer, mp.inner, mp.relation], mp.graph
      );
      const ids = out.polygons.map(e => e.id);
      expect(ids).to.include('r_mp');
    });

    it('does not also render the member ways of a courtyard relation', () => {
      const mp = makeCourtyard(new Rapid.Graph());
      const layer = new Rapid.PixiLayerRapid(makeScene(), 'rapid');
      const out = layer._plateauRenderables(
        [mp.outer, mp.inner, mp.relation], mp.graph
      );
      const ids = out.polygons.map(e => e.id);
      expect(ids).to.not.include('w_outer', 'outer が二重に描かれる');
      expect(ids).to.not.include('w_inner', 'inner が単独で描かれる');
    });

    it('still renders a plain building way', () => {
      let g = new Rapid.Graph();
      const b = makeWay(g, 'w_plain', [[10,10], [11,10], [11,11], [10,11]], { building: 'yes' });
      g = b.graph;
      const layer = new Rapid.PixiLayerRapid(makeScene(), 'rapid');
      const out = layer._plateauRenderables([b.way], g);
      expect(out.polygons.map(e => e.id)).to.include('w_plain');
    });

    it('does not render a type=building relation, only its member ways', () => {
      // type=building は outline と parts を個別に描く現在の方式を変えない。
      let g = new Rapid.Graph();
      const o = makeWay(g, 'w_outline', [[20,20], [21,20], [21,21], [20,21]], { building: 'yes' });
      g = o.graph;
      const p = makeWay(g, 'w_part', [[20.2,20.2], [20.8,20.2], [20.8,20.8], [20.2,20.8]], { 'building:part': 'yes' });
      g = p.graph;
      const rel = Rapid.osmRelation({
        id: 'r_b',
        tags: { type: 'building', building: 'yes' },
        members: [
          { id: 'w_outline', type: 'way', role: 'outline' },
          { id: 'w_part', type: 'way', role: 'part' }
        ]
      });
      g = g.replace(rel);
      const layer = new Rapid.PixiLayerRapid(makeScene(), 'rapid');
      const out = layer._plateauRenderables([o.way, p.way, rel], g);
      const ids = out.polygons.map(e => e.id);
      expect(ids).to.include('w_outline');
      expect(ids).to.include('w_part');
      expect(ids).to.not.include('r_b');
    });
  });
});
