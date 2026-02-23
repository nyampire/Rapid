describe('OvertureService', () => {
  let overture;

  class MockContext {
    constructor() {
      this.systems = {};
      this.services = {
        vectortile: {
          initAsync: () => Promise.resolve(),
          startAsync: () => Promise.resolve()
        }
      };
    }
  }

  beforeEach(() => {
    overture = new Rapid.OvertureService(new MockContext());
  });


  describe('#_geojsonToOSM', () => {
    const triangle = {
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]
      },
      properties: { id: '08f2649b-0733-b91f' }
    };

    it('sets source tag for Microsoft ML Buildings', () => {
      const entities = overture._geojsonToOSM(triangle, 'feat1', 'ml-buildings-overture', 'Microsoft ML Buildings');
      const way = entities[entities.length - 1];
      expect(way.tags.source).to.eql('microsoft/BuildingFootprints');
    });

    it('sets source tag for Google Open Buildings', () => {
      const entities = overture._geojsonToOSM(triangle, 'feat1', 'ml-buildings-overture', 'Google Open Buildings');
      const way = entities[entities.length - 1];
      expect(way.tags.source).to.eql('google/OpenBuildings');
    });

    it('sets source tag for Esri Community Maps', () => {
      const entities = overture._geojsonToOSM(triangle, 'feat1', 'esri-buildings', 'Esri Community Maps');
      const way = entities[entities.length - 1];
      expect(way.tags.source).to.eql('esri/CommunityMaps');
    });

    it('omits source tag for unknown geometry source', () => {
      const entities = overture._geojsonToOSM(triangle, 'feat1', 'esri-buildings', 'SomeOtherSource');
      const way = entities[entities.length - 1];
      expect(way.tags.source).to.be.undefined;
    });

    it('always tags building=yes', () => {
      const entities = overture._geojsonToOSM(triangle, 'feat1', 'esri-buildings', 'Esri Community Maps');
      const way = entities[entities.length - 1];
      expect(way.tags.building).to.eql('yes');
    });

    it('stores GERS ID from properties', () => {
      const entities = overture._geojsonToOSM(triangle, 'feat1', 'esri-buildings', 'Esri Community Maps');
      const way = entities[entities.length - 1];
      expect(way.__gersid__).to.eql('08f2649b-0733-b91f');
    });

    it('creates a closed way with correct node count', () => {
      const entities = overture._geojsonToOSM(triangle, 'feat1', 'esri-buildings', 'Esri Community Maps');
      const way = entities[entities.length - 1];
      // 3 unique coords → 3 nodes, way refs = [n0, n1, n2, n0]
      expect(way.nodes.length).to.eql(4);
      expect(way.nodes[0]).to.eql(way.nodes[3]);
    });

    it('returns null for missing geometry', () => {
      expect(overture._geojsonToOSM({}, 'feat1', 'esri-buildings', 'Esri Community Maps')).to.be.null;
    });

    it('returns null for too few coordinates', () => {
      const bad = { geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] } };
      expect(overture._geojsonToOSM(bad, 'feat1', 'esri-buildings', 'Esri Community Maps')).to.be.null;
    });
  });

});
