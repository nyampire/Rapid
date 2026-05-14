/**
 * utilBuildingRelationInfo
 *
 * 指定 entity が `type=building` relation (Simple 3D Buildings / PLATEAU LOD2 の構造) の
 * メンバー way である場合に、その relation 情報を返す。それ以外は null。
 *
 * UiRapidInspector や conflation ロジックから、UI 表示 / 動作判定の両方で使用。
 *
 * @param  {Object|null}  entity - osmEntity (typically a way)
 * @param  {Graph|null}   graph  - 該当 entity の含まれる Graph (parentRelations を提供)
 * @return {{relation: osmRelation, outlineCount: number, partCount: number} | null}
 */
export function utilBuildingRelationInfo(entity, graph) {
  if (!entity || entity.type !== 'way') return null;
  if (!graph || typeof graph.parentRelations !== 'function') return null;

  let parents;
  try {
    parents = graph.parentRelations(entity);
  } catch (e) {
    return null;
  }

  const relation = parents.find(r => r.tags && r.tags.type === 'building');
  if (!relation) return null;

  let outlineCount = 0;
  let partCount = 0;
  for (const m of relation.members || []) {
    if (m.role === 'outline') outlineCount++;
    else if (m.role === 'part') partCount++;
  }
  return { relation, outlineCount, partCount };
}
