describe('uiSectionPlateauTags', () => {
  let section, wrap, applied;

  class MockL10n {
    isRTL() { return false; }
    t(id) { return id; }
    tHtml(id) { return id; }
  }

  class MockHeightTransfer {
    constructor(candidate) {
      this._cand = candidate;
      this._handlers = {};
      applied = [];
    }
    getCandidateForOSM(id) { return (this._cand && this._cand.osmFeature.id === id) ? this._cand : null; }
    apply(cand) { applied.push(cand); }
    setCandidate(cand) { this._cand = cand; }
    on(evt, fn) {
      (this._handlers[evt] = this._handlers[evt] || []).push(fn);
    }
    off(evt, fn) {
      if (!this._handlers[evt]) return;
      this._handlers[evt] = this._handlers[evt].filter(f => f !== fn);
    }
    emit(evt, ...args) {
      (this._handlers[evt] || []).slice().forEach(fn => fn(...args));
    }
  }

  class MockContext {
    constructor(candidate) {
      this.services = {};
      this.systems = {
        l10n: new MockL10n(),
        heightTransfer: new MockHeightTransfer(candidate),
        storage: { getItem: () => null, setItem: () => {} }
      };
    }
  }

  function candidate(state, extra = {}) {
    return Object.assign({
      osmFeature: { id: 'w1', type: 'way', tags: { building: 'yes' } },
      plateauFeature: { tags: { height: '2.98', ele: '69.1' } },
      state,
      missingTags: [],
      conflictingTags: [],
      matchingTags: []
    }, extra);
  }

  function render(context) {
    section = Rapid.uiSectionPlateauTags(context).entityIDs(['w1']);
    wrap = d3.select('body').append('div').attr('class', 'ui-wrap').call(section.render);
  }

  afterEach(() => { d3.selectAll('.ui-wrap').remove(); });

  it('is hidden when there is no candidate', () => {
    render(new MockContext(null));
    expect(wrap.select('.section-plateau-tags').classed('hide')).to.equal(true);
  });

  it('is hidden for a COVERED candidate', () => {
    render(new MockContext(candidate('COVERED')));
    expect(wrap.select('.section-plateau-tags').classed('hide')).to.equal(true);
  });

  it('renders a labeled heading (not a bare content block)', () => {
    const cand = candidate('CANDIDATE', { missingTags: ['height', 'ele'] });
    render(new MockContext(cand));
    expect(wrap.select('.section-plateau-tags').classed('hide')).to.equal(false);
    expect(wrap.select('.hide-toggle-text').text()).to.contain('height_transfer.section_title');
  });

  it('shows an actionable Apply fix for a CANDIDATE', () => {
    const cand = candidate('CANDIDATE', { missingTags: ['height', 'ele'] });
    render(new MockContext(cand));
    expect(wrap.select('.section-plateau-tags').classed('hide')).to.equal(false);
    const buttons = wrap.selectAll('.issue-fix-item button').nodes();
    expect(buttons.length).to.equal(1);
    buttons[0].dispatchEvent(new MouseEvent('click'));
    expect(applied).to.eql([cand]);
  });

  it('shows CONFLICT as information only, with no fix button', () => {
    const cand = candidate('CONFLICT', {
      conflictingTags: [{ key: 'height', osmValue: '10', plateauValue: '2.98' }]
    });
    render(new MockContext(cand));
    expect(wrap.select('.section-plateau-tags').classed('hide')).to.equal(false);
    expect(wrap.selectAll('.issue-fix-item button').nodes().length).to.equal(0);
    expect(wrap.selectAll('.issue-message').text()).to.contain('conflict_note');
  });

  it('shows AREA_MISMATCH as information only, with no fix button', () => {
    render(new MockContext(candidate('AREA_MISMATCH')));
    expect(wrap.select('.section-plateau-tags').classed('hide')).to.equal(false);
    expect(wrap.selectAll('.issue-fix-item button').nodes().length).to.equal(0);
  });

  it('re-renders and hides once the candidate is cleared by a heightTransfer change event', () => {
    const cand = candidate('CANDIDATE', { missingTags: ['height', 'ele'] });
    const context = new MockContext(cand);
    render(context);
    expect(wrap.select('.section-plateau-tags').classed('hide')).to.equal(false);

    // Simulate what happens after Apply: HeightTransferMode recomputes candidates
    // on 'stablechange' and this building no longer qualifies, then emits 'change'.
    context.systems.heightTransfer.setCandidate(null);
    context.systems.heightTransfer.emit('change');

    expect(wrap.select('.section-plateau-tags').classed('hide')).to.equal(true);
  });
});
