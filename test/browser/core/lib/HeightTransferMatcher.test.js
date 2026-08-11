describe('HeightTransferMatcher', () => {
  const TARGET_KEYS = ['height', 'ele', 'building:levels'];

  describe('analyzeTagStates', () => {
    it('reports all three keys missing when OSM has none', () => {
      const osm = { tags: { building: 'yes' } };
      const plateau = { tags: { height: '12', ele: '45', 'building:levels': '3' } };
      const s = Rapid.analyzeTagStates(osm, plateau);
      expect(s.missing.slice().sort()).to.eql(TARGET_KEYS.slice().sort());
      expect(s.matching).to.eql([]);
      expect(s.conflicting).to.eql([]);
    });

    it('reports a key as matching when both sides have the same value', () => {
      const osm = { tags: { building: 'yes', height: '12' } };
      const plateau = { tags: { height: '12', ele: '45' } };
      const s = Rapid.analyzeTagStates(osm, plateau);
      expect(s.matching).to.eql(['height']);
      expect(s.missing).to.eql(['ele']);
      expect(s.conflicting).to.eql([]);
    });

    it('reports a key as conflicting when both sides have different values', () => {
      const osm = { tags: { building: 'yes', height: '10' } };
      const plateau = { tags: { height: '12' } };
      const s = Rapid.analyzeTagStates(osm, plateau);
      expect(s.conflicting).to.eql([
        { key: 'height', osmValue: '10', plateauValue: '12' }
      ]);
      expect(s.matching).to.eql([]);
      expect(s.missing).to.eql([]);
    });

    it('ignores keys missing from PLATEAU (nothing to transfer)', () => {
      const osm = { tags: { building: 'yes' } };
      const plateau = { tags: { name: 'foo' } };
      const s = Rapid.analyzeTagStates(osm, plateau);
      expect(s.missing).to.eql([]);
      expect(s.matching).to.eql([]);
      expect(s.conflicting).to.eql([]);
    });
  });

  describe('findCandidates', () => {
    // Helpers to build minimal features
    function outline(id, coords, tags, rp) {
      return { id, type: 'way', tags: { building: 'yes', ...tags },
               representativePoint: rp,
               asGeoJSON: () => ({ type: 'Feature', geometry:
                  { type: 'Polygon', coordinates: [coords] }, properties: {} }) };
    }
    function osmBuilding(id, coords, tags = { building: 'yes' }) {
      return { id, type: 'way', tags,
               asGeoJSON: () => ({ type: 'Feature', geometry:
                  { type: 'Polygon', coordinates: [coords] }, properties: {} }) };
    }
    // A 100m x 100m square centered on Tokyo (rough)
    const SQR = [[139.755, 35.679], [139.756, 35.679],
                 [139.756, 35.680], [139.755, 35.680], [139.755, 35.679]];
    const SQR_CENTER = [139.7555, 35.6795];

    // 中庭のある建物。asGeoJSON は MultiPolygon を返し、タグは relation にだけ付く。
    // outerCoords が外側リング、holeCoords が穴。
    function courtyard(id, outerCoords, holeCoords, tags, rp) {
      return { id, type: 'relation',
               tags: { type: 'multipolygon', building: 'yes', ...tags },
               representativePoint: rp,
               asGeoJSON: () => ({ type: 'MultiPolygon',
                                   coordinates: [[outerCoords, holeCoords]] }) };
    }

    // SQR の内側に収まる、一辺がおよそ 8 割の穴。面積比でおよそ 0.36 になる。
    const HOLE = [[139.7551, 35.6791], [139.75590, 35.6791],
                  [139.75590, 35.67990], [139.7551, 35.67990], [139.7551, 35.6791]];

    it('accepts a type=multipolygon building relation as a candidate', () => {
      const p = courtyard('r1', SQR, HOLE, { height: '12' }, SQR_CENTER);
      const o = osmBuilding('o1', SQR);
      const out = Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.have.lengthOf(1, '中庭建物が候補になっていない');
      expect(out[0].state).to.equal('CANDIDATE');
      expect(out[0].missingTags).to.eql(['height']);
    });

    it('measures the courtyard building by its outer ring, not its net area', () => {
      // 穴を差し引くと比は 0.5 を割り、AREA_RATIO_MIN で落ちる。
      // 外側リングで測れば OSM と同じ形なので比は 1 になる。
      const p = courtyard('r2', SQR, HOLE, { height: '12' }, SQR_CENTER);
      const o = osmBuilding('o2', SQR);
      const out = Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.have.lengthOf(1, '正味面積で測って落ちている');
      expect(out[0].ratio).to.be.closeTo(1, 0.05);
    });

    it('ignores a multipolygon that is not a building', () => {
      const forest = { id: 'r3', type: 'relation',
                       tags: { type: 'multipolygon', landuse: 'forest', height: '12' },
                       representativePoint: SQR_CENTER,
                       asGeoJSON: () => ({ type: 'MultiPolygon',
                                           coordinates: [[SQR, HOLE]] }) };
      const o = osmBuilding('o3', SQR);
      const out = Rapid.findCandidates({
        plateauEntities: [forest], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.have.lengthOf(0);
    });

    it('keeps the area of a plain way unchanged', () => {
      // 本番データの大半はこの経路。リングが 1 本なので外側リング = 全体。
      const p = outline('p1', SQR, { height: '12' }, SQR_CENTER);
      const o = osmBuilding('o1', SQR);
      const out = Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.have.lengthOf(1);
      expect(out[0].ratio).to.be.closeTo(1, 0.001);
    });

    it('sums every outer ring when a multipolygon has more than one', () => {
      // 1 本目だけを黙って測らないことを固定する。
      // SQR と、その東隣に同じ大きさの正方形をもう 1 つ置く。
      const EAST = SQR.map(([lon, lat]) => [lon + 0.001, lat]);
      const twoOuters = { id: 'r4', type: 'relation',
                          tags: { type: 'multipolygon', building: 'yes', height: '12' },
                          representativePoint: SQR_CENTER,
                          asGeoJSON: () => ({ type: 'MultiPolygon',
                                              coordinates: [[SQR], [EAST]] }) };
      const o = osmBuilding('o4', SQR);
      const out = Rapid.findCandidates({
        plateauEntities: [twoOuters], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      // 2 つ分の面積なので比はおよそ 2 になる。1 本目だけを測っていれば 1 になる。
      // このテストが見るのは比の値だけで、state は見ない。比が 2.0 の境界に乗るため
      // CANDIDATE と AREA_MISMATCH のどちらになるかは投影の誤差で変わりうる。
      expect(out).to.have.lengthOf(1);
      expect(out[0].ratio).to.be.closeTo(2, 0.1);
    });

    it('does not offer a courtyard building again after it was transferred', () => {
      // 転記後は relation の id が transferredIDs に入る。絞り込みが id で見ているので
      // way と同じ扱いになるが、relation でも効くことを固定しておく。
      const p = courtyard('r5', SQR, HOLE, { height: '12' }, SQR_CENTER);
      const o = osmBuilding('o5', SQR);
      const out = Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o],
        transferredIDs: new Set(['r5']), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.have.lengthOf(0);
    });

    it('returns CANDIDATE when Plateau has tags and OSM is missing them', () => {
      const p = outline('p1', SQR, { height: '12' }, SQR_CENTER);
      const o = osmBuilding('o1', SQR);
      const out = Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.have.lengthOf(1);
      expect(out[0].state).to.equal('CANDIDATE');
      expect(out[0].missingTags).to.eql(['height']);
    });

    it('returns COVERED when OSM has all tags and values match', () => {
      const p = outline('p1', SQR, { height: '12' }, SQR_CENTER);
      const o = osmBuilding('o1', SQR, { building: 'yes', height: '12' });
      const out = Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.have.lengthOf(1);
      expect(out[0].state).to.equal('COVERED');
    });

    it('returns CONFLICT when values differ and nothing is missing', () => {
      const p = outline('p1', SQR, { height: '12' }, SQR_CENTER);
      const o = osmBuilding('o1', SQR, { building: 'yes', height: '10' });
      const out = Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.have.lengthOf(1);
      expect(out[0].state).to.equal('CONFLICT');
    });

    it('skips a Plateau outline far smaller than the OSM building (sub-structure)', () => {
      // OSM building is 10x wider than the Plateau outline -> ratio ~0.1.
      // In real data this is a rooftop stair enclosure / shed that Plateau
      // carries as its own `building`, sitting inside a much larger OSM
      // footprint. Transferring its height would be wrong, and flagging it
      // is just noise, so it produces no candidate at all.
      const bigOsm = [[139.750, 35.679], [139.760, 35.679],
                      [139.760, 35.680], [139.750, 35.680], [139.750, 35.679]];
      const p = outline('p1', SQR, { height: '12' }, SQR_CENTER);
      const o = osmBuilding('o1', bigOsm);
      const out = Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.eql([]);
    });

    it('returns AREA_MISMATCH when the Plateau outline is far larger than the OSM building', () => {
      // Plateau outline is ~10x wider than the OSM building -> ratio ~10.
      // This is the reviewable case: OSM has block-level or partial mapping
      // under one large Plateau outline, so a human should look at it.
      const bigPlateau = [[139.750, 35.679], [139.760, 35.679],
                          [139.760, 35.680], [139.750, 35.680], [139.750, 35.679]];
      const p = outline('p1', bigPlateau, { height: '12' }, SQR_CENTER);
      const o = osmBuilding('o1', SQR);
      const out = Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.have.lengthOf(1);
      expect(out[0].state).to.equal('AREA_MISMATCH');
    });

    it('skips outlines whose representative point hits multiple OSM buildings', () => {
      const p = outline('p1', SQR, { height: '12' }, SQR_CENTER);
      // Two OSM buildings that both contain SQR_CENTER (overlapping polygons)
      const o1 = osmBuilding('o1', SQR);
      const o2 = osmBuilding('o2', SQR);
      const out = Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o1, o2],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.eql([]);
    });

    it('skips Plateau outlines with no OSM building beneath (handled by conflation)', () => {
      const p = outline('p1', SQR, { height: '12' }, SQR_CENTER);
      const out = Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.eql([]);
    });

    it('excludes Plateau outlines in transferredIDs/acceptIDs/ignoreIDs', () => {
      const p = outline('p1', SQR, { height: '12' }, SQR_CENTER);
      const o = osmBuilding('o1', SQR);
      expect(Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o],
        transferredIDs: new Set(['p1']),
        acceptIDs: new Set(), ignoreIDs: new Set()
      })).to.eql([]);
      expect(Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o],
        transferredIDs: new Set(),
        acceptIDs: new Set(['p1']), ignoreIDs: new Set()
      })).to.eql([]);
      expect(Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(),
        ignoreIDs: new Set(['p1'])
      })).to.eql([]);
    });

    it('rejects Plateau entities that have building:part', () => {
      const p = outline('p1', SQR, { 'building:part': 'yes', height: '12' }, SQR_CENTER);
      const o = osmBuilding('o1', SQR);
      const out = Rapid.findCandidates({
        plateauEntities: [p], osmEntities: [o],
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });
      expect(out).to.eql([]);
    });
  });

  // Regression: the mock helpers above expose a zero-arg `asGeoJSON()`, but the
  // real `osmWay.asGeoJSON(resolver)` requires a graph resolver and throws
  // without one. `findCandidates` must pass the correct resolver for each side
  // (Plateau graph for outlines, OSM graph for buildings), otherwise every
  // outline is silently skipped and zero candidates ever render.
  describe('findCandidates with real entities', () => {
    // Build a closed square way + its nodes in a real Graph.
    function realBuilding(idPrefix, coords, tags) {
      const nodes = coords.map((loc, i) =>
        Rapid.osmNode({ id: `${idPrefix}n${i}`, loc }));
      // Close the ring by reusing the first node as the last ref.
      const nodeIDs = nodes.map(n => n.id);
      nodeIDs.push(nodes[0].id);
      const way = Rapid.osmWay({ id: `${idPrefix}w`, tags, nodes: nodeIDs });
      return { way, entities: [...nodes, way] };
    }

    // Distinct corner locs (no repeated closing coord — the way closes by ref).
    const SQR_CORNERS = [[139.755, 35.679], [139.756, 35.679],
                         [139.756, 35.680], [139.755, 35.680]];
    const SQR_CENTER = [139.7555, 35.6795];

    it('finds a CANDIDATE using real osmWay.asGeoJSON(resolver)', () => {
      // `area=yes` forces `isArea()` true so `asGeoJSON` yields a Polygon here;
      // in the running app that comes from `osmAreaKeys` (loaded from presets),
      // which isn't populated in this unit-test context. The point of the test
      // is that `findCandidates` threads a graph resolver into `asGeoJSON`.
      const p = realBuilding('p', SQR_CORNERS, { building: 'yes', area: 'yes', height: '12' });
      p.way.representativePoint = SQR_CENTER;
      const o = realBuilding('o', SQR_CORNERS, { building: 'yes', area: 'yes' });

      const plateauGraph = new Rapid.Graph(p.entities);
      const osmGraph = new Rapid.Graph(o.entities);

      const out = Rapid.findCandidates({
        plateauEntities: [p.way], osmEntities: [o.way],
        plateauGraph, osmGraph,
        transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
      });

      expect(out).to.have.lengthOf(1);
      expect(out[0].state).to.equal('CANDIDATE');
      expect(out[0].missingTags).to.eql(['height']);
    });
  });
});
