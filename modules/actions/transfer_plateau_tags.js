// Add PLATEAU-derived tag values to an OSM entity, but only for keys the
// entity does not already have. Never overwrites existing values.
export function actionTransferPlateauTags(entityID, tags) {
  const action = function(graph) {
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

  // Lets callers (e.g. `HeightTransferMode`) identify this action after the
  // fact. `EditSystem`'s history stores Graphs, not the action functions
  // that produced them, so this marker alone can't be recovered from undo/redo
  // history directly -- callers that need that should read it off the
  // action *before* dispatch and stash the identifier in the edit annotation
  // (see `HeightTransferMode.apply`), which the editor does retain per-Edit.
  action.actionName = 'transfer_plateau_tags';
  return action;
}
