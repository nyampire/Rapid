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
    // Caller can pass a static value (default) or a function that returns
    // the value for each call. The function form lets a single test vary
    // the result across successive calls (e.g. fail-then-succeed).
    const resolver = typeof opts.coverageResolves === 'function'
      ? opts.coverageResolves
      : () => (opts.coverageResolves ?? null);
    return {
      loadCoverage() {
        calls.loadCoverage++;
        return Promise.resolve(resolver(calls.loadCoverage));
      },
      _coverageData: opts.coverageData ?? null,
      _calls: calls
    };
  }

  // Wait one microtask + one macrotask so a .then() chained off a
  // synchronously-started Promise has run before the assertion fires.
  function flushPromises() {
    return new Promise(r => { setTimeout(r, 0); });
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
    it('marks fetch as in-progress synchronously and only flips _fetched on a successful result', async () => {
      const fc = { type: 'FeatureCollection', features: [] };
      const { layer, service } = makeLayer({ coverageResolves: fc });
      layer.render(1, null, 10);
      // Synchronously: in-progress flag set, _fetched still false (Promise pending).
      expect(service._calls.loadCoverage).to.eql(1);
      expect(layer._fetchInProgress).to.be.true;
      expect(layer._fetched).to.be.false;
      // After the Promise resolves: _fetched true, in-progress cleared.
      await flushPromises();
      expect(layer._fetched).to.be.true;
      expect(layer._fetchInProgress).to.be.false;
    });

    it('does not call loadCoverage again on subsequent renders after a successful fetch', async () => {
      const fc = { type: 'FeatureCollection', features: [] };
      const { layer, service } = makeLayer({ coverageResolves: fc });
      layer.render(1, null, 10);
      await flushPromises();             // first fetch succeeds
      layer.render(2, null, 10);
      layer.render(3, null, 12);
      expect(service._calls.loadCoverage).to.eql(1);
    });

    it('coalesces concurrent renders to a single inflight fetch', () => {
      const fc = { type: 'FeatureCollection', features: [] };
      const { layer, service } = makeLayer({ coverageResolves: fc });
      // Three renders fire back-to-back before the first Promise has resolved.
      layer.render(1, null, 10);
      layer.render(2, null, 10);
      layer.render(3, null, 10);
      // Only the first render initiates a fetch.
      expect(service._calls.loadCoverage).to.eql(1);
    });

    it('triggers a deferredRedraw when loadCoverage resolves with data', async () => {
      const fc = { type: 'FeatureCollection', features: [] };
      const { layer, scene } = makeLayer({ coverageResolves: fc });
      layer.render(1, null, 10);
      await flushPromises();
      expect(scene.gfx.deferredRedrawCount).to.be.greaterThan(0);
    });

    it('does NOT trigger deferredRedraw when loadCoverage resolves with null (graceful)', async () => {
      const { layer, scene } = makeLayer({ coverageResolves: null });
      layer.render(1, null, 10);
      await flushPromises();
      expect(scene.gfx.deferredRedrawCount).to.eql(0);
    });

    it('retries on the next render after a failed (null) fetch', async () => {
      // 1st call → null (failure), 2nd+ calls → success.
      const fc = { type: 'FeatureCollection', features: [] };
      const { layer, scene, service } = makeLayer({
        coverageResolves: (callCount) => (callCount === 1 ? null : fc)
      });
      layer.render(1, null, 10);
      await flushPromises();
      expect(service._calls.loadCoverage).to.eql(1);
      expect(layer._fetched).to.be.false;            // failure did NOT lock us out
      expect(layer._fetchInProgress).to.be.false;    // inflight cleared so retry can run

      // Next render: retry happens.
      layer.render(2, null, 10);
      await flushPromises();
      expect(service._calls.loadCoverage).to.eql(2);
      expect(layer._fetched).to.be.true;             // now succeeded
      expect(scene.gfx.deferredRedrawCount).to.be.greaterThan(0);
    });

    it('does not re-fetch while the first call is still inflight, even across many renders', async () => {
      // Hold the Promise un-resolved so we can observe synchronous behavior.
      let resolveFn;
      const heldPromise = new Promise(r => { resolveFn = r; });
      const service = {
        loadCoverage() { service._calls.loadCoverage++; return heldPromise; },
        _coverageData: null,
        _calls: { loadCoverage: 0 }
      };
      const scene = makeScene({ services: { plateau: service } });
      const layer = new Rapid.PixiLayerPlateauCoverage(scene, 'plateau-coverage');
      layer._renderFeatures = () => {};

      layer.render(1, null, 10);
      layer.render(2, null, 10);
      layer.render(3, null, 10);
      expect(service._calls.loadCoverage).to.eql(1);   // coalesced while inflight
      expect(layer._fetchInProgress).to.be.true;

      // Resolve and let the .then run.
      resolveFn({ type: 'FeatureCollection', features: [] });
      await flushPromises();
      expect(layer._fetched).to.be.true;
      expect(layer._fetchInProgress).to.be.false;
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
