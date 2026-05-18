describe('PixiLayerPlateauCoverage', () => {
  // Mock-based unit test for the Plateau coverage Pixi layer. Avoids
  // booting a full Rapid context / real Pixi by stubbing the AbstractLayer
  // dependencies (`scene.gfx`, `scene.context`) just enough to exercise
  // the zoom guard, the once-per-instance fetch, and graceful degradation.
  //
  // Issue #11: previously there was no test infrastructure for Pixi layers
  // in this fork. This file establishes a mock-based pattern other layer
  // tests can follow.

  function makeService(opts = {}) {
    const calls = { loadCoverage: 0 };
    return {
      loadCoverage() {
        calls.loadCoverage++;
        return Promise.resolve(opts.coverageResolves ?? null);
      },
      _coverageData: opts.coverageData ?? null,
      _calls: calls
    };
  }

  function makeScene(opts = {}) {
    const gfx = {
      scene: null,            // back-pointer is set below
      deferredRedrawCount: 0,
      deferredRedraw() { gfx.deferredRedrawCount++; },
      immediateRedraw() {}
    };
    const context = {
      services: opts.services ?? {},
      systems: { gfx: gfx }
    };
    const scene = {
      gfx: gfx,
      context: context,
      groups: new Map([['basemap', null]])
    };
    gfx.scene = scene;
    return scene;
  }

  function makeLayer(serviceOpts) {
    const scene = makeScene({
      services: { plateau: serviceOpts === null ? undefined : makeService(serviceOpts) }
    });
    const layer = new Rapid.PixiLayerPlateauCoverage(scene, 'plateau-coverage');
    // Stub the actual feature rendering so we don't need Pixi
    layer._renderFeaturesCalls = 0;
    layer._renderFeatures = () => { layer._renderFeaturesCalls++; };
    return { layer, scene, service: scene.context.services.plateau };
  }


  describe('#supported', () => {
    it('returns true when plateau service is registered', () => {
      const { layer } = makeLayer({});
      expect(layer.supported).to.be.true;
    });

    it('returns false when plateau service is missing', () => {
      const { layer } = makeLayer(null);
      expect(layer.supported).to.be.false;
    });
  });


  describe('#render zoom range', () => {
    it('does nothing when zoom is below MINZOOM (5)', () => {
      const { layer, service } = makeLayer({});
      layer.render(1, null, 4);
      expect(service._calls.loadCoverage).to.eql(0);
      expect(layer._renderFeaturesCalls).to.eql(0);
    });

    it('does nothing when zoom is above MAXZOOM (14)', () => {
      const { layer, service } = makeLayer({});
      layer.render(1, null, 15);
      expect(service._calls.loadCoverage).to.eql(0);
      expect(layer._renderFeaturesCalls).to.eql(0);
    });

    it('renders within the zoom range when data is cached', () => {
      const fc = { type: 'FeatureCollection', features: [{ id: 'a', geometry: { type: 'Polygon', coordinates: [] } }] };
      const { layer } = makeLayer({ coverageData: fc });
      layer.render(1, null, 10);
      expect(layer._renderFeaturesCalls).to.eql(1);
    });

    it('handles MINZOOM and MAXZOOM as inclusive bounds', () => {
      const fc = { type: 'FeatureCollection', features: [] };
      const { layer } = makeLayer({ coverageData: fc });
      layer.render(1, null, 5);    // MINZOOM inclusive
      layer.render(2, null, 14);   // MAXZOOM inclusive
      // Both calls should pass the zoom gate; _renderFeatures is invoked
      // (even with empty features, the function is called, then iterates over nothing).
      expect(layer._renderFeaturesCalls).to.eql(2);
    });
  });


  describe('#render when disabled', () => {
    it('does nothing when layer is disabled', () => {
      const { layer, service } = makeLayer({});
      layer._enabled = false;
      layer.render(1, null, 10);
      expect(service._calls.loadCoverage).to.eql(0);
      expect(layer._renderFeaturesCalls).to.eql(0);
    });
  });


  describe('#render with missing service', () => {
    it('returns early when context.services.plateau is undefined', () => {
      const { layer } = makeLayer(null);
      // No throw; just an early return
      expect(() => layer.render(1, null, 10)).to.not.throw();
      expect(layer._renderFeaturesCalls).to.eql(0);
    });
  });


  describe('#render fetch lifecycle', () => {
    it('calls service.loadCoverage exactly once on first in-range render', () => {
      const { layer, service } = makeLayer({});
      layer.render(1, null, 10);
      expect(service._calls.loadCoverage).to.eql(1);
      expect(layer._fetched).to.be.true;
    });

    it('does not call loadCoverage again on subsequent renders (fetch-once)', () => {
      const { layer, service } = makeLayer({});
      layer.render(1, null, 10);
      layer.render(2, null, 10);
      layer.render(3, null, 12);
      expect(service._calls.loadCoverage).to.eql(1);
    });

    it('triggers a deferredRedraw when loadCoverage resolves with data', async () => {
      const fc = { type: 'FeatureCollection', features: [] };
      const { layer, scene } = makeLayer({ coverageResolves: fc });
      layer.render(1, null, 10);
      // wait one microtask + macrotask for the .then() to fire
      await Promise.resolve();
      await new Promise(r => { setTimeout(r, 0); });
      expect(scene.gfx.deferredRedrawCount).to.be.greaterThan(0);
    });

    it('does NOT trigger deferredRedraw when loadCoverage resolves with null (graceful)', async () => {
      const { layer, scene } = makeLayer({ coverageResolves: null });
      layer.render(1, null, 10);
      await Promise.resolve();
      await new Promise(r => { setTimeout(r, 0); });
      expect(scene.gfx.deferredRedrawCount).to.eql(0);
    });
  });


  describe('#render data handling', () => {
    it('skips _renderFeatures when service has no _coverageData', () => {
      const { layer } = makeLayer({});  // coverageData stays null
      layer.render(1, null, 10);
      expect(layer._renderFeaturesCalls).to.eql(0);
    });

    it('skips _renderFeatures when _coverageData has no features array', () => {
      const { layer } = makeLayer({ coverageData: { type: 'FeatureCollection' } });
      layer.render(1, null, 10);
      expect(layer._renderFeaturesCalls).to.eql(0);
    });

    it('invokes _renderFeatures with the features array when data is present', () => {
      const feats = [{ id: 'a', geometry: { type: 'Polygon', coordinates: [] } }];
      const { layer } = makeLayer({ coverageData: { type: 'FeatureCollection', features: feats } });
      let receivedFeatures = null;
      layer._renderFeatures = (frame, vp, zoom, features) => { receivedFeatures = features; };
      layer.render(1, null, 10);
      expect(receivedFeatures).to.equal(feats);
    });
  });

});
