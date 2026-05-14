import { vecInterp } from '@rapid-sdk/math';

import { osmNode, osmRelation, osmWay } from '../osm/index.js';


function findConnectionPoint(graph, newNode, targetWay, nodeA, nodeB) {
    // Find the place to newNode on targetWay between nodeA and nodeB if it does
    // not alter the existing segment's angle much. There may be other nodes
    // between A and B from user edit or other automatic connections.

    var sortByLon = Math.abs(nodeA.loc[0] - nodeB.loc[0]) > Math.abs(nodeA.loc[1] - nodeB.loc[1]);
    var sortFunc = sortByLon
        ? function(n1, n2) {
            return nodeA.loc[0] < nodeB.loc[0]
                ? n1.loc[0] - n2.loc[0]
                : n2.loc[0] - n1.loc[0];
        }
        : function(n1, n2) {
            return nodeA.loc[1] < nodeB.loc[1]
                ? n1.loc[1] - n2.loc[1]
                : n2.loc[1] - n1.loc[1];
        };

    var nidList = targetWay.nodes;
    var idxA = nidList.indexOf(nodeA.id);
    var idxB = nidList.indexOf(nodeB.id);

    // Invariants for finding the insert index below: A and B must be in the
    // node list, in order, and the sort function must also order A before B
    if (idxA === -1 || idxB === -1 || idxA >= idxB || sortFunc(nodeA, nodeB) >= 0) {
        return null;
    }

    var insertIdx = idxA + 1;  // index to insert immediately before
    while (insertIdx < idxB && sortFunc(newNode, graph.entity(nidList[insertIdx])) > 0) {
        insertIdx++;
    }

    // Find the interpolated point on the segment where insertion will not
    // alter the segment's angle.
    var locA = graph.entity(nidList[insertIdx - 1]).loc;
    var locB = graph.entity(nidList[insertIdx]).loc;
    var locN = newNode.loc;
    var coeff = Math.abs(locA[0] - locB[0]) > Math.abs(locA[1] - locB[1])
        ? (locN[0] - locA[0]) / (locB[0] - locA[0])
        : (locN[1] - locA[1]) / (locB[1] - locA[1]);
    var interpLoc = vecInterp(locA, locB, coeff);

    return {
        insertIdx: insertIdx,
        interpLoc: interpLoc,
    };
}


function locationChanged(loc1, loc2) {
    return Math.abs(loc1[0] - loc2[0]) > 2e-5
        || Math.abs(loc1[1] - loc2[1]) > 2e-5;
}


function removeMetadata(entity) {
    delete entity.__fbid__;
    delete entity.__origid__;    // old
    delete entity.__service__;
    delete entity.__datasetid__;
    delete entity.tags.conn;
    delete entity.tags.orig_id;
    delete entity.tags.debug_way_id;
    delete entity.tags.import;
    delete entity.tags.dupe;
}


