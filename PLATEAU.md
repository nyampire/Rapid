# Plateau Import Features — Developer Guide

*日本語版: [PLATEAU.ja.md](PLATEAU.ja.md)*

This guide covers the features this fork adds to Rapid for importing Plateau
building data into OpenStreetMap: how they are implemented and how to work on
them.

How to use the editor is described for mappers on the OSM wiki page [JA:MLIT PLATEAU/Plateau RapiD](https://wiki.openstreetmap.org/wiki/JA:MLIT_PLATEAU/Plateau_RapiD) (in Japanese).

This fork deals with **Plateau building data only**. Plateau also publishes
bridges, tunnels, vegetation and other categories; those are out of scope.

The project spans three repositories.

| Repository | Role |
|---|---|
| [nyampire/Rapid](https://github.com/nyampire/Rapid) | The editor (this repository) |
| [nyampire/rapid_plateau_api](https://github.com/nyampire/rapid_plateau_api) | Backend that serves the building data |
| [nyampire/rapid_plateau_dashboard](https://github.com/nyampire/rapid_plateau_dashboard) | Visualization of import progress |

## Architecture overview

Plateau data is fetched and managed by `PlateauService`
(`modules/services/PlateauService.js`).

- **Dataset ID**: `plateauJapan`
- **Data format**: OSM XML
- **Tile zoom**: 16 and above

Plateau-specific handling (relations, conflation, coverage, highlighting) is
kept independent of upstream's MapWithAI / PMTiles code, so that
`git merge upstream/main` does not drag Plateau into the conflict.

Data emitted by this service carries `__service__ = 'plateau'`.

### Plateau-specific modules

| Module | Role |
|---|---|
| `modules/services/PlateauService.js` | API fetching, relation assembly, conflation, coverage |
| `modules/pixi/PixiLayerPlateauCoverage.js` | Coverage area fill |
| `modules/pixi/PixiLayerHeightTransfer.js` | Tag-transfer candidate dots |
| `modules/modes/HeightTransferMode.js` | Tag-transfer mode: recompute and apply |
| `modules/core/lib/HeightTransferMatcher.js` | Matches Plateau outlines to OSM buildings |
| `modules/ui/sections/plateau_tags.js` | Tag-transfer section in the entity editor |
| `modules/actions/transfer_plateau_tags.js` | The edit action that adds the tags |
| `modules/util/plateau_height_warning.js` | Turns height warnings into messages for the user |
| `modules/ui/plateau_height_warning.js` | Draws the height warning box |

## Plateau API

### Production URL

```
https://rapid.nyampire.info/api/mapwithai/buildings
```

Hardcoded in the `PLATEAU_API_URL` constant in `PlateauService.js`.

### Pointing at a local API

The endpoint can be overridden at runtime with a URL hash parameter.

```
http://127.0.0.1:8080/#plateau_api_url=http://localhost:8000/api/mapwithai/buildings
```

Run the Plateau API server (`rapid_plateau_api`) locally and load the editor as
above to use it instead of production.

## URL hash parameters

| Parameter | Purpose | Example |
|---|---|---|
| `plateau_api_url` | Override the Plateau API endpoint | `#plateau_api_url=http://localhost:8000/api/mapwithai/buildings` |
| `plateau_conflation` | Disable client-side conflation | `#plateau_conflation=false` |
| `plateau_overwrite` | Let tag transfer choose OSM or Plateau per tag, including replacing conflicting values (trial before community consultation) | `#plateau_overwrite=1` |

## Tag transfer (height / ele / building:levels)

Transfers the height information Plateau carries onto existing OSM buildings.
Enabled from the "Tag transfer mode" toolbar button.

The target tags are `height`, `ele` and `building:levels`.

### How candidates are found

`HeightTransferMatcher.findCandidates()` looks for the OSM building that
contains the Plateau outline's representative point (the `representative_point`
the API returns). A candidate is formed only when exactly one building contains
it — zero or several are ambiguous and are skipped.

It then looks at the area ratio (Plateau outline ÷ OSM building).

| Area ratio | Treatment |
|---|---|
| Below 0.5 | Dropped from the candidate list |
| 0.5 to 2.0 | Decided by tag state (see below) |
| Above 2.0 | `AREA_MISMATCH` |

Outlines below 0.5 are dropped because Plateau models ancillary structures —
rooftop stair enclosures, sheds — as their own `building=yes` rather than
`building:part`. Their representative points land inside the larger OSM
building, so without this rule they are pure noise. Their heights describe the
ancillary structure, not the building.

When the ratio is in range, the state comes from the target tags. Precedence is
missing → conflicting → matching.

| State | Meaning | Display |
|---|---|---|
| `CANDIDATE` | There are tags to add | Magenta dot (zoom 17+) |
| `CONFLICT` | OSM and Plateau values differ | Dot (zoom 18+) and a note only |
| `AREA_MISMATCH` | Plateau outline over twice the OSM building | Orange `!?` (zoom 18+) |
| `COVERED` | All present and matching | Section hidden entirely |

### Applying

Selecting a building shows a "Plateau tag transfer" section in the entity
editor. The tags to be added are listed read-only, and can be transferred with
the Apply button or the `A` shortcut, which is bound only while such a building
is selected.

The section is structured so that the state decides whether a note appears,
while the presence of tags to add decides whether the table and Apply button
appear. Those two are independent, which is why an `AREA_MISMATCH` still offers
the Apply button alongside its warning note. A `CONFLICT` needs no special case:
state precedence guarantees it has no tags to add, so it shows the note alone.

By default, existing values are never overwritten.
Where OSM and Plateau disagree the section only shows a note.
Whether to overwrite is pending community consultation.

So that people taking part in the consultation can try it, adding `plateau_overwrite=1` to the URL lists missing and conflicting tags in one table, with an "OSM" and a "Plateau" button on each row to pick the value to use.
Plateau is selected initially for missing tags, and OSM for conflicting tags.
Choosing OSM for a missing tag leaves that tag out.
When the source building has a height warning, or in an `AREA_MISMATCH`, Plateau cannot be selected for conflicting tags and the reason is shown.
The questions for the consultation and how to try the feature are on the OSM wiki, in [既存の値の上書き（試用中）](https://wiki.openstreetmap.org/wiki/JA:MLIT_PLATEAU/Plateau_RapiD#%E6%97%A2%E5%AD%98%E3%81%AE%E5%80%A4%E3%81%AE%E4%B8%8A%E6%9B%B8%E3%81%8D%EF%BC%88%E8%A9%A6%E7%94%A8%E4%B8%AD%EF%BC%89) (in Japanese).

## Height warnings

Plateau building heights sometimes contain errors.
To keep wrong heights out of OSM, the editor flags suspicious buildings at the point where the mapper decides whether to add them.
The warning only informs; it never blocks adding a building or transferring tags.

### What the API sends

The API runs the checks and adds marker tags to each building it returns.

| Tag | Value |
|---|---|
| `plateau:height_warning` | Names of the checks that matched, joined with `;` (e.g. `needle;floor-height`) |
| `plateau:footprint_m2` | Footprint area in square metres, present only when `needle` matched |

These are not OSM tags.
`PlateauService` strips them on load and moves them to internal properties of the entity, `heightWarnings` and `footprintM2`.
When a building is added, `rapid_accept_feature.js` removes those internal properties too, so nothing reaches OSM.

Older editor builds copy every received tag onto the building.
When deploying, update the editor first and the API second.

### Checks

| Check | Warns when |
|---|---|
| `degenerate-area` | The outline's area is zero or less |
| `part-over-outline` | A building part is more than 10 m taller than the whole building |
| `needle` | Height is over 15 m and footprint is under 20 m²; building parts are excluded |
| `absolute` | Height is under 1.0 m |
| `floor-height` | `building` is `house`, `apartments` or `residential`, and height divided by levels is under 1.5 m or over 10.2 m |

Rooftop stair towers and penthouses are tall from the ground and small in footprint, so building parts are left out of `needle`.
Factories and warehouses often have tall ground floors, so `floor-height` is limited to residential buildings.
For the exact thresholds and logic, see `plateau_height_warning.py` in the API repository.

### Display

Flagged buildings are filled with a dot pattern on the map.
Selecting one shows a box with the reasons above the tag list in the sidebar.
If the building belongs to a `type=building` relation, the warnings of the relation and all its members are shown together, because adding one member adds the whole building.

In tag transfer, a source with a warning gets a candidate marker with a red edge and a "!", and the "Plateau tags" section shows the same warning.
Only the outline's height is transferred, so only the outline's own warnings and its parts' `part-over-outline` are considered there.

## LOD2 relation support

Plateau LOD2 buildings consist of an outline plus parts such as roof sections,
grouped by a `type=building` relation. The API emits the relations and the
client interprets them.

- Conflation at relation granularity (when only part of it overlaps OSM)
- Highlighting relation members on select and hover for multi-section buildings
- "Add Entire Feature" (the whole relation) versus "Add Only This Feature"
  (just that part). The latter is `Shift+A`

## Coverage display (zoom 5-15)

`PixiLayerPlateauCoverage` shows the areas where Plateau data exists as a
translucent orange fill.

- **Data source**: `GET /api/mapwithai/coverage` (per-city concave hulls)
- **Zoom range**: 5-15 (hidden from 16, where the actual building data takes over)
- **Colour**: `#FE6100` (IBM Accessible Color Palette, colour-blind safe)
- **Module**: `modules/pixi/PixiLayerPlateauCoverage.js`
- **Fetching**: `PlateauService.loadCoverage()`, cached for the session

Requires the `plateau_coverage` materialized view on the server. See the
[rapid_plateau_api README](https://github.com/nyampire/rapid_plateau_api).

## Client-side conflation

Hides Plateau buildings that overlap an existing OSM building.

### How it works

1. Collect the OSM buildings in view
2. Pre-filter each Plateau building by bounding box
3. Decide polygon intersection precisely with the Polyclip library
4. Hide the overlapping Plateau buildings

### Caching

Results are cached in `_plateauConflationCache` (`checked` / `rejected`) and
invalidated automatically when OSM data changes (the `merge` event).

### Disabling

To show all Plateau data with conflation off, for development or debugging:

```
http://127.0.0.1:8080/#plateau_conflation=false
```

## Tests

```bash
npm run test:browser
```

The Plateau tests live mainly in:

- `test/browser/services/PlateauService.test.js` — XML parsing, conflation, relations
- `test/browser/core/lib/HeightTransferMatcher.test.js` — candidate rules and area ratio
- `test/browser/modes/HeightTransferMode.test.js` — apply, shortcut, recompute
- `test/browser/ui/sections/plateau_tags.js` — the editor section
- `test/browser/core/RapidSystem.test.js` — dataset add / enable / toggle

## Local development

```bash
npm install
npm run start         # http://127.0.0.1:8080
```

### Adding translations

The English source for UI strings is `data/core.yaml`. `data/l10n/core.en.json`
is generated from it — do not edit that file directly.

Fork-specific Japanese strings are edited directly in `data/l10n/core.ja.json`
(upstream's strings come from Transifex).

If a string you added does not show up, suspect the browser cache.
`data/l10n/*.min.json` is cached, so a new key can keep rendering as
"Missing translation" until the cache turns over. An incognito window tells the
two apart.

## Relationship to the server

Server repository: [nyampire/rapid_plateau_api](https://github.com/nyampire/rapid_plateau_api)

The main APIs the client uses:

- `GET /api/mapwithai/buildings?bbox=...` → OSM XML
- `GET /api/mapwithai/coverage` → GeoJSON FeatureCollection (coverage areas)

Building data includes `representative_point`, a point guaranteed to fall inside
the outline, which tag transfer uses. An interior point is used rather than a
centroid because the centroid of a concave polygon can fall outside it.

For the server's architecture and database schema, see that repository's
README / ARCHITECTURE.md.

## Issues

For open problems and features under discussion, see the
[issue tracker](https://github.com/nyampire/Rapid/issues).
