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
    const context = {
      services: { plateau: makePlateau([]) },
      systems: {
        editor: new MockEditor(),
        map: new MockMap(),
        rapid: { acceptIDs: new Set(), ignoreIDs: new Set() },
        gfx: { immediateRedrawCalls: 0, immediateRedraw() { this.immediateRedrawCalls++; } }
      }
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
