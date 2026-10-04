describe('HeightTransferMode', () => {

  // A minimal stand-in for `EditSystem` exposing the same public surface that
  // `HeightTransferMode` relies on: `staging`, `intersects`, `perform`,
  // `commit`, `undo`/`redo`, `history`/`index`, and the `stablechange` event
  // (the event EditSystem actually emits — there is no 'undone'/'redone').
  class MockEditor {
    constructor() {
      this.history = [{}];   // base edit occupies index 0, like the real EditSystem
      this.index = 0;
      this._handlers = {};
      this.performCalls = [];
      this.commitCalls = [];
    }
    get staging() { return { graph: {} }; }
    intersects() { return []; }
    perform(action) { this.performCalls.push(action); }
    commit(options = {}) {
      this.history = this.history.slice(0, this.index + 1);
      this.history.push({ annotation: options.annotation });
      this.index++;
      this.commitCalls.push(options);
      this._emit('stablechange');
    }
    undo() {
      if (this.index > 0) {
        this.index--;
        this._emit('stablechange');
      }
    }
    redo() {
      if (this.index < this.history.length - 1) {
        this.index++;
        this._emit('stablechange');
      }
    }
    on(event, fn) {
      (this._handlers[event] = this._handlers[event] || []).push(fn);
      return this;
    }
    off(event, fn) {
      if (this._handlers[event]) {
        this._handlers[event] = this._handlers[event].filter(h => h !== fn);
      }
      return this;
    }
    _emit(event) {
      (this._handlers[event] || []).forEach(fn => fn());
    }
  }


  class MockMap {
    constructor() {
      this._handlers = {};
      this._extent = { min: [139.74, 35.67], max: [139.76, 35.69] };
    }
    extent() { return this._extent; }
    on(event, fn) {
      (this._handlers[event] = this._handlers[event] || []).push(fn);
      return this;
    }
    off(event, fn) {
      if (this._handlers[event]) {
        this._handlers[event] = this._handlers[event].filter(h => h !== fn);
      }
      return this;
    }
    _emit(event) {
      (this._handlers[event] || []).forEach(fn => fn());
    }
  }


  function makePlateau(entities = []) {
    return {
      getAvailableDatasets: () => [{ id: 'plateauJapan' }],
      getData: () => entities
    };
  }


  function makeContext(overrides = {}) {
    const keybinding = {
      registered: [],
      on(keys, handler) { this.registered.push({ keys, handler }); return this; },
      off(keys) { this.registered = this.registered.filter(r => r.keys !== keys); return this; }
    };
    const context = {
      services: { plateau: makePlateau([]) },
      systems: {
        editor: new MockEditor(),
        map: new MockMap(),
        rapid: { acceptIDs: new Set(), ignoreIDs: new Set() },
        gfx: { immediateRedrawCalls: 0, immediateRedraw() { this.immediateRedrawCalls++; } },
        l10n: { t: (id) => id }
      },
      _selectedIDs: [],
      keybinding() { return keybinding; },
      selectedIDs() { return this._selectedIDs; },
      _handlers: {},
      on(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); return this; },
      off(ev, fn) { if (this._handlers[ev]) this._handlers[ev] = this._handlers[ev].filter(h => h !== fn); return this; },
      _emit(ev, ...args) { (this._handlers[ev] || []).forEach(fn => fn(...args)); }
    };
    return Object.assign(context, overrides);
  }


  function makeCandidate(overrides = {}) {
    return Object.assign({
      plateauFeature: { id: 'p1', tags: { height: '12', ele: '45' } },
      osmFeature: { id: 'w1' },
      kind: 'outline_to_building',
      state: 'CANDIDATE',
      missingTags: ['height', 'ele'],
      conflictingTags: [],
      matchingTags: [],
      ratio: 1.0
    }, overrides);
  }


  it('starts inactive with empty state', () => {
    const mode = new Rapid.HeightTransferMode(makeContext());
    expect(mode.active).to.equal(false);
    expect(mode.candidates).to.eql([]);
    expect(mode.transferredIDs.size).to.equal(0);
  });


  it('activate() computes candidates and emits change', () => {
    const context = makeContext();
    const mode = new Rapid.HeightTransferMode(context);
    const spy = sinon.spy();
    mode.on('change', spy);

    mode.activate();

    expect(mode.active).to.equal(true);
    expect(spy.called).to.equal(true);
  });


  it('activate() requests an immediate redraw so the dots paint at once', () => {
    // The renderer is on-demand: without an explicit redraw, the candidate-dot
    // layer isn't repainted until some other event triggers a redraw, so the
    // dots appear seconds after the mode is toggled on.
    const context = makeContext();
    const mode = new Rapid.HeightTransferMode(context);

    mode.activate();

    expect(context.systems.gfx.immediateRedrawCalls).to.be.greaterThan(0);
  });


  it('deactivate() requests an immediate redraw so the dots clear at once', () => {
    const context = makeContext();
    const mode = new Rapid.HeightTransferMode(context);
    mode.activate();
    context.systems.gfx.immediateRedrawCalls = 0;   // reset after activate

    mode.deactivate();

    expect(context.systems.gfx.immediateRedrawCalls).to.be.greaterThan(0);
  });


  it('binds the apply shortcut only while a candidate building is selected', () => {
    const context = makeContext();
    const mode = new Rapid.HeightTransferMode(context);
    mode.activate();
    mode.candidates = [makeCandidate()];   // 'w1' is a CANDIDATE

    // No selection yet -> not bound (so it never clobbers Rapid's own `A`).
    expect(context.keybinding().registered.length).to.equal(0);

    // Select the candidate building -> bound.
    context._selectedIDs = ['w1'];
    context._emit('modechange');
    expect(context.keybinding().registered.length).to.equal(1);

    // Select something else -> unbound again.
    context._selectedIDs = ['w999'];
    context._emit('modechange');
    expect(context.keybinding().registered.length).to.equal(0);
  });


  it('the apply shortcut applies the selected candidate building', () => {
    const context = makeContext();
    const mode = new Rapid.HeightTransferMode(context);
    mode.activate();
    mode.candidates = [makeCandidate()];   // osmFeature.id 'w1', state CANDIDATE
    context._selectedIDs = ['w1'];
    context._emit('modechange');           // selection changed -> binds the shortcut

    context.keybinding().registered[0].handler({ preventDefault() {} });

    expect(context.systems.editor.performCalls.length).to.equal(1);
  });


  it('binds the shortcut for an AREA_MISMATCH that still has tags to add', () => {
    const context = makeContext();
    const mode = new Rapid.HeightTransferMode(context);
    mode.activate();
    // The section offers an Apply button whenever there are tags to add, so the
    // shortcut has to follow the same rule or the button works and the key doesn't.
    mode.candidates = [makeCandidate({ state: 'AREA_MISMATCH', ratio: 4.0 })];
    context._selectedIDs = ['w1'];
    context._emit('modechange');

    expect(context.keybinding().registered.length).to.equal(1);

    context.keybinding().registered[0].handler({ preventDefault() {} });
    expect(context.systems.editor.performCalls.length).to.equal(1);
  });


  it('does not bind the shortcut for a candidate with nothing to add', () => {
    const context = makeContext();
    const mode = new Rapid.HeightTransferMode(context);
    mode.activate();
    mode.candidates = [makeCandidate({
      state: 'CONFLICT',
      missingTags: [],
      conflictingTags: [{ key: 'height', osmValue: '10', plateauValue: '12' }]
    })];
    context._selectedIDs = ['w1'];
    context._emit('modechange');

    expect(context.keybinding().registered.length).to.equal(0);
  });


  it('does not bind the shortcut when the selection has no candidate', () => {
    const context = makeContext();
    const mode = new Rapid.HeightTransferMode(context);
    mode.activate();
    mode.candidates = [makeCandidate()];   // 'w1'
    context._selectedIDs = ['w999'];       // a different building
    context._emit('modechange');

    expect(context.keybinding().registered.length).to.equal(0);
  });


  it('deactivate() unbinds the apply shortcut', () => {
    const context = makeContext();
    const mode = new Rapid.HeightTransferMode(context);
    mode.activate();
    mode.candidates = [makeCandidate()];
    context._selectedIDs = ['w1'];
    context._emit('modechange');
    expect(context.keybinding().registered.length).to.equal(1);

    mode.deactivate();
    expect(context.keybinding().registered.length).to.equal(0);
  });


  it('deactivate() clears candidates and emits change', () => {
    const mode = new Rapid.HeightTransferMode(makeContext());
    mode.activate();
    mode.candidates = [makeCandidate()];   // simulate a non-empty candidate list

    mode.deactivate();

    expect(mode.active).to.equal(false);
    expect(mode.candidates).to.eql([]);
  });


  it('apply() dispatches actionTransferPlateauTags, commits it, and updates transferredIDs', () => {
    const context = makeContext();
    const mode = new Rapid.HeightTransferMode(context);
    mode.activate();
    const candidate = makeCandidate();

    mode.apply(candidate);

    expect(context.systems.editor.performCalls.length).to.equal(1);
    const actionArg = context.systems.editor.performCalls[0];
    expect(typeof actionArg).to.equal('function');
    expect(actionArg.actionName).to.equal('transfer_plateau_tags');

    // The edit must be committed (not left staged) or undo/redo would have nothing to act on.
    expect(context.systems.editor.commitCalls.length).to.equal(1);

    expect(mode.transferredIDs.has('p1')).to.equal(true);
    expect(mode.candidates.includes(candidate)).to.equal(false);
  });


  it('apply() only forwards missing tags that actually have a Plateau value', () => {
    const context = makeContext();
    const mode = new Rapid.HeightTransferMode(context);
    mode.activate();
    // 'ele' is listed as missing but the Plateau feature has no value for it.
    const candidate = makeCandidate({
      plateauFeature: { id: 'p2', tags: { height: '9' } },
      missingTags: ['height', 'ele']
    });

    mode.apply(candidate);

    const action = context.systems.editor.performCalls[0];
    const graph = new Rapid.Graph([ Rapid.osmWay({ id: 'w1', tags: {} }) ]);
    const g2 = action(graph);
    expect(g2.entity('w1').tags).to.eql({ height: '9' });
  });


  it('apply() emits the transferred event', () => {
    const context = makeContext();
    const mode = new Rapid.HeightTransferMode(context);
    mode.activate();
    const spy = sinon.spy();
    mode.on('transferred', spy);

    mode.apply(makeCandidate());

    expect(spy.called).to.equal(true);
  });


  it('apply() records the dataset on the annotation so the changeset gets a source', () => {
    // Rapid#45: 建物を追加する経路は annotation に dataUsed を付けるが、タグ転記の
    // 経路は付けていなかった。変更セットの source は EditSystem がこの値から
    // 組み立てるので、無いと MLIT_PLATEAU も RapiD_Plateau_JP も source_ref も付かない。
    const context = makeContext();
    context.systems.rapid.datasets = new Map([
      ['plateauJapan', { id: 'plateauJapan', dataUsed: ['osmf.jp', 'Plateau Buildings'] }]
    ]);
    const mode = new Rapid.HeightTransferMode(context);
    mode.activate();

    mode.apply(makeCandidate({
      plateauFeature: { id: 'p1', tags: { height: '12' }, __datasetid__: 'plateauJapan' }
    }));

    const annotation = context.systems.editor.commitCalls[0].annotation;
    expect(annotation.dataUsed).to.eql(['osmf.jp', 'Plateau Buildings']);
  });


  it('apply() falls back to the dataset id when the catalog has no entry', () => {
    const context = makeContext();
    const mode = new Rapid.HeightTransferMode(context);
    mode.activate();

    mode.apply(makeCandidate({
      plateauFeature: { id: 'p1', tags: { height: '12' }, __datasetid__: 'plateauJapan' }
    }));

    const annotation = context.systems.editor.commitCalls[0].annotation;
    expect(annotation.dataUsed).to.eql(['plateauJapan']);
  });


  it('apply() fires change exactly once per call', () => {
    const context = makeContext();
    const mode = new Rapid.HeightTransferMode(context);
    mode.activate();

    let changeCount = 0;
    mode.on('change', () => { changeCount++; });

    mode.apply(makeCandidate());

    expect(changeCount).to.equal(1);
  });


  it('recomputes candidates when the viewport moves (debounced)', async () => {
    const context = makeContext();
    const getDatasetsSpy = sinon.spy(context.services.plateau, 'getAvailableDatasets');
    const mode = new Rapid.HeightTransferMode(context);

    mode.activate();
    expect(getDatasetsSpy.callCount).to.equal(1);   // initial recompute from activate()

    // Simulate a burst of viewport-change notifications
    mode.onViewportChange();
    mode.onViewportChange();
    mode.onViewportChange();

    // Nothing should have run yet -- still debouncing
    expect(getDatasetsSpy.callCount).to.equal(1);

    await new Promise(resolve => { setTimeout(resolve, 250); });

    // The burst of 3 collapses into exactly one additional recompute
    expect(getDatasetsSpy.callCount).to.equal(2);
  });


  it('removes id from transferredIDs on undo and restores it on redo', () => {
    const context = makeContext();
    const mode = new Rapid.HeightTransferMode(context);
    mode.activate();
    mode.apply(makeCandidate());
    expect(mode.transferredIDs.has('p1')).to.equal(true);

    context.systems.editor.undo();
    expect(mode.transferredIDs.has('p1')).to.equal(false);

    context.systems.editor.redo();
    expect(mode.transferredIDs.has('p1')).to.equal(true);
  });


  it('resyncs transferredIDs from history when reactivated after an undo while inactive', () => {
    const context = makeContext();
    const mode = new Rapid.HeightTransferMode(context);
    mode.activate();
    mode.apply(makeCandidate());
    mode.deactivate();

    // No listeners are attached while inactive, so this undo can't reach the mode directly.
    context.systems.editor.undo();

    mode.activate();   // must resync transferredIDs from history, not trust stale state
    expect(mode.transferredIDs.has('p1')).to.equal(false);
  });


  describe('choices', () => {
    // OSM に height=10 があり、PLATEAU は height=12、ele=45 を持つ建物。
    // height は食い違うタグ、ele は OSM に無いタグになる。
    function mixedCandidate(overrides = {}) {
      return makeCandidate(Object.assign({
        plateauFeature: { id: 'p1', tags: { height: '12', ele: '45' } },
        state: 'CANDIDATE',
        missingTags: ['ele'],
        conflictingTags: [{ key: 'height', osmValue: '10', plateauValue: '12' }]
      }, overrides));
    }

    function conflictCandidate(overrides = {}) {
      return mixedCandidate(Object.assign({ state: 'CONFLICT', missingTags: [] }, overrides));
    }

    function enabledMode(context) {
      const mode = new Rapid.HeightTransferMode(context);
      sinon.stub(mode, 'overwriteEnabled').returns(true);
      mode.activate();
      return mode;
    }

    function applyTo(context, tags) {
      const action = context.systems.editor.performCalls[0];
      const graph = new Rapid.Graph([ Rapid.osmWay({ id: 'w1', tags: tags }) ]);
      return action(graph).entity('w1').tags;
    }

    it('is disabled without the URL parameter', () => {
      const mode = new Rapid.HeightTransferMode(makeContext());
      mode.activate();
      expect(mode.overwriteEnabled()).to.equal(false);
      expect(mode.getOverwriteBlock(mixedCandidate())).to.equal('disabled');
    });

    it('allows overwriting a matched building with no height warning', () => {
      const mode = enabledMode(makeContext());
      expect(mode.getOverwriteBlock(mixedCandidate())).to.equal(null);
    });

    it('blocks overwriting when the Plateau building has a height warning', () => {
      const mode = enabledMode(makeContext());
      const cand = mixedCandidate({
        plateauFeature: { id: 'p1', tags: { height: '0.5', ele: '45' }, heightWarnings: ['absolute'] }
      });
      expect(mode.getOverwriteBlock(cand)).to.equal('warning');
    });

    it('reports the area mismatch before the height warning', () => {
      const mode = enabledMode(makeContext());
      const cand = mixedCandidate({
        state: 'AREA_MISMATCH',
        ratio: 4.0,
        plateauFeature: { id: 'p1', tags: { height: '0.5', ele: '45' }, heightWarnings: ['absolute'] }
      });
      expect(mode.getOverwriteBlock(cand)).to.equal('area');
    });

    it('starts with Plateau for a missing tag and OSM for a conflicting tag', () => {
      const mode = enabledMode(makeContext());
      const cand = mixedCandidate();
      expect(mode.getChoice(cand, 'ele')).to.equal('plateau');
      expect(mode.getChoice(cand, 'height')).to.equal('osm');
      expect(mode.getChoice(cand, 'building:levels')).to.equal(null);
    });

    it('always adds missing tags without the URL parameter', () => {
      const mode = new Rapid.HeightTransferMode(makeContext());
      mode.activate();
      const cand = mixedCandidate();
      mode.setChoice(cand, 'ele', 'osm');
      expect(mode.getChoice(cand, 'ele')).to.equal('plateau');
      expect(mode._choices.size).to.equal(0);
    });

    it('keeps OSM for a conflicting tag on a building that cannot be overwritten', () => {
      const mode = enabledMode(makeContext());
      mode.setChoice(mixedCandidate(), 'height', 'plateau');

      // 同じ PLATEAU の建物に、あとから高さの警告が付いた場合。
      const warned = mixedCandidate({
        plateauFeature: { id: 'p1', tags: { height: '12', ele: '45' }, heightWarnings: ['absolute'] }
      });
      expect(mode.getChoice(warned, 'height')).to.equal('osm');
      // OSM に無いタグは、警告があっても選べる。
      mode.setChoice(warned, 'ele', 'osm');
      expect(mode.getChoice(warned, 'ele')).to.equal('osm');
    });

    it('remembers a choice and emits change', () => {
      const mode = enabledMode(makeContext());
      const cand = mixedCandidate();
      const spy = sinon.spy();
      mode.on('change', spy);

      mode.setChoice(cand, 'height', 'plateau');
      mode.setChoice(cand, 'ele', 'osm');

      expect(mode.getChoice(cand, 'height')).to.equal('plateau');
      expect(mode.getChoice(cand, 'ele')).to.equal('osm');
      expect(spy.callCount).to.equal(2);
    });

    it('ignores choices it cannot honour', () => {
      const mode = enabledMode(makeContext());
      const area = mixedCandidate({ state: 'AREA_MISMATCH', ratio: 4.0 });
      const spy = sinon.spy();
      mode.on('change', spy);

      mode.setChoice(area, 'height', 'plateau');                  // 書き換えられない建物の食い違うタグ
      mode.setChoice(mixedCandidate(), 'building:levels', 'plateau');   // 表に出ないタグ
      mode.setChoice(mixedCandidate(), 'height', 'both');         // 知らない値

      expect(mode._choices.size).to.equal(0);
      expect(spy.called).to.equal(false);
    });

    it('forgets the choices of a building that left the candidates', () => {
      const mode = enabledMode(makeContext());
      const cand = mixedCandidate();
      mode.candidates = [cand];
      mode.setChoice(cand, 'height', 'plateau');
      expect(mode._choices.size).to.equal(1);

      mode._recompute();   // the mocked plateau service returns no buildings

      expect(mode._choices.size).to.equal(0);
    });

    it('forgets every choice when the mode is turned off', () => {
      const mode = enabledMode(makeContext());
      const cand = mixedCandidate();
      mode.setChoice(cand, 'height', 'plateau');

      mode.deactivate();

      expect(mode._choices.size).to.equal(0);
    });

    it('carries a choice over by tag name when the tag changes from missing to conflicting', () => {
      const mode = enabledMode(makeContext());
      mode.setChoice(mixedCandidate(), 'ele', 'osm');

      // 利用者が OSM の ele に手で 5 を入れたあと、候補が計算し直された場合。
      const recomputed = mixedCandidate({
        missingTags: [],
        conflictingTags: [
          { key: 'height', osmValue: '10', plateauValue: '12' },
          { key: 'ele', osmValue: '5', plateauValue: '45' }
        ]
      });
      expect(mode.getChoice(recomputed, 'ele')).to.equal('osm');
    });

    it('apply() adds and replaces only what is set to Plateau', () => {
      const context = makeContext();
      const mode = enabledMode(context);
      const cand = mixedCandidate();
      mode.setChoice(cand, 'height', 'plateau');
      mode.setChoice(cand, 'ele', 'osm');

      mode.apply(cand);

      expect(applyTo(context, { building: 'yes', height: '10' }))
        .to.eql({ building: 'yes', height: '12' });
      expect(context.systems.editor.commitCalls[0].annotation.overwrittenKeys).to.eql(['height']);
      expect(mode._choices.size).to.equal(0);
    });

    it('apply() only adds when overwriting became unavailable after choosing', () => {
      const context = makeContext();
      const mode = enabledMode(context);
      const cand = mixedCandidate();
      mode.setChoice(cand, 'height', 'plateau');
      mode.overwriteEnabled.returns(false);   // the URL parameter was removed

      mode.apply(cand);

      expect(applyTo(context, { building: 'yes', height: '10' }))
        .to.eql({ building: 'yes', height: '10', ele: '45' });
      expect(context.systems.editor.commitCalls[0].annotation.overwrittenKeys).to.eql([]);
    });

    it('hasWorkToApply() is false only when every row is set to OSM', () => {
      const mode = enabledMode(makeContext());
      const cand = mixedCandidate();
      expect(mode.hasWorkToApply(cand)).to.equal(true);    // ele は最初 Plateau

      mode.setChoice(cand, 'ele', 'osm');
      expect(mode.hasWorkToApply(cand)).to.equal(false);   // height は最初 OSM

      mode.setChoice(cand, 'height', 'plateau');
      expect(mode.hasWorkToApply(cand)).to.equal(true);
    });

    it('binds the apply shortcut once a Plateau value is chosen, and unbinds it when switched back', () => {
      const context = makeContext();
      const mode = enabledMode(context);
      const cand = conflictCandidate();
      mode.candidates = [cand];
      context._selectedIDs = ['w1'];
      context._emit('modechange');
      expect(context.keybinding().registered.length).to.equal(0);

      mode.setChoice(cand, 'height', 'plateau');
      expect(context.keybinding().registered.length).to.equal(1);

      mode.setChoice(cand, 'height', 'osm');
      expect(context.keybinding().registered.length).to.equal(0);
    });
  });


  describe('getCandidateForOSM', () => {
    it('returns null when the system is inactive', () => {
      const mode = new Rapid.HeightTransferMode(makeContext());
      mode.active = false;
      mode.candidates = [{ osmFeature: { id: 'w1' }, state: 'CANDIDATE' }];
      expect(mode.getCandidateForOSM('w1')).to.equal(null);
    });

    it('returns the matching candidate when active', () => {
      const mode = new Rapid.HeightTransferMode(makeContext());
      mode.active = true;
      const cand = { osmFeature: { id: 'w1' }, state: 'CANDIDATE' };
      mode.candidates = [cand, { osmFeature: { id: 'w2' }, state: 'COVERED' }];
      expect(mode.getCandidateForOSM('w1')).to.equal(cand);
    });

    it('returns null when no candidate matches the id', () => {
      const mode = new Rapid.HeightTransferMode(makeContext());
      mode.active = true;
      mode.candidates = [{ osmFeature: { id: 'w1' }, state: 'CANDIDATE' }];
      expect(mode.getCandidateForOSM('w999')).to.equal(null);
    });
  });

});
