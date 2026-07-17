describe('UiHeightTransferTool', () => {
  let selection, context, mode;

  // Minimal stand-in for `HeightTransferMode` (Task 6): exposes the same
  // public surface `UiHeightTransferTool` relies on -- `active`,
  // `activate()`/`deactivate()`, and the 'change' event -- without needing
  // a real editor/map/rapid system behind it.
  class MockMode {
    constructor() {
      this.active = false;
      this._handlers = {};
    }
    activate() {
      if (this.active) return;
      this.active = true;
      this._emit('change');
    }
    deactivate() {
      if (!this.active) return;
      this.active = false;
      this._emit('change');
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
    container() { return d3.select(document.body); }
  }


  beforeEach(() => {
    mode = new MockMode();
    context = new MockContext(mode);
    selection = d3.select(document.createElement('div'));
  });


  it('renders a bar-button with an icon', () => {
    const tool = new Rapid.UiHeightTransferTool(context);
    tool.render(selection);

    const button = selection.select('button.height-transfer-button');
    expect(button.empty()).to.be.false;
    expect(button.classed('bar-button')).to.be.true;
    expect(button.select('svg.icon').empty()).to.be.false;
  });


  it('renders aria-pressed=false and no active class when mode is inactive', () => {
    const tool = new Rapid.UiHeightTransferTool(context);
    tool.render(selection);

    const button = selection.select('button.height-transfer-button');
    expect(button.attr('aria-pressed')).to.eql('false');
    expect(button.classed('active')).to.be.false;
  });


  it('clicking the button when inactive calls mode.activate() and shows a pressed state', () => {
    const tool = new Rapid.UiHeightTransferTool(context);
    tool.render(selection);

    const button = selection.select('button.height-transfer-button');
    happen.click(button.node());

    expect(mode.active).to.be.true;
    expect(button.attr('aria-pressed')).to.eql('true');
    expect(button.classed('active')).to.be.true;
  });


  it('clicking the button when active calls mode.deactivate() and clears the pressed state', () => {
    mode.activate();
    const tool = new Rapid.UiHeightTransferTool(context);
    tool.render(selection);

    const button = selection.select('button.height-transfer-button');
    happen.click(button.node());

    expect(mode.active).to.be.false;
    expect(button.attr('aria-pressed')).to.eql('false');
    expect(button.classed('active')).to.be.false;
  });


  it('reflects mode state changes triggered elsewhere, not just its own clicks', () => {
    const tool = new Rapid.UiHeightTransferTool(context);
    tool.render(selection);

    mode.activate();  // simulate activation from somewhere else

    const button = selection.select('button.height-transfer-button');
    expect(button.attr('aria-pressed')).to.eql('true');
    expect(button.classed('active')).to.be.true;
  });


  it('does not throw when the heightTransfer system is missing', () => {
    const contextNoMode = new MockContext(undefined);
    const tool = new Rapid.UiHeightTransferTool(contextNoMode);
    expect(() => tool.render(selection)).to.not.throw();
  });


  it('sets a localized title from the toolbar.height_transfer string', () => {
    const tool = new Rapid.UiHeightTransferTool(context);
    tool.render(selection);

    const button = selection.select('button.height-transfer-button');
    expect(button.attr('title')).to.eql('toolbar.height_transfer');
  });

});
