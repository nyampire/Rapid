# Upstream Merge Procedure

This document describes how to merge new releases from [facebook/Rapid](https://github.com/facebook/Rapid) (upstream) into this fork.

## Prerequisites

```bash
# Verify upstream remote is configured (main branch only)
git remote -v
# Should show: upstream  https://github.com/facebook/Rapid.git

# If not configured:
git remote add upstream https://github.com/facebook/Rapid.git
git config remote.upstream.fetch "+refs/heads/main:refs/remotes/upstream/main"
```

## Merge Steps

### 1. Fetch latest upstream

```bash
git fetch upstream
```

### 2. Check what's new

```bash
# See new upstream commits not yet in main
git log --oneline main..upstream/main

# See diff summary
git diff --stat main upstream/main
```

### 3. Create a merge branch

```bash
git checkout -b merge/upstream-vX.Y.Z main
git merge upstream/main
```

### 4. Resolve conflicts

See the "Files Likely to Conflict" section below for guidance.

### 5. Test

```bash
npm run lint     # Should have 0 errors
npm run test     # All tests should pass
npm run build    # Build should succeed
```

### 6. Merge to main

```bash
git checkout main
git merge merge/upstream-vX.Y.Z
git push origin main
```

### 7. Clean up

```bash
git branch -d merge/upstream-vX.Y.Z
```

## Files Likely to Conflict

These files contain Plateau-specific modifications that may conflict with upstream changes:

| File | Plateau Changes |
|------|----------------|
| `modules/services/MapWithAIService.js` | `PLATEAU_API_URL` constant, `plateauJapan` dataset definition, `_tileURL()` Plateau branch |
| `modules/core/RapidSystem.js` | `plateauJapan` in default `_addedDatasetIDs` and `_enabledDatasetIDs` |
| `modules/ui/UiRapidCatalog.js` | Dataset sort order prioritizing Plateau |
| `modules/ui/UiRapidDatasetToggle.js` | Plateau CSS class application |
| `css/80_app.css` | ~162 lines of Plateau-specific CSS styling (`.osmf-branding`, `.dataset-item.osmf`, etc.) |
| `data/core.yaml` | `plateau`, `japan` category keys and `plateauJapan` dataset translations |
| `data/l10n/core.en.json` | English translations for Plateau dataset |
| `data/l10n/core.ja.json` | Japanese translations for Plateau dataset |
| `.github/workflows/pages.yml` | GitHub Pages deployment configuration |
| `.gitignore` | Plateau dev artifact exclusions |

## Conflict Resolution Tips

- **MapWithAIService.js**: The Plateau dataset definition and `_tileURL()` branch are independent additions. Accept both upstream changes and Plateau code.
- **RapidSystem.js**: Upstream may add/remove default datasets. Ensure `plateauJapan` remains in both `_addedDatasetIDs` and `_enabledDatasetIDs`.
- **Translation files**: Upstream regenerates these via `npm run translations`. After merge, verify Plateau keys are preserved by searching for `plateauJapan`.
- **CSS**: The Plateau CSS block is appended at the end of `80_app.css`. Conflicts are unlikely unless upstream restructures the file.

## Plateau Feature Overview

This fork adds integration with Japan's [PLATEAU 3D city model](https://www.mlit.go.jp/plateau/) building data:

- **API Server**: [nyampire/rapid_plateau_api](https://github.com/nyampire/rapid_plateau_api) (Production: `https://rapid.nyampire.info/`)
- **Dataset ID**: `plateauJapan`
- **Color**: `#66BB6A` (green)
- **URL Hash Override**: `#plateau_api_url=<url>` for development/testing
- **Deploy Procedure**: See [DEPLOY.md](DEPLOY.md)
