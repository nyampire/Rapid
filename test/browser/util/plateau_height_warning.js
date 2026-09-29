describe('utilPlateauHeightWarningMessages', () => {
  // t は、キーと値を読める形の文字列にして返す。
  // 値の書式まで確かめるため。
  const l10n = {
    t: (key, params) => params ? `${key} ${JSON.stringify(params)}` : key
  };

  function way(id, tags, extra = {}) {
    return Object.assign(Rapid.osmWay({ id, tags, nodes: [] }), extra);
  }

  it('returns nothing for a building without a warning', () => {
    const w = way('w1', { building: 'yes', height: '7' });
    expect(Rapid.utilPlateauHeightWarningMessages(w, null, l10n)).to.eql([]);
  });

  it('writes the height and footprint into the needle message', () => {
    const w = way('w1', { building: 'yes', height: '18.4' },
      { heightWarnings: ['needle'], footprintM2: 0.0036 });
    expect(Rapid.utilPlateauHeightWarningMessages(w, null, l10n)).to.eql([
      'plateau_height_warning.needle {"height":"18.4","area":"0.0036"}'
    ]);
  });

  it('falls back to a message without numbers when the footprint is missing', () => {
    const w = way('w1', { building: 'yes', height: '18.4' },
      { heightWarnings: ['needle'] });
    expect(Rapid.utilPlateauHeightWarningMessages(w, null, l10n)).to.eql([
      'plateau_height_warning.needle_generic'
    ]);
  });

  it('tells the high side from the low side for floor-height', () => {
    const high = way('w1', { building: 'house', height: '24.6', 'building:levels': '2' },
      { heightWarnings: ['floor-height'] });
    const low = way('w2', { building: 'apartments', height: '2.97', 'building:levels': '29' },
      { heightWarnings: ['floor-height'] });
    expect(Rapid.utilPlateauHeightWarningMessages(high, null, l10n)).to.eql([
      'plateau_height_warning.floor_height_high {"per_floor":"12.3"}'
    ]);
    expect(Rapid.utilPlateauHeightWarningMessages(low, null, l10n)).to.eql([
      'plateau_height_warning.floor_height_low {"per_floor":"0.1"}'
    ]);
  });

  it('writes the height into the absolute and degenerate messages', () => {
    const w = way('w1', { building: 'yes', height: '0.5' },
      { heightWarnings: ['degenerate-area', 'absolute'] });
    expect(Rapid.utilPlateauHeightWarningMessages(w, null, l10n)).to.eql([
      'plateau_height_warning.degenerate_area',
      'plateau_height_warning.absolute {"height":"0.5"}'
    ]);
  });

  it('falls back to generic messages when there is no height tag', () => {
    const w = way('w1', { building: 'house' },
      { heightWarnings: ['absolute', 'floor-height'] });
    expect(Rapid.utilPlateauHeightWarningMessages(w, null, l10n)).to.eql([
      'plateau_height_warning.absolute_generic',
      'plateau_height_warning.floor_height_generic'
    ]);
  });

  it('compares a part with its outline through the building relation', () => {
    const outline = way('w1', { building: 'yes', height: '9.1' });
    const part = way('w2', { 'building:part': 'yes', height: '149.2' },
      { heightWarnings: ['part-over-outline'] });
    const relation = Rapid.osmRelation({
      id: 'r1', tags: { type: 'building', building: 'yes', height: '9.1' },
      members: [{ id: 'w1', type: 'way', role: 'outline' },
                { id: 'w2', type: 'way', role: 'part' }]
    });
    const graph = new Rapid.Graph([outline, part, relation]);

    expect(Rapid.utilPlateauHeightWarningMessages(part, graph, l10n)).to.eql([
      'plateau_height_warning.part_over_outline {"part":"149.2","outline":"9.1","diff":"140.1"}'
    ]);
  });

  it('collects the warnings of every member when the outline is selected', () => {
    // 1 つを選んで追加すると建物全体が追加されるので、全体の警告を出す。
    const outline = way('w1', { building: 'yes', height: '9.1' });
    const part = way('w2', { 'building:part': 'yes', height: '149.2' },
      { heightWarnings: ['part-over-outline'] });
    const relation = Rapid.osmRelation({
      id: 'r1', tags: { type: 'building', building: 'yes', height: '9.1' },
      members: [{ id: 'w1', type: 'way', role: 'outline' },
                { id: 'w2', type: 'way', role: 'part' }]
    });
    const graph = new Rapid.Graph([outline, part, relation]);

    expect(Rapid.utilPlateauHeightWarningMessages(outline, graph, l10n)).to.have.length(1);
  });

  it('says the same thing only once', () => {
    // relation は外形の警告を複製して持つので、外形と relation で同じ文になる。
    const outline = way('w1', { building: 'yes', height: '0.5' },
      { heightWarnings: ['absolute'] });
    const relation = Object.assign(Rapid.osmRelation({
      id: 'r1', tags: { type: 'building', building: 'yes', height: '0.5' },
      members: [{ id: 'w1', type: 'way', role: 'outline' }]
    }), { heightWarnings: ['absolute'] });
    const graph = new Rapid.Graph([outline, relation]);

    expect(Rapid.utilPlateauHeightWarningMessages(outline, graph, l10n)).to.eql([
      'plateau_height_warning.absolute {"height":"0.5"}'
    ]);
  });
});
