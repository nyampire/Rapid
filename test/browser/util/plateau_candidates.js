describe('utilPlateauCandidates', () => {
  let _savedAreaKeys;
  before(() => {
    _savedAreaKeys = Rapid.osmAreaKeys;
    Rapid.osmSetAreaKeys({ building: {}, 'building:part': {} });
  });
  after(() => {
    Rapid.osmSetAreaKeys(_savedAreaKeys);
  });

  function addWay(graph, id, x, tags) {
    let g = graph;
    const coords = [[x, 0], [x + 1, 0], [x + 1, 1], [x, 1]];
    const nodeIDs = coords.map((loc, i) => {
      g = g.replace(Rapid.osmNode({ id: `${id}-n${i}`, loc }));
      return `${id}-n${i}`;
    });
    nodeIDs.push(nodeIDs[0]);
    const way = Rapid.osmWay({ id, nodes: nodeIDs, tags: tags ?? { building: 'yes' } });
    g = g.replace(way);
    return { graph: g, way };
  }

  // 模擬の context。entities は getData が返す配列、graph はそのグラフ。
  function makeContext(entities, graph, opts = {}) {
    const plateau = {
      started: opts.started ?? true,
      graph: () => graph,
      getData: () => entities
    };
    const rapid = {
      acceptIDs: new Set(opts.accept ?? []),
      ignoreIDs: new Set(opts.ignore ?? []),
      datasets: new Map(opts.datasets ?? [
        ['plateauJapan', { id: 'plateauJapan', service: 'plateau', added: true, enabled: true }]
      ])
    };
    return {
      services: { plateau },
      systems: {
        rapid,
        gfx: { scene: { layers: new Map([['rapid', { enabled: opts.rapidEnabled ?? true }]]) } }
      },
      viewport: { transform: { zoom: opts.zoom ?? 18 } }
    };
  }

  it('returns the polygons the layer would draw', () => {
    let g = new Rapid.Graph();
    const a = addWay(g, 'w1', 0); g = a.graph;
    const b = addWay(g, 'w2', 5); g = b.graph;
    const out = Rapid.utilPlateauCandidates(makeContext([a.way, b.way], g));
    expect(out.map(c => c.entity.id)).to.eql(['w1', 'w2']);
    expect(out[0].datasetID).to.equal('plateauJapan');
    expect(out[0].graph).to.equal(g);
  });

  it('skips accepted and ignored candidates', () => {
    let g = new Rapid.Graph();
    const a = addWay(g, 'w1', 0); g = a.graph;
    const b = addWay(g, 'w2', 5); g = b.graph;
    const c = addWay(g, 'w3', 10); g = c.graph;
    const ctx = makeContext([a.way, b.way, c.way], g, { accept: ['w1'], ignore: ['w2'] });
    expect(Rapid.utilPlateauCandidates(ctx).map(x => x.entity.id)).to.eql(['w3']);
  });

  it('counts a courtyard relation once, not its member ways', () => {
    let g = new Rapid.Graph();
    const a = addWay(g, 'w1', 0); g = a.graph;
    const b = addWay(g, 'w2', 0.4); g = b.graph;
    const rel = Rapid.osmRelation({
      id: 'r1',
      tags: { type: 'multipolygon', building: 'yes' },
      members: [
        { id: 'w1', type: 'way', role: 'outer' },
        { id: 'w2', type: 'way', role: 'inner' }
      ]
    });
    g = g.replace(rel);
    const out = Rapid.utilPlateauCandidates(makeContext([a.way, b.way, rel], g));
    expect(out).to.have.lengthOf(1);
    expect(out[0].entity.id).to.equal('r1');
  });

  it('returns nothing below the Plateau minimum zoom', () => {
    let g = new Rapid.Graph();
    const a = addWay(g, 'w1', 0); g = a.graph;
    expect(Rapid.utilPlateauCandidates(makeContext([a.way], g, { zoom: 16.9 }))).to.eql([]);
  });

  it('ignores datasets that are not Plateau', () => {
    let g = new Rapid.Graph();
    const a = addWay(g, 'w1', 0); g = a.graph;
    const datasets = [['esri1', { id: 'esri1', service: 'esri', added: true, enabled: true }]];
    expect(Rapid.utilPlateauCandidates(makeContext([a.way], g, { datasets }))).to.eql([]);
  });

  it('returns nothing while the Plateau service is not started', () => {
    let g = new Rapid.Graph();
    const a = addWay(g, 'w1', 0); g = a.graph;
    expect(Rapid.utilPlateauCandidates(makeContext([a.way], g, { started: false }))).to.eql([]);
  });

  it('returns nothing while the Rapid layer is switched off', () => {
    let g = new Rapid.Graph();
    const a = addWay(g, 'w1', 0); g = a.graph;
    expect(Rapid.utilPlateauCandidates(makeContext([a.way], g, { rapidEnabled: false }))).to.eql([]);
  });
});
