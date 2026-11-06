# Changelog

Versions follow [semantic versioning](https://semver.org/). Each release is tagged in git (`vX.Y.Z`).

## Unreleased

### Added
- AIM Standard knowledge article, built from one content model (`scripts/build_aim_article.py`) into `docs/knowledge/` as a Salesforce-branded HTML page, a PDF and a Knowledge body.
- `scripts/setup_aim_article.sh` creates the article as a draft `Knowledge__kav` in a target org (idempotent). See step 5d in docs/INSTALL.md.
- Asset Health card: "AIM Standard" link in the Review and governance section. The article is found by URL name at runtime through `ACM_KnowledgeLinkController`, so no Id is needed per org. Card property: AIM Standard article URL name.

### Changed
- The Asset Health `knowledgeArticleId` property is deprecated and ignored (kept only because pages that use the card already store it).

## 1.1.0 (2026-11-05)

Asset Work Order Timeline rebuilt for large orgs and asset hierarchies.

### Added
- Asset hierarchy in the tree: location > root asset > child assets, to any depth. A collapsed parent shows its children's work orders; expanding it shows each asset's own.
- Lazy loading for tens of thousands of assets: the location tree loads once, a location's root assets load when it is opened (50 at a time, "Show more assets"), an asset tree loads when its root is opened.
- Work orders load per calendar month for what is on screen, with the months either side prefetched, and are cached: stepping a month forward and back does not reload.
- Search box for assets (name, serial and other text fields) and locations (name). It loads and opens the path to each hit and highlights it; clearing it restores the previous tree. Up to 25 matching asset trees are loaded per search.
- "Show all assets here" under a location during a search, to see the location's full contents and not just the matches.
- Work orders raised against a location with no asset show as bars on the location row.
- "No location" row for root assets without a `LocationId`.
- Location KPI chips (open WO, overdue, critical, assets) roll up from the loaded data.
- Criticality filter keeps a root asset when anything in its tree matches and dims the assets that do not match.
- Notices when the location tree (10,000), an asset tree (2,000), a search (25 trees) or a month of work orders (5,000) is capped.

### Changed
- Building, Level and Space filters removed. The Centre (top-level location) filter stays.
- Refresh re-reads everything on screen (locations, opened locations' assets, loaded asset trees, work orders, and the active search). Rows stay on screen until fresh data arrives.
- Status colouring: a completed or cancelled work order always shows as closed; an appointment status category of "None" falls back to the work order's status. Open and overdue counts follow.
- Search with a centre selected scans up to 2,000 hits before filtering to the centre, so matches elsewhere do not crowd out the centre's.
- Apex `ACM_AssetTimelineController` API replaced: `getLocationTree`, `getLocationAssets`, `getAssetTree`, `getWorkOrders`, `getLocationCases`, `searchAssets`.

### Fixed
- Location label chips no longer wrap into the next row; search highlight no longer breaks the grid lines.
- Hover card near the bottom of the timeline no longer makes the page jump.
- Previous / Next month from the 29th to 31st no longer skips or overlaps months.
- A location no longer stays on "Loading assets…" after Refresh; the progress line stays accurate after Refresh.

### Known limits
- Location work orders are fetched in one call per month (not batched), which can hit the 5,000 cap on very large orgs after Expand all.
- Asset trees over 2,000 assets are cut by name order, so some branches may be missing.
- Refresh reloads only the first page of each opened location's assets.
- KPI chips count loaded data only.

## 1.0.0 (2026-11-05)

Initial release: Asset Health, Asset Work Order Timeline and Telematics Simulation cards, the Assess Criticality flow and quick action, Asset and Case fields, the `ACM_User` permission set, sample-data scripts and install docs.
