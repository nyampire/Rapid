describe('UiRapidInspector', () => {
  let inspector;

  class MockScene {
    constructor() { this._handlers = {}; }
    on(type, fn) { (this._handlers[type] ??= []).push(fn); return this; }
    emit(type) { for (const fn of this._handlers[type] ?? []) fn(); }
  }

  class MockContext {
    constructor() {
      this.systems = {
        l10n: { t: (key) => key, isRTL: () => false, on: () => {} },
        rapid: { taskExtent: null, acceptIDs: new Set() },
        urlhash: { getParam: () => null },
        gfx: { scene: new MockScene() }
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

  it('re-renders when the scene emits a layerchange event', () => {
    let calls = 0;
    inspector.render = () => { calls++; };
    inspector.context.systems.gfx.scene.emit('layerchange');
    expect(calls).to.eql(1);
  });


  describe('#_osmLayerOffDisabled', () => {
    // renderChoice() では 'accept_only_this' (この地物のみ追加) にもこの理由を
    // 効かせる。'accept' と onClick (acceptFeature) を共有していて、クリックすれば
    // どのみちガードに当たるため、見た目も揃える。ただし件数上限 ('limit') は
    // 'accept' 専用の仕様なので、この関数は OSM レイヤー起因の理由だけを返す。

    it('returns "osm-layer-off" for a blocked Plateau candidate', () => {
      inspector.context.services.plateau.isAddBlocked = () => true;
      inspector.datum = { __service__: 'plateau' };
      expect(inspector._osmLayerOffDisabled()).to.eql('osm-layer-off');
    });

    it('returns null when the Plateau candidate is not blocked', () => {
      inspector.context.services.plateau.isAddBlocked = () => false;
      inspector.datum = { __service__: 'plateau' };
      expect(inspector._osmLayerOffDisabled()).to.be.null;
    });

    it('leaves other datasets alone while the OSM layer is switched off', () => {
      inspector.context.services.plateau.isAddBlocked = () => true;
      inspector.datum = { __service__: 'mapwithai' };
      expect(inspector._osmLayerOffDisabled()).to.be.null;
    });

    it('never reports the accept-count limit', () => {
      // isAcceptFeatureDisabled() は上限に達すると 'limit' を返すが、
      // _osmLayerOffDisabled() はその判定を持たない。'accept_only_this' に
      // 上限を効かせないための切り分けなので、混ざっていないことを確かめる。
      const ids = new Set();
      for (let i = 0; i < 50; i++) ids.add('w' + i);
      inspector.context.systems.rapid.acceptIDs = ids;
      inspector.datum = { __service__: 'mapwithai' };
      expect(inspector._osmLayerOffDisabled()).to.be.null;
    });
  });
});
