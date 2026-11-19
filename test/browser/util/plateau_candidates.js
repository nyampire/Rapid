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
      getData: () => entities,
      isAddBlocked: () => opts.addBlocked ?? false
    };
    const rapid = {
      acceptIDs: new Set(opts.accept ?? []),
      ignoreIDs: new Set(opts.ignore ?? []),
      datasets: new Map(opts.datasets ?? [
        ['plateauJapan', { id: 'plateauJapan', service: 'plateau', added: true, enabled: opts.datasetEnabled ?? true }]
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

  // type=building の relation と、そのメンバー way を作る。members は [id, role] の配列。
  function buildingRelation(g, relID, members, startX) {
    const ways = [];
    members.forEach(([id, role], i) => {
      const a = addWay(g, id, startX + i * 0.1, { building: 'yes' });
      g = a.graph;
      ways.push(a.way);
    });
    const rel = Rapid.osmRelation({
      id: relID,
      tags: { type: 'building' },
      members: members.map(([id, role]) => ({ id, type: 'way', role }))
    });
    return { graph: g.replace(rel), ways };
  }

  it('counts a type=building relation as one candidate represented by its outline', () => {
    const r = buildingRelation(new Rapid.Graph(), 'r1', [['w2', 'part'], ['w1', 'outline'], ['w3', 'part']], 0);
    const out = Rapid.utilPlateauCandidates(makeContext(r.ways, r.graph));
    expect(out).to.have.lengthOf(1);
    expect(out[0].entity.id).to.equal('w1');
    expect([...out[0].memberIDs].sort()).to.eql(['w1', 'w2', 'w3']);
  });

  it('falls back to the first remaining part once the outline is accepted', () => {
    const r = buildingRelation(new Rapid.Graph(), 'r1', [['w1', 'outline'], ['w2', 'part'], ['w3', 'part']], 0);
    const out = Rapid.utilPlateauCandidates(makeContext(r.ways, r.graph, { accept: ['w1'] }));
    expect(out).to.have.lengthOf(1);
    expect(out[0].entity.id).to.equal('w2');
    expect([...out[0].memberIDs].sort()).to.eql(['w2', 'w3']);
  });

  it('keeps separate buildings separate', () => {
    let r1 = buildingRelation(new Rapid.Graph(), 'r1', [['w1', 'outline'], ['w2', 'part']], 0);
    let r2 = buildingRelation(r1.graph, 'r2', [['w3', 'outline'], ['w4', 'part']], 10);
    const out = Rapid.utilPlateauCandidates(makeContext([...r1.ways, ...r2.ways], r2.graph));
    expect(out.map(c => c.entity.id)).to.eql(['w1', 'w3']);
  });

  it('gives a plain candidate a single-member set', () => {
    let g = new Rapid.Graph();
    const a = addWay(g, 'w9', 0); g = a.graph;
    const out = Rapid.utilPlateauCandidates(makeContext([a.way], g));
    expect([...out[0].memberIDs]).to.eql(['w9']);
  });

  it('gives a courtyard relation a member set of itself', () => {
    let g = new Rapid.Graph();
    const a = addWay(g, 'w1', 0); g = a.graph;
    const rel = Rapid.osmRelation({
      id: 'r1',
      tags: { type: 'multipolygon', building: 'yes' },
      members: [{ id: 'w1', type: 'way', role: 'outer' }]
    });
    g = g.replace(rel);
    const out = Rapid.utilPlateauCandidates(makeContext([a.way, rel], g));
    expect([...out[0].memberIDs]).to.eql(['r1']);
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

  describe('utilPlateauCandidateStatus', () => {
    function oneWay() {
      const a = addWay(new Rapid.Graph(), 'w1', 0);
      return a;
    }

    it('Rapid のレイヤーが無効なら layer-off', () => {
      const a = oneWay();
      const ctx = makeContext([a.way], a.graph, { rapidEnabled: false });
      expect(Rapid.utilPlateauCandidateStatus(ctx)).to.eql({ reason: 'layer-off', count: 0 });
    });

    it('有効な Plateau のデータセットが無ければ layer-off', () => {
      const a = oneWay();
      const ctx = makeContext([a.way], a.graph, { datasetEnabled: false });
      expect(Rapid.utilPlateauCandidateStatus(ctx)).to.eql({ reason: 'layer-off', count: 0 });
    });

    it('ズーム 16 なら zoom', () => {
      const a = oneWay();
      const ctx = makeContext([a.way], a.graph, { zoom: 16 });
      expect(Rapid.utilPlateauCandidateStatus(ctx)).to.eql({ reason: 'zoom', count: 0 });
    });

    it('OSM のレイヤーを切っていれば osm-layer-off', () => {
      const a = oneWay();
      const ctx = makeContext([a.way], a.graph, { addBlocked: true });
      expect(Rapid.utilPlateauCandidateStatus(ctx)).to.eql({ reason: 'osm-layer-off', count: 0 });
    });

    it('追加済みと無視済みしか無ければ none', () => {
      let g = new Rapid.Graph();
      const a = addWay(g, 'w1', 0); g = a.graph;
      const b = addWay(g, 'w2', 5); g = b.graph;
      const ctx = makeContext([a.way, b.way], g, { accept: ['w1'], ignore: ['w2'] });
      expect(Rapid.utilPlateauCandidateStatus(ctx)).to.eql({ reason: 'none', count: 0 });
    });

    it('候補が 2 件あれば ok と 2', () => {
      let g = new Rapid.Graph();
      const a = addWay(g, 'w1', 0); g = a.graph;
      const b = addWay(g, 'w2', 5); g = b.graph;
      const ctx = makeContext([a.way, b.way], g);
      expect(Rapid.utilPlateauCandidateStatus(ctx)).to.eql({ reason: 'ok', count: 2 });
    });
  });
});
