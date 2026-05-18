describe('RapidSystem', () => {
  let _rapid;

  class MockUrlHashSystem {
    constructor() {}
    initAsync()   { return Promise.resolve(); }
    getParam()    { return ''; }
    setParam()    { }
    on()          { return this; }
  }

  class MockContext {
    constructor() {
      this.systems = {
        urlhash: new MockUrlHashSystem()
      };
      this.services = {};
    }
  }


  beforeEach(() => {
    _rapid = new Rapid.RapidSystem(new MockContext());
    // Directly set up internal state without full init (avoids dependency resolution)
    _rapid._addedDatasetIDs = new Set();
    _rapid._enabledDatasetIDs = new Set();
  });


  describe('#addDatasets', () => {
    it('adds a single dataset to the menu', () => {
      _rapid.addDatasets('testDataset');
      expect(_rapid._addedDatasetIDs.has('testDataset')).to.be.true;
    });

    it('adds multiple datasets from an array', () => {
      _rapid.addDatasets(['ds1', 'ds2', 'ds3']);
      expect(_rapid._addedDatasetIDs.has('ds1')).to.be.true;
      expect(_rapid._addedDatasetIDs.has('ds2')).to.be.true;
      expect(_rapid._addedDatasetIDs.has('ds3')).to.be.true;
    });

    it('does not affect enabled state', () => {
      _rapid.addDatasets('testDataset');
      expect(_rapid._enabledDatasetIDs.has('testDataset')).to.be.false;
    });
  });


  describe('#removeDatasets', () => {
    it('removes a dataset from the menu', () => {
      _rapid._addedDatasetIDs.add('ds1');
      _rapid.removeDatasets('ds1');
      expect(_rapid._addedDatasetIDs.has('ds1')).to.be.false;
    });

    it('also removes from enabled', () => {
      _rapid._addedDatasetIDs.add('ds1');
      _rapid._enabledDatasetIDs.add('ds1');
      _rapid.removeDatasets('ds1');
      expect(_rapid._addedDatasetIDs.has('ds1')).to.be.false;
      expect(_rapid._enabledDatasetIDs.has('ds1')).to.be.false;
    });
  });


  describe('#enableDatasets', () => {
    it('enables a dataset and adds it to the menu', () => {
      _rapid.enableDatasets('ds1');
      expect(_rapid._addedDatasetIDs.has('ds1')).to.be.true;
      expect(_rapid._enabledDatasetIDs.has('ds1')).to.be.true;
    });

    it('enables multiple datasets from a Set', () => {
      _rapid.enableDatasets(new Set(['ds1', 'ds2']));
      expect(_rapid._enabledDatasetIDs.has('ds1')).to.be.true;
      expect(_rapid._enabledDatasetIDs.has('ds2')).to.be.true;
    });
  });


  describe('#disableDatasets', () => {
    it('disables a dataset but keeps it on the menu', () => {
      _rapid._addedDatasetIDs.add('ds1');
      _rapid._enabledDatasetIDs.add('ds1');
      _rapid.disableDatasets('ds1');
      expect(_rapid._addedDatasetIDs.has('ds1')).to.be.true;
      expect(_rapid._enabledDatasetIDs.has('ds1')).to.be.false;
    });
  });


  describe('#toggleDatasets', () => {
    it('enables a disabled dataset', () => {
      _rapid._addedDatasetIDs.add('ds1');
      _rapid.toggleDatasets('ds1');
      expect(_rapid._enabledDatasetIDs.has('ds1')).to.be.true;
    });

    it('disables an enabled dataset', () => {
      _rapid._addedDatasetIDs.add('ds1');
      _rapid._enabledDatasetIDs.add('ds1');
      _rapid.toggleDatasets('ds1');
      expect(_rapid._enabledDatasetIDs.has('ds1')).to.be.false;
    });

    it('adds to menu if not already added', () => {
      _rapid.toggleDatasets('ds1');
      expect(_rapid._addedDatasetIDs.has('ds1')).to.be.true;
    });
  });


  describe('#resetAsync', () => {
    it('clears acceptIDs and ignoreIDs', () => {
      _rapid.acceptIDs.add('a1');
      _rapid.ignoreIDs.add('i1');
      return _rapid.resetAsync().then(() => {
        expect(_rapid.acceptIDs.size).to.eql(0);
        expect(_rapid.ignoreIDs.size).to.eql(0);
      });
    });
  });


  describe('#startAsync defaults', () => {
    // Verifies the Plateau-focused defaults applied when no `datasets=…`
    // URL hash param is present. Regression guard for future upstream merges
    // that touch the default set in RapidSystem.startAsync.

    class MockService {
      constructor(datasets) { this._datasets = datasets || []; }
      startAsync() { return Promise.resolve(); }
      getAvailableDatasets() { return this._datasets; }
    }

    function makeDataset(id) {
      return { id, categories: new Set() };
    }

    function makeContextWithServices(opts = {}) {
      const ctx = new MockContext();
      ctx.systems.urlhash = {
        initialHashParams: new Map(),  // .has('datasets') → false
        initAsync()   { return Promise.resolve(); },
        getParam()    { return ''; },
        setParam()    {},
        on()          { return this; }
      };
      ctx.services.mapwithai = new MockService([makeDataset('fbRoads')]);
      ctx.services.overture = new MockService([makeDataset('ml-buildings-overture'), makeDataset('esri-buildings')]);
      ctx.services.plateau = new MockService([makeDataset('plateauJapan')]);
      if (opts.withDatasetsParam) {
        ctx.systems.urlhash.initialHashParams = new Map([['datasets', 'foo,bar']]);
      }
      return ctx;
    }

    it('puts plateauJapan in both _addedDatasetIDs and _enabledDatasetIDs by default', () => {
      const rapid = new Rapid.RapidSystem(makeContextWithServices());
      return rapid.startAsync().then(() => {
        expect(rapid._addedDatasetIDs.has('plateauJapan')).to.be.true;
        expect(rapid._enabledDatasetIDs.has('plateauJapan')).to.be.true;
      });
    });

    it('also adds upstream defaults (fbRoads / ml-buildings-overture / esri-buildings) to the menu', () => {
      const rapid = new Rapid.RapidSystem(makeContextWithServices());
      return rapid.startAsync().then(() => {
        expect(rapid._addedDatasetIDs.has('fbRoads')).to.be.true;
        expect(rapid._addedDatasetIDs.has('ml-buildings-overture')).to.be.true;
        expect(rapid._addedDatasetIDs.has('esri-buildings')).to.be.true;
      });
    });

    it('only enables plateauJapan by default (Japan-focused deployment)', () => {
      const rapid = new Rapid.RapidSystem(makeContextWithServices());
      return rapid.startAsync().then(() => {
        expect(rapid._enabledDatasetIDs.has('fbRoads')).to.be.false;
        expect(rapid._enabledDatasetIDs.has('ml-buildings-overture')).to.be.false;
        expect(rapid._enabledDatasetIDs.has('esri-buildings')).to.be.false;
      });
    });

    it('does not overwrite the defaults when the URL has a datasets= param', () => {
      const rapid = new Rapid.RapidSystem(makeContextWithServices({ withDatasetsParam: true }));
      // Pre-populate as the URL-hash path would
      rapid._addedDatasetIDs = new Set(['userPicked']);
      rapid._enabledDatasetIDs = new Set(['userPicked']);
      return rapid.startAsync().then(() => {
        // startAsync skipped its default block, user selection survived
        expect(rapid._addedDatasetIDs.has('plateauJapan')).to.be.false;
        expect(rapid._addedDatasetIDs.has('userPicked')).to.be.true;
      });
    });

    it('catalogs the plateauJapan dataset', () => {
      const rapid = new Rapid.RapidSystem(makeContextWithServices());
      return rapid.startAsync().then(() => {
        expect(rapid.catalog.has('plateauJapan')).to.be.true;
      });
    });
  });

});
