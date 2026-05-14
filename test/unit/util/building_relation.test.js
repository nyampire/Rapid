import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';

describe('utilBuildingRelationInfo', () => {
  it('returns null when entity is not a way', () => {
    const node = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
    const graph = new Rapid.Graph([node]);
    const info = Rapid.utilBuildingRelationInfo(node, graph);
    assert.equal(info, null);
  });

  it('returns null when entity is null/undefined', () => {
    const graph = new Rapid.Graph();
    assert.equal(Rapid.utilBuildingRelationInfo(null, graph), null);
    assert.equal(Rapid.utilBuildingRelationInfo(undefined, graph), null);
  });

  it('returns null when graph is missing or lacks parentRelations', () => {
    const way = Rapid.osmWay({ id: 'w1', nodes: [] });
    assert.equal(Rapid.utilBuildingRelationInfo(way, null), null);
    assert.equal(Rapid.utilBuildingRelationInfo(way, {}), null);
  });

  it('returns null when way has no parent type=building relation', () => {
    const way = Rapid.osmWay({ id: 'w1', nodes: [] });
    const graph = new Rapid.Graph([way]);
    assert.equal(Rapid.utilBuildingRelationInfo(way, graph), null);
  });

  it('returns null when parent relation is not type=building (e.g., route)', () => {
    const way = Rapid.osmWay({ id: 'w1', nodes: [] });
    const route = Rapid.osmRelation({
      id: 'r1',
      tags: { type: 'route', route: 'bus' },
      members: [{ id: way.id, type: 'way', role: '' }],
    });
    const graph = new Rapid.Graph([way, route]);
    assert.equal(Rapid.utilBuildingRelationInfo(way, graph), null);
  });

  it('returns relation info with outline/part counts', () => {
    const outline = Rapid.osmWay({ id: 'w_outline', nodes: [], tags: { building: 'yes' } });
    const part1 = Rapid.osmWay({ id: 'w_part1', nodes: [], tags: { 'building:part': 'yes' } });
    const part2 = Rapid.osmWay({ id: 'w_part2', nodes: [], tags: { 'building:part': 'yes' } });
    const relation = Rapid.osmRelation({
      id: 'r_building',
      tags: { type: 'building', building: 'yes' },
      members: [
        { id: outline.id, type: 'way', role: 'outline' },
        { id: part1.id, type: 'way', role: 'part' },
        { id: part2.id, type: 'way', role: 'part' },
      ],
    });
    const graph = new Rapid.Graph([outline, part1, part2, relation]);

    // どの member way から問い合わせても同じ relation を返す
    const fromOutline = Rapid.utilBuildingRelationInfo(outline, graph);
    assert.equal(fromOutline.relation.id, 'r_building');
    assert.equal(fromOutline.outlineCount, 1);
    assert.equal(fromOutline.partCount, 2);

    const fromPart = Rapid.utilBuildingRelationInfo(part1, graph);
    assert.equal(fromPart.relation.id, 'r_building');
    assert.equal(fromPart.outlineCount, 1);
    assert.equal(fromPart.partCount, 2);
  });

  it('counts only outline/part roles; ignores other roles', () => {
    const outline = Rapid.osmWay({ id: 'w_outline', nodes: [] });
    const part = Rapid.osmWay({ id: 'w_part', nodes: [] });
    const entrance = Rapid.osmNode({ id: 'n_entrance', loc: [0, 0] });
    const relation = Rapid.osmRelation({
      id: 'r_building',
      tags: { type: 'building' },
      members: [
        { id: outline.id, type: 'way', role: 'outline' },
        { id: part.id, type: 'way', role: 'part' },
        { id: entrance.id, type: 'node', role: 'entrance' },
      ],
    });
    const graph = new Rapid.Graph([outline, part, entrance, relation]);
    const info = Rapid.utilBuildingRelationInfo(outline, graph);
    assert.equal(info.outlineCount, 1);
    assert.equal(info.partCount, 1);  // entrance ロールはカウントされない
  });

  it('returns null when graph.parentRelations throws', () => {
    const way = Rapid.osmWay({ id: 'w1', nodes: [] });
    const brokenGraph = {
      parentRelations() { throw new Error('boom'); }
    };
    assert.equal(Rapid.utilBuildingRelationInfo(way, brokenGraph), null);
  });
});
