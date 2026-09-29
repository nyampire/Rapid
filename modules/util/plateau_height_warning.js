import { utilBuildingRelationInfo } from './building_relation.js';


// 警告は範囲の外に出たときだけ届く。
// 範囲の内側の値を 1 つ決めれば、上側と下側を分けられる。
// 3 m は一般的な階高で、範囲（1.5 m から 10.2 m）の内側にある。
const FLOOR_HEIGHT_SIDE_M = 3;


/**
 * utilPlateauHeightWarningMessages
 * PLATEAU の建物に付いた高さの警告を、利用者に見せる文にする。
 * entity が建物 relation に属していれば、relation と全メンバーの警告をまとめる。
 * 1 つを選んで追加すると、建物全体が一緒に追加されるためである。
 * 同じ文は 1 回だけ返す。
 *
 * @param   {osmEntity} entity  PLATEAU の way か relation
 * @param   {Graph?}    graph   PLATEAU の graph。無ければ entity だけを見る
 * @param   {Object}    l10n    `t(key, params)` を持つ翻訳の仕組み
 * @return  {string[]}
 */
export function utilPlateauHeightWarningMessages(entity, graph, l10n) {
  if (!entity) return [];

  const entities = [entity];
  const info = graph ? utilBuildingRelationInfo(entity, graph) : null;
  if (info) {
    entities.push(info.relation);
    for (const m of info.relation.members ?? []) {
      const member = graph.hasEntity(m.id);
      if (member) entities.push(member);
    }
  }

  const messages = [];
  for (const e of entities) {
    for (const [key, params] of _warningItems(e, graph)) {
      const text = params ? l10n.t(key, params) : l10n.t(key);
      if (!messages.includes(text)) messages.push(text);
    }
  }
  return messages;
}


/**
 * utilPlateauTransferWarningMessages
 * タグ転記の転記元の外形について、転記する値に関わる高さの警告を、利用者に見せる文にする。
 * 転記するのは外形の高さだけなので、部分立体自身の高さの問題は数えない。
 * ただし部分立体の part-over-outline は、外形の高さの誤りを示しうるので数える。
 * 外形の警告を先に、部分立体の警告を後に並べ、同じ文は 1 回だけ返す。
 *
 * @param   {osmEntity} outline  転記元の外形の way か relation
 * @param   {Graph?}    graph    PLATEAU の graph。無ければ外形自身の警告だけを見る
 * @param   {Object}    l10n     `t(key, params)` を持つ翻訳の仕組み
 * @return  {string[]}
 */
export function utilPlateauTransferWarningMessages(outline, graph, l10n) {
  const messages = [];
  for (const [key, params] of _transferWarningItems(outline, graph)) {
    const text = params ? l10n.t(key, params) : l10n.t(key);
    if (!messages.includes(text)) messages.push(text);
  }
  return messages;
}


/**
 * utilPlateauHasTransferWarning
 * utilPlateauTransferWarningMessages と同じ範囲に、警告が 1 つでもあるか。
 *
 * @param   {osmEntity} outline  転記元の外形の way か relation
 * @param   {Graph?}    graph    PLATEAU の graph。無ければ外形自身の警告だけを見る
 * @return  {boolean}
 */
export function utilPlateauHasTransferWarning(outline, graph) {
  return _transferWarningItems(outline, graph).length > 0;
}


function _transferWarningItems(outline, graph) {
  if (!outline) return [];

  const items = _warningItems(outline, graph);
  const info = graph ? utilBuildingRelationInfo(outline, graph) : null;
  if (info) {
    for (const m of info.relation.members ?? []) {
      if (m.role !== 'part') continue;
      const part = graph.hasEntity(m.id);
      if (part) items.push(..._warningItems(part, graph, ['part-over-outline']));
    }
  }
  return items;
}


function _fmt(value, digits = 1) {
  return Number(value).toFixed(digits);
}


function _findOutline(entity, graph) {
  if (!graph) return null;
  const info = utilBuildingRelationInfo(entity, graph);
  if (!info) return null;
  const member = (info.relation.members ?? []).find(m => m.role === 'outline');
  return member ? graph.hasEntity(member.id) : null;
}


/**
 * _warningItems
 * 1 つの entity の警告を、[文言のキー, 値] の組にする。
 * 値を入れられないときは、値の無い文言を使う。
 * only を渡すと、その名前の検査だけを見る。
 */
function _warningItems(entity, graph, only = null) {
  const items = [];
  const tags = entity.tags ?? {};
  const height = parseFloat(tags.height);

  for (const check of entity.heightWarnings ?? []) {
    if (only && !only.includes(check)) continue;
    if (check === 'degenerate-area') {
      items.push(['plateau_height_warning.degenerate_area', null]);

    } else if (check === 'part-over-outline') {
      const outlineHeight = parseFloat(_findOutline(entity, graph)?.tags?.height);
      if (Number.isFinite(height) && Number.isFinite(outlineHeight)) {
        items.push(['plateau_height_warning.part_over_outline', {
          part: _fmt(height), outline: _fmt(outlineHeight), diff: _fmt(height - outlineHeight)
        }]);
      } else {
        items.push(['plateau_height_warning.part_over_outline_generic', null]);
      }

    } else if (check === 'needle') {
      if (Number.isFinite(height) && Number.isFinite(entity.footprintM2)) {
        items.push(['plateau_height_warning.needle', {
          height: _fmt(height), area: String(Number(entity.footprintM2.toPrecision(2)))
        }]);
      } else {
        items.push(['plateau_height_warning.needle_generic', null]);
      }

    } else if (check === 'absolute') {
      if (Number.isFinite(height)) {
        items.push(['plateau_height_warning.absolute', { height: _fmt(height) }]);
      } else {
        items.push(['plateau_height_warning.absolute_generic', null]);
      }

    } else if (check === 'floor-height') {
      const levels = parseFloat(tags['building:levels']);
      if (Number.isFinite(height) && Number.isFinite(levels) && levels > 0) {
        const perFloor = height / levels;
        const key = (perFloor > FLOOR_HEIGHT_SIDE_M)
          ? 'plateau_height_warning.floor_height_high'
          : 'plateau_height_warning.floor_height_low';
        items.push([key, { per_floor: _fmt(perFloor) }]);
      } else {
        items.push(['plateau_height_warning.floor_height_generic', null]);
      }

    } else {
      // 知らない検査の名前でも、警告があることは伝える。
      // 地図は警告の点を描くので、文が空だと理由が分からなくなる。
      items.push(['plateau_height_warning.unknown', null]);
    }
  }
  return items;
}
