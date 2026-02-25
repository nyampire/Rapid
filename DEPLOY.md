# Deploy Procedure (nyampire/Rapid fork)

This document describes how to build and deploy this Rapid fork to the VPS.

## Infrastructure

| Item | Detail |
|------|--------|
| Production URL | https://rapid.nyampire.info/ |
| VPS host alias | `plateau-vps` (configured in `~/.ssh/config`) |
| Document root | `/var/www/rapid/` |
| Web server | Static file serving (no application restart needed) |
| Plateau API | Separate service ([nyampire/rapid_plateau_api](https://github.com/nyampire/rapid_plateau_api)) |

## Quick Deploy

```bash
# 1. Ensure all changes are committed and pushed
git status
git push origin main

# 2. Build
npm run all

# 3. Deploy to VPS
rsync -avz --delete dist/ plateau-vps:/var/www/rapid/
```

> **Note**: The VPS serves static files only. No service restart is required after deployment.

## Detailed Steps

### 1. Pre-deploy Checks

```bash
# Run linter (0 errors expected, warnings are OK)
npm run lint

# Run tests (all should pass)
npm run test

# Verify current branch and commit
git log --oneline -3
```

### 2. Build

```bash
npm run all
```

This command runs `clean`, `build`, and `dist` in sequence:
- **clean**: Removes old build artifacts from `dist/`
- **build**: Generates development bundles (`rapid.js`, `rapid.css`), data files, and source maps
- **dist**: Generates production bundles (`rapid.min.js`, `rapid.legacy.js`, `rapid.legacy.min.js`) and SVG sprites

Expected output:
- `dist/rapid.js` (~7.2 MB, development)
- `dist/rapid.min.js` (~2.7 MB, production)
- `dist/rapid.legacy.js` / `dist/rapid.legacy.min.js` (legacy browser support)
- `dist/data/` (localization, imagery, presets)
- `dist/img/` (SVG sprites)

### 3. Deploy

```bash
rsync -avz --delete dist/ plateau-vps:/var/www/rapid/
```

| rsync flag | Purpose |
|------------|---------|
| `-a` | Archive mode (preserves permissions, timestamps) |
| `-v` | Verbose output |
| `-z` | Compress during transfer |
| `--delete` | Remove files on VPS that no longer exist in `dist/` |

### 4. Post-deploy Verification

Open https://rapid.nyampire.info/ in a browser and verify:
- [ ] Page loads without errors
- [ ] Map renders correctly
- [ ] Plateau building data layer is available (Map Data panel > Plateau Japan)
- [ ] Browser console shows no errors (`F12` > Console)

## Rollback

If a deployment causes issues, redeploy from the previous commit:

```bash
# Check previous commits
git log --oneline -10

# Checkout the working commit
git checkout <commit-hash>

# Rebuild and redeploy
npm run all
rsync -avz --delete dist/ plateau-vps:/var/www/rapid/

# Return to main
git checkout main
```

## Runtime Configuration

These URL hash parameters allow runtime configuration without redeployment:

| Parameter | Example | Description |
|-----------|---------|-------------|
| `#plateau_api_url=<url>` | `#plateau_api_url=http://localhost:8000/api/mapwithai/buildings` | Override Plateau API endpoint |
| `#plateau_conflation=false` | `#plateau_conflation=false` | Disable client-side conflation (overlap filtering) |

## Related Documents

- [UPSTREAM_MERGE.md](UPSTREAM_MERGE.md) - Upstream merge procedure
- [RELEASING.md](RELEASING.md) - Upstream release procedure (facebook/Rapid)
