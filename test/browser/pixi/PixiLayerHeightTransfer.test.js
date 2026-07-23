describe('PixiLayerHeightTransfer', () => {
  // Mock-based unit test for the height-transfer candidate icon layer, following
  // the pattern established in PixiLayerPlateauCoverage.test.js (Issue #11):
  // stub `scene.gfx` / `scene.context` and a fake `_container` so the layer's
  // zoom-gating and click-forwarding logic can be exercised without booting a
  // full Rapid context or a real Pixi renderer.
  //
  // The fake container mirrors just the two PIXI.Container methods the layer
  // actually calls (`addChild`, `removeChildren`), so `container.children`
  // always reflects exactly what's currently rendered.

  function makeFakeContainer() {
    return {
      children: [],
      addChild(c) { this.children.push(c); return c; },
      removeChildren() { const old = this.children; this.children = []; return old; }
    };
  }

  function makeScene(mode) {
    const gfx = { deferredRedraw() {}, immediateRedraw() {} };
    const context = {
      services: {},
      systems: { gfx, heightTransfer: mode }
    };
    const scene = {
      gfx,
      context,
      groups: new Map([['qa', makeFakeContainer()]])
    };
    return scene;
  }

  function makeMode(opts = {}) {
    return {
      active: opts.active ?? true,
      candidates: opts.candidates ?? [],
      on() {},
      off() {}
    };
  }

  const projectIdentity = { project: p => p };


  describe('#supported', () => {
    it('returns true when heightTransfer system is registered', () => {
      const mode = makeMode();
      const scene = makeScene(mode);
      const layer = new Rapid.PixiLayerHeightTransfer(scene, 'height-transfer');
      expect(layer.supported).to.be.true;
    });

    it('returns false when heightTransfer system is missing', () => {
      const scene = makeScene(undefined);
      const layer = new Rapid.PixiLayerHeightTransfer(scene, 'height-transfer');
      expect(layer.supported).to.be.false;
    });
  });


  describe('#render', () => {
    it('renders nothing when mode is inactive', () => {
      const mode = makeMode({ active: false, candidates: [
        { plateauFeature: { id: 'p1', representativePoint: [139.755, 35.679] }, state: 'CANDIDATE' }
      ] });
      const scene = makeScene(mode);
      const layer = new Rapid.PixiLayerHeightTransfer(scene, 'height-transfer');
      const container = makeFakeContainer();
      layer._container = container;

      layer.render(0, projectIdentity, 18);

      expect(container.children.length).to.eql(0);
    });

    it('renders one icon per candidate at zoom >= 17 for CANDIDATE state', () => {
      const c1 = { plateauFeature: { id: 'p1', representativePoint: [139.755, 35.679] }, state: 'CANDIDATE' };
      const mode = makeMode({ candidates: [c1] });
      const scene = makeScene(mode);
      const layer = new Rapid.PixiLayerHeightTransfer(scene, 'height-transfer');
      layer._container = makeFakeContainer();

      layer.render(0, projectIdentity, 17);

      expect(layer._container.children.length).to.eql(1);
    });

    it('hides CANDIDATE below zoom 17', () => {
      const c1 = { plateauFeature: { id: 'p1', representativePoint: [139.755, 35.679] }, state: 'CANDIDATE' };
      const mode = makeMode({ candidates: [c1] });
      const scene = makeScene(mode);
      const layer = new Rapid.PixiLayerHeightTransfer(scene, 'height-transfer');
      layer._container = makeFakeContainer();

      layer.render(0, projectIdentity, 16);

      expect(layer._container.children.length).to.eql(0);
    });

    it('hides COVERED / CONFLICT / AREA_MISMATCH below zoom 18', () => {
      const c1 = { plateauFeature: { id: 'p1', representativePoint: [139.755, 35.679] }, state: 'COVERED' };
      const mode = makeMode({ candidates: [c1] });
      const scene = makeScene(mode);
      const layer = new Rapid.PixiLayerHeightTransfer(scene, 'height-transfer');
      layer._container = makeFakeContainer();

      layer.render(0, projectIdentity, 17);
      expect(layer._container.children.length).to.eql(0);

      layer.render(1, projectIdentity, 18);
      expect(layer._container.children.length).to.eql(1);
    });

    it('shows CONFLICT and AREA_MISMATCH at zoom 18', () => {
      const c1 = { plateauFeature: { id: 'p1', representativePoint: [139.755, 35.679] }, state: 'CONFLICT' };
      const c2 = { plateauFeature: { id: 'p2', representativePoint: [139.756, 35.680] }, state: 'AREA_MISMATCH' };
      const mode = makeMode({ candidates: [c1, c2] });
      const scene = makeScene(mode);
      const layer = new Rapid.PixiLayerHeightTransfer(scene, 'height-transfer');
      layer._container = makeFakeContainer();

      layer.render(0, projectIdentity, 18);

      expect(layer._container.children.length).to.eql(2);
    });

    it('skips a candidate with no representativePoint', () => {
      const c1 = { plateauFeature: { id: 'p1', representativePoint: null }, state: 'CANDIDATE' };
      const mode = makeMode({ candidates: [c1] });
      const scene = makeScene(mode);
      const layer = new Rapid.PixiLayerHeightTransfer(scene, 'height-transfer');
      layer._container = makeFakeContainer();

      layer.render(0, projectIdentity, 18);

      expect(layer._container.children.length).to.eql(0);
    });

    it('clears previously rendered icons on a re-render (e.g. mode went inactive)', () => {
      const c1 = { plateauFeature: { id: 'p1', representativePoint: [139.755, 35.679] }, state: 'CANDIDATE' };
      const mode = makeMode({ candidates: [c1] });
      const scene = makeScene(mode);
      const layer = new Rapid.PixiLayerHeightTransfer(scene, 'height-transfer');
      layer._container = makeFakeContainer();

      layer.render(0, projectIdentity, 18);
      expect(layer._container.children.length).to.eql(1);

      mode.active = false;
      layer.render(1, projectIdentity, 18);
      expect(layer._container.children.length).to.eql(0);
    });

    it('destroys previously rendered icons on re-render, not just detaches them', () => {
      // `PIXI.Container#removeChildren()` only unparents children - it does not
      // call `.destroy()` on them, so a replaced icon's GPU-backed resources
      // (a canvas texture, for `PIXI.Text` glyphs) would leak on every re-render
      // unless render() destroys the old icons itself.
      const c1 = { plateauFeature: { id: 'p1', representativePoint: [139.755, 35.679] }, state: 'CANDIDATE' };
      const c2 = { plateauFeature: { id: 'p2', representativePoint: [139.756, 35.680] }, state: 'CANDIDATE' };
      const mode = makeMode({ candidates: [c1] });
      const scene = makeScene(mode);
      const layer = new Rapid.PixiLayerHeightTransfer(scene, 'height-transfer');
      layer._container = makeFakeContainer();

      layer.render(0, projectIdentity, 18);
      const firstIcon = layer._container.children[0];
      expect(firstIcon.destroyed).to.be.false;

      mode.candidates = [c2];
      layer.render(1, projectIdentity, 18);

      expect(firstIcon.destroyed).to.be.true;
    });
  });


  describe('#_renderPreview (geometry-replace ghost)', () => {
    // A minimal OSM-way-like entity: just enough for `_renderPreview` to call
    // `asGeoJSON(graph)` on it and get back a closed Polygon ring.
    function makePolygonEntity(id, coords) {
      return {
        id,
        asGeoJSON() {
          return { type: 'Polygon', coordinates: [coords] };
        }
      };
    }

    const squareCoords = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];

    function makeCandidateWithPreview() {
      return {
        plateauFeature: makePolygonEntity('p1', squareCoords),
        osmFeature: makePolygonEntity('w1', squareCoords),
        plateauGraph: {}
      };
    }

    it('draws a ghost ring and a highlight ring when replacePreview is set', () => {
      const mode = makeMode({ candidates: [] });
      mode.replacePreview = makeCandidateWithPreview();
      const scene = makeScene(mode);
      scene.context.systems.editor = { staging: { graph: {} } };
      const layer = new Rapid.PixiLayerHeightTransfer(scene, 'height-transfer');
      layer._container = makeFakeContainer();
      layer._previewContainer = makeFakeContainer();

      layer.render(0, projectIdentity, 18);

      // one child for the ghost (fill+dash wrapper) and one for the OSM highlight
      expect(layer._previewContainer.children.length).to.eql(2);
      // the dot layer's own container is untouched by the preview logic
      expect(layer._container.children.length).to.eql(0);
    });

    it('empties (and destroys) the preview container when replacePreview is null', () => {
      const mode = makeMode({ candidates: [] });
      mode.replacePreview = makeCandidateWithPreview();
      const scene = makeScene(mode);
      scene.context.systems.editor = { staging: { graph: {} } };
      const layer = new Rapid.PixiLayerHeightTransfer(scene, 'height-transfer');
      layer._container = makeFakeContainer();
      layer._previewContainer = makeFakeContainer();

      layer.render(0, projectIdentity, 18);
      expect(layer._previewContainer.children.length).to.eql(2);
      const [firstGhost, firstHighlight] = layer._previewContainer.children;

      mode.replacePreview = null;
      layer.render(1, projectIdentity, 18);

      expect(layer._previewContainer.children.length).to.eql(0);
      expect(firstGhost.destroyed).to.be.true;
      expect(firstHighlight.destroyed).to.be.true;
    });

    it('does not draw a preview when heightTransfer has no replacePreview candidate', () => {
      const mode = makeMode({ candidates: [] });
      const scene = makeScene(mode);
      const layer = new Rapid.PixiLayerHeightTransfer(scene, 'height-transfer');
      layer._container = makeFakeContainer();
      layer._previewContainer = makeFakeContainer();

      layer.render(0, projectIdentity, 18);

      expect(layer._previewContainer.children.length).to.eql(0);
    });
  });


  describe('#click forwarding', () => {
    it('click on an icon enters select-osm mode on the candidate\'s OSM building', () => {
      const c1 = {
        plateauFeature: { id: 'p1', representativePoint: [139.755, 35.679] },
        osmFeature: { id: 'w1' },
        state: 'CANDIDATE'
      };
      const mode = makeMode({ candidates: [c1] });
      const scene = makeScene(mode);
      const entered = [];
      scene.context.enter = (modeID, opts) => entered.push([modeID, opts]);
      const layer = new Rapid.PixiLayerHeightTransfer(scene, 'height-transfer');
      layer._container = makeFakeContainer();

      layer.render(0, projectIdentity, 18);
      const icon = layer._container.children[0];
      icon.emit('pointertap');

      expect(entered).to.eql([['select-osm', { selection: { osm: ['w1'] } }]]);
    });

    it('each icon enters select-osm for its own candidate\'s OSM building, not the last one rendered', () => {
      const c1 = {
        plateauFeature: { id: 'p1', representativePoint: [139.755, 35.679] },
        osmFeature: { id: 'w1' },
        state: 'CANDIDATE'
      };
      const c2 = {
        plateauFeature: { id: 'p2', representativePoint: [139.756, 35.680] },
        osmFeature: { id: 'w2' },
        state: 'CANDIDATE'
      };
      const mode = makeMode({ candidates: [c1, c2] });
      const scene = makeScene(mode);
      const entered = [];
      scene.context.enter = (modeID, opts) => entered.push([modeID, opts]);
      const layer = new Rapid.PixiLayerHeightTransfer(scene, 'height-transfer');
      layer._container = makeFakeContainer();

      layer.render(0, projectIdentity, 18);
      const [icon1, icon2] = layer._container.children;
      icon2.emit('pointertap');
      icon1.emit('pointertap');

      expect(entered).to.eql([
        ['select-osm', { selection: { osm: ['w2'] } }],
        ['select-osm', { selection: { osm: ['w1'] } }]
      ]);
    });
  });

});
