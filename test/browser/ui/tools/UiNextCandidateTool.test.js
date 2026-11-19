describe('UiNextCandidateTool', () => {
  let selection, context, tool, clock, drawHandlers;

  class MockL10n {
    constructor() { this.calls = []; }
    t(id, params) {
      this.calls.push({ id, params });
      return id;
    }
  }

  class MockContext {
    constructor() {
      this.l10n = new MockL10n();
      this.selectNextCandidate = sinon.spy(() => true);
      this.checkOverflow = sinon.spy();
      this.systems = {
        l10n: this.l10n,
        map: {
          on: (event, fn) => { if (event === 'draw') drawHandlers.push(fn); }
        },
        ui: {
          checkOverflow: this.checkOverflow,
          Sidebar: { RapidInspector: { selectNextCandidate: this.selectNextCandidate } }
        }
      };
    }
    container() { return d3.select(document.body); }
  }

  function makeTool(status) {
    const t = new Rapid.UiNextCandidateTool(context);
    t._status = sinon.spy(() => status);
    return t;
  }

  // The toolbar gives the tool an `.item-content`; the label lives in a sibling `.item-label`.
  function makeSelection() {
    const $item = d3.select(document.createElement('div')).attr('class', 'toolbar-item');
    $item.append('div').attr('class', 'item-content');
    $item.append('div').attr('class', 'item-label');
    return $item.select('.item-content');
  }

  function tooltipText(t) {
    return t.Tooltip.title()();
  }


  beforeEach(() => {
    drawHandlers = [];
    clock = sinon.useFakeTimers();
    context = new MockContext();
    selection = makeSelection();
  });

  afterEach(() => {
    clock.restore();
  });


  it('ok のとき、名前に数が付き、押せる', () => {
    tool = makeTool({ reason: 'ok', count: 24 });
    tool.render(selection);

    expect(tool.label()).to.equal('toolbar.next_candidate.label_count');
    const call = context.l10n.calls.find(c => c.id === 'toolbar.next_candidate.label_count');
    expect(call.params).to.eql({ n: 24 });

    const $button = selection.select('button.next-candidate');
    expect($button.empty()).to.be.false;
    expect($button.classed('bar-button')).to.be.true;
    expect($button.classed('disabled')).to.be.false;
    expect(tooltipText(tool)).to.equal('toolbar.next_candidate.tooltip');
  });


  it('押すと selectNextCandidate を 1 回呼ぶ', () => {
    tool = makeTool({ reason: 'ok', count: 3 });
    tool.render(selection);
    happen.click(selection.select('button.next-candidate').node());
    expect(context.selectNextCandidate.callCount).to.equal(1);
  });


  it('zoom のとき、押せない見た目で、説明が toolbar.next_candidate.zoom', () => {
    tool = makeTool({ reason: 'zoom', count: 0 });
    tool.render(selection);

    expect(selection.select('button.next-candidate').classed('disabled')).to.be.true;
    expect(tooltipText(tool)).to.equal('toolbar.next_candidate.zoom');
    expect(tool.label()).to.equal('toolbar.next_candidate.label');
  });


  it('layer-off と osm-layer-off のとき、それぞれの理由を説明に出す', () => {
    tool = makeTool({ reason: 'layer-off', count: 0 });
    tool.render(selection);
    expect(tooltipText(tool)).to.equal('toolbar.next_candidate.layer_off');

    tool._status = () => ({ reason: 'osm-layer-off', count: 0 });
    tool.render(selection);
    expect(tooltipText(tool)).to.equal('toolbar.next_candidate.osm_layer_off');
  });


  it('none のとき、説明が rapid_inspector.next_candidate.none', () => {
    tool = makeTool({ reason: 'none', count: 0 });
    tool.render(selection);

    expect(selection.select('button.next-candidate').classed('disabled')).to.be.true;
    expect(tooltipText(tool)).to.equal('rapid_inspector.next_candidate.none');
  });


  it('押せないときに押しても、selectNextCandidate を呼ばない', () => {
    tool = makeTool({ reason: 'zoom', count: 0 });
    tool.render(selection);
    happen.click(selection.select('button.next-candidate').node());
    expect(context.selectNextCandidate.callCount).to.equal(0);
  });


  it('draw が 250ms のあいだに 5 回来ても、数え直しは 1 回', () => {
    tool = makeTool({ reason: 'ok', count: 5 });
    tool.render(selection);
    const before = tool._status.callCount;

    expect(drawHandlers.length).to.be.above(0);
    for (let i = 0; i < 5; i++) {
      drawHandlers.forEach(fn => fn());
      clock.tick(20);
    }
    clock.tick(300);

    expect(tool._status.callCount - before).to.equal(1);
  });


  it('名前を書き換えたあと checkOverflow を呼ぶ', () => {
    tool = makeTool({ reason: 'ok', count: 24 });
    tool.render(selection);

    const $label = d3.select(selection.node().parentNode).select('.item-label');
    expect($label.text()).to.equal('toolbar.next_candidate.label_count');
    expect(context.checkOverflow.calledWith('.map-toolbar', true)).to.be.true;
  });


  it('ツールバーは label() を持つ道具の名前にその戻り値を使う', () => {
    const labelFor = Rapid.UiMapToolbar.prototype.labelFor;
    const toolbar = { context };
    const labelTool = { id: 'x', stringID: 'ignored.id', render: () => {}, label: () => 'dynamic' };
    expect(labelFor.call(toolbar, labelTool)).to.equal('dynamic');
    expect(labelFor.call(toolbar, { id: 'y', stringID: 'plain.id' })).to.equal('plain.id');
    expect(labelFor.call(toolbar, 'spacer')).to.equal('');
  });
});
