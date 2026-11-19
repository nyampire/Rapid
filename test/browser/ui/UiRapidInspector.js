describe('UiRapidInspector', () => {
  let inspector;

  class MockScene {
    constructor() { this._handlers = {}; }
    on(type, fn) { (this._handlers[type] ??= []).push(fn); return this; }
    emit(type) { for (const fn of this._handlers[type] ?? []) fn(); }
  }

  class MockEmitter {
    constructor() {
      const handlers = {};
      this.on = (type, fn) => { (handlers[type] ??= []).push(fn); return this; };
      this.emit = (type) => { for (const fn of handlers[type] ?? []) fn(); };
    }
  }

  class MockContext {
    constructor() {
      this.systems = {
        l10n: { t: (key) => (key === 'shortcuts.command.next_plateau_candidate.key' ? '4' : key), isRTL: () => false, on: () => {} },
        rapid: { taskExtent: null, acceptIDs: new Set() },
        urlhash: { getParam: () => null },
        gfx: { scene: new MockScene() },
        map: { centerEase: (loc) => { this.eased.push(loc); }, ...new MockEmitter() }
      };
      this.eased = [];
      this.entered = [];
      this.mode = { id: 'browse' };
      this.viewport = { centerLoc: () => [0, 0] };
      this.services = { plateau: { isAddBlocked: () => false } };
    }
    container() { return d3.select('body'); }
    enter(modeID, options) { this.entered.push({ modeID, options }); }
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

  it('ignores the accept limit while working on a task', () => {
    // タスク作業中は「追加できる数の上限」を外す仕様 (isAcceptFeatureDisabled 内
    // `if (rapid.taskExtent) return null;`)。上限に達していても non-PLATEAU は
    // ブロックしない。
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add('w' + i);
    inspector.context.systems.rapid.acceptIDs = ids;
    inspector.context.systems.rapid.taskExtent = {};
    inspector.datum = { __service__: 'mapwithai' };
    expect(inspector.isAcceptFeatureDisabled()).to.be.null;
  });

  it('still blocks a Plateau candidate while working on a task, when the OSM layer is off', () => {
    // タスク作業中でも、重なりを確かめる材料が無い理由 ('osm-layer-off') は
    // taskExtent のバイパスより先に見るため効いたままになる。
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add('w' + i);
    inspector.context.systems.rapid.acceptIDs = ids;
    inspector.context.systems.rapid.taskExtent = {};
    inspector.context.services.plateau.isAddBlocked = () => true;
    inspector.datum = { __service__: 'plateau' };
    expect(inspector.isAcceptFeatureDisabled()).to.eql('osm-layer-off');
  });

  it('re-renders when the scene emits a layerchange event while a feature is selected', () => {
    inspector.datum = { __service__: 'plateau' };
    let calls = 0;
    inspector.render = () => { calls++; };
    inspector.context.systems.gfx.scene.emit('layerchange');
    expect(calls).to.eql(1);
  });

  it('does not re-render on layerchange when nothing is selected', () => {
    // サイドバーがリセットされたあとも `$parent` は detached な DOM を
    // 指したまま残るため、`render()` 側の `$parent` チェックでは弾けない。
    // `this.datum` が無いあいだは描き直す意味が無い。
    inspector.datum = null;
    let calls = 0;
    inspector.render = () => { calls++; };
    inspector.context.systems.gfx.scene.emit('layerchange');
    expect(calls).to.eql(0);
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

  describe('#selectNextCandidate', () => {
    // x 座標だけで位置を決める 1 辺 0.1 度の四角の候補。外形の中心は (x + 0.05, 0.05)。
    function makeCandidate(id, x) {
      const nodes = [[x, 0], [x + 0.1, 0], [x + 0.1, 0.1], [x, 0.1]]
        .map((loc, i) => Rapid.osmNode({ id: `${id}-n${i}`, loc }));
      const way = Rapid.osmWay({ id, nodes: [...nodes.map(n => n.id), nodes[0].id], tags: { building: 'yes' } });
      const graph = new Rapid.Graph([...nodes, way]);
      Object.assign(way, { __service__: 'plateau', __datasetid__: 'plateauJapan' });
      return { entity: way, graph, datasetID: 'plateauJapan', memberIDs: new Set([id]) };
    }

    let near, mid, far, far2, ctx;
    beforeEach(() => {
      near = makeCandidate('w1', 1);
      mid = makeCandidate('w2', 5);
      far = makeCandidate('w3', 9);
      far2 = makeCandidate('w4', 14);
      ctx = inspector.context;
      inspector._candidates = () => [far, mid, near, far2];
    });
    afterEach(() => d3.selectAll('.test-input').remove());

    it('selects the nearest candidate and centers the map on it', () => {
      expect(inspector.selectNextCandidate()).to.be.true;
      expect(ctx.entered).to.have.lengthOf(1);
      expect(ctx.entered[0].modeID).to.eql('select');
      expect([...ctx.entered[0].options.selection.keys()]).to.eql(['w1']);
      expect(ctx.eased).to.have.lengthOf(1);
      expect(ctx.eased[0][0]).to.be.closeTo(1.05, 1e-9);
    });

    it('moves from the selected Plateau candidate to the nearest other one', () => {
      // 地図の中央 (0, 0) からなら near だが、far を選んでいるので、そこから近い mid になる。
      inspector.datum = far.entity;
      ctx.services.plateau.graph = () => far.graph;
      expect(inspector.selectNextCandidate()).to.be.true;
      expect([...ctx.entered[0].options.selection.keys()]).to.eql(['w2']);
    });

    it('does not move when the only candidate is the selected one', () => {
      inspector._candidates = () => [mid];
      inspector.datum = mid.entity;
      ctx.services.plateau.graph = () => mid.graph;
      expect(inspector.selectNextCandidate()).to.be.false;
      expect(ctx.entered).to.have.lengthOf(0);
    });

    it('does not move while the OSM layer is switched off', () => {
      ctx.services.plateau.isAddBlocked = () => true;
      expect(inspector.selectNextCandidate()).to.be.false;
      expect(ctx.entered).to.have.lengthOf(0);
    });

    it('starts from the map center when a non-Plateau feature is selected', () => {
      ctx.viewport.centerLoc = () => [9.05, 0.05];
      inspector.datum = { __service__: 'esri', id: 'x1' };
      expect(inspector.selectNextCandidate()).to.be.true;
      expect([...ctx.entered[0].options.selection.keys()]).to.eql(['w3']);
    });

    it('works in select modes', () => {
      ctx.mode = { id: 'select-osm' };
      expect(inspector.selectNextCandidate()).to.be.true;
      ctx.mode = { id: 'select' };
      expect(inspector.selectNextCandidate()).to.be.true;
      expect(ctx.entered).to.have.lengthOf(2);
    });

    it('does nothing in modes other than browse and select', () => {
      for (const id of ['draw-area', 'draw-line', 'move', 'rotate', 'save', 'height-transfer', 'add-point', 'add-note', 'drag-node']) {
        ctx.mode = { id };
        expect(inspector.selectNextCandidate(), id).to.be.false;
      }
      expect(ctx.entered).to.have.lengthOf(0);
      expect(ctx.eased).to.have.lengthOf(0);
    });

    it('counts the remaining candidates on screen', () => {
      expect(inspector.remainingCandidateCount()).to.eql(4);
      expect(inspector.remainingCandidateCount('w2')).to.eql(3);
    });

    it('skips every member of the selected building when a part is selected', () => {
      const bldg = makeCandidate('w1', 1);
      const part = makeCandidate('w2', 2);
      bldg.memberIDs = new Set(['w1', 'w2', 'w3']);
      const other = makeCandidate('w9', 30);
      inspector._candidates = () => [bldg, other];
      inspector.datum = part.entity;
      ctx.services.plateau.graph = () => part.graph;
      expect(inspector.selectNextCandidate()).to.be.true;
      expect([...ctx.entered[0].options.selection.keys()]).to.eql(['w9']);
    });

    it('counts buildings, not parts, excluding the selected building', () => {
      const bldg = makeCandidate('w1', 1);
      bldg.memberIDs = new Set(['w1', 'w2', 'w3']);
      const other = makeCandidate('w9', 30);
      inspector._candidates = () => [bldg, other];
      expect(inspector.remainingCandidateCount('w2')).to.eql(1);
      expect(inspector.remainingCandidateCount()).to.eql(2);
    });

    it('does not react to 4 typed into a text field', () => {
      const input = document.createElement('input');
      input.className = 'test-input';
      document.body.appendChild(input);
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }));
      expect(ctx.entered).to.have.lengthOf(0);
    });

    it('reacts to 4 pressed on the document', () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }));
      expect(ctx.entered).to.have.lengthOf(1);
    });
  });


  describe('#renderNextCandidate', () => {
    function candidate(id) {
      return { entity: { id, __service__: 'plateau' }, graph: null, datasetID: 'plateauJapan', memberIDs: new Set([id]) };
    }
    function plateauDatum() {
      return { id: 'w1', __service__: 'plateau', __datasetid__: 'plateauJapan' };
    }
    let $body;
    beforeEach(() => {
      $body = d3.select('body').append('div').attr('class', 'test-body');
    });
    afterEach(() => d3.selectAll('.test-body').remove());

    it('renders nothing for a non-Plateau datum', () => {
      inspector.datum = { id: 'x1', __service__: 'esri' };
      inspector._candidates = () => [candidate('w2')];
      inspector.renderNextCandidate($body);
      expect($body.select('.rapid-inspector-next-candidate').empty()).to.be.true;
    });

    it('shows the label with the key and the remaining count, excluding the selected one', () => {
      inspector.datum = plateauDatum();
      inspector._candidates = () => [candidate('w1'), candidate('w2'), candidate('w3')];
      inspector.renderNextCandidate($body);
      expect($body.select('.choice-label').text()).to.contain('rapid_inspector.next_candidate.label (4)');
      expect($body.select('.rapid-inspector-next-candidate-count').text()).to.contain('rapid_inspector.next_candidate.remaining');
      expect($body.select('.choice-button').property('disabled')).to.be.false;
    });

    it('disables the button and shows the none text when nothing remains', () => {
      inspector.datum = plateauDatum();
      inspector._candidates = () => [candidate('w1')];
      inspector.renderNextCandidate($body);
      expect($body.select('.choice-button').property('disabled')).to.be.true;
      expect($body.select('.rapid-inspector-next-candidate-count').text()).to.eql('rapid_inspector.next_candidate.none');
    });

    it('refreshes the count when the map draws', () => {
      inspector.datum = plateauDatum();
      inspector._candidates = () => [candidate('w1'), candidate('w2')];
      inspector.$inspector = $body.append('div');
      inspector.$inspector.append('div').attr('class', 'body');
      inspector.renderNextCandidate(inspector.$inspector.select('.body'));
      expect(inspector.$inspector.select('.choice-button').property('disabled')).to.be.false;
      inspector._candidates = () => [candidate('w1')];
      inspector.context.systems.map.emit('draw');
      expect(inspector.$inspector.select('.choice-button').property('disabled')).to.be.true;
    });
  });


  describe('#renderHeightWarning', () => {
    function plateauDatum(extra = {}) {
      return Object.assign(
        Rapid.osmWay({ id: 'w1', tags: { building: 'yes', height: '0.5' }, nodes: [] }),
        { __service__: 'plateau', __datasetid__: 'plateauJapan' },
        extra
      );
    }

    afterEach(() => d3.selectAll('.test-body').remove());

    it('shows the warning above the tags for a building with a warning', () => {
      const datum = plateauDatum({ heightWarnings: ['absolute'] });
      inspector.context.services.plateau.graph = () => new Rapid.Graph([datum]);
      inspector.datum = datum;

      const $body = d3.select('body').append('div').attr('class', 'test-body');
      $body.append('div').attr('class', 'tag-info');
      inspector.renderHeightWarning($body);

      const $warning = $body.select('.plateau-height-warning');
      expect($warning.empty()).to.be.false;
      expect($warning.text()).to.contain('plateau_height_warning.title');
      expect($warning.text()).to.contain('plateau_height_warning.absolute');
      expect($warning.text()).to.contain('plateau_height_warning.advice');
      // タグ一覧より前に置く。
      expect($body.node().firstChild.classList.contains('plateau-height-warning')).to.be.true;
    });

    it('shows nothing for a building without a warning', () => {
      const datum = plateauDatum();
      inspector.context.services.plateau.graph = () => new Rapid.Graph([datum]);
      inspector.datum = datum;

      const $body = d3.select('body').append('div').attr('class', 'test-body');
      inspector.renderHeightWarning($body);

      expect($body.select('.plateau-height-warning').empty()).to.be.true;
    });

    it('does not stop the accept button', () => {
      inspector.datum = plateauDatum({ heightWarnings: ['absolute'] });
      expect(inspector.isAcceptFeatureDisabled()).to.be.null;
    });
  });
});
