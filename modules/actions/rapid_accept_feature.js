import { Extent, geoMetersToLat, geoMetersToLon, geoSphericalDistance, vecInterp, vecProject } from '@rapid-sdk/math';

import { osmNode, osmRelation, osmWay } from '../osm/index.js';
import { osmRoutableHighwayTagValues } from '../osm/tags.js';

const AUTO_CONNECT_METERS = 5;    // max distance to snap endpoint to nearby highway
const NODE_MERGE_METERS = 1;   // reuse existing node if within this distance


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

    // Phase 4-B-2 (描画修正): cascade で実際に accept された全 entity ID を集める。
    // 呼び出し側 (UiRapidInspector) はこれを annotation.entityIDs に詰めて commit し、
    // RapidSystem._stablechange でこの ID 群を一括 acceptIDs に追加することで、
    // Rapid layer のフィルタが cascade 全 member に効くようにする。
    var acceptedIDs = (options && Array.isArray(options.acceptedIDs)) ? options.acceptedIDs : null;
    function recordAccepted(id) {
        if (acceptedIDs && id) acceptedIDs.push(id);
    }

    // upstream (PR #1769): auto-connect 用に渡される RBush tree。
    // 旧 signature `actionRapidAcceptFeature(id, graph, tree)` を踏襲する呼び出しがあれば
    // options に tree を畳み込んで渡すこと: `{ skipCascade, acceptedIDs, tree }`。
    var tree = options && options.tree;

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


        function canConnect(way1, way2) {
            if (way1.id === way2.id) return false;

            var b1 = way1.tags.bridge && way1.tags.bridge !== 'no';
            var b2 = way2.tags.bridge && way2.tags.bridge !== 'no';
            if ((b1 || b2) && !(b1 && b2)) return false;

            var t1 = way1.tags.tunnel && way1.tags.tunnel !== 'no';
            var t2 = way2.tags.tunnel && way2.tags.tunnel !== 'no';
            if ((t1 || t2) && !(t1 && t2)) return false;

            if ((way1.tags.layer || '0') !== (way2.tags.layer || '0')) return false;
            if ((way1.tags.level || '0') !== (way2.tags.level || '0')) return false;

            return true;
        }


        function autoConnectEndpoint(node, acceptedWay) {
            if (!tree) return null;

            var loc = node.loc;
            var lonRange = geoMetersToLon(AUTO_CONNECT_METERS, loc[1]);
            var latRange = geoMetersToLat(AUTO_CONNECT_METERS);
            var queryExtent = new Extent(
                [loc[0] - lonRange, loc[1] - latRange],
                [loc[0] + lonRange, loc[1] + latRange]
            );

            var segmentInfos = tree.waySegments(queryExtent, graph);
            var bestDist = Infinity;
            var bestResult = null;

            var targetWay;
            for (var i = 0; i < segmentInfos.length; i++) {
                var segInfo = segmentInfos[i];
                targetWay = graph.hasEntity(segInfo.wayId);
                if (!targetWay) continue;
                if (!targetWay.tags.highway || !osmRoutableHighwayTagValues[targetWay.tags.highway]) continue;
                if (!canConnect(acceptedWay, targetWay)) continue;

                var nA = graph.hasEntity(segInfo.nodes[0]);
                var nB = graph.hasEntity(segInfo.nodes[1]);
                if (!nA || !nB) continue;

                // Check for node merge (dupe-like) — prefer merging to existing endpoints
                var distA = geoSphericalDistance(loc, nA.loc);
                if (distA < NODE_MERGE_METERS && distA < bestDist) {
                    bestDist = distA;
                    bestResult = { mergeNodeId: nA.id, targetWayId: segInfo.wayId };
                }
                var distB = geoSphericalDistance(loc, nB.loc);
                if (distB < NODE_MERGE_METERS && distB < bestDist) {
                    bestDist = distB;
                    bestResult = { mergeNodeId: nB.id, targetWayId: segInfo.wayId };
                }

                // Project onto segment
                var projected = vecProject(loc, [nA.loc, nB.loc]);
                if (projected) {
                    var projDist = geoSphericalDistance(loc, projected.target);
                    if (projDist < AUTO_CONNECT_METERS && projDist < bestDist) {
                        // If projection lands near an existing segment endpoint, merge instead of snap
                        var distToA = geoSphericalDistance(projected.target, nA.loc);
                        var distToB = geoSphericalDistance(projected.target, nB.loc);
                        if (distToA < NODE_MERGE_METERS) {
                            bestDist = projDist;
                            bestResult = { mergeNodeId: nA.id, targetWayId: segInfo.wayId };
                        } else if (distToB < NODE_MERGE_METERS) {
                            bestDist = projDist;
                            bestResult = { mergeNodeId: nB.id, targetWayId: segInfo.wayId };
                        } else {
                            bestDist = projDist;
                            bestResult = { snapLoc: projected.target, edge: [nA.id, nB.id], targetWayId: segInfo.wayId };
                        }
                    }
                }
            }

            if (!bestResult) return null;

            // Get the connected highway tag before modifying the graph
            var connectedHighwayTag = graph.entity(bestResult.targetWayId).tags.highway;

            if (bestResult.mergeNodeId) {
                // Replace endpoint references in accepted way with existing node
                var updatedNodes = acceptedWay.nodes.map(function(nid) {
                    return nid === node.id ? bestResult.mergeNodeId : nid;
                });
                graph = graph.replace(acceptedWay.update({ nodes: updatedNodes }));
                // Remove the orphaned original node
                graph = graph.remove(node);
            } else {
                // Snap node to projected point on segment, splice into target way
                node = node.move(bestResult.snapLoc);
                graph = graph.replace(node);

                targetWay = graph.entity(bestResult.targetWayId);
                var nidList = targetWay.nodes;
                var nAid = bestResult.edge[0];
                var nBid = bestResult.edge[1];

                // Find the exact edge in the target way's node list
                for (var k = 0; k < nidList.length - 1; k++) {
                    if (nidList[k] === nAid && nidList[k + 1] === nBid) {
                        graph = graph.replace(targetWay.addNode(node.id, k + 1));
                        break;
                    }
                }
            }

            return connectedHighwayTag;
        }


        // These functions each accept the external entities, returning the replacement
        // NOTE - these functions will update `graph` closure variable

        function acceptNode(extNode) {
            // copy node before modifying
            var node = osmNode(extNode);
            node.tags = Object.assign({}, node.tags);
            removeMetadata(node);

            graph = graph.replace(node);
            recordAccepted(node.id);
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
                    // メンバー way だけを accept すると壊れる 2 つの構造を cascade する。
                    //
                    // type=building は PLATEAU LOD2 の outline + parts。
                    // メンバー way は自分のタグを持つが、relation を落とすと構造が失われる。
                    //
                    // type=multipolygon は複数リングのポリゴンで、外形が outer、穴が inner。
                    // **メンバー way はタグを持たず、タグは relation にしか無い。**
                    // cascade しないと acceptWay に落ちて、タグの無い way が OSM に上がる。
                    // 中庭のある PLATEAU の建物がこの形で届くが、Esri も複数リングの
                    // ポリゴンを同じ形で作る (EsriService.js の multiple rings 分岐)。
                    // 建物に限らないので、building タグでは絞らない。
                    var parentType = parent.tags && parent.tags.type;
                    if ((parentType === 'building' || parentType === 'multipolygon')
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

            var firstNodeHadConn = false;
            var lastNodeHadConn = false;

            var nodes = way.nodes.map(function(nodeId, index) {
                // copy node before modifying
                var node = osmNode(extGraph.entity(nodeId));
                node.tags = Object.assign({}, node.tags);

                var conn = node.tags.conn && node.tags.conn.split(',');
                var dupeId = node.tags.dupe;

                // Track endpoints with existing connection metadata
                if (index === 0 && (conn || dupeId)) firstNodeHadConn = true;
                if (index === extWay.nodes.length - 1 && (conn || dupeId)) lastNodeHadConn = true;

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

            // upstream (PR #1769): auto-connect endpoints that had no conn/dupe tags.
            // Only runs when caller supplied a `tree` (RBush index) via options.tree.
            if (tree && !way.isClosed()) {
                var connectedHighwayTag = null;
                var tag;
                if (!firstNodeHadConn) {
                    tag = autoConnectEndpoint(graph.entity(way.nodes[0]), graph.entity(way.id));
                    if (tag) connectedHighwayTag = tag;
                    way = graph.entity(way.id);  // re-fetch after potential modification
                }
                if (!lastNodeHadConn) {
                    tag = autoConnectEndpoint(graph.entity(way.nodes[way.nodes.length - 1]), graph.entity(way.id));
                    if (tag) connectedHighwayTag = tag;
                    way = graph.entity(way.id);  // re-fetch after potential modification
                }

                // Inherit highway tag from connected way if accepted way has generic 'road' classification
                if (connectedHighwayTag && way.tags.highway === 'road') {
                    graph = graph.replace(way.update({ tags: Object.assign({}, way.tags, { highway: connectedHighwayTag }) }));
                }
            }

            recordAccepted(way.id);
            return graph.entity(way.id);
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
                // extGraph.entity() は見つからない場合 throw するため、hasEntity を使う。
                // bbox 外や未ロードの member 参照は保持しつつ、accept 自体はスキップする。
                var extEntity = extGraph.hasEntity(member.id);
                if (!extEntity) {
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
            recordAccepted(relation.id);
            return relation;
        }

    };
}
