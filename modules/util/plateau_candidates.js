import { utilStringQs } from '@rapid-sdk/util';

import { PLATEAU_BUILDINGS_MINZOOM } from '../services/PlateauService.js';


/**
 * utilPlateauRenderables
 * Plateau の entity 群から、描画するポリゴンを選ぶ。
 *
 * 中庭のある建物は `type=multipolygon` の relation で届く。外形が role='outer'、
 * 穴が role='inner' で、タグは relation にだけ付く。`osmRelation.geometry()` は
 * multipolygon に対して 'area' を返し、`PixiFeaturePolygon` は外側に続く穴を
 * 既に描けるので、relation をそのまま積めば穴が穴として描かれる。
 *
 * そのメンバー way は積まない。積むと外形が二重に描かれ、穴の上にも塗りが乗る。
 *
 * `type=building` は従来どおり outline と parts を個別に積む。穴とは別の構造なので、
 * 描画方式は変えない。
 *
 * @param   {Array}     entities  service.getData() の戻り値
 * @param   {Graph}     graph     データセットのグラフ
 * @param   {Function}  [skip]    true を返した entity は除く
 * @return  {{polygons: Array}}
 */
export function utilPlateauRenderables(entities, graph, skip) {
  skip = skip || (() => false);

  // 先に「relation として描く」対象を決め、そのメンバー way を除外集合に入れる。
  const memberWayIDs = new Set();
  const relations = [];
  for (const entity of entities) {
    if (entity.type !== 'relation') continue;
    if (entity.tags?.type !== 'multipolygon' || !entity.tags?.building) continue;
    if (skip(entity)) continue;
    relations.push(entity);
    for (const m of entity.members ?? []) {
      if (m.type === 'way') memberWayIDs.add(m.id);
    }
  }

  const polygons = [];
  for (const relation of relations) {
    if (relation.geometry(graph) === 'area') polygons.push(relation);
  }
  for (const entity of entities) {
    if (entity.type !== 'way') continue;
    if (memberWayIDs.has(entity.id)) continue;
    if (skip(entity)) continue;
    if (entity.geometry(graph) === 'area') polygons.push(entity);
  }
  return { polygons };
}


/**
 * utilPlateauCandidates
 * 今の画面の中で、地図に描いている Plateau の候補を集める。
 * 描く処理と同じ絞り込みを通すので、画面に無い候補が混ざったり、数がずれたりしない。
 *
 * @param   {Context}  context
 * @return  {Array<{entity: Entity, graph: Graph, datasetID: string}>}
 */
export function utilPlateauCandidates(context) {
  const rapid = context.systems.rapid;
  const service = context.services.plateau;
  if (!rapid || !service) return [];

  // Rapid レイヤー自体が消えているときは、PixiLayerRapid が何も描かない。
  if (!context.systems.gfx?.scene?.layers.get('rapid')?.enabled) return [];

  // 描画と同じく、サービスが始まるまでは何も描いていない。
  if (!service.started) return [];

  // 取得と描画の閾値と同じ。届かないズームでは何も描いていない。
  if (context.viewport.transform.zoom < PLATEAU_BUILDINGS_MINZOOM) return [];

  const skip = entity => rapid.acceptIDs.has(entity.id) || rapid.ignoreIDs.has(entity.id);

  const conflationStr = utilStringQs(window.location.hash).conflation;
  const noConflation = (conflationStr === 'false' || conflationStr === 'no');

  const results = [];
  for (const dataset of rapid.datasets.values()) {
    if (dataset.service !== 'plateau') continue;
    if (!(dataset.added && dataset.enabled)) continue;   // 描画と同じ判定

    const datasetID = dataset.id + ((dataset.conflated && !noConflation) ? '-conflated' : '');
    const graph = service.graph(datasetID);
    const { polygons } = utilPlateauRenderables(service.getData(datasetID), graph, skip);
    for (const entity of polygons) {
      results.push({ entity, graph, datasetID });
    }
  }
  return results;
}
