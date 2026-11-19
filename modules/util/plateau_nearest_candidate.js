import { geoSphericalDistance } from '@rapid-sdk/math';


/**
 * utilNearestPlateauCandidate
 * 候補の中から、基準の位置にいちばん近い建物を 1 つ選ぶ。
 * 距離は候補の外形の中心から測る。
 * 距離が同じときは、配列で先に並んでいる候補を選ぶ。
 *
 * @param   {Array<{entity, graph, datasetID}>}  candidates  utilPlateauCandidates() が返す候補
 * @param   {Array<number>}                      fromLoc      基準の位置 [lon, lat]
 * @param   {string?}                            excludeID    除外する entity.id
 * @return  {Object?}  選んだ候補。無ければ null
 */
export function utilNearestPlateauCandidate(candidates, fromLoc, excludeID) {
  let best = null;
  let bestDistance = Infinity;

  for (const candidate of candidates ?? []) {
    const { entity, graph } = candidate;
    if (excludeID && entity.id === excludeID) continue;

    const distance = geoSphericalDistance(fromLoc, entity.extent(graph).center());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}
