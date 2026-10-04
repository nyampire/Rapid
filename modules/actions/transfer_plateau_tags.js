// PLATEAU の値を OSM の entity に転記する。
// addTags は、entity に値が無いキーだけを足し、既存の値は書き換えない。
// replaceTags は、entity の値を渡された値で置き換える。
// replaceTags を省いたときは、既存の値を 1 つも書き換えない。
export function actionTransferPlateauTags(entityID, addTags, replaceTags = {}) {
  const action = function(graph) {
    const entity = graph.entity(entityID);
    const existing = entity.tags ?? {};
    const merged = { ...existing };
    let changed = false;
    for (const [k, v] of Object.entries(addTags ?? {})) {
      if (existing[k] !== undefined && existing[k] !== null && existing[k] !== '') continue;
      merged[k] = v;
      changed = true;
    }
    for (const [k, v] of Object.entries(replaceTags ?? {})) {
      if (existing[k] === v) continue;
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
