# PLATEAU Height Transfer (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Rapid "PLATEAU height transfer" mode that lets mappers add missing `height`, `ele`, and `building:levels` tags from PLATEAU outlines to existing OSM buildings, one building at a time, with four-state visual candidates and hard safety guarantees against overwriting.

**Architecture:** Server adds a `representative_point` XML tag to each PLATEAU way/relation via `ST_PointOnSurface`. Client's PlateauService lifts it onto Entity properties. A new mode drives candidate computation (point-in-polygon + area-ratio filter + per-tag missing detection), a new Pixi layer renders four-state icons, and a new graph action applies the missing-tag subset through Rapid's standard tag-edit machinery.

**Tech Stack:** Python 3 / FastAPI / PostGIS (server); JavaScript / Pixi.js / Turf.js / Vitest browser tests (client)

**Design references:**
- Canonical spec: `docs/superpowers/specs/2026-07-17-plateau-height-transfer-design.md`
- Japanese review copy: `docs/superpowers/specs/2026-07-17-plateau-height-transfer-design.ja.md`

## Global Constraints

- **Branches:** All work must happen on feature branches. Never commit to `main`. Rapid uses `feature/plateau-height-transfer`, rapid_plateau_api uses `feature/representative-point`.
- **Never overwrite existing OSM tag values in Phase 1.** Only add tags that are missing.
- **Target tags are exactly three:** `height`, `ele`, `building:levels`. `roof:shape` is out of scope for Phase 1.
- **Stay within Rapid's 50-object-per-changeset limit.** No batch application UI.
- **Server API contract is additive only.** Adding the `representative_point` tag must not break existing clients.
- **Ambiguous matches skip silently:** if a Plateau outline's representative point falls into zero or multiple OSM buildings, no icon is shown.
- **Client fallback required:** if the server response lacks `representative_point`, compute it locally via `@turf/point-on-feature`.
- **Server: never run raw commands on the production DB.** All server tests use the `fresh_plateau_schema` fixture.
- **Client: no new keyboard shortcuts** in Phase 1 (avoid conflicts with existing bindings).

---

## Task 1 — Measure current tag population rates in production PLATEAU DB (OQ-1)

**Repository:** `rapid_plateau_api`
**Branch:** run from any branch (read-only observation, no code change)

**Files:** none created or modified. Result is a short observation captured in this plan's addendum.

**Interfaces:**
- Consumes: nothing
- Produces: population rate table added at the bottom of this plan under "Task 1 Result"; used by Task 4 to decide whether all three tags participate in the state machine

**Purpose:** Sanity-check the assumption that PLATEAU actually populates height/ele/building:levels for a meaningful share of features. If a tag's population rate is near zero, we know before writing code that its column in `analyzeTagStates` will almost always be empty.

- [ ] **Step 1: Run the read-only count query**

Run:
```bash
ssh plateau-vps 'bash -s' <<'REMOTE'
source /opt/plateau-api/.env
psql "$DATABASE_URL" -P pager=off <<'SQL'
SELECT
  COUNT(*)                                                     AS total_buildings,
  COUNT(*) FILTER (WHERE height IS NOT NULL)                   AS with_height,
  COUNT(*) FILTER (WHERE ele IS NOT NULL)                      AS with_ele,
  COUNT(*) FILTER (WHERE building_levels IS NOT NULL)          AS with_levels
FROM plateau_buildings
WHERE building = 'yes' OR building IS NOT NULL;
SQL
REMOTE
```

Expected output shape:
```
 total_buildings | with_height | with_ele | with_levels
-----------------+-------------+----------+-------------
        14375264 |    14375264 | 14375264 |      12345678
```

- [ ] **Step 2: Record the result in this plan file**

Edit this plan file's "Task 1 Result" section at the bottom, filling in the four counts and percentages.

- [ ] **Step 3: Decide whether to proceed with all three tags**

If any tag's population is < 20 %, log the finding in the Task 1 Result section and note it as an operational caveat (the tag will rarely appear in candidates). Do not remove tags from the state machine — Phase 1 keeps all three so the UI structure stays stable.

- [ ] **Step 4: Commit the Result section**

Note: this commit is to the Rapid repo (where the plan file lives). Amend to whichever branch you are on for this housekeeping edit, or commit to a docs branch.

```bash
cd /Users/nyampire/git/Rapid
git add docs/superpowers/plans/2026-07-17-plateau-height-transfer.md
git commit -m "docs: record OQ-1 measurement of PLATEAU tag population rates"
```

---

## Task 2 — Server: add `representative_point` to buildings endpoint

**Repository:** `rapid_plateau_api`
**Branch:** `feature/representative-point`

**Files:**
- Modify: `osmfj_plateau_api.py` (`get_buildings_in_bbox` SELECT and `buildings_to_osm_xml`)
- Test: `tests/test_representative_point.py` (new file, integration marker)

**Interfaces:**
- Consumes: existing `get_buildings_in_bbox` SELECT structure and `buildings_to_osm_xml` XML builder
- Produces: XML response where every `<way>` and `<relation>` for a building carries `<tag k="representative_point" v="<lon>,<lat>" />`. Consumed by Task 3 (`PlateauService._parseXML`)

- [ ] **Step 1: Create the feature branch**

```bash
cd /Users/nyampire/git/rapid_plateau_api
git checkout main && git pull
git checkout -b feature/representative-point
```

- [ ] **Step 2: Write the failing integration test**

Create `tests/test_representative_point.py`:

```python
import pytest
import xml.etree.ElementTree as ET
from fastapi.testclient import TestClient
from osmfj_plateau_api import app

pytestmark = pytest.mark.integration


def _make_client(fresh_plateau_full_schema):
    return TestClient(app)


def _tags(elem):
    return {t.get('k'): t.get('v') for t in elem.findall('tag')}


def test_representative_point_present_on_every_building(fresh_plateau_full_schema):
    """Every <way> that represents a building carries representative_point."""
    # Seed one building with a well-known geometry
    _seed_building(fresh_plateau_full_schema, lat=35.6795, lon=139.7563,
                   height=12.5, building_levels=3)
    client = _make_client(fresh_plateau_full_schema)

    resp = client.get('/api/mapwithai/buildings',
                      params={'bbox': '139.755,35.679,139.758,35.680'})
    assert resp.status_code == 200
    root = ET.fromstring(resp.content)

    ways = root.findall('way')
    assert len(ways) >= 1
    for way in ways:
        tags = _tags(way)
        assert 'representative_point' in tags, \
            f"way {way.get('id')} is missing representative_point"
        lon_str, lat_str = tags['representative_point'].split(',')
        lon, lat = float(lon_str), float(lat_str)
        assert 139.755 <= lon <= 139.758
        assert 35.679 <= lat <= 35.680


def test_representative_point_falls_inside_polygon(fresh_plateau_full_schema):
    """The representative point must lie inside the way's polygon, not just its bbox."""
    # Seed an L-shaped building (non-convex) where centroid could fall outside
    _seed_l_shaped_building(fresh_plateau_full_schema)
    client = _make_client(fresh_plateau_full_schema)

    resp = client.get('/api/mapwithai/buildings',
                      params={'bbox': '139.7,35.6,139.8,35.7'})
    root = ET.fromstring(resp.content)

    way = root.find('way')
    tags = _tags(way)
    assert 'representative_point' in tags
    # geometric check: reassemble polygon from way's nd refs, verify point-in-polygon
    rp = tuple(map(float, tags['representative_point'].split(',')))
    polygon = _reconstruct_polygon(root, way)
    assert _point_in_polygon(rp, polygon)


def test_absent_when_building_geometry_broken(fresh_plateau_full_schema):
    """If ST_PointOnSurface fails on invalid geometry, the tag is absent (not crashed)."""
    _seed_invalid_geometry_building(fresh_plateau_full_schema)
    client = _make_client(fresh_plateau_full_schema)

    resp = client.get('/api/mapwithai/buildings',
                      params={'bbox': '139.7,35.6,139.8,35.7'})
    assert resp.status_code == 200
    # Response is valid XML; missing representative_point is acceptable
    ET.fromstring(resp.content)


# Helper stubs — implementations follow the existing tests/conftest.py patterns
def _seed_building(schema, lat, lon, **attrs): ...
def _seed_l_shaped_building(schema): ...
def _seed_invalid_geometry_building(schema): ...
def _reconstruct_polygon(root, way): ...
def _point_in_polygon(point, polygon): ...
```

Fill the helper stubs by copying the existing `_seed_building` / `_square_wkt` helpers from `tests/test_dedup_city_duplicates.py`. Add a `_seed_l_shaped_building` that stores a WKT polygon shaped like an "L" (non-convex).

