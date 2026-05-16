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


  describe('#_getMembers', () => {
    it('extracts member references with type initial prefix and role', () => {
      const xml = new DOMParser().parseFromString(
        '<relation>' +
          '<member type="way" ref="100" role="outline"/>' +
          '<member type="way" ref="101" role="part"/>' +
          '<member type="node" ref="200" role=""/>' +
        '</relation>', 'text/xml'
      ).documentElement;
      const members = _service._getMembers(xml);
      expect(members).to.eql([
        { id: 'w100', type: 'way', role: 'outline' },
        { id: 'w101', type: 'way', role: 'part' },
        { id: 'n200', type: 'node', role: '' }
      ]);
    });

    it('handles missing role attribute as empty string', () => {
      const xml = new DOMParser().parseFromString(
        '<relation><member type="way" ref="42"/></relation>', 'text/xml'
      ).documentElement;
      const members = _service._getMembers(xml);
      expect(members[0].role).to.eql('');
    });
  });


  describe('#_parseRelation', () => {
    it('creates an osmRelation with tags and members', () => {
      const xml = new DOMParser().parseFromString(
        '<relation>' +
          '<member type="way" ref="10" role="outline"/>' +
          '<member type="way" ref="11" role="part"/>' +
          '<tag k="type" v="building"/>' +
          '<tag k="building" v="yes"/>' +
          '<tag k="height" v="8.4"/>' +
        '</relation>', 'text/xml'
      ).documentElement;
      const rel = _service._parseRelation(xml, 'r-100');
      expect(rel.id).to.eql('r-100');
      expect(rel.type).to.eql('relation');
      expect(rel.tags).to.eql({ type: 'building', building: 'yes', height: '8.4' });
      expect(rel.members).to.eql([
        { id: 'w10', type: 'way', role: 'outline' },
        { id: 'w11', type: 'way', role: 'part' }
      ]);
      expect(rel.visible).to.be.true;
    });
  });


  describe('#_parseEntity for relations', () => {
    // MapWithAIService が `<relation>` を取り込むかの統合テスト
    const dataset = {
      id: 'fbRoads-test',
      cache: { seen: new Set(), splitWays: new Map(), seenFirstNodeID: new Set() }
    };

    beforeEach(() => {
      dataset.cache.seen.clear();
      dataset.cache.splitWays.clear();
      dataset.cache.seenFirstNodeID.clear();
    });

    it('parses a relation element into an osmRelation entity', () => {
      const xml = new DOMParser().parseFromString(
        '<relation id="-100">' +
          '<member type="way" ref="-1" role="outline"/>' +
          '<member type="way" ref="-2" role="part"/>' +
          '<tag k="type" v="building"/>' +
          '<tag k="building" v="yes"/>' +
        '</relation>', 'text/xml'
      ).documentElement;
      const entity = _service._parseEntity(dataset, null, xml);
      expect(entity).to.not.be.null;
      expect(entity.id).to.eql('r-100');
      expect(entity.type).to.eql('relation');
      expect(entity.tags.type).to.eql('building');
      expect(entity.members).to.have.length(2);
      expect(dataset.cache.seen.has('r-100')).to.be.true;
    });

    it('skips duplicate relation IDs (cache.seen)', () => {
      const xml = new DOMParser().parseFromString(
        '<relation id="-100"><tag k="type" v="building"/></relation>', 'text/xml'
      ).documentElement;
      const first = _service._parseEntity(dataset, null, xml);
      const second = _service._parseEntity(dataset, null, xml);
      expect(first).to.not.be.null;
      expect(second).to.be.null;
    });
  });



});
