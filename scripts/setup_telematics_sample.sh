#!/usr/bin/env bash
# Usage: scripts/setup_telematics_sample.sh <target-org-alias>
# Creates the sample asset, attribute definition and threshold monitor (Apex), then the AssetAttribute
# value through the REST API (Apex cannot insert it). Idempotent.
set -euo pipefail
ORG="${1:?usage: $0 <target-org-alias>}"
cd "$(dirname "$0")/.."

sf apex run -o "$ORG" -f scripts/apex/acm_telematics_sample_data.apex >/dev/null

q() { sf data query -o "$ORG" --json -q "$1" | python3 -c "import sys,json;r=json.load(sys.stdin)['result']['records'];print(r[0]['Id'] if r else '')"; }
ASSET=$(q "SELECT Id FROM Asset WHERE SerialNumber = 'ACM-SAMPLE-CH-01' LIMIT 1")
DEV=$(sf data query -o "$ORG" --json -q "SELECT Attribute_Developer_Name__c, Normal_Value__c FROM ACM_Simulation_Config__mdt WHERE DeveloperName = 'Default'" \
  | python3 -c "import sys,json;r=json.load(sys.stdin)['result']['records'][0];print(r['Attribute_Developer_Name__c'],int(r['Normal_Value__c']))")
ATTR_DEV="${DEV% *}"; NORMAL="${DEV#* }"
ADEF=$(q "SELECT Id FROM AttributeDefinition WHERE DeveloperName = '$ATTR_DEV' LIMIT 1")
EXISTING=$(q "SELECT Id FROM AssetAttribute WHERE AssetId = '$ASSET' AND AttributeDefinitionId = '$ADEF' LIMIT 1")
if [ -z "$EXISTING" ]; then
  sf data create record -o "$ORG" --sobject AssetAttribute --values "AssetId=$ASSET AttributeDefinitionId=$ADEF AttributeValue=$NORMAL" >/dev/null
  echo "Created AssetAttribute ($ATTR_DEV = $NORMAL)"
else
  echo "AssetAttribute already exists"
fi
echo "Done. Open asset $ASSET, add the ACM Telematics Simulation card to its record page."