- [ ] **Step 3: Run the tests and confirm they fail**

```bash
cd /Users/nyampire/git/rapid_plateau_api
source venv/bin/activate
export PLATEAU_TEST_DATABASE_URL="postgresql://..."  # local test DB
pytest tests/test_representative_point.py --run-integration -v
```

Expected: all three tests fail because `representative_point` is not present in responses yet.

- [ ] **Step 4: Add representative_point to the SELECT**

Modify `osmfj_plateau_api.py` in `get_buildings_in_bbox` (the SQL that returns building rows). Add to the SELECT clause:

```sql
ST_AsGeoJSON(ST_PointOnSurface(geom))::jsonb -> 'coordinates' AS representative_point
```

Adjust the Python dict assembly so `building['representative_point']` receives the `[lon, lat]` list. Handle `NULL` gracefully:

```python
# in get_buildings_in_bbox result assembly
row_rp = row['representative_point']
if row_rp is not None:
    building['representative_point'] = [float(row_rp[0]), float(row_rp[1])]
else:
    building['representative_point'] = None
```

- [ ] **Step 5: Emit the XML tag in buildings_to_osm_xml**

In `buildings_to_osm_xml`, when constructing each `<way>` element for a building, add:

```python
rp = building.get('representative_point')
if rp is not None:
    way_elem.append(_make_tag('representative_point', f'{rp[0]:.7f},{rp[1]:.7f}'))
```

Do the same for `<relation>` elements that represent buildings (outlines with parts). Ensure both outline `<way>` and relation-level `<relation>` receive the tag when applicable.

Use 7 decimal places (~1 cm precision) for consistent formatting.

- [ ] **Step 6: Run the tests and confirm they pass**

```bash
pytest tests/test_representative_point.py --run-integration -v
```

Expected: all three tests pass.

- [ ] **Step 7: Run the full test suite to confirm no regressions**

```bash
pytest --run-integration -v
```

Expected: full suite passes (no new failures in existing tests).

- [ ] **Step 8: Commit**

```bash
git add osmfj_plateau_api.py tests/test_representative_point.py
git commit -m "feat: add representative_point tag to buildings XML response"
```

---

## Task 3 — Client: PlateauService parses `representative_point` with Turf fallback

**Repository:** `Rapid`
**Branch:** `feature/plateau-height-transfer` (created earlier; the spec commit lives there)

**Files:**
- Modify: `modules/services/PlateauService.js` (add extraction in `_parseWay` and `_parseRelation`, and a fallback path)
- Test: `test/browser/services/PlateauService.test.js` (append new `describe` block)

**Interfaces:**
- Consumes: XML response from Task 2 with `<tag k="representative_point" v="lon,lat" />`
- Produces: on each parsed Plateau Entity, a `entity.representativePoint = [lon, lat]` property. Consumed by Tasks 4 (matching), 7 (icon rendering). The tag is removed from the Entity's OSM tags map so that OSM tag machinery never sees it.

- [ ] **Step 1: Switch to the feature branch and pull latest**

```bash
cd /Users/nyampire/git/Rapid
git checkout feature/plateau-height-transfer
git pull origin main --rebase  # keep up to date with main
```

- [ ] **Step 2: Add `@turf/point-on-feature` if not already present**

```bash
grep '"@turf/point-on-feature"' package.json || npm install --save @turf/point-on-feature
```

- [ ] **Step 3: Write the failing unit tests**

Append to `test/browser/services/PlateauService.test.js`:

```javascript
describe('#representativePoint parsing', () => {
  it('lifts representative_point tag onto entity property and removes it from tags', () => {
    const xml = `<?xml version="1.0"?>
      <osm version="0.6">
        <node id="1" lat="35.6795" lon="139.7560"/>
        <node id="2" lat="35.6795" lon="139.7566"/>
        <node id="3" lat="35.6800" lon="139.7566"/>
        <node id="4" lat="35.6800" lon="139.7560"/>
        <way id="10">
          <nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/>
          <tag k="building" v="yes"/>
          <tag k="height" v="12.5"/>
          <tag k="representative_point" v="139.7563000,35.6797500"/>
        </way>
      </osm>`;

    const service = _makeService();
    service._parseXML(_fakeDataset, xml, _fakeTile, (err, result) => {
      const way = result.data.find(e => e.type === 'way' && e.id.endsWith('10'));
      expect(way.representativePoint).toEqual([139.7563000, 35.67975]);
      expect(way.tags.representative_point).toBeUndefined();
      expect(way.tags.height).toEqual('12.5');
    });
  });

  it('falls back to turf.pointOnFeature when tag is missing', async () => {
    const { default: pointOnFeature } = await import('@turf/point-on-feature');
    const xml = `<?xml version="1.0"?>
      <osm version="0.6">
        <node id="1" lat="35.6795" lon="139.7560"/>
        <node id="2" lat="35.6795" lon="139.7566"/>
        <node id="3" lat="35.6800" lon="139.7566"/>
        <node id="4" lat="35.6800" lon="139.7560"/>
        <way id="20">
          <nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/>
          <tag k="building" v="yes"/>
        </way>
      </osm>`;

    const service = _makeService();
    service._parseXML(_fakeDataset, xml, _fakeTile, (err, result) => {
      const way = result.data.find(e => e.type === 'way' && e.id.endsWith('20'));
      expect(way.representativePoint).toBeDefined();
      expect(way.representativePoint[0]).toBeCloseTo(139.7563, 3);
      expect(way.representativePoint[1]).toBeCloseTo(35.67975, 3);
    });
  });

  it('leaves node entities without a representativePoint property', () => {
    const xml = `<?xml version="1.0"?>
      <osm version="0.6"><node id="1" lat="35.68" lon="139.75"/></osm>`;
    const service = _makeService();
    service._parseXML(_fakeDataset, xml, _fakeTile, (err, result) => {
      const node = result.data[0];
      expect(node.representativePoint).toBeUndefined();
    });
  });
});
```

`_makeService`, `_fakeDataset`, `_fakeTile` follow the pattern already used in the existing `PlateauService.test.js` describe blocks.

- [ ] **Step 4: Run the tests and confirm they fail**

```bash
npm run test:browser -- --grep 'representativePoint parsing'
```

Expected: FAIL — property doesn't exist yet.

- [ ] **Step 5: Extract representative_point in `_parseWay` and `_parseRelation`**

Modify `modules/services/PlateauService.js`. In the local helper that builds tags for an entity (currently `_getTags`), extract and remove the special key:

```javascript
// Near _getTags (around line 680)
_getTags(xml) {
  const tags = {};
  const els = xml.getElementsByTagName('tag');
  for (let i = 0; i < els.length; i++) {
    const k = els[i].getAttribute('k');
    const v = els[i].getAttribute('v');
    if (k) tags[k] = v;
  }
  return tags;
}

_extractRepresentativePoint(tags) {
  const raw = tags.representative_point;
  if (!raw) return null;
  delete tags.representative_point;
  const parts = raw.split(',');
  if (parts.length !== 2) return null;
  const lon = parseFloat(parts[0]);
  const lat = parseFloat(parts[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}
```

In `_parseWay` (around line 711), after tags are built, attach the property:

```javascript
_parseWay(obj, uid) {
  const tags = this._getTags(obj);
  const representativePoint = this._extractRepresentativePoint(tags);
  const way = new osmWay({
    id: uid,
    version: 1,
    tags: tags,
    nodes: this._getNodes(obj),
    visible: this._getVisible(obj.attributes)
  });
  if (representativePoint) way.representativePoint = representativePoint;
  return way;
}
```

Do the same in `_parseRelation`.

- [ ] **Step 6: Add the Turf fallback**

Add at the top of `PlateauService.js`:

```javascript
import pointOnFeature from '@turf/point-on-feature';
```

Add a helper that computes a fallback for way entities lacking a `representativePoint`, invoked at the end of `_parseXML` after the graph is assembled:

```javascript
_fillMissingRepresentativePoints(entities, graph) {
  for (const entity of entities) {
    if (entity.type !== 'way' || entity.representativePoint) continue;
    if (!entity.tags?.building && !entity.tags?.['building:part']) continue;
    try {
      const geojson = entity.asGeoJSON(graph);
      const point = pointOnFeature(geojson);
      if (point?.geometry?.coordinates) {
        entity.representativePoint = point.geometry.coordinates;
      }
    } catch (_err) {
      // skip unfillable entities silently
    }
  }
}
```

Call it at the end of `_parseXML` after the entities are collected but before returning them.

