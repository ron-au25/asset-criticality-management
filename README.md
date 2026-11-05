# Asset Criticality Management (ACM)

Three Lightning cards for Salesforce Field Service that show how critical an asset is, what has happened to it, and what its telematics feed is doing.

| Card | Component | Apex | Where it goes |
|---|---|---|---|
| Asset Health | `acmAssetHealth` | none (uses `getRecord` and related lists) | Asset and Work Order record pages |
| Asset Work Order Timeline | `acmAssetTimeline` | `ACM_AssetTimelineController` | Asset and Location record pages |
| Telematics Simulation | `acmTelematicsSimulation` | `ACM_TelematicsController` | Asset record page |

**Asset Health** shows the criticality score and rating, the 3x3 impact-by-condition matrix, the review date, data quality, lifecycle and replacement cost, classification and warranty status.

**Asset Work Order Timeline** plots work orders as job boxes on an expandable location and asset-hierarchy tree. It loads lazily (locations first, then a location's assets when opened, then work orders for the visible months, cached), so it copes with tens of thousands of assets. A collapsed parent asset shows its children's work orders; expanding it shows each child's own. Filter by centre or criticality (non-matching assets in a matching tree are dimmed), or find assets and locations by text and then "Show all assets here" on a location. Refresh re-reads everything on screen.

Current version: **1.1.0**. See [CHANGELOG.md](CHANGELOG.md).

**Assess Criticality** is an Asset quick action (screen flow) that scores impact across six categories plus condition, then saves the impact score, the condition and the review date. The card and the score update from it.

**Telematics Simulation** is a demo card. A button plays the telematics (BMS) feed pushing an out-of-threshold reading: it writes the asset attribute value, flips the threshold monitor to breached and raises a reactive work order. A second button resets the reading.

## What is in the repo

```
force-app/main/default/
  lwc/                 acmAssetHealth, acmAssetTimeline, acmTelematicsSimulation
  classes/             ACM_AssetTimelineController, ACM_TelematicsController, and their tests
  objects/Asset/fields 12 criticality fields (AIM_*, Criticality_*, Lifespan_Years__c, ...)
  objects/Case/fields  Location__c
  objects/ACM_Simulation_Config__mdt   settings for the telematics card
  flows/               ACM_Assess_Criticality (screen flow)
  quickActions/        Asset.ACM_Assess_Criticality
  customMetadata/      ACM_Simulation_Config.Default
  staticresources/     ACM_Band_Red, ACM_Band_Amber, ACM_Band_Green (used by Criticality_Indicator__c)
  permissionsets/      ACM_User
manifest/package.xml
scripts/apex/acm_telematics_sample_data.apex
scripts/apex/acm_mel_seed_locations.apex   example: builds a Site > Building > Level > Space hierarchy and links assets
scripts/setup_telematics_sample.sh
docs/INSTALL.md
CHANGELOG.md
```

## Requirements

- A Salesforce org with **Field Service** enabled (Work Orders, Service Appointments, Work Types, Service Territories).
- **Asset Attributes and Condition Monitoring** objects (`AssetAttribute`, `AttributeDefinition`, `RecordsetFilterCriteria`, `RecordsetFltrCritMonitor`) for the telematics card.
- The custom field **`Asset.SDO_Service_Perform_Status__c`** (picklist: High, Medium, Low). It exists in Salesforce SDO orgs; this repo does not create it. `Criticality_Score__c` and `AIM_Condition__c` are formulas that depend on it, so **deployment fails in an org without it**.
- The standard `Asset.ConsequenceOfFailure` field (Minor, Moderate, Major).
- Salesforce CLI (`sf`) and Python 3 (the sample-data script uses it).

## Quick start

```bash
sf project deploy start --target-org MY_ORG --manifest manifest/package.xml
sf org assign permset --name ACM_User --target-org MY_ORG
scripts/setup_telematics_sample.sh MY_ORG      # optional sample data for the telematics card
```

Then add the cards to the record pages by hand. Full steps, configuration and troubleshooting are in [docs/INSTALL.md](docs/INSTALL.md).

## Notes

- Page layouts and Lightning pages are not part of the repo. Place the cards with Lightning App Builder.
- The telematics card is a simulation: the connection status and "last synced" time are mocked, and no real telematics feed is read.
- The timeline follows the Location hierarchy to any depth. Root assets (no parent asset) sit under their `LocationId`; child assets sit under their parent. Root assets without a location are under a "No location" row. See step 5b in [docs/INSTALL.md](docs/INSTALL.md) for a script that builds a hierarchy.
- The timeline reads `Case.Location__c`, which this repo creates as a lookup to Location.
