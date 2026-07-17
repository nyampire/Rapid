import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point as turfPoint } from '@turf/helpers';
import area from '@turf/area';

export const TARGET_TAG_KEYS = ['height', 'ele', 'building:levels'];
const AREA_RATIO_MIN = 0.5;
const AREA_RATIO_MAX = 2.0;


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
  transferredIDs, acceptIDs, ignoreIDs
}) {
  const outlines = plateauEntities.filter(f =>
    f.type === 'way' &&
    f.tags?.building &&
    !f.tags['building:part'] &&
    !transferredIDs.has(f.id) &&
    !acceptIDs.has(f.id) &&
    !ignoreIDs.has(f.id) &&
    f.representativePoint
  );

  const osmBuildings = osmEntities.filter(f =>
    f.type === 'way' && f.tags?.building
  );

  const candidates = [];

  for (const outline of outlines) {
    const rp = turfPoint(outline.representativePoint);

    let outlineGeo;
    try { outlineGeo = outline.asGeoJSON(); } catch (_err) { continue; }

    let matched = [];
    for (const osm of osmBuildings) {
      let osmGeo;
      try { osmGeo = osm.asGeoJSON(); } catch (_err) { continue; }
      if (booleanPointInPolygon(rp, osmGeo)) matched.push({ osm, osmGeo });
    }
    if (matched.length !== 1) continue;   // ambiguous or no hit

    const { osm, osmGeo } = matched[0];

    const outlineArea = area(outlineGeo);
    const osmArea = area(osmGeo);
    if (osmArea === 0) continue;
    const ratio = outlineArea / osmArea;

    let state;
    let tagStates;

    if (ratio < AREA_RATIO_MIN || ratio > AREA_RATIO_MAX) {
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
