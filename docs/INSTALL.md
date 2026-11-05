# Install and deploy

`MY_ORG` below stands for your org alias or username.

## 1. Check the target org

The org must have Field Service, Asset Attributes / Condition Monitoring, and the custom field `Asset.SDO_Service_Perform_Status__c`. To confirm the field exists:

```bash
sf data query --target-org MY_ORG --use-tooling-api --query "SELECT QualifiedApiName FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = 'Asset' AND QualifiedApiName = 'SDO_Service_Perform_Status__c'"
```

No row back means the deploy will fail on `AIM_Condition__c` and `Criticality_Score__c`.

## 2. Authenticate

```bash
sf org login web --alias MY_ORG
```

## 3. Deploy

```bash
sf project deploy start --target-org MY_ORG --manifest manifest/package.xml \
  --test-level RunSpecifiedTests --tests ACM_AssetTimelineControllerTest --tests ACM_TelematicsControllerTest
```

Sandboxes and scratch orgs can omit the test flags. Production-type orgs need a test level. To check first without changing the org:

```bash
sf project deploy validate --target-org MY_ORG --manifest manifest/package.xml \
  --test-level RunSpecifiedTests --tests ACM_AssetTimelineControllerTest --tests ACM_TelematicsControllerTest
```

Some orgs report 0 tests run on deploy. If that happens, run them directly:

```bash
sf apex run test --target-org MY_ORG --class-names ACM_AssetTimelineControllerTest --class-names ACM_TelematicsControllerTest --wait 15
```

## 4. Assign the permission set (required)

```bash
sf org assign permset --name ACM_User --target-org MY_ORG
# for another user
sf org assign permset --name ACM_User --target-org MY_ORG --on-behalf-of user@example.com
```

Without it, users see an error like `No such column 'Criticality_Rating__c' on entity 'Asset'`, because the new fields are hidden by field-level security. Assign it to every user who will see the cards.

## 5. Telematics sample data (optional)

```bash
scripts/setup_telematics_sample.sh MY_ORG
```

This creates the attribute definition, a threshold monitor, the account `ACM Sample Account` and the asset `ACM Sample Chiller` (serial `ACM-SAMPLE-CH-01`) with a normal reading. The `AssetAttribute` value is created through the REST API because Apex cannot insert it. The script is safe to re-run.

To use your own asset instead, create a monitor and an `AssetAttribute` for it, using the attribute named in the config below.

## 5b. Location hierarchy for your assets (optional)

The timeline shows the Location tree (any depth, top level = centres) and loads a location's assets when it is opened. Assets with no `LocationId` appear under a "No location" row. To give them a hierarchy, use `scripts/apex/acm_mel_seed_locations.apex` as a template. As shipped it:

- selects assets named `MEL-SEED%` (the root machines are those with no parent asset)
- creates `Melbourne Workshop` (Site) > `Main Workshop` (Building) > `Ground Level` (Level) > `Bay 1` to `Bay N` (Space), one bay per root asset in name order
- sets `LocationId` on every root asset and all its sub-assets (matched through `RootAssetId`) to that root's bay

To adapt it, change the `Name LIKE 'MEL-SEED%'` filters, the location names, and the bay logic (for example, map assets to bays by a field instead of by name order). Run it with:

```bash
sf apex run --target-org MY_ORG --file scripts/apex/acm_mel_seed_locations.apex
```

Notes:

- Safe to re-run: locations are matched by name and parent, and assets are only updated when their location differs. The debug line `ACM locations: roots=... newBays=... assets updated=...` shows what changed (`0` and `0` on a re-run).
- The `LocationType` picklist may not list `Building`, `Level` or `Space`, but API inserts were accepted in the test org. If your org rejects them, add the values to the picklist. The timeline does not depend on these names.
- In anonymous Apex, `Location` clashes with the system `Location` class, so the script uses `Schema.Location`.
- Undo: `UPDATE Asset SET LocationId = NULL WHERE Name LIKE 'MEL-SEED%'`, then delete the `Melbourne Workshop` location tree.

## 6. Place the cards

In Lightning App Builder:

