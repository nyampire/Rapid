import { utilStringQs } from '@rapid-sdk/util';

import { utilBuildingRelationInfo } from './building_relation.js';
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
 * 外形と部品に分かれた建物（`type=building` の relation）は、まとめて1件と数える。
 * 代表は外形で、外形がもう残っていなければ、残っている部品のうち最初のもの。
 * memberIDs には、まとめた way の id がすべて入る。
 *
 * @return  {Array<{entity: Entity, graph: Graph, datasetID: string, memberIDs: Set<string>}>}
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
    const groups = new Map();   // relation.id -> { relation, ways, result }
    for (const entity of polygons) {
      const info = (entity.type === 'way') ? utilBuildingRelationInfo(entity, graph) : null;
      if (info?.relationType !== 'building') {
        results.push({ entity, graph, datasetID, memberIDs: new Set([entity.id]) });
        continue;
      }

      const relID = info.relation.id;
      let group = groups.get(relID);
      if (!group) {
        // グループの最初の要素が現れた位置に置く。代表は、まとめ終えてから決める。
        group = { relation: info.relation, ways: [], result: { entity, graph, datasetID, memberIDs: new Set() } };
        groups.set(relID, group);
        results.push(group.result);
      }
      group.ways.push(entity);
      group.result.memberIDs.add(entity.id);
    }

    for (const { relation, ways, result } of groups.values()) {
      const outlineIDs = new Set((relation.members ?? []).filter(m => m.role === 'outline').map(m => m.id));
      result.entity = ways.find(w => outlineIDs.has(w.id)) ?? ways[0];
    }
  }
  return results;
}


/**
 * utilPlateauCandidateStatus
 * 「次の Plateau 候補」の操作が押せるかどうかと、残っている候補の数を返す。
 * 数は utilPlateauCandidates と同じ数え方で、別には数えない。
 *
 * reason は次の順に判定する。
 *   'layer-off'     Rapid のレイヤーかサービスが動いていない、または有効な Plateau のデータセットが無い
 *   'zoom'          届かないズーム
 *   'osm-layer-off' OSM のレイヤーを切っていて、追加できない
 *   'none'          追加済みか無視済みの候補しか残っていない
 *   'ok'            押せる。このときだけ count > 0
 *
 * excludeID を渡すと、そのメンバーを含む候補は数えない。右の枠の「残り」と同じ数え方で、
 * 選んでいる候補を引くときに使う。
 *
 * @param   {Context}  context
 * @param   {string}   [excludeID]  数えない候補のメンバーの id
 * @return  {{reason: 'ok'|'layer-off'|'zoom'|'osm-layer-off'|'none', count: number}}
 */
export function utilPlateauCandidateStatus(context, excludeID) {
  const rapid = context.systems.rapid;
  const service = context.services.plateau;
  const layerOn = !!rapid && !!service
    && !!context.systems.gfx?.scene?.layers.get('rapid')?.enabled
    && !!service.started;
  const hasDataset = layerOn
    && [...rapid.datasets.values()].some(d => d.service === 'plateau' && d.added && d.enabled);
  if (!hasDataset) return { reason: 'layer-off', count: 0 };

  if (context.viewport.transform.zoom < PLATEAU_BUILDINGS_MINZOOM) return { reason: 'zoom', count: 0 };

  if (service.isAddBlocked?.()) return { reason: 'osm-layer-off', count: 0 };

  const count = utilPlateauCandidates(context)
    .filter(c => excludeID === undefined || !c.memberIDs.has(excludeID))
    .length;
  return count > 0 ? { reason: 'ok', count } : { reason: 'none', count: 0 };
}
