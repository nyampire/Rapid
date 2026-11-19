import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';


// 中心が経度 139.700、139.701、139.710 の 3 棟を作る（緯度は 35.000）
function makeCandidates() {
  const square = (id, lon) => {
    const d = 0.0001;
    const corners = [
      [lon - d, 35.000 - d],
      [lon + d, 35.000 - d],
      [lon + d, 35.000 + d],
      [lon - d, 35.000 + d],
    ];
    const nodes = corners.map((loc, i) => Rapid.osmNode({ id: `${id}_n${i}`, loc }));
    const way = Rapid.osmWay({
      id,
      nodes: [...nodes.map(n => n.id), nodes[0].id],
      tags: { building: 'yes' },
    });
    return { way, nodes };
  };

  const a = square('w1', 139.700);
  const b = square('w2', 139.701);
  const c = square('w3', 139.710);
  const entities = [a, b, c].flatMap(s => [...s.nodes, s.way]);
  const graph = new Rapid.Graph(entities);

  return [a.way, b.way, c.way].map(way => ({ entity: way, graph, datasetID: 'plateauJapan' }));
}


describe('utilNearestPlateauCandidate', () => {
  it('returns the candidate closest to the given location', () => {
    const candidates = makeCandidates();
    const picked = Rapid.utilNearestPlateauCandidate(candidates, [139.7008, 35.0]);
    assert.equal(picked.entity.id, 'w2');
  });

  it('skips the excluded candidate', () => {
    const candidates = makeCandidates();
    const picked = Rapid.utilNearestPlateauCandidate(candidates, [139.7008, 35.0], 'w2');
    assert.equal(picked.entity.id, 'w1');
  });

  it('returns null when the only candidate is excluded', () => {
    const candidates = makeCandidates().slice(1, 2);   // w2 だけ
    const picked = Rapid.utilNearestPlateauCandidate(candidates, [139.7008, 35.0], 'w2');
    assert.equal(picked, null);
  });

  it('returns null for an empty list', () => {
    assert.equal(Rapid.utilNearestPlateauCandidate([], [139.7008, 35.0]), null);
  });
});
