// Add PLATEAU-derived tag values to an OSM entity, but only for keys the
// entity does not already have. Never overwrites existing values.
export function actionTransferPlateauTags(entityID, tags) {
  return function(graph) {
    const entity = graph.entity(entityID);
    const existing = entity.tags ?? {};
    const merged = { ...existing };
    let changed = false;
    for (const [k, v] of Object.entries(tags)) {
      if (existing[k] !== undefined && existing[k] !== null && existing[k] !== '') continue;
      merged[k] = v;
      changed = true;
    }
    if (!changed) return graph;
    return graph.replace(entity.update({ tags: merged }));
  };
}
