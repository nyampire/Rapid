# Design: Transfer PLATEAU building attributes to existing OSM buildings (Phase 1)

Date: 2026-07-17
Scope: Rapid (client) + rapid_plateau_api (server)
Phase: 1 of 3 (see "Phased Roadmap" section)

> **Canonical version.** This document is the primary reference for
> implementation. A Japanese translation for discussion and review is
> available at
> [2026-07-17-plateau-height-transfer-design.ja.md](2026-07-17-plateau-height-transfer-design.ja.md).
> When the two versions diverge, this one takes precedence.

## Problem

Many existing OSM building objects lack height, elevation, or level
count data. The PLATEAU dataset provides these attributes for the same
physical buildings but currently the Rapid Plateau editor only lets
mappers add new buildings from PLATEAU; it does not help transfer
attributes to buildings that already exist in OSM.

We want a Rapid tool that lets a mapper transfer missing PLATEAU
attributes onto existing OSM buildings, one building at a time, with
strong safeguards against overwriting existing values.

## Goals

- Enable mappers to click a PLATEAU representative point on the map and
  add the missing subset of `height`, `ele`, and `building:levels` tags
  to the OSM building beneath it
- Visualize match state (candidate, already covered, value conflict,
  ambiguous match) so mappers can see PLATEAU coverage at a glance and
  spot situations that need human review
- Preserve existing OSM values; never overwrite in Phase 1
- Stay within Rapid's 50-object-per-changeset limit (per-building manual
  workflow, not batch)
- Structure code so Phase 2 (building:part support) and Phase 3
  (conflict-value override) can be added without rework

## Non-goals

- PLATEAU building:part attribute transfer (Phase 2)
- OSM `building:part` creation from PLATEAU parts (Phase 2)
- Automated batch matching with review panel (considered for Phase 3
  only after community consultation on whether to pursue Phase 3 at
  all, and additionally requires relaxing the 50-object changeset
  limit via community discussion)
- Transfer of `roof:shape` (deferred to Phase 2 alongside building:part
  support; the roof-only vs. full-building distinction is already
  expressible via `building=roof`, so detailed roof shape adds little
  Phase 1 value and pairs naturally with Simple 3D Buildings work in
  Phase 2)
- Transfer of `building:material`, `roof:material`, `start_date`,
  `name`, `addr:*` (out of scope; either lower fact-quality or already
  independently maintained in OSM)
- Overwriting existing OSM tag values, including cases where the
  existing value clearly diverges from PLATEAU (considered for Phase 3
  only after community consultation on whether to pursue Phase 3 at
  all)
- Server-side pre-computed match caching (client computes matches from
  fetched features; server only provides the representative point)

## Design

### Feature overview

A new "PLATEAU height transfer" mode is added to the Rapid toolbar.
When enabled, the map shows one icon per PLATEAU outline whose
representative point falls inside an OSM building polygon. Icons are
colored by match state:

| State | Icon | Interaction |
|---|---|---|
| `CANDIDATE` | Magenta dot | Click opens preview, then applies missing tags on confirm |
| `COVERED` | Green check | Click shows read-only info (fully covered, values match) |
| `CONFLICT` | Yellow "!?" | Click shows read-only diff (existing OSM value differs from PLATEAU; override deferred, and any override feature depends on the outcome of Phase 3 community consultation) |
| `AREA_MISMATCH` | Orange "!?" | Click shows read-only note (block-level mapping or PLATEAU under-partitioning suspected; manual review recommended) |

The mode is exclusive with other Rapid tools. Toggling it off clears
all icons and returns to the normal editing view.

### Match target: outline only, area-ratio filtered

- Only PLATEAU features tagged `building=*` without `building:part` are
  candidate sources (outline / parent building)
- Match uses server-provided `representative_point` (from
  `ST_PointOnSurface`, guaranteed to fall inside the polygon)
- Client runs point-in-polygon against OSM building ways/relations
- A candidate must match exactly one OSM building; ambiguous cases
  (zero or multiple hits) are skipped without an icon
- Area ratio must be between 0.5 and 2.0 (PLATEAU area / OSM area) to
  earn `CANDIDATE` / `COVERED` / `CONFLICT` state; outside this range
  the icon becomes `AREA_MISMATCH`

### Tag scope and per-tag missing-fill

Three PLATEAU attributes are considered for transfer:

- `height`
- `ele`
- `building:levels`

