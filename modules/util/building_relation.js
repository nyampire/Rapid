/**
 * utilBuildingRelationInfo
 *
 * 指定 entity が「1 棟の建物」に属するとき、その relation 情報を返す。それ以外は null。
 *
 * way を渡すと、その way が属する建物 relation を返す。
 * relation を渡すと、その relation 自身について同じ形の情報を返す。
 * 中庭建物は relation 単位で描画されるため、インスペクタが受け取る datum は relation になる。
 * メンバー way は描かれず hover も select もできないので、way からの経路だけでは届かない。
 *
 * 対象は 2 種類ある。
 * type=building は Simple 3D Buildings / PLATEAU LOD2 の構造で、外形が役割 outline、
 * 内訳が part。メンバー way はそれぞれ自分のタグを持つ。
 * type=multipolygon は中庭のある建物で、外形が outer、穴が inner。
 * **タグは relation にだけ付き、メンバー way はタグを持たない。**
 *
 * UiRapidInspector や conflation ロジックから、UI 表示 / 動作判定の両方で使用。
 *
 * @param  {Object|null}  entity - osmEntity (way または relation)
 * @param  {Graph|null}   graph  - 該当 entity の含まれる Graph (parentRelations を提供)。
 *                                 relation を渡す場合は参照しない。
 * @return {{relation: osmRelation, outlineCount: number, partCount: number,
 *           relationType: string} | null}
 */
export function utilBuildingRelationInfo(entity, graph) {
  if (!entity) return null;

  const relation = (entity.type === 'relation')
    ? (isBuildingRelation(entity) ? entity : null)
    : findParentBuildingRelation(entity, graph);
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


/**
 * 「1 棟の建物」を表す relation かどうか。
 * 建物でない multipolygon (森林など) は対象外にする。
 */
function isBuildingRelation(r) {
  if (!r || !r.tags) return false;
  if (r.tags.type === 'building') return true;
  return r.tags.type === 'multipolygon' && !!r.tags.building;
}


/**
 * way が属する建物 relation を探す。
 */
function findParentBuildingRelation(entity, graph) {
  if (entity.type !== 'way') return null;
  if (!graph || typeof graph.parentRelations !== 'function') return null;

  let parents;
  try {
    parents = graph.parentRelations(entity);
  } catch (e) {
    return null;
  }
  return parents.find(isBuildingRelation) || null;
}
