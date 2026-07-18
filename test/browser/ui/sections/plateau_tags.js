describe('uiSectionPlateauTags', () => {
  let section, wrap, applied;

  class MockL10n {
    isRTL() { return false; }
    t(id) { return id; }
    tHtml(id) { return id; }
  }

  class MockHeightTransfer {
    constructor(candidate) { this._cand = candidate; applied = []; }
    getCandidateForOSM(id) { return (this._cand && this._cand.osmFeature.id === id) ? this._cand : null; }
    apply(cand) { applied.push(cand); }
  }

  class MockContext {
    constructor(candidate) {
      this.services = {};
      this.systems = {
        l10n: new MockL10n(),
        heightTransfer: new MockHeightTransfer(candidate)
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
    expect(section.shouldDisplay()).to.be.false;
  });

  it('is hidden for a COVERED candidate', () => {
    render(new MockContext(candidate('COVERED')));
    expect(section.shouldDisplay()).to.be.false;
  });

  it('shows an actionable Apply fix for a CANDIDATE', () => {
    const cand = candidate('CANDIDATE', { missingTags: ['height', 'ele'] });
    render(new MockContext(cand));
    expect(section.shouldDisplay()).to.be.true;
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
    expect(section.shouldDisplay()).to.be.true;
    expect(wrap.selectAll('.issue-fix-item button').nodes().length).to.equal(0);
    expect(wrap.selectAll('.issue-message').text()).to.contain('conflict_note');
  });

  it('shows AREA_MISMATCH as information only, with no fix button', () => {
    render(new MockContext(candidate('AREA_MISMATCH')));
    expect(section.shouldDisplay()).to.be.true;
    expect(wrap.selectAll('.issue-fix-item button').nodes().length).to.equal(0);
  });
});