- [ ] **Step 7: Run the tests and confirm they pass**

```bash
npm run test:browser -- --grep 'representativePoint parsing'
```

Expected: all 3 tests pass.

- [ ] **Step 8: Run the full PlateauService test file to confirm no regressions**

```bash
npm run test:browser -- --grep 'PlateauService'
```

Expected: full suite passes.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json \
        modules/services/PlateauService.js \
        test/browser/services/PlateauService.test.js
git commit -m "feat(plateau): parse representative_point tag with turf fallback"
```

---

## Task 4 — Client: matching logic (`analyzeTagStates` + `findCandidates`)

**Repository:** `Rapid`
**Branch:** `feature/plateau-height-transfer`

**Files:**
- Create: `modules/core/lib/HeightTransferMatcher.js`
- Create: `test/browser/core/lib/HeightTransferMatcher.test.js`

**Interfaces:**
- Consumes: Plateau entities with `.representativePoint` (Task 3); OSM building entities from `graph.getBuildingsInBbox`; existing sets `transferredIDs`, `acceptIDs`, `ignoreIDs`
- Produces: pure function `findCandidates({ plateauEntities, osmEntities, transferredIDs, acceptIDs, ignoreIDs }): MatchCandidate[]` and helper `analyzeTagStates(osm, plateau)`. Consumed by HeightTransferMode (Task 6) and PixiLayerHeightTransfer (Task 7).

**Types (returned shape):**
```typescript
type MatchCandidate = {
  plateauFeature: Entity;
  osmFeature: Entity;
  kind: 'outline_to_building';
  state: 'CANDIDATE' | 'COVERED' | 'CONFLICT' | 'AREA_MISMATCH';
  missingTags: string[];
  conflictingTags: { key: string; osmValue: string; plateauValue: string }[];
  matchingTags: string[];
  ratio: number;
};
```

- [ ] **Step 1: Add `@turf/boolean-point-in-polygon` and `@turf/area` dependencies if not present**

```bash
grep '"@turf/boolean-point-in-polygon"' package.json || npm install --save @turf/boolean-point-in-polygon
grep '"@turf/area"' package.json || npm install --save @turf/area
```

- [ ] **Step 2: Write failing tests**

Create `test/browser/core/lib/HeightTransferMatcher.test.js`:

```javascript
import { findCandidates, analyzeTagStates } from '../../../../modules/core/lib/HeightTransferMatcher.js';

const TARGET_KEYS = ['height', 'ele', 'building:levels'];

describe('analyzeTagStates', () => {
  it('reports all three keys missing when OSM has none', () => {
    const osm = { tags: { building: 'yes' } };
    const plateau = { tags: { height: '12', ele: '45', 'building:levels': '3' } };
    const s = analyzeTagStates(osm, plateau);
    expect(s.missing.sort()).toEqual(TARGET_KEYS.slice().sort());
    expect(s.matching).toEqual([]);
    expect(s.conflicting).toEqual([]);
  });

  it('reports a key as matching when both sides have the same value', () => {
    const osm = { tags: { building: 'yes', height: '12' } };
    const plateau = { tags: { height: '12', ele: '45' } };
    const s = analyzeTagStates(osm, plateau);
    expect(s.matching).toEqual(['height']);
    expect(s.missing).toEqual(['ele']);
    expect(s.conflicting).toEqual([]);
  });

  it('reports a key as conflicting when both sides have different values', () => {
    const osm = { tags: { building: 'yes', height: '10' } };
    const plateau = { tags: { height: '12' } };
    const s = analyzeTagStates(osm, plateau);
    expect(s.conflicting).toEqual([
      { key: 'height', osmValue: '10', plateauValue: '12' }
    ]);
    expect(s.matching).toEqual([]);
    expect(s.missing).toEqual([]);
  });

  it('ignores keys missing from PLATEAU (nothing to transfer)', () => {
    const osm = { tags: { building: 'yes' } };
    const plateau = { tags: { name: 'foo' } };
    const s = analyzeTagStates(osm, plateau);
    expect(s.missing).toEqual([]);
    expect(s.matching).toEqual([]);
    expect(s.conflicting).toEqual([]);
  });
});