Transfer is per-tag: only tags missing from the OSM building are added.
Existing values are never modified in Phase 1. The preview UI shows
only the subset that will actually be added.

State assignment for a candidate (all conditions in one bucket):

```
if area_ratio < 0.5 or area_ratio > 2.0:
  state = AREA_MISMATCH
elif missing_tags is not empty:
  state = CANDIDATE
elif conflicting_tags is not empty:
  state = CONFLICT
elif matching_tags is not empty and missing_tags is empty:
  state = COVERED
else:
  # PLATEAU has no relevant tags and OSM has none — no icon
  skip
```

### UX flow

1. User enables "PLATEAU height transfer" mode from the toolbar
2. Rapid computes candidates for the current bbox and renders icons
   (candidate dots at zoom ≥ 17; the other three states at zoom ≥ 18
   to reduce visual noise in dense areas)
3. Clicking a `CANDIDATE` dot highlights the target OSM building and
   opens a preview showing current tags plus the tags that will be
   added
4. Clicking "Apply" dispatches a standard Rapid tag-edit action; the
   PLATEAU feature ID is recorded in `transferredIDs`; the dot
   disappears
5. Clicking icons in other states shows a read-only info popup
6. Undo restores the previous OSM tags and removes the feature from
   `transferredIDs`, re-showing the dot; redo re-applies
7. Toggling the mode off clears all icons

### Architecture

Server (rapid_plateau_api):

- `osmfj_plateau_api.py` `/api/mapwithai/buildings`: SELECT gains
  `ST_AsGeoJSON(ST_PointOnSurface(geom)) AS representative_point`
- Both outlines and parts get the field (Phase 1 uses outlines; Phase 2
  will use parts)
- No new endpoint, no schema migration, no API version bump — existing
  clients ignore the new field

Client (Rapid):

- `PlateauService` (existing): parse `representative_point` from
  responses and attach it to feature entities
- `HeightTransferMode` (new): mode lifecycle, candidate computation,
  `transferredIDs` set, selected-candidate preview state
- `HeightTransferAction` (new): standard Rapid graph action that adds
  the missing tag subset to an OSM way / relation; undo / redo are
  handled by Rapid's standard action machinery
- `PixiLayerHeightTransfer` (new): draws state-colored icons while the
  mode is active; hit-tests clicks and forwards to `HeightTransferMode`
- Toolbar (existing): adds the mode toggle button

### Data model

`MatchCandidate`:

```typescript
type MatchCandidate = {
  plateauFeature: Entity;       // PLATEAU outline
  osmFeature: Entity;            // OSM building way/relation
  kind: 'outline_to_building';   // Phase 2 will add 'part_to_part'
  state: 'CANDIDATE' | 'COVERED' | 'CONFLICT' | 'AREA_MISMATCH';
  missingTags: string[];         // in PLATEAU, missing from OSM
  conflictingTags: {             // in both, values differ
    key: string;
    osmValue: string;
    plateauValue: string;
  }[];
  matchingTags: string[];        // in both, values equal
  ratio: number;                 // PLATEAU area / OSM area
};
```

`HeightTransferMode` state:

```typescript
{
  active: boolean;
  transferredIDs: Set<string>;
  candidates: MatchCandidate[];
  selectedCandidate: MatchCandidate | null;
}
```

`transferredIDs` is session-scoped; it is not persisted across page
reloads. Applied tags are preserved in Rapid's standard auto-save
mechanism (as part of the graph edit history), and once uploaded, the
next session sees them as OSM values and computes `COVERED` on its own.

### Candidate computation

```
function findCandidates(bbox):
  plateauFeatures = plateauService.getFeaturesInBbox(bbox)
  osmFeatures = graph.getBuildingsInBbox(bbox)

  outlines = plateauFeatures.filter(f =>
    f.tags.building &&
    not f.tags['building:part'] &&
    not transferredIDs.has(f.id) &&
    not acceptIDs.has(f.id) &&
    not ignoreIDs.has(f.id)
  )

  candidates = []
  for outline in outlines:
    rp = outline.representative_point
    matched = osmFeatures.filter(w =>
      w.tags.building and pointInPolygon(rp, w.geometry)
    )
    if len(matched) != 1:
      continue      # ambiguous — skip, no icon

    osm = matched[0]
    ratio = geodesicArea(outline.geometry) / geodesicArea(osm.geometry)

    if ratio < 0.5 or ratio > 2.0:
      state = 'AREA_MISMATCH'
    else:
      tagStates = analyzeTagStates(osm, outline)
      if tagStates.missing:
        state = 'CANDIDATE'
      elif tagStates.conflicting:
        state = 'CONFLICT'
      elif tagStates.matching and not tagStates.missing:
        state = 'COVERED'
      else:
        continue    # nothing to compare — skip

    candidates.append(MatchCandidate(outline, osm, 'outline_to_building',
                                     state, tagStates, ratio))

  return candidates
```

