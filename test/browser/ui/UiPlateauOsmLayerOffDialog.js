describe('UiPlateauOsmLayerOffDialog', () => {
  const HIDDEN_KEY = 'plateau.osm-layer-off-dialog.hidden';
  let elem;

  class MockLocalizationSystem {
    constructor() { }
    initAsync()   { return Promise.resolve(); }
    t(id)         { return id; }
    tHtml(id)     { return id; }
  }

  class MockStorageSystem {
    constructor()      { this._map = new Map(); }
    getItem(k)         { return this._map.has(k) ? this._map.get(k) : null; }
    setItem(k, v)      { this._map.set(k, v); return true; }
    removeItem(k)      { this._map.delete(k); }
  }

  class MockPlateauService {
    constructor()      { this._handlers = new Map(); }
    on(type, fn) {
      if (!this._handlers.has(type)) this._handlers.set(type, []);
      this._handlers.get(type).push(fn);
      return this;
    }
    emit(type) {
      for (const fn of this._handlers.get(type) ?? []) fn();
    }
  }

  class MockContext {
    constructor() {
      this.systems = {
        l10n: new MockLocalizationSystem(),
        storage: new MockStorageSystem()
      };
      this.services = { plateau: new MockPlateauService() };
    }
    container() { return elem; }
  }

  let context;

  // `no-new` を避けるために関数の戻り値として返す。
  // この部品は組み立てた時点で `osmlayeroff` の購読を始めるので、戻り値は使わない試験が多い。
  function mountDialog(ctx) {
    return new Rapid.UiPlateauOsmLayerOffDialog(ctx);
  }

  beforeEach(() => {
    elem = d3.select('body')
      .append('div')
      .attr('class', 'plateau-dialog-wrap');
    context = new MockContext();
  });

  afterEach(() => {
    d3.select('.plateau-dialog-wrap').remove();
    d3.selectAll('.shaded').remove();
  });


  it('opens the dialog when the service announces the switched-off layer', () => {
    mountDialog(context);
    context.services.plateau.emit('osmlayeroff');
    expect(elem.selectAll('.modal').size()).to.equal(1);
  });

  it('shows the title, the reason and the checkbox', () => {
    mountDialog(context);
    context.services.plateau.emit('osmlayeroff');
    expect(elem.selectAll('.modal-section.header h3').text())
      .to.equal('plateau_conflation.osm_layer_off_title');
    expect(elem.selectAll('.modal-section.message-text p').text())
      .to.equal('plateau_conflation.osm_layer_off');
    expect(elem.selectAll('.plateau-dont-show-again input').size()).to.equal(1);
  });

  it('does not open the dialog when the user asked not to see it', () => {
    context.systems.storage.setItem(HIDDEN_KEY, 'true');
    mountDialog(context);
    context.services.plateau.emit('osmlayeroff');
    expect(elem.selectAll('.modal').size()).to.equal(0);
  });

  it('remembers the choice when the checkbox is ticked', () => {
    mountDialog(context);
    context.services.plateau.emit('osmlayeroff');
    const node = elem.select('.plateau-dont-show-again input').node();
    node.checked = true;
    happen.once(node, { type: 'change' });
    expect(context.systems.storage.getItem(HIDDEN_KEY)).to.equal('true');
  });

  it('forgets the choice when the checkbox is unticked', () => {
    mountDialog(context);
    context.services.plateau.emit('osmlayeroff');
    const node = elem.select('.plateau-dont-show-again input').node();
    node.checked = true;
    happen.once(node, { type: 'change' });
    node.checked = false;
    happen.once(node, { type: 'change' });
    expect(context.systems.storage.getItem(HIDDEN_KEY)).to.be.null;
  });
});
