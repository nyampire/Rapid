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

  // 書き換えの関数を持つ heightTransfer の偽物。
  // 選択の状態は自分で持ち、切り替えたら 'change' を出す。
  class MockOverwriteTransfer extends MockHeightTransfer {
    constructor(candidate, block) {
      super(candidate);
      this._block = block;
      this._keys = new Set();
    }
    getOverwriteBlock() { return this._block; }
    getOverwriteKeys() { return this._keys; }
    setOverwrite(cand, key, usePlateau) {
      if (usePlateau) {
        this._keys.add(key);
      } else {
        this._keys.delete(key);
      }
      this.emit('change');
    }
    hasWorkToApply(cand) {
      return !!cand.missingTags?.length || (this._block === null && this._keys.size > 0);
    }
  }

  function overwriteContext(cand, block) {
    const context = new MockContext(cand);
    context.systems.heightTransfer = new MockOverwriteTransfer(cand, block);
    return context;
  }

  const heightConflict = [{ key: 'height', osmValue: '10', plateauValue: '2.98' }];

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

  it('shows the height warning of the Plateau building above the proposal', () => {
    const cand = candidate('CANDIDATE', {
      missingTags: ['height'],
      plateauFeature: Object.assign(
        Rapid.osmWay({ id: 'w9', tags: { building: 'yes', height: '0.5' }, nodes: [] }),
        { heightWarnings: ['absolute'] }
      )
    });
    render(new MockContext(cand));

    const $warning = wrap.select('.plateau-height-warning');
    expect($warning.empty()).to.be.false;
    expect($warning.text()).to.contain('plateau_height_warning.absolute');
    // 適用のボタンは残す。
    expect(wrap.select('.plateau-apply').empty()).to.be.false;
  });

  it('does not show a warning that only a part of the building has', () => {
    // 転記するのは外形の高さだけなので、部分立体自身の高さの問題は出さない。
    const outline = Rapid.osmWay({ id: 'w9', tags: { building: 'yes', height: '9.1' }, nodes: [] });
    const part = Object.assign(
      Rapid.osmWay({ id: 'w10', tags: { 'building:part': 'yes', height: '0.5' }, nodes: [] }),
      { heightWarnings: ['absolute'] });
    const relation = Rapid.osmRelation({
      id: 'r1', tags: { type: 'building', building: 'yes', height: '9.1' },
      members: [{ id: 'w9', type: 'way', role: 'outline' },
                { id: 'w10', type: 'way', role: 'part' }]
    });
    const graph = new Rapid.Graph([outline, part, relation]);

    const cand = candidate('CANDIDATE', { missingTags: ['height'], plateauFeature: outline });
    const context = new MockContext(cand);
    context.services.plateau = { graph: () => graph };
    render(context);

    expect(wrap.select('.plateau-height-warning').empty()).to.be.true;
    expect(wrap.select('.plateau-apply').empty()).to.be.false;
  });

  describe('with overwriting enabled', () => {
    it('shows each conflicting tag with OSM chosen first and a disabled Apply', () => {
      const cand = candidate('CONFLICT', { conflictingTags: heightConflict });
      render(overwriteContext(cand, null));

      const rows = wrap.selectAll('ul.plateau-conflicts li.plateau-conflict').nodes();
      expect(rows.map(n => n.dataset.key)).to.eql(['height']);
      expect(wrap.select('input[value=osm]').property('checked')).to.equal(true);
      expect(wrap.select('input[value=plateau]').property('checked')).to.equal(false);
      expect(wrap.select('input[value=plateau]').property('disabled')).to.equal(false);
      expect(wrap.select('button.plateau-apply').property('disabled')).to.equal(true);
      // 食い違うタグの行が、食い違いの注記の代わりになる。
      expect(wrap.selectAll('.plateau-tags-note').text()).not.to.contain('conflict_note');
    });

    it('enables Apply once the Plateau value is chosen', () => {
      const cand = candidate('CONFLICT', { conflictingTags: heightConflict });
      render(overwriteContext(cand, null));

      wrap.select('input[value=plateau]').node().click();

      expect(wrap.select('input[value=plateau]').property('checked')).to.equal(true);
      const button = wrap.select('button.plateau-apply');
      expect(button.property('disabled')).to.equal(false);
      button.node().dispatchEvent(new MouseEvent('click'));
      expect(applied).to.eql([cand]);
    });

    it('disables the Plateau choice and explains why when the height may be wrong', () => {
      const cand = candidate('CONFLICT', { conflictingTags: heightConflict });
      render(overwriteContext(cand, 'warning'));

      expect(wrap.select('input[value=plateau]').property('disabled')).to.equal(true);
      expect(wrap.select('p.plateau-overwrite-blocked').text()).to.contain('overwrite_blocked_warning');
      expect(wrap.select('button.plateau-apply').property('disabled')).to.equal(true);
    });

    it('shows the values without choices and explains why for an area mismatch', () => {
      const cand = candidate('AREA_MISMATCH', { missingTags: ['ele'], conflictingTags: heightConflict });
      render(overwriteContext(cand, 'area'));

      expect(wrap.selectAll('input[type=radio]').nodes().length).to.equal(0);
      expect(wrap.selectAll('.plateau-conflict-values').nodes().length).to.equal(1);
      expect(wrap.select('p.plateau-overwrite-blocked').text()).to.contain('overwrite_blocked_area');
      expect(wrap.selectAll('.plateau-tags-note').text()).to.contain('area_mismatch_note');
      // 追加するタグがあるので、適用はできる。
      expect(wrap.select('button.plateau-apply').property('disabled')).to.equal(false);
    });

    it('shows both the additions and the conflicting tags for a CANDIDATE', () => {
      const cand = candidate('CANDIDATE', { missingTags: ['ele'], conflictingTags: heightConflict });
      render(overwriteContext(cand, null));

      const keys = wrap.selectAll('.plateau-additions li.tag-row input.key').nodes().map(n => n.value);
      expect(keys).to.eql(['ele']);
      expect(wrap.selectAll('li.plateau-conflict').nodes().length).to.equal(1);
      expect(wrap.select('button.plateau-apply').property('disabled')).to.equal(false);
    });

    it('does not show an explanation when overwriting is allowed', () => {
      const cand = candidate('CONFLICT', { conflictingTags: heightConflict });
      render(overwriteContext(cand, null));
      expect(wrap.select('p.plateau-overwrite-blocked').empty()).to.equal(true);
    });

    it('looks the same as before without the URL parameter', () => {
      const cand = candidate('CONFLICT', { conflictingTags: heightConflict });
      render(overwriteContext(cand, 'disabled'));

      expect(wrap.selectAll('li.plateau-conflict').nodes().length).to.equal(0);
      expect(wrap.selectAll('button.plateau-apply').nodes().length).to.equal(0);
      expect(wrap.selectAll('.plateau-tags-note').text()).to.contain('conflict_note');
    });
  });
});
