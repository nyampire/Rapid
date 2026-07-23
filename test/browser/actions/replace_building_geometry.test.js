describe('actionReplaceBuildingGeometry', () => {
  // Build a closed square way + its nodes in a real Graph.
  function building(prefix, coords, tags) {
    const nodes = coords.map((loc, i) => Rapid.osmNode({ id: `${prefix}n${i}`, loc }));
    const nodeIDs = nodes.map(n => n.id);
    nodeIDs.push(nodes[0].id);                 // close the ring by ref
    const way = Rapid.osmWay({ id: `${prefix}w`, tags, nodes: nodeIDs });
    return { nodes, way, entities: [...nodes, way] };
  }
  const OSM_SQR = [[139.755, 35.679], [139.756, 35.679], [139.756, 35.680], [139.755, 35.680]];
  // Plateau outline: same footprint nudged, distinct corner coords
  const PL_SQR  = [[139.7551, 35.6791], [139.7561, 35.6791], [139.7561, 35.6801], [139.7551, 35.6801]];

  it('keeps the OSM way id and replaces its node coords with the Plateau outline', () => {
    const osm = building('o', OSM_SQR, { building: 'yes' });
    const pl  = building('p', PL_SQR,  { building: 'yes', height: '12' });
    const osmGraph = new Rapid.Graph(osm.entities);
    const plateauGraph = new Rapid.Graph(pl.entities);

    const g2 = Rapid.actionReplaceBuildingGeometry('ow', pl.way, plateauGraph)(osmGraph);

    const w = g2.entity('ow');                 // same id preserved
    const locs = w.nodes.map(nid => g2.entity(nid).loc);
    // first 4 distinct corners equal the Plateau corners, ring closed
    expect(locs.slice(0, 4)).to.eql(PL_SQR);
    expect(locs[locs.length - 1]).to.eql(locs[0]);
  });

  it('merges Plateau tags non-destructively (OSM wins, empty keys filled)', () => {
    const osm = building('o', OSM_SQR, { building: 'house', height: '10' });
    const pl  = building('p', PL_SQR,  { building: 'yes', height: '12', 'building:levels': '3' });
    const g2 = Rapid.actionReplaceBuildingGeometry('ow', pl.way, new Rapid.Graph(pl.entities))(new Rapid.Graph(osm.entities));
    expect(g2.entity('ow').tags).to.eql({ building: 'house', height: '10', 'building:levels': '3' });
  });

  it('strips Plateau-internal metadata tags', () => {
    const osm = building('o', OSM_SQR, { building: 'yes' });
    const pl  = building('p', PL_SQR,  { building: 'yes', height: '12', conn: 'x', dupe: 'y', orig_id: '1' });
    const g2 = Rapid.actionReplaceBuildingGeometry('ow', pl.way, new Rapid.Graph(pl.entities))(new Rapid.Graph(osm.entities));
    const t = g2.entity('ow').tags;
    expect(t.conn).to.be.undefined;
    expect(t.dupe).to.be.undefined;
    expect(t.orig_id).to.be.undefined;
    expect(t.height).to.eql('12');
  });

  it('removes old OSM nodes that become orphaned', () => {
    const osm = building('o', OSM_SQR, { building: 'yes' });
    const g2 = Rapid.actionReplaceBuildingGeometry('ow', building('p', PL_SQR, { building: 'yes' }).way,
      new Rapid.Graph(building('p', PL_SQR, { building: 'yes' }).entities))(new Rapid.Graph(osm.entities));
    expect(g2.hasEntity('on0')).to.be.undefined;   // old corner gone
  });

  it('keeps an old node carrying interesting tags, even if orphaned', () => {
    const nodes = OSM_SQR.map((loc, i) => Rapid.osmNode({ id: `o${i}`, loc }));
    // Tag one corner as an entrance -- a real, interesting OSM node.
    nodes[0] = nodes[0].update({ tags: { entrance: 'yes' } });
    const nodeIDs = [...nodes.map(n => n.id), nodes[0].id];
    const way = Rapid.osmWay({ id: 'ow', tags: { building: 'yes' }, nodes: nodeIDs });
    const osmGraph = new Rapid.Graph([...nodes, way]);

    const pl = building('p', PL_SQR, { building: 'yes' });
    const g2 = Rapid.actionReplaceBuildingGeometry('ow', pl.way, new Rapid.Graph(pl.entities))(osmGraph);

    expect(g2.hasEntity('o0')).to.exist;               // tagged node survives, detached
    expect(g2.hasEntity('o1')).to.be.undefined;         // plain untagged orphan still removed
  });

  it('keeps an old node still used by another way', () => {
    const osm = building('o', OSM_SQR, { building: 'yes' });
    // a second way reuses OSM corner on0
    const other = Rapid.osmWay({ id: 'ow2', tags: { barrier: 'fence' }, nodes: ['on0', 'on1'] });
    const graph = new Rapid.Graph([...osm.entities, other]);
    const pl = building('p', PL_SQR, { building: 'yes' });
    const g2 = Rapid.actionReplaceBuildingGeometry('ow', pl.way, new Rapid.Graph(pl.entities))(graph);
    expect(g2.hasEntity('on0')).to.exist;    // still referenced by ow2
  });

  it('marks the returned action with actionName', () => {
    const action = Rapid.actionReplaceBuildingGeometry('ow', { id: 'pw', nodes: [], tags: {} }, new Rapid.Graph([]));
    expect(action.actionName).to.eql('replace_building_geometry');
  });
});
