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

  // 選択の関数を持つ heightTransfer の偽物。
  // 選択はタグの名前で自分で持ち、押されたら 'change' を出す。
  class MockChoiceTransfer extends MockHeightTransfer {
    constructor(candidate, block) {
      super(candidate);
      this._block = block;
      this._choices = new Map();
      this.setCalls = [];
    }
    getOverwriteBlock() { return this._block; }
    getChoice(cand, key) {
      const isMissing = cand.missingTags.includes(key);
      const isConflict = cand.conflictingTags.some(c => c.key === key);
      if (!isMissing && !isConflict) return null;
      if (isConflict && this._block !== null) return 'osm';
      return this._choices.get(key) ?? (isMissing ? 'plateau' : 'osm');
    }
    setChoice(cand, key, source) {
      this.setCalls.push([key, source]);
      this._choices.set(key, source);
      this.emit('change');
    }
    hasWorkToApply(cand) {
      const keys = [...cand.missingTags, ...cand.conflictingTags.map(c => c.key)];
      return keys.some(k => this.getChoice(cand, k) === 'plateau');
    }
  }

  function choiceContext(cand, block) {
    const context = new MockContext(cand);
    context.systems.heightTransfer = new MockChoiceTransfer(cand, block);
    return context;
  }

  // OSM に building:levels=2 があり、PLATEAU は height、ele、building:levels=1 を持つ建物。
  function mixed(state = 'CANDIDATE') {
    return candidate(state, {
      osmFeature: { id: 'w1', type: 'way', tags: { building: 'yes', 'building:levels': '2' } },
      plateauFeature: { tags: { height: '2.98', ele: '69.1', 'building:levels': '1' } },
      missingTags: ['height', 'ele'],
      conflictingTags: [{ key: 'building:levels', osmValue: '2', plateauValue: '1' }]
    });
  }

  function texts(selector) {
    return wrap.selectAll(selector).nodes().map(n => n.textContent);
  }

  function selected(key) {
    const row = wrap.select(`tr.plateau-choice-row[data-key="${key}"]`);
    const osm = row.select('button.plateau-choice-osm');
    const plateau = row.select('button.plateau-choice-plateau');
    return {
      osm: osm.classed('selected') && osm.attr('aria-pressed') === 'true',
      plateau: plateau.classed('selected') && plateau.attr('aria-pressed') === 'true'
    };
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

  describe('with choice buttons', () => {
    it('shows one table with OSM and Plateau headings and value-only buttons', () => {
      render(choiceContext(mixed(), null));

      expect(texts('table.plateau-choices thead th')).to.eql(['', 'height_transfer.column_osm', 'height_transfer.column_plateau']);
      expect(wrap.selectAll('tr.plateau-choice-row').nodes().map(n => n.dataset.key))
        .to.eql(['height', 'ele', 'building:levels']);
      expect(texts('button.plateau-choice-osm'))
        .to.eql(['height_transfer.osm_none', 'height_transfer.osm_none', '2']);
      expect(texts('button.plateau-choice-plateau')).to.eql(['2.98', '69.1', '1']);
      expect(wrap.select('tr[data-key="building:levels"] button.plateau-choice-osm').attr('aria-label'))
        .to.equal('building:levels height_transfer.column_osm 2');
      // 表が、これまでの見出しと読み取り専用の表の代わりになる。
      expect(wrap.selectAll('.plateau-additions').nodes().length).to.equal(0);
      expect(wrap.selectAll('.plateau-tags-note').nodes().map(n => n.textContent).join(' '))
        .not.to.contain('additions');
    });

    it('starts with Plateau for missing tags and OSM for conflicting tags', () => {
      render(choiceContext(mixed(), null));
      expect(selected('height')).to.eql({ osm: false, plateau: true });
      expect(selected('ele')).to.eql({ osm: false, plateau: true });
      expect(selected('building:levels')).to.eql({ osm: true, plateau: false });
      expect(wrap.select('button.plateau-apply').property('disabled')).to.equal(false);
    });

    it('keeps a pressed button selected until the other one in the row is pressed', () => {
      const context = choiceContext(mixed(), null);
      render(context);

      wrap.select('tr[data-key="building:levels"] button.plateau-choice-plateau').node().click();
      expect(selected('building:levels')).to.eql({ osm: false, plateau: true });

      wrap.select('tr[data-key="ele"] button.plateau-choice-osm').node().click();
      expect(selected('ele')).to.eql({ osm: true, plateau: false });
      // ほかの行の選択は変わらない。
      expect(selected('building:levels')).to.eql({ osm: false, plateau: true });

      expect(context.systems.heightTransfer.setCalls)
        .to.eql([['building:levels', 'plateau'], ['ele', 'osm']]);
    });

    it('keeps keyboard focus on the pressed button after the table is rebuilt', () => {
      render(choiceContext(mixed(), null));
      const before = wrap.select('tr[data-key="building:levels"] button.plateau-choice-plateau').node();
      before.focus();
      before.click();

      const after = wrap.select('tr[data-key="building:levels"] button.plateau-choice-plateau').node();
      expect(after).not.to.equal(before);
      expect(document.activeElement).to.equal(after);
    });

    it('enables Apply only while something is set to Plateau', () => {
      const cand = mixed('CONFLICT');
      cand.missingTags = [];
      render(choiceContext(cand, null));
      expect(wrap.select('button.plateau-apply').property('disabled')).to.equal(true);
      // 食い違いの注記の代わりに、表が出る。
      expect(wrap.selectAll('.plateau-tags-note').nodes().map(n => n.textContent).join(' '))
        .not.to.contain('conflict_note');

      wrap.select('button.plateau-choice-plateau').node().click();
      const button = wrap.select('button.plateau-apply');
      expect(button.property('disabled')).to.equal(false);
      button.node().dispatchEvent(new MouseEvent('click'));
      expect(applied).to.eql([cand]);
    });

    it('disables Plateau only for conflicting tags and explains why when the height may be wrong', () => {
      render(choiceContext(mixed(), 'warning'));

      expect(wrap.select('tr[data-key="building:levels"] button.plateau-choice-plateau').property('disabled')).to.equal(true);
      expect(wrap.select('tr[data-key="height"] button.plateau-choice-plateau').property('disabled')).to.equal(false);
      expect(wrap.select('tr[data-key="height"] button.plateau-choice-osm').property('disabled')).to.equal(false);
      expect(wrap.select('p.plateau-overwrite-blocked').text()).to.contain('overwrite_blocked_warning');
    });

    it('shows the area note and the reason for an area mismatch', () => {
      render(choiceContext(mixed('AREA_MISMATCH'), 'area'));

      expect(wrap.select('tr[data-key="building:levels"] button.plateau-choice-plateau').property('disabled')).to.equal(true);
      expect(wrap.select('p.plateau-overwrite-blocked').text()).to.contain('overwrite_blocked_area');
      expect(wrap.selectAll('.plateau-tags-note').nodes().map(n => n.textContent).join(' '))
        .to.contain('area_mismatch_note');
    });

    it('does not explain anything when nothing is blocked or nothing conflicts', () => {
      render(choiceContext(mixed(), null));
      expect(wrap.select('p.plateau-overwrite-blocked').empty()).to.equal(true);

      d3.selectAll('.ui-wrap').remove();
      const cand = mixed();
      cand.conflictingTags = [];
      render(choiceContext(cand, 'warning'));
      expect(wrap.select('p.plateau-overwrite-blocked').empty()).to.equal(true);
    });

    it('looks the same as before without the URL parameter', () => {
      render(choiceContext(mixed(), 'disabled'));

      expect(wrap.selectAll('table.plateau-choices').nodes().length).to.equal(0);
      const keys = wrap.selectAll('.plateau-additions li.tag-row input.key').nodes().map(n => n.value);
      expect(keys).to.eql(['height', 'ele']);
      expect(wrap.select('button.plateau-apply').property('disabled')).to.equal(false);
    });
  });
});
