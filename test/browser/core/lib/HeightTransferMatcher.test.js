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

    it('returns AREA_MISMATCH when area ratio is outside 0.5..2.0', () => {
      // OSM building is 10x wider than Plateau
      const bigOsm = [[139.750, 35.679], [139.760, 35.679],
                      [139.760, 35.680], [139.750, 35.680], [139.750, 35.679]];
      const p = outline('p1', SQR, { height: '12' }, SQR_CENTER);
      const o = osmBuilding('o1', bigOsm);
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
});
