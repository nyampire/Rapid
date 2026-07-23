import { osmNode } from '../osm/index.js';

// Plateau-internal metadata that must never reach OSM.
const INTERNAL_TAGS = new Set(['conn', 'dupe', 'orig_id', 'debug_way_id', 'import']);

// Replace an OSM building way's geometry with a Plateau outline while keeping
// the OSM way's id (and therefore its version/history). Tags are merged
// non-destructively: existing OSM values win, empty keys are filled from Plateau.
export function actionReplaceBuildingGeometry(osmWayID, plateauWay, plateauGraph) {
  const action = function(graph) {
    const osmWay = graph.entity(osmWayID);

    // 1. Build new nodes at the Plateau outline coords. Reuse one new node per
    //    Plateau node id, so a closing first==last ref closes the new ring too.
    let g = graph;
    const idMap = new Map();   // plateauNodeID -> new osmNode
    const newNodeIDs = [];
    for (const pid of plateauWay.nodes) {
      let nn = idMap.get(pid);
      if (!nn) {
        const loc = plateauGraph.entity(pid).loc;
        nn = osmNode({ loc });
        idMap.set(pid, nn);
        g = g.replace(nn);
      }
      newNodeIDs.push(nn.id);
    }

    // 2. Non-destructive tag merge (OSM wins).
    const merged = { ...osmWay.tags };
    for (const [k, v] of Object.entries(plateauWay.tags ?? {})) {
      if (INTERNAL_TAGS.has(k)) continue;
      if (merged[k] === undefined || merged[k] === null || merged[k] === '') merged[k] = v;
    }

    // 3. Replace the way in place (id/version kept by `update`).
    const oldNodeIDs = osmWay.nodes.slice();
    g = g.replace(osmWay.update({ nodes: newNodeIDs, tags: merged }));

    // 4. Drop old nodes that are now orphaned (no way/relation references them).
    for (const oid of new Set(oldNodeIDs)) {
      if (!g.hasEntity(oid)) continue;
      const node = g.entity(oid);
      if (g.parentWays(node).length === 0 && g.parentRelations(node).length === 0) {
        g = g.remove(node);
      }
    }

    return g;
  };

  action.actionName = 'replace_building_geometry';
  return action;
}
