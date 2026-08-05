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
        assert.ok(graph.hasEntity(node.id));
        assert.ok(graph.hasEntity(way.id));
    });


    it('accepts a way with duplicate nodes', () => {
        const node1 = Rapid.osmNode({ id: 'a', loc: [0, 0] });
        const node2 = Rapid.osmNode({ id: 'b', loc: [1, 1], tags: { dupe: 'a' } });
        const way = Rapid.osmWay({ id: 'w', nodes: [node1.id, node2.id] });
        const graph = Rapid.actionRapidAcceptFeature(way.id, new Rapid.Graph([node1, node2, way]))(new Rapid.Graph());
        assert.ok(graph.hasEntity(way.id));
    });


    it('accepts a relation with nested relations', () => {
        const node = Rapid.osmNode({ id: 'a', loc: [0, 0] });
        const way = Rapid.osmWay({ id: 'w', nodes: [node.id] });
        const relation1 = Rapid.osmRelation({ id: 'r1', members: [{ id: way.id }] });
        const relation2 = Rapid.osmRelation({ id: 'r2', members: [{ id: relation1.id }] });
        const graph = Rapid.actionRapidAcceptFeature(relation2.id, new Rapid.Graph([node, way, relation1, relation2]))(new Rapid.Graph());
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


    // ----------------------------------------------------------------------
    // Phase 4-C: skipCascade opt-out
    // 「relation 全体ではなく、この way だけ追加したい」上級ユーザー向けオプション
    // ----------------------------------------------------------------------

    it('skipCascade=true adds only the way, not the parent building relation', () => {
        const n1 = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
        const outline = Rapid.osmWay({ id: 'w_outline', nodes: ['n1'], tags: { building: 'yes' } });
        const part = Rapid.osmWay({ id: 'w_part', nodes: ['n1'], tags: { 'building:part': 'yes' } });
        const relation = Rapid.osmRelation({
            id: 'r_building',
            tags: { type: 'building', building: 'yes' },
            members: [
                { id: outline.id, type: 'way', role: 'outline' },
                { id: part.id, type: 'way', role: 'part' },
            ],
        });
        const extGraph = new Rapid.Graph([n1, outline, part, relation]);

        // part に対して skipCascade=true で accept
        const graph = Rapid.actionRapidAcceptFeature(part.id, extGraph, { skipCascade: true })(new Rapid.Graph());

        // part だけが追加され、relation / outline は追加されない
        assert.ok(graph.hasEntity('w_part'));
        assert.ok(!graph.hasEntity('r_building'), 'relation should NOT be cascaded when skipCascade=true');
        assert.ok(!graph.hasEntity('w_outline'), 'outline should NOT be cascaded when skipCascade=true');
    });

    it('skipCascade=true on outline adds only the outline, not parts or relation', () => {
        const n1 = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
        const outline = Rapid.osmWay({ id: 'w_outline', nodes: ['n1'], tags: { building: 'yes' } });
        const part = Rapid.osmWay({ id: 'w_part', nodes: ['n1'], tags: { 'building:part': 'yes' } });
        const relation = Rapid.osmRelation({
            id: 'r_building',
            tags: { type: 'building' },
            members: [
                { id: outline.id, type: 'way', role: 'outline' },
                { id: part.id, type: 'way', role: 'part' },
            ],
        });
        const extGraph = new Rapid.Graph([n1, outline, part, relation]);

        const graph = Rapid.actionRapidAcceptFeature(outline.id, extGraph, { skipCascade: true })(new Rapid.Graph());

        assert.ok(graph.hasEntity('w_outline'));
        assert.ok(!graph.hasEntity('r_building'));
        assert.ok(!graph.hasEntity('w_part'));
    });

    it('skipCascade=false (or omitted) cascades to the parent building relation', () => {
        const n1 = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
        const outline = Rapid.osmWay({ id: 'w_outline', nodes: ['n1'], tags: { building: 'yes' } });
        const part = Rapid.osmWay({ id: 'w_part', nodes: ['n1'], tags: { 'building:part': 'yes' } });
        const relation = Rapid.osmRelation({
            id: 'r_building',
            tags: { type: 'building' },
            members: [
                { id: outline.id, type: 'way', role: 'outline' },
                { id: part.id, type: 'way', role: 'part' },
            ],
        });
        const extGraph = new Rapid.Graph([n1, outline, part, relation]);

        // skipCascade=false: 既存の Phase 3 挙動 (relation 全体追加)
        const graphFalse = Rapid.actionRapidAcceptFeature(part.id, extGraph, { skipCascade: false })(new Rapid.Graph());
        assert.ok(graphFalse.hasEntity('r_building'));
        assert.ok(graphFalse.hasEntity('w_outline'));
        assert.ok(graphFalse.hasEntity('w_part'));

        // options 省略時: 同じ挙動 (cascade)
        const graphOmit = Rapid.actionRapidAcceptFeature(part.id, extGraph)(new Rapid.Graph());
        assert.ok(graphOmit.hasEntity('r_building'));
        assert.ok(graphOmit.hasEntity('w_outline'));
        assert.ok(graphOmit.hasEntity('w_part'));
    });

    it('skipCascade=true on a relation directly still processes the relation and its members', () => {
        // user が直接 relation を accept した時、skipCascade は entry が way の場合のみ意味を持つ。
        // relation の入口は acceptRelation で、その内部の acceptWay 再帰は inProgressRelations で
        // 自然に cascade されないので、skipCascade=true でも relation の全体追加は機能する。
        const n1 = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
        const outline = Rapid.osmWay({ id: 'w_outline', nodes: ['n1'], tags: { building: 'yes' } });
        const part = Rapid.osmWay({ id: 'w_part', nodes: ['n1'], tags: { 'building:part': 'yes' } });
        const relation = Rapid.osmRelation({
            id: 'r_building',
            tags: { type: 'building' },
            members: [
                { id: outline.id, type: 'way', role: 'outline' },
                { id: part.id, type: 'way', role: 'part' },
            ],
        });
        const extGraph = new Rapid.Graph([n1, outline, part, relation]);

        const graph = Rapid.actionRapidAcceptFeature(relation.id, extGraph, { skipCascade: true })(new Rapid.Graph());

        // relation を entry にした場合、skipCascade は単に「内部 acceptWay の冒頭 cascade 判定を bypass する」
        // 効果しかなく、acceptRelation 自体は member を順に accept する。
        // 結果として relation + 全 member が graph に入る。
        assert.ok(graph.hasEntity('r_building'));
        assert.ok(graph.hasEntity('w_outline'));
        assert.ok(graph.hasEntity('w_part'));
    });


    describe('auto-connect endpoints', () => {
        // Helper: build an OSM graph containing the given entities, and a Tree indexing them
        function buildOsmScene(osmEntities) {
            const osmGraph = new Rapid.Graph(osmEntities);
            const tree = new Rapid.Tree(osmGraph);
            tree.rebase(osmEntities);
            return { osmGraph, tree };
        }

        // Shared fixture: east-west residential highway [0,0] -> [1,0]
        function makeHighway(tags) {
            const hwyN1 = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
            const hwyN2 = Rapid.osmNode({ id: 'n2', loc: [1, 0] });
            const highway = Rapid.osmWay({ id: 'w1', nodes: ['n1', 'n2'],
                tags: Object.assign({ highway: 'residential' }, tags) });
            return [hwyN1, hwyN2, highway];
        }

        // Helper: build a TomTom external graph with a 2-node way
        // First node at [0.5, 0.5], second node at the given loc
        function makeExtGraph(endpointLoc, wayTags) {
            const extN1 = Rapid.osmNode({ id: 'e1', loc: [0.5, 0.5] });
            const extN2 = Rapid.osmNode({ id: 'e2', loc: endpointLoc });
            const extWay = Rapid.osmWay({ id: 'ew1', nodes: ['e1', 'e2'],
                tags: Object.assign({ highway: 'tertiary' }, wayTags) });
            return new Rapid.Graph([extN1, extN2, extWay]);
        }

        // Helper: build ext graph where nodes have custom tags
        function makeExtGraphWithNodeTags(endpointLoc, nodeTags, wayTags) {
            const extN1 = Rapid.osmNode({ id: 'e1', loc: [0.5, 0.5] });
            const extN2 = Rapid.osmNode({ id: 'e2', loc: endpointLoc, tags: nodeTags });
            const extWay = Rapid.osmWay({ id: 'ew1', nodes: ['e1', 'e2'],
                tags: Object.assign({ highway: 'tertiary' }, wayTags) });
            return new Rapid.Graph([extN1, extN2, extWay]);
        }


        it('auto-connects endpoint to nearby highway segment', () => {
            const { osmGraph, tree } = buildOsmScene(makeHighway());
            const extGraph = makeExtGraph([0.5, 0.00003]);  // ~3m from highway

            const result = Rapid.actionRapidAcceptFeature('ew1', extGraph, { tree })(osmGraph);

            const acceptedWay = result.entity('ew1');
            const endNode = result.entity(acceptedWay.nodes[acceptedWay.nodes.length - 1]);
            assert.ok(Math.abs(endNode.loc[1]) < 0.0001, 'endpoint should be snapped to highway latitude');

            const updatedHighway = result.entity('w1');
            assert.ok(updatedHighway.nodes.length === 3, 'highway should have 3 nodes after splice');
            assert.ok(updatedHighway.nodes.includes(endNode.id), 'highway should include the snapped node');
        });


        it('merges endpoint with nearby existing node', () => {
            const hwyN1 = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
            const hwyN2 = Rapid.osmNode({ id: 'n2', loc: [0.5, 0] });
            const hwyN3 = Rapid.osmNode({ id: 'n3', loc: [1, 0] });
            const highway = Rapid.osmWay({ id: 'w1', nodes: ['n1', 'n2', 'n3'], tags: { highway: 'residential' } });
            const { osmGraph, tree } = buildOsmScene([hwyN1, hwyN2, hwyN3, highway]);

            const extGraph = makeExtGraph([0.5, 0.000005]);  // ~0.5m from n2

            const result = Rapid.actionRapidAcceptFeature('ew1', extGraph, { tree })(osmGraph);

            const acceptedWay = result.entity('ew1');
            assert.equal(acceptedWay.nodes[acceptedWay.nodes.length - 1], 'n2',
                'endpoint should be merged with existing highway node');
            assert.ok(!result.hasEntity('e2'), 'orphaned original node should be removed');
        });


        it('merges instead of creating duplicate when projection lands on existing node', () => {
            const { osmGraph, tree } = buildOsmScene(makeHighway());

            // Endpoint near n1 but off-axis — projection clamps to n1's location
            const extN1 = Rapid.osmNode({ id: 'e1', loc: [-0.5, 0.5] });
            const extN2 = Rapid.osmNode({ id: 'e2', loc: [-0.00001, 0.00003] });
            const extWay = Rapid.osmWay({ id: 'ew1', nodes: ['e1', 'e2'], tags: { highway: 'tertiary' } });
            const extGraph = new Rapid.Graph([extN1, extN2, extWay]);

            const result = Rapid.actionRapidAcceptFeature('ew1', extGraph, { tree })(osmGraph);

            const acceptedWay = result.entity('ew1');
            assert.equal(acceptedWay.nodes[acceptedWay.nodes.length - 1], 'n1',
                'endpoint should be merged with nearby highway node, not duplicated');
            const updatedHighway = result.entity('w1');
            assert.equal(updatedHighway.nodes.length, 2, 'highway should still have 2 nodes (no duplicate)');
        });


        it('does not connect when distance exceeds threshold', () => {
            const { osmGraph, tree } = buildOsmScene(makeHighway());
            const extGraph = makeExtGraph([0.5, 0.0002]);  // ~22m away

            const result = Rapid.actionRapidAcceptFeature('ew1', extGraph, { tree })(osmGraph);

            const updatedHighway = result.entity('w1');
            assert.equal(updatedHighway.nodes.length, 2, 'highway should still have 2 nodes');
            const acceptedWay = result.entity('ew1');
            const endNode = result.entity(acceptedWay.nodes[acceptedWay.nodes.length - 1]);
            assert.ok(Math.abs(endNode.loc[1] - 0.0002) < 0.0001, 'endpoint should not be moved');
        });


        it('does not connect across different layers', () => {
            const { osmGraph, tree } = buildOsmScene(makeHighway({ bridge: 'yes', layer: '1' }));
            const extGraph = makeExtGraph([0.5, 0.00003]);  // ~3m from bridge

            const result = Rapid.actionRapidAcceptFeature('ew1', extGraph, { tree })(osmGraph);

            const updatedHighway = result.entity('w1');
            assert.equal(updatedHighway.nodes.length, 2, 'highway should still have 2 nodes');
        });


        it('preserves existing conn tag behavior', () => {
            const { osmGraph, tree } = buildOsmScene(makeHighway());
            const extGraph = makeExtGraphWithNodeTags(
                [0.5, 0.00003], { conn: 'w1,n1,n2' }
            );

            const result = Rapid.actionRapidAcceptFeature('ew1', extGraph, { tree })(osmGraph);

            const acceptedWay = result.entity('ew1');
            assert.ok(acceptedWay, 'way should be accepted');
            const endNode = result.entity(acceptedWay.nodes[acceptedWay.nodes.length - 1]);
            assert.ok(!endNode.tags.conn, 'conn tag should be removed');
        });


        it('skips auto-connect when tree is null', () => {
            const osmGraph = new Rapid.Graph(makeHighway());
            const extGraph = makeExtGraph([0.5, 0.00003]);

            const result = Rapid.actionRapidAcceptFeature('ew1', extGraph)(osmGraph);

            assert.ok(result.hasEntity('ew1'), 'way should be accepted');
            const updatedHighway = result.entity('w1');
            assert.equal(updatedHighway.nodes.length, 2, 'highway should remain unchanged');
        });


        it('connects both endpoints independently', () => {
            const hwyN1 = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
            const hwyN2 = Rapid.osmNode({ id: 'n2', loc: [1, 0] });
            const highway1 = Rapid.osmWay({ id: 'w1', nodes: ['n1', 'n2'], tags: { highway: 'residential' } });
            const hwyN3 = Rapid.osmNode({ id: 'n3', loc: [0, 1] });
            const hwyN4 = Rapid.osmNode({ id: 'n4', loc: [1, 1] });
            const highway2 = Rapid.osmWay({ id: 'w2', nodes: ['n3', 'n4'], tags: { highway: 'residential' } });
            const { osmGraph, tree } = buildOsmScene([hwyN1, hwyN2, highway1, hwyN3, hwyN4, highway2]);

            const extN1 = Rapid.osmNode({ id: 'e1', loc: [0.5, 0.00003] });   // ~3m from highway1
            const extN2 = Rapid.osmNode({ id: 'e2', loc: [0.5, 0.99997] });   // ~3m from highway2
            const extWay = Rapid.osmWay({ id: 'ew1', nodes: ['e1', 'e2'], tags: { highway: 'tertiary' } });
            const extGraph = new Rapid.Graph([extN1, extN2, extWay]);

            const result = Rapid.actionRapidAcceptFeature('ew1', extGraph, { tree })(osmGraph);

            assert.equal(result.entity('w1').nodes.length, 3, 'highway1 should have 3 nodes after splice');
            assert.equal(result.entity('w2').nodes.length, 3, 'highway2 should have 3 nodes after splice');
        });


        it('inherits highway tag from connected way when accepted way has highway=road', () => {
            const { osmGraph, tree } = buildOsmScene(makeHighway());
            const extGraph = makeExtGraph([0.5, 0.00003], { highway: 'road' });

            const result = Rapid.actionRapidAcceptFeature('ew1', extGraph, { tree })(osmGraph);

            const acceptedWay = result.entity('ew1');
            assert.equal(acceptedWay.tags.highway, 'residential',
                'highway tag should be inherited from connected way');
        });


        it('does not inherit highway tag when accepted way has a specific classification', () => {
            const { osmGraph, tree } = buildOsmScene(makeHighway());
            const extGraph = makeExtGraph([0.5, 0.00003]);  // default: highway=tertiary

            const result = Rapid.actionRapidAcceptFeature('ew1', extGraph, { tree })(osmGraph);

            const acceptedWay = result.entity('ew1');
            assert.equal(acceptedWay.tags.highway, 'tertiary',
                'highway tag should not be overwritten when it is already specific');
        });
    });


    describe('type=multipolygon (courtyard building)', () => {
        // 中庭のある建物。outer が外形、inner が穴。
        // タグは relation にだけ付き、メンバー way はタグを持たない。
        function makeCourtyardGraph() {
            const n1 = Rapid.osmNode({ id: 'n1', loc: [0, 0] });
            const n2 = Rapid.osmNode({ id: 'n2', loc: [1, 0] });
            const n3 = Rapid.osmNode({ id: 'n3', loc: [1, 1] });
            const n4 = Rapid.osmNode({ id: 'n4', loc: [0, 1] });
            const n5 = Rapid.osmNode({ id: 'n5', loc: [0.4, 0.4] });
            const n6 = Rapid.osmNode({ id: 'n6', loc: [0.6, 0.4] });
            const n7 = Rapid.osmNode({ id: 'n7', loc: [0.6, 0.6] });
            const n8 = Rapid.osmNode({ id: 'n8', loc: [0.4, 0.6] });
            const outer = Rapid.osmWay({ id: 'w_outer', nodes: ['n1','n2','n3','n4','n1'] });
            const inner = Rapid.osmWay({ id: 'w_inner', nodes: ['n5','n6','n7','n8','n5'] });
            const relation = Rapid.osmRelation({
                id: 'r_mp',
                tags: { type: 'multipolygon', building: 'yes', height: '12' },
                members: [
                    { id: outer.id, type: 'way', role: 'outer' },
                    { id: inner.id, type: 'way', role: 'inner' }
                ]
            });
            const extGraph = new Rapid.Graph([n1,n2,n3,n4,n5,n6,n7,n8, outer, inner, relation]);
            return { extGraph, outer, inner, relation };
        }

        it('accepts the whole relation when the outer way is clicked', () => {
            const { extGraph, outer } = makeCourtyardGraph();
            const graph = Rapid.actionRapidAcceptFeature(outer.id, extGraph)(new Rapid.Graph());

            assert.ok(graph.hasEntity('r_mp'), 'relation not in graph');
            assert.ok(graph.hasEntity('w_outer'), 'outer not in graph');
            assert.ok(graph.hasEntity('w_inner'), 'inner not in graph');
        });

        it('accepts the whole relation when the inner way is clicked', () => {
            const { extGraph, inner } = makeCourtyardGraph();
            const graph = Rapid.actionRapidAcceptFeature(inner.id, extGraph)(new Rapid.Graph());

            assert.ok(graph.hasEntity('r_mp'));
            assert.ok(graph.hasEntity('w_outer'));
            assert.ok(graph.hasEntity('w_inner'));
        });

        it('keeps the tags on the relation and none on the member ways', () => {
            const { extGraph, outer } = makeCourtyardGraph();
            const graph = Rapid.actionRapidAcceptFeature(outer.id, extGraph)(new Rapid.Graph());

            const rel = graph.entity('r_mp');
            assert.equal(rel.tags.type, 'multipolygon');
            assert.equal(rel.tags.building, 'yes');
            assert.equal(rel.tags.height, '12');

            // メンバー way にタグは足さない。relation にあるものをコピーしない。
            assert.equal(graph.entity('w_outer').tags.building, undefined);
            assert.equal(graph.entity('w_inner').tags.building, undefined);
        });

        it('keeps the member roles', () => {
            const { extGraph, outer } = makeCourtyardGraph();
            const graph = Rapid.actionRapidAcceptFeature(outer.id, extGraph)(new Rapid.Graph());

            const roles = {};
            for (const m of graph.entity('r_mp').members) roles[m.role] = m.id;
            assert.equal(roles.outer, 'w_outer');
            assert.equal(roles.inner, 'w_inner');
        });

        it('adds only the clicked way when skipCascade is set', () => {
            // action 自体は skipCascade を尊重する。UI 側が multipolygon で
            // この選択肢を出さないことは Task 2 で担保する。
            const { extGraph, outer } = makeCourtyardGraph();
            const graph = Rapid.actionRapidAcceptFeature(
                outer.id, extGraph, { skipCascade: true }
            )(new Rapid.Graph());

            assert.ok(graph.hasEntity('w_outer'));
            assert.equal(graph.hasEntity('r_mp'), undefined);
        });
    });
});
