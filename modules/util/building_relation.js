/**
 * utilBuildingRelationInfo
 *
 * 指定 entity が「1 棟の建物」を表す relation のメンバー way である場合に、その relation
 * 情報を返す。それ以外は null。
 *
 * 対象は 2 種類ある。
 * type=building は Simple 3D Buildings / PLATEAU LOD2 の構造で、外形が役割 outline、
 * 内訳が part。メンバー way はそれぞれ自分のタグを持つ。
 * type=multipolygon は中庭のある建物で、外形が outer、穴が inner。
 * **タグは relation にだけ付き、メンバー way はタグを持たない。**
 *
 * UiRapidInspector や conflation ロジックから、UI 表示 / 動作判定の両方で使用。
 *
 * @param  {Object|null}  entity - osmEntity (typically a way)
 * @param  {Graph|null}   graph  - 該当 entity の含まれる Graph (parentRelations を提供)
 * @return {{relation: osmRelation, outlineCount: number, partCount: number,
 *           relationType: string} | null}
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

  const relation = parents.find(r => {
    if (!r.tags) return false;
    if (r.tags.type === 'building') return true;
    // 建物でない multipolygon (森林など) は対象外。
    return r.tags.type === 'multipolygon' && !!r.tags.building;
  });
  if (!relation) return null;

  const relationType = relation.tags.type;
  // 役割名は relation の種別で変わる。外形と内訳を同じ 2 つの数に集約する。
  const outlineRole = (relationType === 'multipolygon') ? 'outer' : 'outline';
  const partRole = (relationType === 'multipolygon') ? 'inner' : 'part';

  let outlineCount = 0;
  let partCount = 0;
  for (const m of relation.members || []) {
    if (m.role === outlineRole) outlineCount++;
    else if (m.role === partRole) partCount++;
  }
  return { relation, outlineCount, partCount, relationType };
}