describe('findCandidates', () => {
  // Helpers to build minimal features
  function outline(id, coords, tags, rp) {
    return { id, type: 'way', tags: { building: 'yes', ...tags },
             representativePoint: rp,
             asGeoJSON: () => ({ type: 'Feature', geometry:
                { type: 'Polygon', coordinates: [coords] }, properties: {} }) };
  }
  function osmBuilding(id, coords, tags = { building: 'yes' }) {
    return { id, type: 'way', tags,
             asGeoJSON: () => ({ type: 'Feature', geometry:
                { type: 'Polygon', coordinates: [coords] }, properties: {} }) };
  }
  // A 100m x 100m square centered on Tokyo (rough)
  const SQR = [[139.755, 35.679], [139.756, 35.679],
               [139.756, 35.680], [139.755, 35.680], [139.755, 35.679]];
  const SQR_CENTER = [139.7555, 35.6795];

  it('returns CANDIDATE when Plateau has tags and OSM is missing them', () => {
    const p = outline('p1', SQR, { height: '12' }, SQR_CENTER);
    const o = osmBuilding('o1', SQR);
    const out = findCandidates({
      plateauEntities: [p], osmEntities: [o],
      transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
    });
    expect(out).toHaveLength(1);
    expect(out[0].state).toBe('CANDIDATE');
    expect(out[0].missingTags).toEqual(['height']);
  });

  it('returns COVERED when OSM has all tags and values match', () => {
    const p = outline('p1', SQR, { height: '12' }, SQR_CENTER);
    const o = osmBuilding('o1', SQR, { building: 'yes', height: '12' });
    const out = findCandidates({
      plateauEntities: [p], osmEntities: [o],
      transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
    });
    expect(out).toHaveLength(1);
    expect(out[0].state).toBe('COVERED');
  });

  it('returns CONFLICT when values differ and nothing is missing', () => {
    const p = outline('p1', SQR, { height: '12' }, SQR_CENTER);
    const o = osmBuilding('o1', SQR, { building: 'yes', height: '10' });
    const out = findCandidates({
      plateauEntities: [p], osmEntities: [o],
      transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
    });
    expect(out).toHaveLength(1);
    expect(out[0].state).toBe('CONFLICT');
  });

  it('returns AREA_MISMATCH when area ratio is outside 0.5..2.0', () => {
    // OSM building is 10x wider than Plateau
    const bigOsm = [[139.750, 35.679], [139.760, 35.679],
                    [139.760, 35.680], [139.750, 35.680], [139.750, 35.679]];
    const p = outline('p1', SQR, { height: '12' }, SQR_CENTER);
    const o = osmBuilding('o1', bigOsm);
    const out = findCandidates({
      plateauEntities: [p], osmEntities: [o],
      transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
    });
    expect(out).toHaveLength(1);
    expect(out[0].state).toBe('AREA_MISMATCH');
  });

  it('skips outlines whose representative point hits multiple OSM buildings', () => {
    const p = outline('p1', SQR, { height: '12' }, SQR_CENTER);
    // Two OSM buildings that both contain SQR_CENTER (overlapping polygons)
    const o1 = osmBuilding('o1', SQR);
    const o2 = osmBuilding('o2', SQR);
    const out = findCandidates({
      plateauEntities: [p], osmEntities: [o1, o2],
      transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
    });
    expect(out).toEqual([]);
  });

  it('skips Plateau outlines with no OSM building beneath (handled by conflation)', () => {
    const p = outline('p1', SQR, { height: '12' }, SQR_CENTER);
    const out = findCandidates({
      plateauEntities: [p], osmEntities: [],
      transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
    });
    expect(out).toEqual([]);
  });

  it('excludes Plateau outlines in transferredIDs/acceptIDs/ignoreIDs', () => {
    const p = outline('p1', SQR, { height: '12' }, SQR_CENTER);
    const o = osmBuilding('o1', SQR);
    expect(findCandidates({
      plateauEntities: [p], osmEntities: [o],
      transferredIDs: new Set(['p1']),
      acceptIDs: new Set(), ignoreIDs: new Set()
    })).toEqual([]);
    expect(findCandidates({
      plateauEntities: [p], osmEntities: [o],
      transferredIDs: new Set(),
      acceptIDs: new Set(['p1']), ignoreIDs: new Set()
    })).toEqual([]);
    expect(findCandidates({
      plateauEntities: [p], osmEntities: [o],
      transferredIDs: new Set(), acceptIDs: new Set(),
      ignoreIDs: new Set(['p1'])
    })).toEqual([]);
  });

  it('rejects Plateau entities that have building:part', () => {
    const p = outline('p1', SQR, { 'building:part': 'yes', height: '12' }, SQR_CENTER);
    const o = osmBuilding('o1', SQR);
    const out = findCandidates({
      plateauEntities: [p], osmEntities: [o],
      transferredIDs: new Set(), acceptIDs: new Set(), ignoreIDs: new Set()
    });
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

```bash
npm run test:browser -- --grep 'HeightTransferMatcher'
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement the matcher module**

Create `modules/core/lib/HeightTransferMatcher.js`:

```javascript
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
    try { outlineGeo = outline.asGeoJSON(); }
    catch (_err) { continue; }

    let matched = [];
    for (const osm of osmBuildings) {
      let osmGeo;
      try { osmGeo = osm.asGeoJSON(); }
      catch (_err) { continue; }
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
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
npm run test:browser -- --grep 'HeightTransferMatcher'
```

Expected: PASS all tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json \
        modules/core/lib/HeightTransferMatcher.js \
        test/browser/core/lib/HeightTransferMatcher.test.js
git commit -m "feat(plateau): add HeightTransferMatcher for outline/OSM candidate detection"
```

---

## Task 5 — Client: `HeightTransferAction` (graph action)

**Repository:** `Rapid`
**Branch:** `feature/plateau-height-transfer`

**Files:**
- Create: `modules/actions/transfer_plateau_tags.js`
- Modify: `modules/actions/index.js` (add export)
- Test: `test/browser/actions/transfer_plateau_tags.test.js`

**Interfaces:**
- Consumes: OSM entity ID + a `{key: value}` map (already filtered to missing tags by the matcher/preview)
- Produces: `actionTransferPlateauTags(entityID, tags)` — returns a graph transformation function suitable for `Context.perform(...)`; used by HeightTransferMode (Task 6)

**Guarantees:** never overwrites existing tag values; if any of the requested keys already exist on the entity, they are skipped (defense-in-depth on top of the matcher's per-tag missing filter).

- [ ] **Step 1: Write failing tests**

Create `test/browser/actions/transfer_plateau_tags.test.js`:

```javascript
import { actionTransferPlateauTags } from '../../../modules/actions/transfer_plateau_tags.js';
import { osmWay } from '../../../modules/osm/way.js';
import { Graph } from '../../../modules/core/lib/Graph.js';

describe('actionTransferPlateauTags', () => {
  it('adds missing tags to the entity', () => {
    const way = osmWay({ id: 'w1', tags: { building: 'yes' } });
    const graph = new Graph([way]);
    const g2 = actionTransferPlateauTags('w1',
      { height: '12.5', 'building:levels': '3' })(graph);
    expect(g2.entity('w1').tags).toEqual({
      building: 'yes', height: '12.5', 'building:levels': '3'
    });
  });

  it('never overwrites existing tag values', () => {
    const way = osmWay({ id: 'w1', tags: { building: 'yes', height: '10' } });
    const graph = new Graph([way]);
    const g2 = actionTransferPlateauTags('w1',
      { height: '12.5', ele: '45' })(graph);
    // height stays at 10, ele is added
    expect(g2.entity('w1').tags).toEqual({
      building: 'yes', height: '10', ele: '45'
    });
  });

  it('leaves the entity untouched when no tags are actually new', () => {
    const way = osmWay({ id: 'w1', tags: { building: 'yes', height: '12' } });
    const graph = new Graph([way]);
    const g2 = actionTransferPlateauTags('w1', { height: '99' })(graph);
    expect(g2.entity('w1')).toBe(graph.entity('w1'));   // reference equality
  });

  it('accepts relations as well as ways', () => {
    // relation with building=yes gets height added
    // (Rapid represents building relations via osmRelation; test structure is
    //  the same — entity() returns the relation, tags update replaces it)
    // Detailed setup omitted here for brevity; mirror the osmWay test.
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npm run test:browser -- --grep 'actionTransferPlateauTags'
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the action**

Create `modules/actions/transfer_plateau_tags.js`:

```javascript
// Add PLATEAU-derived tag values to an OSM entity, but only for keys the
// entity does not already have. Never overwrites existing values.
export function actionTransferPlateauTags(entityID, tags) {
  return function(graph) {
    const entity = graph.entity(entityID);
    const existing = entity.tags ?? {};
    const merged = { ...existing };
    let changed = false;
    for (const [k, v] of Object.entries(tags)) {
      if (existing[k] !== undefined && existing[k] !== null && existing[k] !== '') continue;
      merged[k] = v;
      changed = true;
    }
    if (!changed) return graph;
    return graph.replace(entity.update({ tags: merged }));
  };
}
```

- [ ] **Step 4: Register the action in the actions index**

Edit `modules/actions/index.js` and add:

```javascript
export { actionTransferPlateauTags } from './transfer_plateau_tags.js';
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
npm run test:browser -- --grep 'actionTransferPlateauTags'
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add modules/actions/transfer_plateau_tags.js \
        modules/actions/index.js \
        test/browser/actions/transfer_plateau_tags.test.js
git commit -m "feat(plateau): add actionTransferPlateauTags graph action"
```

---

## Task 6 — Client: `HeightTransferMode`

**Repository:** `Rapid`
**Branch:** `feature/plateau-height-transfer`

**Files:**
- Create: `modules/modes/HeightTransferMode.js`
- Modify: `modules/modes/index.js` (add export) and wherever modes are registered with the ModeSystem (typically `modules/core/ModeSystem.js`)
- Test: `test/browser/modes/HeightTransferMode.test.js`

**Interfaces:**
- Consumes: `findCandidates` (Task 4), `actionTransferPlateauTags` (Task 5), the current viewport bbox, existing sets `transferredIDs` (new to this task), `acceptIDs`, `ignoreIDs`
- Produces:
  - `activate()`, `deactivate()`, `active: boolean`
  - `candidates: MatchCandidate[]` (recomputed on bbox change with debounce)
  - `selectedCandidate: MatchCandidate | null`
  - `select(candidate)`, `clearSelection()`
  - `apply(candidate)` — dispatches `actionTransferPlateauTags`, adds Plateau id to `transferredIDs`, dispatches event `'transferred'`
  - `transferredIDs: Set<string>` (new state, session-only)
- Emits events: `'change'` (candidates changed, selection changed, active toggled), `'transferred'` (apply completed)

- [ ] **Step 1: Write failing tests**

Create `test/browser/modes/HeightTransferMode.test.js`:

```javascript
import { HeightTransferMode } from '../../../modules/modes/HeightTransferMode.js';

function makeContext(overrides = {}) {
  return {
    services: { plateau: { getData: () => [] } },
    systems: {
      editor: { staging: { graph: { getEntitiesForBbox: () => [] } },
                perform: vi.fn() },
      map:    { center: () => [139.75, 35.68], zoom: () => 18,
                extent: () => ({ min:[139.74,35.67], max:[139.76,35.69] }) },
      rapid:  { acceptIDs: new Set(), ignoreIDs: new Set() }
    },
    ...overrides
  };
}

describe('HeightTransferMode', () => {
  it('starts inactive with empty state', () => {
    const mode = new HeightTransferMode(makeContext());
    expect(mode.active).toBe(false);
    expect(mode.candidates).toEqual([]);
    expect(mode.selectedCandidate).toBeNull();
    expect(mode.transferredIDs.size).toBe(0);
  });

  it('activate() computes candidates and emits change', () => {
    const context = makeContext();
    const mode = new HeightTransferMode(context);
    const spy = vi.fn();
    mode.on('change', spy);
    mode.activate();
    expect(mode.active).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('deactivate() clears selection and emits change', () => {
    const mode = new HeightTransferMode(makeContext());
    mode.activate();
    mode.select({ plateauFeature: { id: 'p1' } });
    expect(mode.selectedCandidate).not.toBeNull();
    mode.deactivate();
    expect(mode.active).toBe(false);
    expect(mode.selectedCandidate).toBeNull();
  });

  it('apply() dispatches actionTransferPlateauTags with missing tags only', () => {
    const context = makeContext();
    const mode = new HeightTransferMode(context);
    mode.activate();
    const candidate = {
      plateauFeature: { id: 'p1', tags: { height: '12', ele: '45' } },
      osmFeature: { id: 'w1' },
      kind: 'outline_to_building',
      state: 'CANDIDATE',
      missingTags: ['height', 'ele'],
      conflictingTags: [],
      matchingTags: [],
      ratio: 1.0
    };
    mode.apply(candidate);
    expect(context.systems.editor.perform).toHaveBeenCalledTimes(1);
    // Perform should have been called with an action function
    const actionArg = context.systems.editor.perform.mock.calls[0][0];
    expect(typeof actionArg).toBe('function');
    expect(mode.transferredIDs.has('p1')).toBe(true);
  });

  it('apply() emits transferred event', () => {
    const context = makeContext();
    const mode = new HeightTransferMode(context);
    mode.activate();
    const spy = vi.fn();
    mode.on('transferred', spy);
    mode.apply({
      plateauFeature: { id: 'p1', tags: { height: '12' } },
      osmFeature: { id: 'w1' },
      kind: 'outline_to_building',
      state: 'CANDIDATE',
      missingTags: ['height'], conflictingTags: [], matchingTags: [], ratio: 1
    });
    expect(spy).toHaveBeenCalled();
  });

  it('recomputes candidates when bbox changes (debounced)', async () => {
    const context = makeContext();
    const mode = new HeightTransferMode(context);
    mode.activate();
    const initialCount = mode.candidates.length;
    // Simulate bbox change event
    mode.onViewportChange();
    mode.onViewportChange();
    mode.onViewportChange();
    // Wait for debounce
    await new Promise(r => setTimeout(r, 250));
    // findCandidates was called at most once after the burst
    // (Detailed spy on findCandidates omitted here — assert via observable effect
    //  on mode.candidates and a shared counter for calls.)
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npm run test:browser -- --grep 'HeightTransferMode'
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `HeightTransferMode`**

Create `modules/modes/HeightTransferMode.js`:

```javascript
import { EventEmitter } from 'events';
import { actionTransferPlateauTags } from '../actions/transfer_plateau_tags.js';
import { findCandidates } from '../core/lib/HeightTransferMatcher.js';

const RECOMPUTE_DEBOUNCE_MS = 200;

export class HeightTransferMode extends EventEmitter {
  constructor(context) {
    super();
    this.context = context;
    this.id = 'height-transfer';
    this.active = false;
    this.candidates = [];
    this.selectedCandidate = null;
    this.transferredIDs = new Set();
    this._recomputeTimer = null;
    this._boundOnViewport = this.onViewportChange.bind(this);
  }

  activate() {
    if (this.active) return;
    this.active = true;
    const map = this.context.systems.map;
    map.on?.('move', this._boundOnViewport);
    this._recompute();
    this.emit('change');
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.selectedCandidate = null;
    this.candidates = [];
    const map = this.context.systems.map;
    map.off?.('move', this._boundOnViewport);
    if (this._recomputeTimer) clearTimeout(this._recomputeTimer);
    this._recomputeTimer = null;
    this.emit('change');
  }

  onViewportChange() {
    if (!this.active) return;
    if (this._recomputeTimer) clearTimeout(this._recomputeTimer);
    this._recomputeTimer = setTimeout(() => {
      this._recompute();
      this._recomputeTimer = null;
    }, RECOMPUTE_DEBOUNCE_MS);
  }

  _recompute() {
    const ctx = this.context;
    const plateau = ctx.services?.plateau;
    if (!plateau) { this.candidates = []; this.emit('change'); return; }
    const editor = ctx.systems.editor;
    const rapid = ctx.systems.rapid;

    // Combine entities from all Plateau datasets in the current bbox
    const plateauEntities = [];
    for (const datasetID of plateau.getAvailableDatasets?.() ?? []) {
      const entities = plateau.getData(datasetID);
      if (entities) plateauEntities.push(...entities);
    }
    const extent = ctx.systems.map.extent();
    const osmEntities = editor.staging.graph.getEntitiesForBbox
      ? editor.staging.graph.getEntitiesForBbox(extent)
      : [];

    this.candidates = findCandidates({
      plateauEntities,
      osmEntities,
      transferredIDs: this.transferredIDs,
      acceptIDs: rapid.acceptIDs,
      ignoreIDs: rapid.ignoreIDs
    });
    this.emit('change');
  }

  select(candidate) {
    if (!this.active) return;
    this.selectedCandidate = candidate;
    this.emit('change');
  }

  clearSelection() {
    if (!this.selectedCandidate) return;
    this.selectedCandidate = null;
    this.emit('change');
  }

  apply(candidate) {
    if (!this.active) return;
    const tagsToAdd = {};
    for (const key of candidate.missingTags) {
      const v = candidate.plateauFeature.tags?.[key];
      if (v !== undefined) tagsToAdd[key] = v;
    }
    this.context.systems.editor.perform(
      actionTransferPlateauTags(candidate.osmFeature.id, tagsToAdd)
    );
    this.transferredIDs.add(candidate.plateauFeature.id);
    this.selectedCandidate = null;
    // Remove the applied candidate from the current list so its icon disappears
    this.candidates = this.candidates.filter(c => c !== candidate);
    this.emit('transferred', candidate);
    this.emit('change');
  }
}
```

- [ ] **Step 4: Wire the mode into the ModeSystem**

Add the export in `modules/modes/index.js`:

```javascript
export { HeightTransferMode } from './HeightTransferMode.js';
```

Register it in the ModeSystem's mode list (find where other modes are added to the system and add ours). Follow the existing pattern; the exact line number is close to the `SelectMode` / `BrowseMode` registrations.

- [ ] **Step 5: Register undo hook for `transferredIDs`**

`HeightTransferMode` must observe editor undo/redo so that a Plateau id is removed from `transferredIDs` when the tag-add action is undone (and re-added on redo). In `activate()`, subscribe to the editor's `undone` / `redone` events:

```javascript
this._boundOnUndone = this._onUndone.bind(this);
this._boundOnRedone = this._onRedone.bind(this);
ctx.systems.editor.on?.('undone', this._boundOnUndone);
ctx.systems.editor.on?.('redone', this._boundOnRedone);
```

In `deactivate()`, unsubscribe. Implement `_onUndone(action)` / `_onRedone(action)` to inspect whether the action was a `transfer_plateau_tags` action (mark actions by tagging the returned function with `.actionName = 'transfer_plateau_tags'` in Task 5 and check that in the handler), and add/remove from `transferredIDs` accordingly. Recompute candidates.

Add a test for undo behavior:

```javascript
it('removes id from transferredIDs on undo', () => { /* ... */ });
```

- [ ] **Step 6: Run the tests and confirm they pass**

```bash
npm run test:browser -- --grep 'HeightTransferMode'
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add modules/modes/HeightTransferMode.js \
        modules/modes/index.js \
        modules/actions/transfer_plateau_tags.js \
        test/browser/modes/HeightTransferMode.test.js
git commit -m "feat(plateau): add HeightTransferMode with debounced recompute and undo integration"
```

---

## Task 7 — Client: `PixiLayerHeightTransfer`

**Repository:** `Rapid`
**Branch:** `feature/plateau-height-transfer`

**Files:**
- Create: `modules/pixi/PixiLayerHeightTransfer.js`
- Modify: `modules/pixi/PixiScene.js` (register the new layer)
- Test: `test/browser/pixi/PixiLayerHeightTransfer.test.js`

**Interfaces:**
- Consumes: `HeightTransferMode.candidates` and `HeightTransferMode.active` (Task 6)
- Produces: renders four-state icons at each candidate's `plateauFeature.representativePoint` on top of the map. Emits click hits back to `HeightTransferMode` via `select(candidate)`.

**State visual specs (matches spec Section 3):**

| State           | Shape                 | Color             | Min zoom |
|-----------------|-----------------------|-------------------|----------|
| CANDIDATE       | filled circle 8px     | magenta `0xD500F9`| 17       |
| COVERED         | check-mark glyph      | green   `0x66BB6A`| 18       |
| CONFLICT        | "!?" glyph in circle  | yellow  `0xFFC107`| 18       |
| AREA_MISMATCH   | "!?" glyph in circle  | orange  `0xFF9800`| 18       |

- [ ] **Step 1: Study `PixiLayerPlateauCoverage.js` and `AbstractLayer.js` for the layer pattern**

Read `modules/pixi/PixiLayerPlateauCoverage.js` end-to-end and `modules/pixi/AbstractLayer.js` for the `render(frame, viewport, zoom)` contract.

- [ ] **Step 2: Write failing tests**

Create `test/browser/pixi/PixiLayerHeightTransfer.test.js`:

```javascript
import { PixiLayerHeightTransfer } from '../../../modules/pixi/PixiLayerHeightTransfer.js';

function makeSceneWithMode(candidates = []) {
  const mode = {
    active: true, candidates, on: () => {}, off: () => {},
    select: vi.fn()
  };
  return { context: { systems: { heightTransfer: mode } }, mode };
}

describe('PixiLayerHeightTransfer', () => {
  it('renders nothing when mode is inactive', () => {
    const scene = makeSceneWithMode([]);
    scene.mode.active = false;
    const layer = new PixiLayerHeightTransfer(scene, 'height-transfer');
    const container = { children: [], addChild: c => container.children.push(c) };
    layer._container = container;
    layer.render(0, /*viewport*/ {}, /*zoom*/ 18);
    expect(container.children.length).toBe(0);
  });

  it('renders one icon per candidate at zoom >= 17 for CANDIDATE state', () => {
    const scene = makeSceneWithMode([
      { plateauFeature: { id: 'p1', representativePoint: [139.755, 35.679] },
        state: 'CANDIDATE' }
    ]);
    const layer = new PixiLayerHeightTransfer(scene, 'height-transfer');
    layer._container = { children: [], addChild(c) { this.children.push(c); } };
    layer.render(0, /*viewport*/ { project: p => p }, 17);
    expect(layer._container.children.length).toBe(1);
  });

  it('hides COVERED / CONFLICT / AREA_MISMATCH below zoom 18', () => {
    const scene = makeSceneWithMode([
      { plateauFeature: { id: 'p1', representativePoint: [139.755, 35.679] },
        state: 'COVERED' }
    ]);
    const layer = new PixiLayerHeightTransfer(scene, 'height-transfer');
    layer._container = { children: [], addChild(c) { this.children.push(c); } };
    layer.render(0, { project: p => p }, 17);
    expect(layer._container.children.length).toBe(0);
    layer.render(1, { project: p => p }, 18);
    expect(layer._container.children.length).toBe(1);
  });

  it('click on an icon invokes mode.select(candidate)', () => {
    const c1 = { plateauFeature: { id: 'p1', representativePoint: [139.755, 35.679] },
                 state: 'CANDIDATE' };
    const scene = makeSceneWithMode([c1]);
    const layer = new PixiLayerHeightTransfer(scene, 'height-transfer');
    layer._container = { children: [], addChild(c) { this.children.push(c); } };
    layer.render(0, { project: p => p }, 18);
    const icon = layer._container.children[0];
    icon.emit('pointertap');
    expect(scene.mode.select).toHaveBeenCalledWith(c1);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

```bash
npm run test:browser -- --grep 'PixiLayerHeightTransfer'
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement the layer**

Create `modules/pixi/PixiLayerHeightTransfer.js`:

```javascript
import * as PIXI from 'pixi.js';
import { AbstractLayer } from './AbstractLayer.js';

const LAYERID = 'height-transfer';
const MIN_CANDIDATE_ZOOM = 17;
const MIN_INFO_ZOOM = 18;

const STATE_STYLE = {
  CANDIDATE:     { color: 0xD500F9, radius: 6, glyph: null },
  COVERED:       { color: 0x66BB6A, radius: 8, glyph: '✓' },
  CONFLICT:      { color: 0xFFC107, radius: 8, glyph: '!?' },
  AREA_MISMATCH: { color: 0xFF9800, radius: 8, glyph: '!?' }
};

export class PixiLayerHeightTransfer extends AbstractLayer {
  constructor(scene, layerID) {
    super(scene, layerID);
    this._iconContainer = null;
  }

  get supported() {
    return !!this.context.systems.heightTransfer;
  }

  reset() {
    super.reset();
    if (this._iconContainer) this._iconContainer.removeChildren();
  }

  render(frame, viewport, zoom) {
    const mode = this.context.systems.heightTransfer;
    if (!mode || !mode.active) { this.reset(); return; }
    if (!this._iconContainer) {
      this._iconContainer = new PIXI.Container();
      this._container.addChild(this._iconContainer);
    } else {
      this._iconContainer.removeChildren();
    }
    for (const cand of mode.candidates) {
      const minZoom = (cand.state === 'CANDIDATE') ? MIN_CANDIDATE_ZOOM : MIN_INFO_ZOOM;
      if (zoom < minZoom) continue;
      const icon = this._makeIcon(cand, viewport);
      if (icon) this._iconContainer.addChild(icon);
    }
  }

  _makeIcon(cand, viewport) {
    const rp = cand.plateauFeature.representativePoint;
    if (!rp) return null;
    const [x, y] = viewport.project(rp);
    const style = STATE_STYLE[cand.state];

    const g = new PIXI.Graphics();
    g.beginFill(style.color, 0.85);
    g.lineStyle(1.5, 0xFFFFFF, 1.0);
    g.drawCircle(0, 0, style.radius);
    g.endFill();
    if (style.glyph) {
      const label = new PIXI.Text({
        text: style.glyph,
        style: { fontFamily: 'sans-serif', fontSize: 10, fill: 0xFFFFFF, fontWeight: 'bold' }
      });
      label.anchor.set(0.5);
      g.addChild(label);
    }
    g.x = x; g.y = y;
    g.eventMode = 'static';
    g.cursor = 'pointer';
    g.on('pointertap', () => this.context.systems.heightTransfer.select(cand));
    return g;
  }
}
```

- [ ] **Step 5: Register the layer**

Edit `modules/pixi/PixiScene.js` following the existing `PixiLayerPlateauCoverage` registration pattern (near line 75):

```javascript
import { PixiLayerHeightTransfer } from './PixiLayerHeightTransfer.js';
// ...
new PixiLayerHeightTransfer(this, 'height-transfer'),
```

- [ ] **Step 6: Register `HeightTransferMode` on `context.systems.heightTransfer`**

If not already done in Task 6, ensure that the mode is exposed on `context.systems.heightTransfer` at startup. This is typically wired in the same file where `PlateauService` is added to `context.services`.

- [ ] **Step 7: Run the tests and confirm they pass**

```bash
npm run test:browser -- --grep 'PixiLayerHeightTransfer'
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add modules/pixi/PixiLayerHeightTransfer.js \
        modules/pixi/PixiScene.js \
        test/browser/pixi/PixiLayerHeightTransfer.test.js
git commit -m "feat(plateau): add PixiLayerHeightTransfer for four-state candidate icons"
```

---

## Task 8 — Client: Toolbar mode button

**Repository:** `Rapid`
**Branch:** `feature/plateau-height-transfer`

**Files:**
- Create: `modules/ui/tools/UiHeightTransferTool.js`
- Modify: `modules/ui/UiMapToolbar.js` (add the tool to the toolbar)
- Test: manual (button appears; click toggles mode)

**Interfaces:**
- Consumes: `context.systems.heightTransfer` (Task 6)
- Produces: a toolbar button that toggles `mode.activate()` / `mode.deactivate()`

- [ ] **Step 1: Study an existing tool implementation**

Read `modules/ui/tools/UiRapidTool.js` (its pattern is closest to what we need — a toolbar tool that toggles a state).

- [ ] **Step 2: Implement `UiHeightTransferTool`**

Create `modules/ui/tools/UiHeightTransferTool.js`:

```javascript
import { uiIcon } from '../icon.js';   // adapt to the actual helper name used by other tools

export class UiHeightTransferTool {
  constructor(context) {
    this.context = context;
    this.id = 'height-transfer';
    this.stringID = 'toolbar.height_transfer';   // for l10n; see step 3
  }

  render(selection) {
    const mode = this.context.systems.heightTransfer;
    if (!mode) return;

    const button = selection.selectAll('.height-transfer-button')
      .data([0])
      .enter()
      .append('button')
      .attr('class', 'height-transfer-button bar-button')
      .attr('title', this.context.systems.l10n.t(this.stringID))
      .on('click', () => {
        if (mode.active) mode.deactivate(); else mode.activate();
        this._syncPressed(button, mode);
      });
    button.call(uiIcon('#rapid-icon-building-height'));   // choose an appropriate icon id

    mode.on('change', () => this._syncPressed(selection.select('.height-transfer-button'), mode));
    this._syncPressed(button, mode);
  }

  _syncPressed(button, mode) {
    button.classed('pressed', mode.active)
          .attr('aria-pressed', mode.active ? 'true' : 'false');
  }
}
```

- [ ] **Step 3: Add localization strings**

Find the l10n directory (`data/l10n/en.json` or similar) and add:

```json
"toolbar.height_transfer": "Transfer PLATEAU heights to OSM"
```

Add a Japanese translation to the corresponding JA file:

```json
"toolbar.height_transfer": "PLATEAU の高さを OSM に転記"
```

- [ ] **Step 4: Register the tool in `UiMapToolbar`**

Edit `modules/ui/UiMapToolbar.js`. Import and instantiate the new tool in the toolbar's tool list. Match the placement pattern of `UiRapidTool` (put it adjacent to it since both are Plateau-related).

- [ ] **Step 5: Manual smoke test**

Start the dev server:

```bash
npm run start
```

Open http://127.0.0.1:8080/ and verify:
- New button appears in the toolbar
- Clicking toggles between pressed and unpressed
- When pressed at zoom 18 over a Plateau-covered area, dots appear
- Clicking off dismisses them

- [ ] **Step 6: Commit**

```bash
git add modules/ui/tools/UiHeightTransferTool.js \
        modules/ui/UiMapToolbar.js \
        data/l10n/en.json data/l10n/ja.json
git commit -m "feat(plateau): add height-transfer mode toggle to toolbar"
```

---

## Task 9 — Client: preview panel + apply flow + changeset comment preset

**Repository:** `Rapid`
**Branch:** `feature/plateau-height-transfer`

**Files:**
- Create: `modules/ui/panes/UiHeightTransferPreview.js`
- Modify: `modules/ui/UiRapidInspector.js` OR wherever right-side panels are rendered
- Modify: `modules/ui/commit.js` (add preset comment when at least one transfer occurred)
- Test: `test/browser/ui/UiHeightTransferPreview.test.js`

**Interfaces:**
- Consumes: `HeightTransferMode.selectedCandidate`, `.on('change')`
- Produces:
  - A panel that shows current OSM tags vs. planned additions, with Apply / Cancel buttons
  - Highlight of the target OSM building on the map (via existing hover mechanism)
  - Commit UI comment prefilled once at least one transfer has been done in the session

- [ ] **Step 1: Write failing tests for the preview panel**

Create `test/browser/ui/UiHeightTransferPreview.test.js`:

```javascript
import { UiHeightTransferPreview } from '../../../modules/ui/panes/UiHeightTransferPreview.js';

describe('UiHeightTransferPreview', () => {
  let panel, mode, selection;

  beforeEach(() => {
    mode = { selectedCandidate: null, on: vi.fn(), off: vi.fn(),
             apply: vi.fn(), clearSelection: vi.fn() };
    panel = new UiHeightTransferPreview({ systems: { heightTransfer: mode } });
    selection = document.createElement('div');
  });

  it('renders nothing when no candidate is selected', () => {
    panel.render(selection);
    expect(selection.querySelector('.height-transfer-preview')).toBeNull();
  });

  it('renders current tags and planned additions when a candidate is selected', () => {
    mode.selectedCandidate = {
      osmFeature: { id: 'w1', tags: { building: 'yes' } },
      plateauFeature: { tags: { height: '12.5', ele: '45.2' } },
      missingTags: ['height', 'ele'],
      state: 'CANDIDATE'
    };
    panel.render(selection);
    const html = selection.innerHTML;
    expect(html).toContain('w1');
    expect(html).toContain('height');
    expect(html).toContain('12.5');
    expect(html).toContain('ele');
    expect(html).toContain('45.2');
  });

  it('Apply button dispatches mode.apply', () => {
    mode.selectedCandidate = {
      osmFeature: { id: 'w1', tags: { building: 'yes' } },
      plateauFeature: { tags: { height: '12' } },
      missingTags: ['height'], state: 'CANDIDATE'
    };
    panel.render(selection);
    selection.querySelector('.apply').click();
    expect(mode.apply).toHaveBeenCalled();
  });

  it('Cancel button clears selection', () => {
    mode.selectedCandidate = {
      osmFeature: { id: 'w1', tags: {} },
      plateauFeature: { tags: {} },
      missingTags: [], state: 'CANDIDATE'
    };
    panel.render(selection);
    selection.querySelector('.cancel').click();
    expect(mode.clearSelection).toHaveBeenCalled();
  });

  it('for COVERED / CONFLICT / AREA_MISMATCH states, no Apply button is shown', () => {
    for (const state of ['COVERED', 'CONFLICT', 'AREA_MISMATCH']) {
      mode.selectedCandidate = {
        osmFeature: { id: 'w1', tags: {} },
        plateauFeature: { tags: {} },
        missingTags: [], conflictingTags: [], matchingTags: [],
        state
      };
      selection.innerHTML = '';
      panel.render(selection);
      expect(selection.querySelector('.apply')).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npm run test:browser -- --grep 'UiHeightTransferPreview'
```

Expected: FAIL.

- [ ] **Step 3: Implement the preview panel**

Create `modules/ui/panes/UiHeightTransferPreview.js`:

```javascript
export class UiHeightTransferPreview {
  constructor(context) {
    this.context = context;
    this._mode = context.systems.heightTransfer;
    this._mode?.on('change', () => this._rerender());
    this._boundSelection = null;
  }

  render(selection) {
    this._boundSelection = selection;
    this._rerender();
  }

  _rerender() {
    if (!this._boundSelection) return;
    const cand = this._mode?.selectedCandidate;
    this._boundSelection.innerHTML = '';
    if (!cand) return;

    const panel = document.createElement('div');
    panel.className = 'height-transfer-preview';

    const title = document.createElement('h4');
    title.textContent = `OSM ${cand.osmFeature.type} #${cand.osmFeature.id}`;
    panel.appendChild(title);

    // Current tags
    const currentH = document.createElement('h5');
    currentH.textContent = this.context.systems.l10n.t('height_transfer.current_tags');
    panel.appendChild(currentH);
    const currentList = document.createElement('ul');
    for (const [k, v] of Object.entries(cand.osmFeature.tags ?? {})) {
      const li = document.createElement('li');
      li.textContent = `${k} = ${v}`;
      currentList.appendChild(li);
    }
    panel.appendChild(currentList);

    // Additions (only shown for CANDIDATE state)
    if (cand.state === 'CANDIDATE' && cand.missingTags.length > 0) {
      const addH = document.createElement('h5');
      addH.textContent = this.context.systems.l10n.t('height_transfer.additions');
      panel.appendChild(addH);
      const addList = document.createElement('ul');
      for (const key of cand.missingTags) {
        const li = document.createElement('li');
        li.textContent = `${key} = ${cand.plateauFeature.tags[key]}   ← PLATEAU`;
        addList.appendChild(li);
      }
      panel.appendChild(addList);

      const apply = document.createElement('button');
      apply.className = 'apply';
      apply.textContent = this.context.systems.l10n.t('height_transfer.apply');
      apply.onclick = () => this._mode.apply(cand);
      panel.appendChild(apply);
    } else if (cand.state === 'CONFLICT') {
      const note = document.createElement('p');
      note.textContent = this.context.systems.l10n.t('height_transfer.conflict_note');
      panel.appendChild(note);
      // Show diff table
      const tbl = document.createElement('table');
      for (const c of cand.conflictingTags) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${c.key}</td><td>OSM: ${c.osmValue}</td>
                        <td>PLATEAU: ${c.plateauValue}</td>`;
        tbl.appendChild(tr);
      }
      panel.appendChild(tbl);
    } else if (cand.state === 'COVERED') {
      const note = document.createElement('p');
      note.textContent = this.context.systems.l10n.t('height_transfer.covered_note');
      panel.appendChild(note);
    } else if (cand.state === 'AREA_MISMATCH') {
      const note = document.createElement('p');
      note.textContent = this.context.systems.l10n.t('height_transfer.area_mismatch_note');
      panel.appendChild(note);
    }

    const cancel = document.createElement('button');
    cancel.className = 'cancel';
    cancel.textContent = this.context.systems.l10n.t('height_transfer.cancel');
    cancel.onclick = () => this._mode.clearSelection();
    panel.appendChild(cancel);

    this._boundSelection.appendChild(panel);
  }
}
```

- [ ] **Step 4: Add the l10n strings**

Add to `data/l10n/en.json`:

```json
"height_transfer.current_tags": "Current tags",
"height_transfer.additions": "Adding (missing tags only)",
"height_transfer.apply": "Apply",
"height_transfer.cancel": "Cancel",
"height_transfer.conflict_note": "Existing OSM values differ from PLATEAU. Override deferred (Phase 3, pending community consultation).",
"height_transfer.covered_note": "All target tags are present and match PLATEAU values.",
"height_transfer.area_mismatch_note": "Area ratio outside 0.5–2.0. Likely block-level mapping or PLATEAU under-partition; please review manually."
```

Add Japanese translations to `data/l10n/ja.json`.

- [ ] **Step 5: Wire the preview into the existing right-side panel**

Register `UiHeightTransferPreview` next to `UiRapidInspector`. When `HeightTransferMode.active === true` and a candidate is selected, show the preview panel instead of the default Inspector; otherwise show the standard one.

- [ ] **Step 6: Add commit comment preset**

In `modules/ui/commit.js`, near where the changeset comment is initialized, add:

```javascript
const mode = context.systems.heightTransfer;
if (mode && mode.transferredIDs.size > 0) {
  const preset = 'Add height/ele/building:levels from PLATEAU building data';
  if (!currentComment) {
    tags.comment = preset;
  } else if (!currentComment.includes('PLATEAU')) {
    tags.comment = `${currentComment}; ${preset}`;
  }
}
```

- [ ] **Step 7: Run the tests and confirm they pass**

```bash
npm run test:browser -- --grep 'UiHeightTransferPreview'
```

Expected: PASS.

- [ ] **Step 8: Manual verification of the full flow**

Start dev server, open browser:
- Toggle mode on at zoom 18 over a Plateau-covered OSM building
- Click a magenta dot → panel appears with the correct fields
- Click Apply → OSM way updates in the graph (verify via Rapid's inspector)
- Undo → the tag is removed, and the dot reappears
- Redo → the tag comes back, dot disappears
- Open the commit UI → comment field is prefilled

- [ ] **Step 9: Commit**

```bash
git add modules/ui/panes/UiHeightTransferPreview.js \
        modules/ui/UiRapidInspector.js \
        modules/ui/commit.js \
        data/l10n/en.json data/l10n/ja.json \
        test/browser/ui/UiHeightTransferPreview.test.js
git commit -m "feat(plateau): add height-transfer preview panel and changeset comment preset"
```

---

## Task 10 — Manual QA, PR, and production deploy

**Repository:** both
**Branches:** feature branches from Tasks 1–9

**Files:** none new; this task is release engineering

**Interfaces:**
- Consumes: everything from Tasks 1–9
- Produces: two merged PRs, one server deploy, one client build+rsync deploy, a QA report

- [ ] **Step 1: Run full test suites on both feature branches**

```bash
cd /Users/nyampire/git/rapid_plateau_api
git checkout feature/representative-point
pytest --run-integration -v
```

```bash
cd /Users/nyampire/git/Rapid
git checkout feature/plateau-height-transfer
npm run test:browser
```

Expected: all pass.

- [ ] **Step 2: Manual QA on the dev server against a local plateau API**

Follow the manual QA matrix from the spec's Testing section:
- **Dense**: Tokyo 23 wards center (e.g. Shibuya, Shinjuku)
- **Medium**: suburban (Fuchu, Yokohama north)
- **Sparse**: regional (Kanazawa, Wakayama)

For each area, verify:
- Icon density and readability
- All 4 states appear where expected
- Apply flow works end-to-end
- Undo/redo behave correctly
- Toggle to another tool auto-deactivates the mode
- Mode-off clears icons

Capture screenshots and note any issues in a QA log at `docs/qa/2026-07-17-plateau-height-transfer.md`.

- [ ] **Step 3: Open PR on rapid_plateau_api**

```bash
cd /Users/nyampire/git/rapid_plateau_api
git push -u origin feature/representative-point
gh pr create --title "Add representative_point tag to buildings endpoint" \
             --body-file <(cat <<'EOF'
Implements the server side of the Phase 1 PLATEAU height transfer
design. See `Rapid/docs/superpowers/specs/2026-07-17-plateau-height-transfer-design.md`
for design details.

## Changes
- SELECT gains `ST_AsGeoJSON(ST_PointOnSurface(geom))::jsonb -> 'coordinates'`
- Each `<way>` / `<relation>` receives a `<tag k="representative_point" v="lon,lat" />`
- New integration test file `tests/test_representative_point.py`

## Compatibility
Additive only — existing clients simply ignore the new tag.
EOF
)
```

- [ ] **Step 4: Open PR on Rapid**

```bash
cd /Users/nyampire/git/Rapid
git push -u origin feature/plateau-height-transfer
gh pr create --title "PLATEAU height transfer Phase 1" \
             --body-file <(cat <<'EOF'
Adds a new "PLATEAU height transfer" mode. See
`docs/superpowers/specs/2026-07-17-plateau-height-transfer-design.md`
for design details.

## Changes
- PlateauService extracts `representative_point` from XML tags
- New matcher (`HeightTransferMatcher.js`) computes four-state candidates
- New action `actionTransferPlateauTags` adds missing tags without overwriting
- New mode `HeightTransferMode` manages state and integrates with undo/redo
- New Pixi layer `PixiLayerHeightTransfer` renders four-state icons
- Toolbar button and preview panel added

## Non-goals for Phase 1
- Overwriting existing tags (Phase 3, community-dependent)
- building:part support (Phase 2)
- Batch UI (Phase 3, community-dependent)
EOF
)
```

- [ ] **Step 5: Merge server PR first, deploy server**

After server PR is reviewed and merged, deploy:

```bash
ssh plateau-vps "cd /opt/plateau-api/rapid_plateau_api && git pull"
# Ask user to run: sudo systemctl restart plateau-api
```

Smoke test:

```bash
curl 'https://rapid.nyampire.info/api/mapwithai/buildings?bbox=139.755,35.679,139.758,35.680' \
  | grep 'representative_point' | head -3
```

Expected: at least one `<tag k="representative_point" v="..." />` line.

- [ ] **Step 6: Merge Rapid PR, build, and deploy**

After Rapid PR is reviewed and merged:

```bash
cd /Users/nyampire/git/Rapid
git checkout main && git pull
npm run dist
rsync -avz --delete dist/ plateau-vps:/var/www/rapid/
```

(Note: use `--exclude /dashboard/` if the deploy dashboard is present in dist to avoid wiping it. Check `~/.claude/projects/-Users-nyampire-git-Rapid/memory/rapid_deploy_dashboard_rsync_hazard.md` for the current guidance.)

- [ ] **Step 7: Production smoke test**

At https://rapid.nyampire.info/, verify:
- Toolbar shows the new mode button
- Enabling it at zoom 18 over Tokyo 23 wards shows candidate dots
- Apply on one candidate produces a valid changeset (do not upload yet — use undo)

- [ ] **Step 8: Announce**

Post in OSM Japan Discord with:
- Short description of the new mode
- Screenshot
- Link to spec / PR
- Request for feedback

If reception is positive, cross-post to `talk-ja` mailing list.

- [ ] **Step 9: Commit the QA log**

```bash
cd /Users/nyampire/git/Rapid
git checkout main
git add docs/qa/2026-07-17-plateau-height-transfer.md
git commit -m "docs: QA log for PLATEAU height transfer Phase 1 deploy"
git push
```

---

## Task 1 Result

Measured on 2026-07-17 against production DB (read-only SELECT).

| Attribute        | Count      | Percentage |
|------------------|-----------:|-----------:|
| Total buildings (`building IS NOT NULL`) | 12,746,701 | — |
| With `height`    | 12,660,547 | 99.32 %    |
| With `ele`       | 12,746,701 | 100.00 %   |
| With `building_levels` | 6,075,503 | 47.66 %    |

Observations:
- `height` and `ele` are populated on essentially every building — these are the main workhorses of the transfer feature.
- `building:levels` covers about half of buildings. This is exactly the scenario the per-tag missing-fill logic (C-b) is designed for: a mapper viewing a building that has PLATEAU height but no levels can pull just the levels.
- All three target tags stay in the state machine (Task 4). No tag is excluded for low population.
- No operational caveats to flag downstream.

---

## Spec traceability

| Spec requirement | Task(s) |
|---|---|
| Server: `representative_point` field | Task 2 |
| Client: parse the tag, Turf fallback | Task 3 |
| Match: outline-only, α ratio filter, point-in-polygon | Task 4 |
| Three-tag transfer (height/ele/building:levels) | Task 4 (target keys), Task 5 (action) |
| Four-state icons | Task 4 (state classification), Task 7 (rendering) |
| Never overwrite existing OSM values | Task 4 (missing-only), Task 5 (defense-in-depth) |
| Mode toggle in toolbar | Task 8 |
| Preview panel with per-state UI | Task 9 |
| Rapid standard undo/redo integration | Task 5, Task 6 |
| Changeset comment preset | Task 9 (Step 6) |
| `transferredIDs` session state | Task 6 |
| No shortcut in Phase 1 | Task 8 (explicit absence) |
| 50-object changeset cap respected | Task 6 (one apply at a time) |
| Deploy server first, then client | Task 10 |
| Rollback = git revert + rsync back | Documented in spec §Rollback; no plan task needed |
| Feature branches, no direct main commit | Task 2 Step 1, Task 3 Step 1, Task 10 Steps 5-6 |