export function actionRapidAcceptFeature(entityID, extGraph, options) {
    // Phase 4-C: skipCascade=true で「外側の entry point の cascade のみ抑制」する。
    // acceptRelation 内部の member 走査 (= 入れ子 acceptWay) は inProgressRelations で
    // 自然に再 cascade されない構造なので、このフラグは entry 1段目だけに効けば十分。
    var skipOuterCascade = !!(options && options.skipCascade);

    return function(graph) {
        var seenRelations = {};       // 完了済 relation (relation→relation 再帰防止 + 結果キャッシュ)
        var inProgressRelations = {}; // 処理中 relation (way→relation の再 cascade 防止)
        var extEntity = extGraph.entity(entityID);

        if (extEntity.type === 'node') {
            acceptNode(extEntity);
        } else if (extEntity.type === 'way') {
            acceptWay(extEntity);
        } else if (extEntity.type === 'relation') {
            acceptRelation(extEntity);
        }

        return graph;


        // These functions each accept the external entities, returning the replacement
        // NOTE - these functions will update `graph` closure variable

        function acceptNode(extNode) {
            // copy node before modifying
            var node = osmNode(extNode);
            node.tags = Object.assign({}, node.tags);
            removeMetadata(node);

            graph = graph.replace(node);
            return node;
        }


        function acceptWay(extWay) {
            // Phase 3: PLATEAU LOD2 等で `type=building` relation のメンバーとして
            // 取り込まれた way は、relation 全体 (outline + parts + relation 自体) を
            // 一括 accept する。これにより orphan building:part way が OSM に
            // 上がるのを防ぎ、OSM Simple 3D Buildings の構造を維持する。
            //
            // 注意: acceptRelation の中で member 各 way に対し acceptWay を再帰呼びする
            // ため、inProgressRelations で進行中の親 relation への二重 cascade を防ぐ。
            //
            // Phase 4-C: options.skipCascade で「relation を組まずこの way だけ追加」する
            // opt-out を提供。relation cascade 検出ループ全体を bypass する。
            if (!skipOuterCascade) {
                var parents = extGraph.parentRelations(extWay);
                for (var i = 0; i < parents.length; i++) {
                    var parent = parents[i];
                    if (parent.tags && parent.tags.type === 'building'
                        && !seenRelations[parent.id]
                        && !inProgressRelations[parent.id]) {
                        return acceptRelation(parent);
                    }
                }
            }

            // copy way before modifying
            var way = osmWay(extWay);
            way.nodes = extWay.nodes.slice();
            way.tags = Object.assign({}, way.tags);
            removeMetadata(way);

            var nodes = way.nodes.map(function(nodeId) {
                // copy node before modifying
                var node = osmNode(extGraph.entity(nodeId));
                node.tags = Object.assign({}, node.tags);

                var conn = node.tags.conn && node.tags.conn.split(',');
                var dupeId = node.tags.dupe;
                removeMetadata(node);

                if (dupeId && graph.hasEntity(dupeId) && !locationChanged(graph.entity(dupeId).loc, node.loc)) {
                    node = graph.entity(dupeId);           // keep original node with dupeId
                } else if (graph.hasEntity(node.id) && locationChanged(graph.entity(node.id).loc, node.loc)) {
                    node = osmNode({ loc: node.loc });     // replace (unnecessary copy of node?)
                }

                if (conn && graph.hasEntity(conn[0])) {
                    //conn=w316746574,n3229071295,n3229071273
                    var targetWay = graph.hasEntity(conn[0]);
                    var nodeA = graph.hasEntity(conn[1]);
                    var nodeB = graph.hasEntity(conn[2]);

                    if (targetWay && nodeA && nodeB) {
                        var result = findConnectionPoint(graph, node, targetWay, nodeA, nodeB);
                        if (result && !locationChanged(result.interpLoc, node.loc)) {
                            node.loc = result.interpLoc;
                            graph = graph.replace(targetWay.addNode(node.id, result.insertIdx));
                        }
                    }
                }

                graph = graph.replace(node);
                return node.id;
            });

            way = way.update({ nodes: nodes });
            graph = graph.replace(way);
            return way;
        }


        function acceptRelation(extRelation) {
            var seen = seenRelations[extRelation.id];
            if (seen) return seen;

            // 処理中マーク (member の acceptWay からの再 cascade を防ぐ)
            inProgressRelations[extRelation.id] = true;

            // copy relation before modifying
            var relation = osmRelation(extRelation);
            relation.members = extRelation.members.slice();
            relation.tags = Object.assign({}, extRelation.tags);
            removeMetadata(relation);

            var members = relation.members.map(function(member) {
                var extEntity = extGraph.entity(member.id);
                if (!extEntity) {
                    // メンバーが extGraph に存在しない場合 (bbox 外などで dataset graph に入っていない)
                    // → そのメンバー参照は保持しつつ accept はスキップ
                    return member;
                }
                var replacement;

                if (extEntity.type === 'node') {
                    replacement = acceptNode(extEntity);
                } else if (extEntity.type === 'way') {
                    replacement = acceptWay(extEntity);
                } else if (extEntity.type === 'relation') {
                    replacement = acceptRelation(extEntity);
                }

                if (!replacement) return member;
                return Object.assign(member, { id: replacement.id });
            });

            relation = relation.update({ members: members });
            graph = graph.replace(relation);
            seenRelations[extRelation.id] = relation;
            delete inProgressRelations[extRelation.id];
            return relation;
        }

    };
}
