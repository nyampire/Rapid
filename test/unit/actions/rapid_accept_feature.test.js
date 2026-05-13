import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import * as Rapid from '../../../modules/headless.js';

describe('actionRapidAcceptFeature', () => {
    it('accepts a node', () => {
        const node = Rapid.osmNode({ id: 'a', loc: [0, 0] });
        const graph = Rapid.actionRapidAcceptFeature(node.id, new Rapid.Graph([node]))(new Rapid.Graph());

        assert.ok(graph.hasEntity(node.id));
    });


    it('accepts a way', () => {
        const node1 = Rapid.osmNode({ id: 'a', loc: [0, 0] });
        const node2 = Rapid.osmNode({ id: 'b', loc: [1, 1] });
        const way = Rapid.osmWay({ id: 'w', nodes: [node1.id, node2.id] });
        const graph = Rapid.actionRapidAcceptFeature(way.id, new Rapid.Graph([node1, node2, way]))(new Rapid.Graph());

        assert.ok(graph.hasEntity(way.id));
    });


    it('accepts a relation', () => {
        const node = Rapid.osmNode({ id: 'a', loc: [0, 0] });
        const way = Rapid.osmWay({ id: 'w', nodes: [node.id] });
        const relation = Rapid.osmRelation({ id: 'r', members: [{ id: way.id }] });
        const graph = Rapid.actionRapidAcceptFeature(relation.id, new Rapid.Graph([node, way, relation]))(new Rapid.Graph());

        assert.ok(graph.hasEntity(relation.id));
    });


    it('accepts a node with connection tags', () => {
        const node = Rapid.osmNode({ id: 'a', loc: [0, 0], tags: { conn: 'w1,n1,n2' } });
        const way = Rapid.osmWay({ id: 'w1', nodes: ['n1', 'n2'] });
        const node1 = Rapid.osmNode({ id: 'n1', loc: [0, 1] });
        const node2 = Rapid.osmNode({ id: 'n2', loc: [1, 1] });
        const extGraph = new Rapid.Graph([node, way, node1, node2]);
        const graph = Rapid.actionRapidAcceptFeature(node.id, extGraph)(new Rapid.Graph([way, node1, node2]));
        // Replace with your actual assertions
        assert.ok(graph.hasEntity(node.id));
        assert.ok(graph.hasEntity(way.id));
    });


    it('accepts a way with duplicate nodes', () => {
        const node1 = Rapid.osmNode({ id: 'a', loc: [0, 0] });
        const node2 = Rapid.osmNode({ id: 'b', loc: [1, 1], tags: { dupe: 'a' } });
        const way = Rapid.osmWay({ id: 'w', nodes: [node1.id, node2.id] });
        const graph = Rapid.actionRapidAcceptFeature(way.id, new Rapid.Graph([node1, node2, way]))(new Rapid.Graph());
        // Replace with your actual assertions
        assert.ok(graph.hasEntity(way.id));
    });


    it('accepts a relation with nested relations', () => {
        const node = Rapid.osmNode({ id: 'a', loc: [0, 0] });
        const way = Rapid.osmWay({ id: 'w', nodes: [node.id] });
        const relation1 = Rapid.osmRelation({ id: 'r1', members: [{ id: way.id }] });
        const relation2 = Rapid.osmRelation({ id: 'r2', members: [{ id: relation1.id }] });
        const graph = Rapid.actionRapidAcceptFeature(relation2.id, new Rapid.Graph([node, way, relation1, relation2]))(new Rapid.Graph());
        // Replace with your actual assertions
        assert.ok(graph.hasEntity(relation2.id));
    });


    it('accepts a node with changed location', () => {
        const node = Rapid.osmNode({ id: 'a', loc: [0, 0] });
        const graph = new Rapid.Graph([node]);
        const newNode = Rapid.osmNode({ id: 'a', loc: [1, 1] });
        const newGraph = Rapid.actionRapidAcceptFeature(newNode.id, new Rapid.Graph([newNode]))(graph);
        assert.ok(newGraph.hasEntity(newNode.id));
        assert.deepStrictEqual(newGraph.entity(newNode.id).loc, [1, 1]);
    });


    it('accepts an entity of type node', () => {
        const node = Rapid.osmNode({ id: 'a', loc: [0, 0] });
        const graph = Rapid.actionRapidAcceptFeature(node.id, new Rapid.Graph([node]))(new Rapid.Graph());
        assert.ok(graph.hasEntity(node.id));
    });


    // ----------------------------------------------------------------------
    // Phase 3: building relation cascade
    // ユーザーが PLATEAU LOD2 の outline / part を click した時、
    // 関連する type=building relation 全体 (outline + parts + relation) を一括 accept する。
    // ----------------------------------------------------------------------

    it('accepts the parent type=building relation when accepting a part way', () => {
        const n1 = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
        const n2 = Rapid.osmNode({ id: 'n2', loc: [0, 1] });
        const n3 = Rapid.osmNode({ id: 'n3', loc: [1, 1] });
        const n4 = Rapid.osmNode({ id: 'n4', loc: [1, 0] });
        const outline = Rapid.osmWay({ id: 'w_outline', nodes: ['n1', 'n2', 'n3', 'n4', 'n1'], tags: { building: 'yes', height: '10' } });
        const part = Rapid.osmWay({ id: 'w_part', nodes: ['n1', 'n2', 'n3', 'n4', 'n1'], tags: { 'building:part': 'yes', height: '5' } });
        const relation = Rapid.osmRelation({
            id: 'r_building',
            tags: { type: 'building', building: 'yes', height: '10' },
            members: [
                { id: outline.id, type: 'way', role: 'outline' },
                { id: part.id, type: 'way', role: 'part' }
            ]
        });
        const extGraph = new Rapid.Graph([n1, n2, n3, n4, outline, part, relation]);

        // ユーザーが part だけを click したケース
        const graph = Rapid.actionRapidAcceptFeature(part.id, extGraph)(new Rapid.Graph());

        // relation + outline + part が全部入る
        assert.ok(graph.hasEntity('r_building'), 'relation not in graph');
        assert.ok(graph.hasEntity('w_outline'), 'outline not in graph');
        assert.ok(graph.hasEntity('w_part'), 'part not in graph');
    });

    it('accepts the parent type=building relation when accepting the outline way', () => {
        const n1 = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
        const outline = Rapid.osmWay({ id: 'w_outline', nodes: ['n1'], tags: { building: 'yes' } });
        const part = Rapid.osmWay({ id: 'w_part', nodes: ['n1'], tags: { 'building:part': 'yes' } });
        const relation = Rapid.osmRelation({
            id: 'r_building',
            tags: { type: 'building', building: 'yes' },
            members: [
                { id: outline.id, type: 'way', role: 'outline' },
                { id: part.id, type: 'way', role: 'part' }
            ]
        });
        const extGraph = new Rapid.Graph([n1, outline, part, relation]);

        // outline を click したケース → relation 経由で part も一緒に accept
        const graph = Rapid.actionRapidAcceptFeature(outline.id, extGraph)(new Rapid.Graph());

        assert.ok(graph.hasEntity('r_building'));
        assert.ok(graph.hasEntity('w_outline'));
        assert.ok(graph.hasEntity('w_part'));
    });

    it('does NOT cascade for ways in non-building relations', () => {
        const n1 = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
        const way = Rapid.osmWay({ id: 'w', nodes: ['n1'], tags: { highway: 'primary' } });
        const route = Rapid.osmRelation({
            id: 'r_route',
            tags: { type: 'route', route: 'bus' },
            members: [{ id: way.id, type: 'way', role: '' }]
        });
        const extGraph = new Rapid.Graph([n1, way, route]);

        const graph = Rapid.actionRapidAcceptFeature(way.id, extGraph)(new Rapid.Graph());

        // way は accept されるが、type=building ではない relation は cascade されない
        assert.ok(graph.hasEntity('w'));
        assert.ok(!graph.hasEntity('r_route'), 'non-building relation should NOT be cascaded');
    });

    it('processes building relation only once even if multiple members are picked', () => {
        // 内部 cascade ロジックの再帰防止検証: relation を accept する過程で
        // 各 member way の acceptWay が呼ばれるが、その都度 relation を再 accept しないこと。
        const n1 = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
        const outline = Rapid.osmWay({ id: 'w_outline', nodes: ['n1'], tags: { building: 'yes' } });
        const part1 = Rapid.osmWay({ id: 'w_part1', nodes: ['n1'], tags: { 'building:part': 'yes' } });
        const part2 = Rapid.osmWay({ id: 'w_part2', nodes: ['n1'], tags: { 'building:part': 'yes' } });
        const relation = Rapid.osmRelation({
            id: 'r_building',
            tags: { type: 'building' },
            members: [
                { id: outline.id, type: 'way', role: 'outline' },
                { id: part1.id, type: 'way', role: 'part' },
                { id: part2.id, type: 'way', role: 'part' }
            ]
        });
        const extGraph = new Rapid.Graph([n1, outline, part1, part2, relation]);

        // part1 を accept → relation cascade → outline / part1 / part2 全部 accept
        const graph = Rapid.actionRapidAcceptFeature(part1.id, extGraph)(new Rapid.Graph());

        assert.ok(graph.hasEntity('r_building'));
        assert.ok(graph.hasEntity('w_outline'));
        assert.ok(graph.hasEntity('w_part1'));
        assert.ok(graph.hasEntity('w_part2'));
        // relation の members は元の3件のまま (重複追加されていない)
        assert.equal(graph.entity('r_building').members.length, 3);
    });

    it('accepts a standalone way without cascading when not in any relation', () => {
        const n1 = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
        const way = Rapid.osmWay({ id: 'w_solo', nodes: ['n1'], tags: { building: 'yes' } });
        const extGraph = new Rapid.Graph([n1, way]);

        const graph = Rapid.actionRapidAcceptFeature(way.id, extGraph)(new Rapid.Graph());

        // 既存挙動: 単独 way のみ accept
        assert.ok(graph.hasEntity('w_solo'));
    });
});