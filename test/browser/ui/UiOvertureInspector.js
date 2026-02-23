describe('UiOvertureInspector', () => {
  let body, container, inspector;

  class MockDataset {
    constructor(color, label) {
      this.color = color || '#da26d3';
      this._label = label || 'Test Dataset';
      this.tags = new Set(['opendata']);
      this.licenseUrl = 'https://example.com/license';
    }
    getLabel() { return this._label; }
  }

  class MockContext {
    constructor() {
      this.assetPath = '/dist/';
      this.systems = {
        l10n: {
          isRTL: () => false,
          t: (key) => key
        },
        rapid: {
          datasets: new Map([
            ['overture-places', new MockDataset('#00ffff', 'Overture Places')]
          ])
        }
      };
    }
    container() { return container; }
    enter() { }
  }

  const context = new MockContext();

  beforeEach(() => {
    body = d3.select('body');
    container = body.append('div');
    inspector = new Rapid.UiOvertureInspector(context);
  });

  afterEach(() => {
    container.remove();
  });


  it('renders the property name prominently', () => {
    inspector.datum = {
      __datasetid__: 'overture-places',
      geojson: { properties: { names: '{"primary":"Central Library"}' } }
    };
    const $body = container.append('div');
    inspector.renderPropertyInfo($body);

    expect($body.select('.property-name').text()).to.eql('Central Library');
  });

  it('renders GERS ID from raw properties (not parsed)', () => {
    inspector.datum = {
      __datasetid__: 'overture-places',
      geojson: { properties: { id: '08f2649b-0733-b91f-0400-e91d50e41e87' } }
    };
    const $body = container.append('div');
    inspector.renderPropertyInfo($body);

    // Should show the UUID string, not [object Object]
    let gersText = null;
    $body.selectAll('.property-value').each(function() {
      const t = d3.select(this).text();
      if (t.includes('08f2649b')) gersText = t;
    });
    expect(gersText).to.eql('08f2649b-0733-b91f-0400-e91d50e41e87');
  });

  it('renders categories as pill tags with underscores replaced', () => {
    inspector.datum = {
      __datasetid__: 'overture-places',
      geojson: { properties: { categories: '{"primary":"public_library"}' } }
    };
    const $body = container.append('div');
    inspector.renderPropertyInfo($body);

    const tags = $body.selectAll('.property-category-tag');
    expect(tags.size()).to.be.greaterThan(0);
    expect(tags.nodes()[0].textContent).to.eql('public library');
  });

  it('renders websites as links that open in new tab', () => {
    inspector.datum = {
      __datasetid__: 'overture-places',
      geojson: { properties: { websites: '["https://www.example.com"]' } }
    };
    const $body = container.append('div');
    inspector.renderPropertyInfo($body);

    const link = $body.select('.property-link');
    expect(link.attr('href')).to.eql('https://www.example.com');
    expect(link.attr('target')).to.eql('_blank');
    expect(link.text()).to.eql('example.com');
  });

  it('renders confidence rounded to 2 decimal places', () => {
    inspector.datum = {
      __datasetid__: 'overture-places',
      geojson: { properties: { confidence: '0.87654' } }
    };
    const $body = container.append('div');
    inspector.renderPropertyInfo($body);

    let found = false;
    $body.selectAll('.property-value').each(function() {
      if (d3.select(this).text() === '0.88') found = true;
    });
    expect(found).to.be.true;
  });

  it('puts unhandled properties below a divider', () => {
    inspector.datum = {
      __datasetid__: 'overture-places',
      geojson: { properties: { names: '{"primary":"Test"}', version: '42' } }
    };
    const $body = container.append('div');
    inspector.renderPropertyInfo($body);

    expect($body.select('.property-divider').empty()).to.be.false;
    expect($body.select('.property-heading-minor').text()).to.eql('Version');
  });

  it('applies dataset color to feature info bar', () => {
    inspector.datum = {
      __datasetid__: 'overture-places',
      geojson: { properties: {} }
    };
    const $body = container.append('div');
    inspector.renderFeatureInfo($body);

    expect($body.select('.feature-info').style('background')).to.contain('rgb(0, 255, 255)');
    expect($body.select('.dataset-label').text()).to.eql('Overture Places');
  });

});
