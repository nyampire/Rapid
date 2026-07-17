describe('UiHeightTransferPreview', () => {
  let body, container, mode;

  // Minimal stand-in for `HeightTransferMode` (Task 6): exposes the same
  // public surface `UiHeightTransferPreview` relies on -- `selectedCandidate`,
  // the 'change' event, `apply()`, and `clearSelection()` -- without needing a
  // real editor/map/rapid system behind it. Mirrors the MockMode pattern used
  // in test/browser/ui/tools/UiHeightTransferTool.test.js (Task 8).
  class MockMode {
    constructor() {
      this.selectedCandidate = null;
      this._handlers = {};
      this._applyCalls = [];
      this._clearSelectionCalls = 0;
    }
    apply(candidate) { this._applyCalls.push(candidate); }
    clearSelection() { this._clearSelectionCalls++; }
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

  class MockL10n {
    t(id) { return id; }
  }

  class MockContext {
    constructor(mode) {
      this.systems = {
        heightTransfer: mode,
        l10n: new MockL10n()
      };
    }
    container() { return container; }
  }


  beforeEach(() => {
    body = d3.select('body');
    container = body.append('div');
    mode = new MockMode();
  });

  afterEach(() => {
    container.remove();
  });


  it('renders nothing when no candidate is selected', () => {
    const context = new MockContext(mode);
    const panel = new Rapid.UiHeightTransferPreview(context);
    const $selection = container.append('div');
    panel.render($selection);

    expect($selection.node().querySelector('.height-transfer-preview')).to.be.null;
  });


  it('renders current tags and planned additions when a candidate is selected', () => {
    mode.selectedCandidate = {
      osmFeature: { id: 'w1', type: 'way', tags: { building: 'yes' } },
      plateauFeature: { id: 'p1', tags: { height: '12.5', ele: '45.2' } },
      missingTags: ['height', 'ele'],
      state: 'CANDIDATE'
    };

    const context = new MockContext(mode);
    const panel = new Rapid.UiHeightTransferPreview(context);
    const $selection = container.append('div');
    panel.render($selection);

    const html = $selection.node().innerHTML;
    expect(html).to.include('w1');
    expect(html).to.include('height');
    expect(html).to.include('12.5');
    expect(html).to.include('ele');
    expect(html).to.include('45.2');
  });


  it('Apply button dispatches mode.apply', () => {
    const candidate = {
      osmFeature: { id: 'w1', type: 'way', tags: { building: 'yes' } },
      plateauFeature: { id: 'p1', tags: { height: '12' } },
      missingTags: ['height'],
      state: 'CANDIDATE'
    };
    mode.selectedCandidate = candidate;

    const context = new MockContext(mode);
    const panel = new Rapid.UiHeightTransferPreview(context);
    const $selection = container.append('div');
    panel.render($selection);

    $selection.node().querySelector('.apply').click();

    expect(mode._applyCalls).to.eql([candidate]);
  });


  it('Cancel button clears selection', () => {
    mode.selectedCandidate = {
      osmFeature: { id: 'w1', type: 'way', tags: {} },
      plateauFeature: { id: 'p1', tags: {} },
      missingTags: [],
      state: 'CANDIDATE'
    };

    const context = new MockContext(mode);
    const panel = new Rapid.UiHeightTransferPreview(context);
    const $selection = container.append('div');
    panel.render($selection);

    $selection.node().querySelector('.cancel').click();

    expect(mode._clearSelectionCalls).to.eql(1);
  });


  it('for COVERED / CONFLICT / AREA_MISMATCH states, no Apply button is shown', () => {
    for (const state of ['COVERED', 'CONFLICT', 'AREA_MISMATCH']) {
      mode.selectedCandidate = {
        osmFeature: { id: 'w1', type: 'way', tags: {} },
        plateauFeature: { id: 'p1', tags: {} },
        missingTags: [], conflictingTags: [], matchingTags: [],
        state
      };

      const context = new MockContext(mode);
      const panel = new Rapid.UiHeightTransferPreview(context);
      const $selection = container.append('div');
      panel.render($selection);

      expect($selection.node().querySelector('.apply'), `state=${state}`).to.be.null;
    }
  });


  it('re-renders when the mode emits a change event', () => {
    const context = new MockContext(mode);
    const panel = new Rapid.UiHeightTransferPreview(context);
    const $selection = container.append('div');
    panel.render($selection);

    expect($selection.node().querySelector('.height-transfer-preview')).to.be.null;

    mode.selectedCandidate = {
      osmFeature: { id: 'w1', type: 'way', tags: {} },
      plateauFeature: { id: 'p1', tags: {} },
      missingTags: [],
      state: 'COVERED'
    };
    mode._emit('change');

    expect($selection.node().querySelector('.height-transfer-preview')).to.not.be.null;
  });


  it('does not throw when the heightTransfer system is missing', () => {
    const context = new MockContext(undefined);
    const panel = new Rapid.UiHeightTransferPreview(context);
    const $selection = container.append('div');
    expect(() => panel.render($selection)).to.not.throw();
  });

});