`analyzeTagStates(osm, plateau)` returns `{missing, matching, conflicting}`
over the three target keys.

### Rapid integration

- Tag additions use the standard Rapid graph action pattern; they
  appear in changesets as normal tag edits, riding on the existing
  upload flow and undo / redo stack
- `transferredIDs` is a new set alongside the existing `acceptIDs` and
  `ignoreIDs`; it does not overload their semantics
- The commit UI's comment field is pre-filled with a default when at
  least one `HeightTransferAction` has been dispatched (user-editable,
  appended to existing comment rather than overwriting)
- The existing `source=RapiD_Plateau_JP` changeset tag applies without
  modification

### Backward-compat fallback

If the server responds without `representative_point` (older
deployment), the client computes it locally via
`turf.pointOnFeature(geometry)`. Costs a small amount of CPU but keeps
the client functional against un-upgraded servers.

## Edge cases

Server-side:

- `ST_PointOnSurface` fails on broken geometry → server returns NULL →
  client falls back to `turf.pointOnFeature`
- API endpoint down → existing PLATEAU service error handling applies

Client-side:

- PLATEAU / OSM fetch in progress → mode shows "computing" indicator,
  no icons drawn
- OSM entity deleted by another action while mode is active →
  candidate removed on next recompute, icon vanishes
- PLATEAU feature invalidated by pan / re-fetch → same

Match ambiguities:

- `representative_point` is null → fall back to `turf.pointOnFeature`;
  skip if that also fails
- Multiple OSM buildings hit (overlapping polygons) → skip (Phase 1
  ambiguity rule)
- PLATEAU feature has no target tags → not a candidate (nothing to
  compare)
- OSM `building=roof` and other non-typical values → still eligible;
  Phase 1 does not filter on the value of `building=*`

UI state transitions:

- Switching to another tool while mode is on → mode auto-disables,
  icons cleared, in-flight preview cancelled
- Undo of an applied transfer → feature removed from `transferredIDs`,
  icon reappears
- Redo → feature re-added to `transferredIDs`, icon hidden again
- Reload → `transferredIDs` lost, but applied tags remain in Rapid's
  auto-save; once uploaded, next session sees them as OSM values and
  computes `COVERED`

Apply-time:

- Target OSM entity deleted between preview and apply → action fails
  gracefully, brief warning to user
- PLATEAU tag value invalid (e.g. non-numeric height) → that specific
  tag is skipped; other valid tags still applied

Changeset upload:

- Version conflict → existing Rapid conflict-resolution UI handles it
- Auth expiry → existing OAuth flow
- 50-object per-changeset limit reached → standard Rapid limit error;
  natural operational cap for Phase 1

## Testing

Server (rapid_plateau_api, pytest with `fresh_plateau_schema` fixture):

- Integration: `representative_point` present in response for outlines
  and parts, coordinate falls inside polygon
- Integration: broken geometry yields NULL, does not crash the request
- Integration: existing API contract unchanged (JSON schema check)

Client (Rapid, browser test suite):

- Unit: `findCandidates` — outline-only filter, transferred / accept /
  ignore exclusion, point-in-polygon uniqueness, area-ratio branching,
  four-state classification, per-tag missing detection
- Unit: `HeightTransferAction` — adds tags, undo restores, redo
  re-applies, existing values never overwritten, no-ops when entity
  deleted
- Unit: `HeightTransferMode` — active flag transitions, tool-switch
  auto-off, bbox-change recompute with debounce
- Unit: fallback via `turf.pointOnFeature` when
  `representative_point` is missing

Integration (manual):

- Local `plateau_api` with a few cities; Rapid pointed at it via
  `#plateau_api_url=...`; verify dot render → click → apply → undo

Manual QA:

- Dense area (Tokyo 23 wards center): icon density, performance, zoom
  threshold suitability
- Mid-density area (suburban): typical operational flow
- Sparse area (regional city): behavior with few candidates
- All four icon states are visually distinguishable and their info
  popups make sense
