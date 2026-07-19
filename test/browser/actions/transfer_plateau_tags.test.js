describe('actionTransferPlateauTags', () => {
  it('adds missing tags to the entity', () => {
    const way = Rapid.osmWay({ id: 'w1', tags: { building: 'yes' } });
    const graph = new Rapid.Graph([way]);
    const g2 = Rapid.actionTransferPlateauTags('w1',
      { height: '12.5', 'building:levels': '3' })(graph);
    expect(g2.entity('w1').tags).to.eql({
      building: 'yes', height: '12.5', 'building:levels': '3'
    });
  });

  it('never overwrites existing tag values', () => {
    const way = Rapid.osmWay({ id: 'w1', tags: { building: 'yes', height: '10' } });
    const graph = new Rapid.Graph([way]);
    const g2 = Rapid.actionTransferPlateauTags('w1',
      { height: '12.5', ele: '45' })(graph);
    // height stays at 10, ele is added
    expect(g2.entity('w1').tags).to.eql({
      building: 'yes', height: '10', ele: '45'
    });
  });

  it('leaves the entity untouched when no tags are actually new', () => {
    const way = Rapid.osmWay({ id: 'w1', tags: { building: 'yes', height: '12' } });
    const graph = new Rapid.Graph([way]);
    const g2 = Rapid.actionTransferPlateauTags('w1', { height: '99' })(graph);
    expect(g2.entity('w1')).to.equal(graph.entity('w1'));   // reference equality
  });

  it('accepts relations as well as ways', () => {
    const relation = Rapid.osmRelation({ id: 'r1', tags: { building: 'yes' } });
    const graph = new Rapid.Graph([relation]);
    const g2 = Rapid.actionTransferPlateauTags('r1', { height: '15' })(graph);
    expect(g2.entity('r1').tags).to.eql({ building: 'yes', height: '15' });
  });

  it('marks the returned action with actionName so callers can identify it later (e.g. in undo/redo history)', () => {
    const action = Rapid.actionTransferPlateauTags('w1', { height: '12' });
    expect(action.actionName).to.eql('transfer_plateau_tags');
  });
});
