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

    // memberTags defaults to untagged, matching real data: importer-produced
    // member ways of a courtyard relation carry no tags of their own.
    function makeCourtyard(graph, memberTags) {
      let g = graph;
      const o = makeWay(g, 'w_outer', [[0,0], [1,0], [1,1], [0,1]], memberTags);
      g = o.graph;
      const i = makeWay(g, 'w_inner', [[0.4,0.4], [0.6,0.4], [0.6,0.6], [0.4,0.6]], memberTags);
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
      // Member ways here must carry an area-suggesting tag (unlike every other
      // fixture in this file). If they were left untagged, `osmWay#geometry()`
      // would already return 'line' for them (isArea() needs
      // tagSuggestingArea() !== null — see modules/osm/way.js), so
      // `_plateauRenderables` would skip them for being non-area regardless of
      // whether the member-way exclusion guard exists. That would make this
      // assertion pass even with the guard deleted, proving nothing. Tagging
      // the member ways as `building: 'yes'` makes them area-geometry ways
      // that only the guard keeps out, so the test actually exercises it.
      const mp = makeCourtyard(new Rapid.Graph(), { building: 'yes' });
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
