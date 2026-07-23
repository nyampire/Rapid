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


// A building whose node is shared with another building/part cannot have its
// geometry replaced without deforming the neighbour. Guard Phase 1 against it.
function isReplaceable(osmWay, osmGraph, state) {
  if (state === 'AREA_MISMATCH') return false;
  if (!osmGraph?.hasEntity || !osmGraph.parentWays) return true;   // mock/no-graph fallback
  for (const nid of osmWay.nodes ?? []) {
    const node = osmGraph.hasEntity(nid);
    if (!node) continue;
    for (const parent of osmGraph.parentWays(node)) {
      if (parent.id !== osmWay.id && (parent.tags?.building || parent.tags?.['building:part'])) {
        return false;
      }
    }
  }
  return true;
}


export function findCandidates({
  plateauEntities, osmEntities,
  plateauGraph, osmGraph,
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
    try { outlineGeo = outline.asGeoJSON(plateauGraph); } catch (_err) { continue; }

    let matched = [];
    for (const osm of osmBuildings) {
      let osmGeo;
      try { osmGeo = osm.asGeoJSON(osmGraph); } catch (_err) { continue; }
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
      ratio,
      replaceable: isReplaceable(osm, osmGraph, state),
      plateauGraph
    });
  }

  return candidates;
}
