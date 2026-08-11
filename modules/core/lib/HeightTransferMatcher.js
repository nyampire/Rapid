import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point as turfPoint } from '@turf/helpers';
import area from '@turf/area';

export const TARGET_TAG_KEYS = ['height', 'ele', 'building:levels'];
const AREA_RATIO_MIN = 0.5;
const AREA_RATIO_MAX = 2.0;

/**
 * PLATEAU 側の面積を外側リングだけで測る。
 *
 * turf の `area` は MultiPolygon の穴を差し引く。OSM 側は単純な way で総面積なので、
 * そのまま比べると正味面積と総面積の比較になり、中庭が広い建物ほど比が小さく出る。
 * AREA_RATIO_MIN は「OSM の建物よりずっと小さい PLATEAU の外形は塔屋や物置である」
 * という判定なので、中庭のある建物がそれと同じ理由で落ちてしまう。
 *
 * 外側リングだけで測れば、OSM 側と同種どうしの比較になる。
 * 単純な way はリングが 1 本なので、値は全体の面積と等しく、結果は変わらない。
 *
 * 描画は穴を抜いた形を見せるので、この面積は画面の見た目と一致しない。
 *
 * `osmWay.asGeoJSON` / `osmRelation.asGeoJSON` は素のジオメトリを返すが、
 * テストのモックは Feature を返すので、どちらの形も受ける。
 */
function outerRingArea(geo) {
  const g = geo?.geometry ?? geo;
  if (!g?.type) return 0;

  if (g.type === 'Polygon') {
    return area({ type: 'Polygon', coordinates: [g.coordinates[0]] });
  }
  if (g.type === 'MultiPolygon') {
    // outer が複数あるときは全部の外側リングを合算する。1 本目だけを測らない。
    return area({
      type: 'MultiPolygon',
      coordinates: g.coordinates.map(poly => [poly[0]])
    });
  }
  return area(geo);
}


export function analyzeTagStates(osmFeature, plateauFeature) {
  const missing = [];
  const matching = [];
  const conflicting = [];
  const osmTags = osmFeature.tags ?? {};
  const plateauTags = plateauFeature.tags ?? {};

  for (const key of TARGET_TAG_KEYS) {
    const pv = plateauTags[key];
    if (pv === undefined || pv === null || pv === '') continue;   // nothing to transfer
    const ov = osmTags[key];
    if (ov === undefined || ov === null || ov === '') {
      missing.push(key);
    } else if (String(ov) === String(pv)) {
      matching.push(key);
    } else {
      conflicting.push({ key, osmValue: String(ov), plateauValue: String(pv) });
    }
  }

  return { missing, matching, conflicting };
}


export function findCandidates({
  plateauEntities, osmEntities,
  plateauGraph, osmGraph,
  transferredIDs, acceptIDs, ignoreIDs
}) {
  const outlines = plateauEntities.filter(f => {
    // 転記元になるのは 1 棟の建物である。way は自分のタグを持ち、
    // 中庭のある建物は type=multipolygon の relation で届いてタグは relation にだけ付く。
    // 建物でない multipolygon (森林など) は対象外なので building タグを要求する。
    const isWay = f.type === 'way';
    const isCourtyard = f.type === 'relation' && f.tags?.type === 'multipolygon';
    if (!isWay && !isCourtyard) return false;

    return f.tags?.building &&
      !f.tags['building:part'] &&
      !transferredIDs.has(f.id) &&
      !acceptIDs.has(f.id) &&
      !ignoreIDs.has(f.id) &&
      f.representativePoint;
  });

  const osmBuildings = osmEntities.filter(f =>
    f.type === 'way' && f.tags?.building
  );

  const candidates = [];

  for (const outline of outlines) {
    const rp = turfPoint(outline.representativePoint);

    let outlineGeo;
    try { outlineGeo = outline.asGeoJSON(plateauGraph); } catch (_err) { continue; }

    let matched = [];
    for (const osm of osmBuildings) {
      let osmGeo;
      try { osmGeo = osm.asGeoJSON(osmGraph); } catch (_err) { continue; }
      if (booleanPointInPolygon(rp, osmGeo)) matched.push({ osm, osmGeo });
    }
    if (matched.length !== 1) continue;   // ambiguous or no hit

    const { osm, osmGeo } = matched[0];

    const outlineArea = outerRingArea(outlineGeo);
    const osmArea = area(osmGeo);
    if (osmArea === 0) continue;
    const ratio = outlineArea / osmArea;

    let state;
    let tagStates;

    // A Plateau outline far SMALLER than the OSM building it sits in is an
    // ancillary structure Plateau models as its own `building` -- a rooftop
    // stair enclosure, a shed. Its height describes that structure, not the
    // building, so transferring it would be wrong and flagging it is only
    // noise (observed: 7-9 m2 outlines inside a 214 m2 OSM building). Drop it.
    if (ratio < AREA_RATIO_MIN) continue;

    if (ratio > AREA_RATIO_MAX) {
      // Plateau outline far LARGER than the OSM building: block-level or
      // partial OSM mapping under one Plateau outline. Worth a human look.
      state = 'AREA_MISMATCH';
      tagStates = analyzeTagStates(osm, outline);
    } else {
      tagStates = analyzeTagStates(osm, outline);
      if (tagStates.missing.length > 0) state = 'CANDIDATE';
      else if (tagStates.conflicting.length > 0) state = 'CONFLICT';
      else if (tagStates.matching.length > 0) state = 'COVERED';
      else continue;   // nothing to compare — no icon
    }

    candidates.push({
      plateauFeature: outline,
      osmFeature: osm,
      kind: 'outline_to_building',
      state,
      missingTags: tagStates.missing,
      conflictingTags: tagStates.conflicting,
      matchingTags: tagStates.matching,
      ratio
    });
  }

  return candidates;
}