- Mode toggle interactions with other tools, reload, logout
- 50-object changeset limit reached — feedback is clear

Performance:

- Measure `findCandidates` time in dense-area bbox (target < 100ms)
- Confirm pan debounce feels smooth
- If measurement demands, add Web Worker or spatial index (not in
  Phase 1 scope; decide after data)

## Development branch policy

**This Phase 1 implementation MUST be developed on feature branches
in both repositories. Direct commits to `main` are not permitted.**

- Rapid: `feature/plateau-height-transfer`
- rapid_plateau_api: `feature/representative-point`
- Merge to `main` happens via PR after review
- During implementation, frequently rebase / pull `main` into the
  feature branch to catch conflicts early
- Deploy to production only after PR merge to `main`

Rationale: the change spans a new mode, a new Pixi layer, toolbar
changes, a new graph action, and a SQL modification, all on
production-serving systems. Direct-to-main risks destabilizing
`rapid.nyampire.info` and the plateau-api service.

## Deliverables

1. Server PR (`rapid_plateau_api`, `feature/representative-point`):
   `representative_point` field added to buildings endpoint
2. Client PR (`Rapid`, `feature/plateau-height-transfer`):
   `HeightTransferMode`, `HeightTransferAction`,
   `PixiLayerHeightTransfer`, toolbar mode toggle, PlateauService
   extension, `turf.pointOnFeature` fallback
3. Unit and integration tests (both repos)
4. Manual QA report covering dense / mid / sparse areas
5. Production deploy (server git-pull + service restart; client
   `npm run dist` + rsync to web root)

## Rollout order

1. Deploy `rapid_plateau_api` first (adds `representative_point`, no
   behavior change for existing clients)
2. Merge Rapid PR, run `npm run dist`
3. rsync `dist/` to production web root
4. Smoke test across several cities: dot render, apply, undo
5. Announce in OSM Japan Discord; consider `talk-ja` if the response
   is positive

## Rollback

- Server: `git revert` the SELECT change; restart service
- Client: rsync a previous `dist/` back into place
- No DB migrations or persisted state to reverse

## Open questions

| # | Question | When to resolve |
|---|---|---|
| OQ-1 | Actual population rate of the three target tags in the current PLATEAU DB | Early in implementation (read-only SELECT COUNT, ~10 min) |
| OQ-2 | Preview UI location: sidebar vs. popup — which matches other Rapid patterns | During UI implementation, after reviewing existing Rapid UI |
| OQ-3 | Dot zoom threshold — 17 vs. 18 vs. per-state tuning | After manual QA and performance measurement |
| OQ-4 | Changeset comment default wording: English, Japanese, or bilingual | Just before implementation completes, in discussion with nyampire |
| OQ-5 | Icon visual assets — pick from Rapid's icon library or add new | During UI implementation |

## Phased roadmap

**Phase 1 (this design):** outline-only, per-building manual UI, four
state icons, per-tag missing-fill, no value overwriting.

**Phase 2:** PLATEAU building:part support. Extends `MatchCandidate.kind`
to `'part_to_part'`, adds a part matcher, extends the Pixi layer for
part icons. Requires separate brainstorm on OSM `building:part` creation
policy and Simple 3D Buildings alignment.

**Phase 3 (conditional on community consultation):** Whether to
implement Phase 3 at all is itself a decision that must follow
community consultation, not an automatic follow-on to Phase 2. If
pursued, the contemplated scope includes: overwriting existing OSM
values when they conflict with PLATEAU (adds an "override" button to
the `CONFLICT` info popup), and automated batch-match with review
panel (Model 2). Model 2 additionally requires community consultation
on relaxing the 50-object changeset limit. Community consultation is
a precondition for the entire phase, not just for the batch-match
sub-scope.

Extension hooks already provided in Phase 1:

| Hook | Phase 1 form | Phase 2/3 use |
|---|---|---|
| `MatchCandidate.kind` | `'outline_to_building'` only | Add `'part_to_part'` |
| `findCandidates(kind)` | Function structure supports parameter | Swap in part matcher |
| `PixiLayerHeightTransfer` | Colors by state (and later, kind) | Add part-icon rendering |
| Server `representative_point` | On both outlines and parts | Phase 2 uses part values |
| `analyzeTagStates.conflicting` | Displayed only | If Phase 3 is pursued (subject to community consultation), an override button can be added |
