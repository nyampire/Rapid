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

});
