describe('UiRapidInspector', () => {
  let inspector;

  class MockContext {
    constructor() {
      this.systems = {
        l10n: { t: (key) => key, isRTL: () => false, on: () => {} },
        rapid: { taskExtent: null, acceptIDs: new Set() },
        urlhash: { getParam: () => null }
      };
      this.services = { plateau: { isAddBlocked: () => false } };
    }
    container() { return d3.select('body'); }
  }

  beforeEach(() => {
    inspector = new Rapid.UiRapidInspector(new MockContext());
  });


  it('returns null when nothing blocks adding', () => {
    inspector.datum = { __service__: 'plateau' };
    expect(inspector.isAcceptFeatureDisabled()).to.be.null;
  });

  it('blocks a Plateau candidate while the OSM layer is switched off', () => {
    inspector.context.services.plateau.isAddBlocked = () => true;
    inspector.datum = { __service__: 'plateau' };
    expect(inspector.isAcceptFeatureDisabled()).to.eql('osm-layer-off');
  });

  it('leaves other datasets alone while the OSM layer is switched off', () => {
    inspector.context.services.plateau.isAddBlocked = () => true;
    inspector.datum = { __service__: 'mapwithai' };
    expect(inspector.isAcceptFeatureDisabled()).to.be.null;
  });

  it('blocks a Plateau candidate before the poweruser bypass', () => {
    // 追加できる数の上限を外している利用者でも、材料が無い状態では追加させない。
    inspector.context.services.plateau.isAddBlocked = () => true;
    inspector.context.systems.urlhash.getParam = () => 'true';
    inspector.datum = { __service__: 'plateau' };
    expect(inspector.isAcceptFeatureDisabled()).to.eql('osm-layer-off');
  });

  it('reports the accept limit once it is reached', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add('w' + i);
    inspector.context.systems.rapid.acceptIDs = ids;
    inspector.datum = { __service__: 'mapwithai' };
    expect(inspector.isAcceptFeatureDisabled()).to.eql('limit');
  });

  it('returns null when the plateau service is not installed', () => {
    inspector.context.services = {};
    inspector.datum = { __service__: 'plateau' };
    expect(inspector.isAcceptFeatureDisabled()).to.be.null;
  });
});
