#!/usr/bin/env bash
# Usage: scripts/setup_aim_article.sh <target-org-alias>
# Creates the AIM Standard knowledge article (draft) from docs/knowledge/ and reports its Id. Idempotent: if an article
# with the same URL name exists it is left alone. The Asset Health card finds the article by URL name at runtime, so no
# Id needs to be copied anywhere. Needs Knowledge enabled and the SDO FAQ fields (Knowledge__kav.FAQ_Answer__c).
set -euo pipefail
ORG="${1:?usage: $0 <target-org-alias>}"
cd "$(dirname "$0")/.."
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

python3 scripts/build_aim_article.py >/dev/null
sf sobject describe -o "$ORG" --sobject Knowledge__kav --json 2>/dev/null \
  | python3 -c "import sys,json;f=[x['name'] for x in json.load(sys.stdin)['result']['fields']];sys.exit(0 if 'FAQ_Answer__c' in f and 'FAQ_Question__c' in f else 1)" \
  || { echo "Knowledge__kav with FAQ_Question__c and FAQ_Answer__c not found in $ORG. Enable Knowledge, or adapt this script to a rich-text field." >&2; exit 1; }

q() { sf data query -o "$ORG" --json -q "$1" | python3 -c "import sys,json;r=json.load(sys.stdin)['result']['records'];print(r[0]['Id'] if r else '')"; }
URL=$(python3 -c "import json;print(json.load(open('docs/knowledge/aim-standard-article.json'))['urlName'])")
EXISTING=$(q "SELECT Id FROM Knowledge__kav WHERE UrlName = '$URL' AND IsLatestVersion = true LIMIT 1")
if [ -n "$EXISTING" ]; then
  echo "Article '$URL' already exists ($EXISTING). Nothing to do."; exit 0
fi

RT=$(q "SELECT Id FROM RecordType WHERE SobjectType = 'Knowledge__kav' AND Name = 'FAQ' AND IsActive = true LIMIT 1")
python3 -I - "$RT" > "$TMP/body.json" <<'PY'
import json, sys
m = json.load(open('docs/knowledge/aim-standard-article.json'))
p = {"Title": m["title"], "UrlName": m["urlName"], "Summary": m["summary"], "Language": "en_US",
     "FAQ_Question__c": m["question"], "FAQ_Answer__c": open('docs/knowledge/aim-standard-body.html', encoding='utf-8').read()}
if sys.argv[1]:
    p["RecordTypeId"] = sys.argv[1]
print(json.dumps(p, ensure_ascii=False))
PY
ID=$(sf api request rest "/services/data/v66.0/sobjects/Knowledge__kav" -o "$ORG" -X POST --body "@$TMP/body.json" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['id']) if d.get('success') else sys.exit(d)")
echo "Created draft article $ID (URL name '$URL')."
echo "Publish it (Knowledge tab > article > Publish) so all users see the AIM Standard link on the Asset Health card."
