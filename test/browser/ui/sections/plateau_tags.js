describe('uiSectionPlateauTags', () => {
  let section, wrap, applied, previewed, confirmed, cancelled;

  class MockL10n {
    isRTL() { return false; }
    t(id) { return id; }
    tHtml(id) { return id; }
  }

  class MockHeightTransfer {
    constructor(candidate) {
      this._cand = candidate;
      this._handlers = {};
      this.replacePreview = null;
      applied = [];
      previewed = [];
      confirmed = 0;
      cancelled = 0;
    }
    getCandidateForOSM(id) { return (this._cand && this._cand.osmFeature.id === id) ? this._cand : null; }
    apply(cand) { applied.push(cand); }
    setCandidate(cand) { this._cand = cand; }
    previewReplace(cand) { previewed.push(cand); this.replacePreview = cand; this.emit('change'); }
    confirmReplace() { confirmed++; this.replacePreview = null; this.emit('change'); }
    cancelReplace() { cancelled++; this.replacePreview = null; this.emit('change'); }
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
    // Added tags render as read-only key/value tag-rows (iD tag-editor layout).
    const keys = wrap.selectAll('.plateau-additions li.tag-row input.key').nodes().map(n => n.value);
    const vals = wrap.selectAll('.plateau-additions li.tag-row input.value').nodes().map(n => n.value);
    expect(keys).to.eql(['height', 'ele']);
    expect(vals).to.eql(['2.98', '69.1']);
    const buttons = wrap.selectAll('button.plateau-apply').nodes();
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
    expect(wrap.selectAll('button.plateau-apply').nodes().length).to.equal(0);
    expect(wrap.selectAll('.plateau-tags-note').text()).to.contain('conflict_note');
  });

  it('shows AREA_MISMATCH with nothing to add as information only, with no fix button', () => {
    render(new MockContext(candidate('AREA_MISMATCH')));
    expect(wrap.select('.section-plateau-tags').classed('hide')).to.equal(false);
    expect(wrap.selectAll('button.plateau-apply').nodes().length).to.equal(0);
    expect(wrap.selectAll('.plateau-tags-note').text()).to.contain('area_mismatch_note');
  });

  it('offers the same Apply fix for an AREA_MISMATCH that still has tags to add', () => {
    const cand = candidate('AREA_MISMATCH', { missingTags: ['height', 'ele'] });
    render(new MockContext(cand));
    expect(wrap.select('.section-plateau-tags').classed('hide')).to.equal(false);

    // The area note still warns the mapper to check imagery first...
    expect(wrap.selectAll('.plateau-tags-note').text()).to.contain('area_mismatch_note');

    // ...but the proposal itself renders exactly as it does for a CANDIDATE.
    const keys = wrap.selectAll('.plateau-additions li.tag-row input.key').nodes().map(n => n.value);
    const vals = wrap.selectAll('.plateau-additions li.tag-row input.value').nodes().map(n => n.value);
    expect(keys).to.eql(['height', 'ele']);
    expect(vals).to.eql(['2.98', '69.1']);

    const buttons = wrap.selectAll('button.plateau-apply').nodes();
    expect(buttons.length).to.equal(1);
    buttons[0].dispatchEvent(new MouseEvent('click'));
    expect(applied).to.eql([cand]);
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

  it('shows a replace-geometry button for a replaceable candidate', () => {
    const cand = candidate('CANDIDATE', { missingTags: ['height', 'ele'], replaceable: true });
    const context = new MockContext(cand);
    render(context);
    const buttons = wrap.selectAll('button.plateau-replace').nodes();
    expect(buttons.length).to.equal(1);
    expect(wrap.selectAll('button.plateau-replace-confirm').nodes().length).to.equal(0);
    expect(wrap.selectAll('button.plateau-replace-cancel').nodes().length).to.equal(0);

    buttons[0].dispatchEvent(new MouseEvent('click'));
    expect(previewed).to.eql([cand]);
  });

  it('does not show a replace-geometry button for a non-replaceable candidate', () => {
    const cand = candidate('CANDIDATE', { missingTags: ['height', 'ele'], replaceable: false });
    render(new MockContext(cand));
    expect(wrap.selectAll('button.plateau-replace').nodes().length).to.equal(0);
  });

  it('shows confirm/cancel and the fill-tag list while a replace is in preview', () => {
    const cand = candidate('CANDIDATE', { missingTags: ['height', 'ele'], replaceable: true });
    const context = new MockContext(cand);
    context.systems.heightTransfer.replacePreview = cand;
    render(context);

    expect(wrap.selectAll('button.plateau-replace').nodes().length).to.equal(0);
    const confirmBtn = wrap.selectAll('button.plateau-replace-confirm').nodes();
    const cancelBtn = wrap.selectAll('button.plateau-replace-cancel').nodes();
    expect(confirmBtn.length).to.equal(1);
    expect(cancelBtn.length).to.equal(1);

    // fill-tag list: both height and ele are missing from the OSM feature's tags.
    // Note: the existing Apply block's own tag-list also renders (missingTags is
    // non-empty, which is what gates renderContent past its early return), so the
    // same two keys appear twice -- once from Apply, once from the replace preview.
    const keys = wrap.selectAll('.plateau-additions li.tag-row input.key').nodes().map(n => n.value);
    expect(keys).to.include('height');
    expect(keys).to.include('ele');

    confirmBtn[0].dispatchEvent(new MouseEvent('click'));
    expect(confirmed).to.equal(1);
  });

  it('cancels a replace preview via the cancel button', () => {
    const cand = candidate('CANDIDATE', { missingTags: ['height', 'ele'], replaceable: true });
    const context = new MockContext(cand);
    context.systems.heightTransfer.replacePreview = cand;
    render(context);

    const cancelBtn = wrap.selectAll('button.plateau-replace-cancel').nodes();
    expect(cancelBtn.length).to.equal(1);
    cancelBtn[0].dispatchEvent(new MouseEvent('click'));
    expect(cancelled).to.equal(1);
  });
});