| Page | Add |
|---|---|
| Asset record page | ACM Asset Health, ACM Asset Work Order Timeline, ACM Telematics Simulation |
| Work Order record page | ACM Asset Health |
| Location record page | ACM Asset Work Order Timeline |

Save and activate the page.

Add the **Assess Criticality** action to the Asset page too: in Lightning App Builder open the Highlights Panel and add it under Actions, or add it to the Asset page layout's Salesforce Mobile and Lightning Experience Actions. Actions do not appear on a page until they are added to it. Users also need `ACM_User` (step 4), which grants access to the flow.

## 7. Configure the telematics card

The card reads the custom metadata record **ACM Simulation Config > Default** (Setup > Custom Metadata Types > ACM Simulation Config > Manage Records).

| Field | Default | Meaning |
|---|---|---|
| Attribute Developer Name | `Condenser_Discharge_Pressure` | Attribute the simulated reading is written to |
| Threshold Criteria Name | `Discharge Pressure Within 2000 kPa` | Criteria whose rule value is the threshold. If not found, Default Threshold is used |
| Default Threshold | 2000 | Fallback threshold |
| Breach Value | 2150 | Reading written by Simulate |
| Normal Value | 1800 | Reading written by Reset |
| Unit | kPa | Shown in the work order description |
| Work Order Subject | `High discharge pressure alarm` | Subject of the alarm work order; also used to avoid duplicates |
| Work Type Name, Service Territory Name, Account Name | blank | Optional. Matched by name; if blank or not found, left unset (account falls back to the asset's account) |

The sample-data script reads the same record, so change it before running the script if you want a different attribute.

## 8. Verify

1. Open `ACM Sample Chiller`. Asset Health shows the card; the criticality score stays at "Not assessed" until the asset has Consequence of Failure and `SDO_Service_Perform_Status__c` set.
2. Run **Assess Criticality** on the sample asset: the score, rating and review date on the Asset Health card update.
3. On the Telematics card, press Simulate: the value moves above the threshold and a work order is created. Pressing it again does not create a second one.
4. Press Reset to return the reading to normal. The alarm work order stays open and must be closed or deleted by hand.

### Using the timeline

- **Open a location** (chevron or row click) to load its root assets, 50 at a time. Open a root asset to load its whole tree.
- **Prev / Next / Today** step the window. Work orders are cached per month, so going back is instant. **Refresh** re-reads everything on screen.
- **Search** (2+ characters) finds assets by name, serial and other text fields, and locations by name. It opens the path to each match and highlights it. Under a location with matches, **Show all assets here** shows the full location. Clear the box to go back to the previous tree.
- **Filters > Criticality** keeps an asset tree when any asset in it matches; the assets that do not match are dimmed.
- **Filters > Centre** limits the tree and search to one top-level location.
- Hover a row or bar for details; click an asset name or bar to open the record.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `No such column ... on entity 'Asset'` in a card | `ACM_User` is not assigned to the user. Assign it (step 4) |
| Deploy fails on `AIM_Condition__c` or `Criticality_Score__c` | `SDO_Service_Perform_Status__c` is missing in the org |
| Telematics card says the asset is not monitored | Run the sample-data script, or create a monitor and an `AssetAttribute` for the asset |
| Simulate throws "Asset has no ... attribute" | The asset lacks an `AssetAttribute` for the configured attribute name |
| Deploy reports 0 tests run | Run the tests directly with `sf apex run test` |
| Timeline shows assets under "No location" | Those root assets have no `LocationId`. Create a hierarchy (step 5b) |
| Timeline search finds nothing for a just-created asset | Search indexing can lag a few minutes |
| Timeline notice "Too many work orders" | More than 5,000 in one month for the open locations; open fewer locations or search |
| Timeline notice "Showing the first 25 of N matching asset hierarchies" | Add more words in the search box, or use "Show all assets here" on a location |
| Timeline notice "Only the first 10000 locations are loaded" | Use the Centre filter or search to reach the rest |
| Location chips show 0 although bars are visible | Chips count open work orders only; completed or cancelled ones do not count (Colour by Status to check) |
| Location script: `Compilation failed ... Location` | Use `Schema.Location`, not `Location`, in anonymous Apex |
