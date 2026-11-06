#!/usr/bin/env python3
"""Builds the AIM Standard knowledge article from one content model.

Outputs (in docs/knowledge/):
  aim-standard-article.html   standalone, Salesforce-branded page
  aim-standard-body.html      body only, inline styles, for Knowledge__kav.FAQ_Answer__c
  aim-standard-article.json   title, urlName, summary, question (for the org create script)

Source: Asset Inventory Management (AIM) Standard, version 1.2. Run: python3 scripts/build_aim_article.py
"""
import html
import json
import pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "docs" / "knowledge"

BLUE, NAVY, PALE, INK, GREY = "#0176D3", "#032D60", "#EAF5FE", "#181818", "#5C5C5C"
RAG = {"green": ("#CDEFC4", "#194E31"), "amber": ("#FFE9B8", "#6B4A00"), "red": ("#FFC9C4", "#8E030F")}
e = html.escape


def h2(t):
    return f'<h2 style="color:{NAVY};font-size:22px;border-bottom:2px solid {BLUE};padding-bottom:4px;margin:28px 0 10px">{e(t)}</h2>'


def h3(t):
    return f'<h3 style="color:{BLUE};font-size:17px;margin:18px 0 6px">{e(t)}</h3>'


def p(t):
    return f'<p style="margin:6px 0;line-height:1.5">{t}</p>'


def ul(items):
    return '<ul style="margin:6px 0 6px 20px;line-height:1.5">' + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


def ol(items):
    return '<ol style="margin:6px 0 6px 20px;line-height:1.5">' + "".join(f"<li>{i}</li>" for i in items) + "</ol>"


def note(t):
    return (f'<p style="background-color:{PALE};border-left:4px solid {BLUE};padding:8px 12px;margin:10px 0;'
            f'line-height:1.5">{t}</p>')


def table(head, rows, widths=None, colours=None):
    """rows: list of lists of str (already escaped or html). colours: {(row, col): 'green'|'amber'|'red'}."""
    colours = colours or {}
    th = "".join(
        f'<th align="left" style="background-color:{NAVY};color:#FFFFFF;padding:6px 8px;border:1px solid #C9C9C9">{e(c)}</th>'
        for c in head)
    out = [f'<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;'
           f'border:1px solid #C9C9C9;margin:8px 0;font-size:14px"><tr>{th}</tr>']
    for r, row in enumerate(rows):
        cells = []
        for c, val in enumerate(row):
            style = "padding:6px 8px;border:1px solid #C9C9C9;vertical-align:top"
            if (r, c) in colours:
                bg, fg = RAG[colours[(r, c)]]
                style += f";background-color:{bg};color:{fg};font-weight:bold"
            elif r % 2:
                style += f";background-color:#F3F3F3"
            cells.append(f'<td style="{style}">{val}</td>')
        out.append("<tr>" + "".join(cells) + "</tr>")
    out.append("</table>")
    return "".join(out)


def build_body():
    b = []
    b.append(note("<b>Source:</b> Asset Inventory Management (AIM) Standard, version 1.2 (National Operations, "
                  "Property Management). Internal use. This article condenses the standard; the standard itself is the "
                  "authority."))

    b.append(h2("1. Purpose and scope"))
    b.append(p("The business owns and manages buildings across Australia (mainly shopping centres) that need regular "
               "maintenance, servicing and inspection, and in some cases capital investment. The AIM Standard sets the "
               "<b>minimum standard for keeping accurate asset inventory data</b> in the Facilities Management (FM) "
               "business systems. It is the baseline for setting, managing and monitoring service and maintenance, and for "
               "capital planning."))
    b.append(ul([
        "Which assets must be tracked in the Asset Inventory Register for each property.",
        "Which assets are <b>critical</b> to the business and need closer monitoring, especially where failure affects "
        "operations or regulatory obligations.",
        "The key data needed to assess business impact, manage maintenance cost and plan capital investment.",
    ]))
    b.append(p("<b>Applies to</b> building systems, equipment and other inventory items owned by the business and physically "
               "located at owned or managed buildings. Items may be subject to servicing, maintenance, repair or "
               "inspection under property management obligations, and to programmatic capital investment."))

    b.append(h2("2. Roles and responsibilities"))
    b.append(table(["Role", "Responsibility"], [
        ["<b>Centre Management Team</b>",
         ul(["Maintain the centre's Asset Inventory Register and its data accuracy; work with PM Business Solutions on "
             "data issues flagged by National Operations.",
             "Review and update all Category 1 and 2 items at least every 24 months, ideally every 12.",
             "Verify physical installation and commissioning of assets; keep item data current with service partners.",
             "Escalate Tier 1 supplier non-compliance to National Facilities Manager – Engineering Services.",
             "Review criticality ratings at least every 24 months, ideally every 12, considering centre-specific risks and "
             "lease obligations."])],
        ["<b>National Operations and PM Business Solutions</b>",
         ul(["Support and implement the Standard across all owned and managed properties, including acquisitions and "
             "developments.",
             "Own and maintain the full list of Asset Inventory Items and the generic impact assessment and ranking for each "
             "asset type.",
             "Run data quality controls; calculate and maintain condition assessment data for each item."])],
        ["<b>National Facilities Manager – Engineering Services</b>",
         ul(["Review and resolve Tier 1 supplier non-compliance.", "Oversee the full list of Asset Inventory Items."])],
        ["<b>Capital Delivery Team</b>",
         "Ensure approved capital projects identify new, modified and removed assets; provide asset data, commissioning "
         "records, warranties, O&amp;M manuals and handover documents; notify Centre Operations and PM Business Solutions."],
        ["<b>Development Team</b>",
         "Ensure asset information from redevelopments, expansions and new developments is captured and handed over in "
         "line with the Standard."],
        ["<b>Tenancy Delivery Development Team</b>",
         "Identify assets installed, modified or removed in tenant works and submit them for register updates before "
         "practical completion."],
    ]))

    b.append(h2("3. Service types"))
    b.append(p("Every item is categorised under a governed list of service types. Centre teams request new items through "
               "the agreed request management process."))
    svc = [("HVAC", "Heating Ventilation Air Conditioning"), ("ELEC", "Electrical"), ("SEC", "Security"),
           ("HYD", "Hydraulic"), ("FIRE", "Fire"), ("COMM", "Communications"), ("GAS", "Gas"), ("CARP", "Carparking"),
           ("VEH", "Vehicle"), ("BUILD", "Building"), ("VERT", "Vertical Transport"), ("SAFT", "Safety"),
           ("INFO", "Information"), ("SOLA", "Solar"), ("WAS", "Waste")]
    half = (len(svc) + 1) // 2
    rows = []
    for i in range(half):
        l = svc[i]
        r = svc[i + half] if i + half < len(svc) else ("", "")
        rows.append([f"<b>{l[0]}</b>", l[1], f"<b>{r[0]}</b>", r[1]])
    b.append(table(["Service type", "Description", "Service type", "Description"], rows))
    b.append(p("<b>Naming convention:</b> building code, location code, asset system, asset type and sequence, then a "
               "description taken from the Tier 1 supplier or centre records, for example "
               "<i>95210.RPA.Z1.HVAC.COOLI.0001 – Cooling Tower 12 – Roof Zone 1</i>."))

    b.append(h2("4. Asset categories"))
    b.append(p("All items are assigned a category, which defines the level of management required."))
    b.append(table(["Category", "What it means", "Examples"], [
        ["<b>Category 1</b>",
         ul(["Major equipment managed as an individual item with its own asset ID (which may be needed to connect to "
             "corporate networks).",
             "Planned and unplanned maintenance costs are captured against the item.",
             "Must be assessed under the criticality assessment; may carry associated compliance obligations.",
             "Ideally identified against a Space or Tenancy Unit."]),
         "Chiller – air cooled, escalator, fire indicator panel"],
        ["<b>Category 2</b>",
         ul(["Medium to low value equipment, or high volumes of each asset that make individual tracking onerous.",
             "Record the <b>volume</b> of each asset as an attribute.",
             "May be assessed for criticality and carry statutory or regulatory maintenance obligations.",
             "Maintenance costs are <b>not</b> required against the item.",
             "Ideally identified against a Space; can be identified against the building."]),
         "Electrical air breaker, security door, fire hose reel"],
        ["<b>Category 2N (networked)</b>",
         ul(["Assets that need a connection to the corporate network or Wi-Fi certificates.",
             "Recorded as a parent-child relationship: the parent is used for maintenance tracking and cost management; "
             "each individual asset is a Category 2N child with a network ID."]),
         "Security cameras, digital directories"],
        ["<b>Category 3</b>",
         ul(["Captured purely to record an item as owned equipment in the building inventory.",
             "May not be subject to any maintenance or inspection regime.", "Record the <b>volume</b> as an attribute."]),
         "Stab proof vest, office furniture"],
    ]))

    b.append(h2("5. Criticality assessment"))
    b.append(p("Items that would have a significant impact if they failed, or that are more likely to fail because of age "
               "or condition, get a more stringent maintenance and monitoring regime. The assessment decides which items "
               "are recorded as <b>Critical</b>. Category 1 items must be assessed; Category 2 items may be."))
    b.append(ol(["<b>Impact assessment</b> – score six impact areas.", "<b>Condition assessment</b> – score maintenance "
                 "history and age.", "<b>Criticality score</b> – combine impact and condition on the matrix."]))

    b.append(h3("5.1 Impact assessment"))
    b.append(p("Score each of the six criteria: Not applicable (0), Minor (1), Moderate (2) or Major (3). Add the six "
               "scores for the overall impact score (maximum 18)."))
    b.append(table(["Impact area", "Minor = 1", "Moderate = 2", "Major = 3"], [
        ["<b>Environmental</b>", "One-off, localised damage to or loss of physical environment.",
         "Temporary damage to or loss of physical environment.",
         "Repeated damage to or loss of physical environment, on site and/or offsite."],
        ["<b>Health and safety</b>", "Minimal or no harm; first aid or assessment with no follow-up treatment.",
         "Medical treatment injury but no lost time.", "Lost time injuries, or illness requiring hospitalisation."],
        ["<b>Financial</b> (asset value, maintenance and replacement costs)", "Under $250k", "$251k – $500k",
         "Over $500k"],
        ["<b>Disruption</b>", "Unscheduled maintenance with no impact on operations and tenants.",
         "Unscheduled maintenance with a limited impact on operations and tenants.",
         "Loss of ability to sustain operations and/or temporary closure of part or all of the centre."],
        ["<b>Reputational</b>", "Temporary brand damage focused on a particular asset.",
         "Temporary brand damage from limited negative national publicity.",
         "Brand damage from detrimental national publicity."],
        ["<b>Legal / contractual compliance</b> (including lease covenants)", "Issues addressed as part of normal business.",
         "Issues addressed with additional compliance controls and intervention.",
         "Breaches resulting in a restriction of business."],
    ], colours={(i, c): col for i in range(6) for c, col in ((1, "green"), (2, "amber"), (3, "red"))}))
    b.append(table(["Overall impact score", "Impact rating"], [
        ["1 – 7", "Minor (1)"], ["7 – 13", "Moderate (2)"], ["14 – 18", "Major (3)"]],
        colours={(0, 1): "green", (1, 1): "amber", (2, 1): "red"}))
    b.append(p("<i>Ranges are shown as printed in the standard; the value 7 appears in both Minor and Moderate.</i>"))
    b.append(p("<b>Example:</b> HVAC actuator fire-smoke scores Environmental 1, Health and safety 2, Financial 3, "
               "Disruption 2, Reputational 2, Legal 2 = <b>12</b>, a Moderate impact."))
    b.append(note("<b>Generic and centre-specific assessment.</b> A generic impact assessment is applied to each centre's "
                  "register as a baseline. Centre teams should run their own impact assessments at least every 24 months, "
                  "because local risk differs (for example, electrical failure matters less where a back-up generator "
                  "exists)."))

    b.append(h3("5.2 Condition assessment"))
    b.append(p("Age and condition, including how often the asset breaks down or needs repair, are the best indicators of "
               "reliability and likelihood of failure."))
    b.append(table(["Criterion", "Good = 1", "Average = 2", "Poor = 3"], [
        ["<b>Maintenance</b>", "Low volume of historical breakdown and reactive repairs.",
         "Moderate to high volume of historical breakdown and reactive repairs.",
         "Frequent breakdown and reactive repairs or maintenance."],
        ["<b>Age</b>", "Over half (&gt;50%) of useful life left.", "Less than half (&lt;50%) of useful life left.",
         "Beyond the end of useful life."],
    ], colours={(i, c): col for i in range(2) for c, col in ((1, "green"), (2, "amber"), (3, "red"))}))

    b.append(h3("5.3 Criticality score"))
    b.append(p("<b>Impact score x condition score = criticality score</b> (1 to 9), read from the matrix."))
    b.append(table(["Condition \\ Impact", "Minor (1)", "Moderate (2)", "Major (3)"], [
        ["<b>Poor (3)</b>", "Semi-Critical (3)", "Critical (6)", "Critical (9)"],
        ["<b>Average (2)</b>", "Non-Critical (2)", "Semi-Critical (4)", "Critical (6)"],
        ["<b>Good (1)</b>", "Non-Critical (1)", "Non-Critical (2)", "Semi-Critical (3)"],
    ], colours={(0, 1): "amber", (0, 2): "red", (0, 3): "red", (1, 1): "green", (1, 2): "amber", (1, 3): "red",
                (2, 1): "green", (2, 2): "green", (2, 3): "amber"}))
    b.append(p("<b>Example:</b> the HVAC actuator (Moderate impact, Average condition) scores 2 x 2 = 4, "
               "<b>Semi-Critical</b>."))
    b.append(table(["Score", "Ranking", "What it means"], [
        ["1 – 2", "Non-Critical",
         "Planned service and maintenance is identified as non-critical in the maintenance management system, with an "
         "appropriate service level on the schedule."],
        ["3 – 5", "Semi-Critical",
         "Identified as semi-critical in the maintenance management system, with an appropriate service level."],
        ["6 – 9", "Critical",
         "Identified as critical, with an appropriate service level. Completed and overdue activity is monitored more "
         "closely by Centre Management, National Operations and Property Management Leadership, and the FM system can "
         "report business risk across critical items."],
    ], colours={(0, 1): "green", (1, 1): "amber", (2, 1): "red"}))

    b.append(h2("6. Associated compliance"))
    b.append(p("All required inspection and maintenance tasks for Category 1 and 2 assets must be identified and documented "
               "so completion can be monitored. This supports the service provider's compliance programme; it does not "
               "replace it. It is met in one of two ways:"))
    b.append(ol(["Where service provider systems hold inspection and maintenance data for Category 1 and 2 assets, that "
                 "data marks scheduled tasks as <b>Associated Compliance</b> in the PPM system.",
                 "Otherwise the business marks scheduled tasks as Associated Compliance for the items listed below, because "
                 "of their higher operating risk."]))
    comp = [("HVAC", "Cooling Tower", "1"), ("HVAC", "Cooling Tower Dosing System", "2"), ("HVAC", "Actuator Fire Smoke", "2"),
            ("HVAC", "Smoke Exhaust Fan", "2"), ("HVAC", "Smoke Spill Fan", "2"), ("HVAC", "Stairwell Pressurisation Fan", "2"),
            ("HVAC", "Fire Damper", "2"), ("HVAC", "Pressure Vessel", "2"),
            ("VERT", "Vertical Transport – Annual Certification", "1"),
            ("SAFT", "Heights Safety Anchor Points – Annual Certification", "1"), ("ELEC", "Main Switch Board", "1"),
            ("FIRE", "Hydrant Pump Diesel", "1"), ("FIRE", "Sprinkler Pump Electrical", "1"),
            ("FIRE", "Fire Indicator Panel", "1"), ("FIRE", "EWIS Panel", "1"), ("FIRE", "MIMIC Panel", "1"),
            ("FIRE", "Fire Sprinkler Installation", "1"), ("FIRE", "Sprinkler Booster", "2"),
            ("FIRE", "Hydrant Booster", "2"), ("FIRE", "Hydrant", "2"), ("FIRE", "Fire Hose Reel", "2"),
            ("FIRE", "Portable Fire Extinguishers", "2")]
    b.append(table(["Service type", "Equipment", "Category"], [[f"<b>{s}</b>", e(d), f"Category {c}"] for s, d, c in comp]))
    b.append(note("Where an item is rated <b>Critical</b> and also has legal, contractual or compliance impact, the "
                  "associated compliance obligations take priority and the activity is captured and reported as "
                  "Associated Compliance."))

    b.append(h2("7. Asset attributes"))
    b.append(p("Every item on the register carries these data points. Category 1 assets must have a location."))
    attrs = [("Asset Code", "Alphanumeric", "Free text", 1), ("Building", "Alphanumeric", "Menu selection", 1),
             ("Asset Description", "Alphanumeric", "Free text, following naming standards", 1),
             ("Condition", "Alphanumeric", "Menu selection", 1), ("Asset Category", "Alphanumeric", "Menu selection", 1),
             ("Asset Tag (Service Type)", "Alpha", "Menu selection", 1), ("Asset Type", "Alpha", "Menu selection", 1),
             ("Location", "Alphanumeric", "Menu selection (all Category 1 assets must have a location)", 1),
             ("Supplier barcode", "Alphanumeric", "Free text", 0), ("Cost Centre", "Alphanumeric", "Menu selection", 0),
             ("Comments", "Alphanumeric", "Free text", 0), ("Manufacturer", "Alphanumeric", "Free text", 0),
             ("Serial Number", "Alphanumeric", "Free text", 0), ("Asset Barcode (VCX)", "Alphanumeric", "Free text", 0),
             ("Parent Asset", "Alphanumeric", "Process steps to link", 0), ("Asset Quantity", "Numeric", "Free text", 0),
             ("VCX App Identifier", "UUID", "Free text", 1), ("Installation Date", "Date", "Select from calendar", 1),
             ("Warranty Expiration", "Date", "Select from calendar", 0), ("Replacement Cost", "Numeric", "Free text", 1),
             ("Purchase Cost", "Numeric", "Free text", 0), ("Lifespan", "Numeric", "Free text", 1),
             ("Longitude", "Numeric (7 decimal places)", "Free text", 0),
             ("Latitude", "Numeric (7 decimal places)", "Free text", 0),
             ("Last Major Service Date", "Date", "Select from calendar", 0)]
    b.append(table(["Attribute", "Format", "Data entry", "Mandatory"],
                   [[f"<b>{n}</b>", f, d, "Yes" if m else "No"] for n, f, d, m in attrs]))
    b.append(h3("Estimating an installation date"))
    b.append(p("Where the real installation date cannot be confirmed, use the highest-confidence evidence available, record "
               "the assumption and assign a confidence rating. The aim is a reasonable, defensible approximation, not the "
               "exact date."))
    b.append(table(["Priority", "Evidence source", "Confidence"], [
        ["1", "Original commissioning records", "Very High"], ["2", "Practical Completion documentation", "Very High"],
        ["3", "Asset purchase invoices", "High"], ["4", "Contractor maintenance records", "High"],
        ["5", "Manufacturer serial number decoding", "Medium-High"], ["6", "Asset warranty information", "Medium"],
        ["7", "Asset condition and lifecycle assessment", "Medium"],
        ["8", "Building opening date or major redevelopment date", "Medium-Low"],
        ["9", "Expert engineering assessment", "Low-Medium"], ["10", "Portfolio default lifecycle model", "Low"]]))

    b.append(h2("8. Data capture, review and retention"))
    b.append(table(["Data element", "Minimum standard"], [
        ["Asset inventory with service provider data", "Updated every 90 days"],
        ["New assets – Category 1 and 2", "Captured within 30 days of installation / handover"],
        ["New assets – Category 3", "Captured within 60 days of installation / handover"],
        ["Asset criticality assessment", "Fully reviewed and updated every 24 months"],
        ["Associated compliance data", "Fully reviewed and updated every 12 months"],
        ["Scheduled maintenance cost data", "Fully reviewed and updated every 12 months"],
        ["Compliance data related to asset servicing",
         "Captured at completion of works and reviewed per the asset's compliance requirements"],
        ["Data quality remediation", "Errors corrected within 30 days of identification"],
        ["Asset additions after capital, development or tenant projects",
         "Asset Registration Pack submitted within 30 days of Practical Completion"],
        ["Asset retirements", "Retirement notification submitted within 30 days of removal or decommissioning"]]))

    b.append(h2("9. Asset lifecycle change management"))
    b.append(h3("9.1 Adding a new asset"))
    b.append(p("Applies to capital replacement, upgrades, new developments, redevelopments, tenant installations, "
               "sustainability and compliance projects, and operational asset purchases."))
    b.append(table(["Step", "Who", "What"], [
        ["1. Identify", "Capital, Development, Tenant Installations, Centre Operations",
         "Identify new assets; confirm ownership, category, service type, location, criticality needs and compliance "
         "obligations."],
        ["2. Compile data", "Project Manager, Contractor",
         "Supply description, service type, category, manufacturer, model, serial number, installation date, purchase and "
         "replacement cost, expected useful life, warranty expiry, location, O&amp;M manuals, commissioning reports and "
         "compliance certificates. Data must align with the attributes above."],
        ["3. Review handover", "Centre Operations",
         "Review as-built drawings, asset schedules, commissioning reports, compliance certificates, warranties and "
         "maintenance recommendations. The project cannot reach final handover until asset information is complete."],
        ["4. Submit", "Capital, Development, Tenant Installations",
         "Submit the Asset Registration Pack to Centre Operations and PM Business Solutions."],
        ["5. Validate", "Centre Operations",
         "Confirm the asset exists, location, ownership and category are correct and attributes are complete. Fix "
         "discrepancies before registration."],
        ["6. Create", "PM Business Solutions",
         "Create the asset ID, parent-child relationships, criticality score and compliance designation."],
        ["7. Set up maintenance", "Centre Operations",
         "Planned maintenance schedules, service provider systems updated, associated compliance tasks, correct service "
         "levels for critical assets."],
        ["8. Accept", "Centre Operations",
         "Approve once the asset appears in the register, maintenance tasks are active and compliance obligations are "
         "established."]]))
    b.append(h3("9.2 Disposing of or removing an asset"))
    b.append(table(["Step", "Who", "What"], [
        ["1. Identify", "Capital, Development, Tenant Installations, Centre Operations",
         "Identify assets being replaced, demolished, disposed of or decommissioned (including during tenant work or "
         "redevelopment)."],
        ["2. Assess", "Centre Operations",
         "Determine asset ID, ownership, current maintenance obligations, compliance implications and whether a "
         "replacement exists."],
        ["3. Approve", "Capital, Development, Tenant Installations; Centre Operations for operational assets",
         "Confirm the assets are no longer required, compliance risks are addressed and any replacement strategy is "
         "approved."],
        ["4. Notify", "Capital, Development, Tenant Installations",
         "Send a retirement notification to Centre Operations and PM Business Solutions: asset ID, description, removal "
         "date, reason, replacement reference."],
        ["5. Review maintenance", "Centre Operations",
         "Remove PPM schedules and compliance tasks; notify service providers; update the asset hierarchy."],
        ["6. Retire in register", "PM Business Solutions",
         "Set status to Retired or Decommissioned. <b>Do not delete the record</b>: it is retained for historical "
         "reporting and lifecycle analysis."],
        ["7. Update finance", "Capital Team", "Update capital forecasts, replacement plans and valuations."],
        ["8. Confirm closure", "Centre Operations",
         "Verify the asset is physically removed, the register is updated, schedules are removed and any replacement is "
         "commissioned."]]))
    b.append(h3("9.3 Who does what (R = Responsible, A = Accountable, C = Consulted)"))
    b.append(table(["Activity", "Capital", "Development", "Tenant Installations", "Centre Operations",
                    "PM Business Solutions"], [
        ["New capital asset", "R", "C", "C", "A", "R"], ["New development asset", "C", "R", "C", "A", "R"],
        ["Tenant project asset", "C", "C", "R", "A", "R"], ["Asset removal", "C", "C", "C", "R", "C"],
        ["Asset register update", "C", "C", "C", "R", "A"], ["Maintenance setup", "C", "C", "C", "R", "A"]]))

    b.append(h2("10. Data quality management"))
    b.append(table(["Data quality check", "Review process owner"], [
        ["Missing or incorrect asset category", "PM Business Solutions"],
        ["Missing or incorrect service type / description", "PM Business Solutions"],
        ["Missing or incorrect equipment key", "PM Business Solutions"],
        ["Missing asset criticality (generic rating to be applied)", "PM Business Solutions"],
        ["Missing associated compliance identification", "PM Business Solutions"],
        ["Missing minimum standard asset attributes", "Centre Management Team"],
        ["Missing or outdated maintenance cost data", "PM Business Solutions"]]))
    b.append(p("<b>Tier 1 suppliers</b> manage asset inventory data reviews under their contract and must give the business a "
               "comprehensive annual report. Missing or unsatisfactory reports are escalated to the National Facilities "
               "Manager – Engineering Services."))
    b.append(table(["Category", "Tier 1 supplier", "System"], [
        ["HVAC", "Airmaster", "Evaluate"], ["Vertical", "Schindler", "ActionBoard"], ["Fire", "ARA Fire", "Uptick"],
        ["Fire", "ELITE", "Uptick"], ["Waste", "Veolia", "EcoLogic"]]))

    b.append(h2("11. Service and maintenance monitoring"))
    b.append(p("Repair-versus-replace decisions need accurate frequency and cost data for planned and unplanned work. That "
               "is only achievable for major equipment held as individual assets, that is <b>Category 1</b>."))
    b.append(ol(["Planned maintenance schedules cover all like items at each building, at the frequency maintenance "
                 "occurs. Where a schedule covers more than one item, the planned cost per item is held as an asset "
                 "attribute.",
                 "Unplanned or reactive tasks are linked to the item worked on. Every reactive task must carry an accurate "
                 "cost to avoid spend discrepancy."]))

    b.append(h2("12. Facilities management business systems"))
    b.append(p("Service providers may keep detailed asset and maintenance data in their own systems, but the data covered by "
               "this Standard must be maintained inside the FM business systems. Where provider systems are used, "
               "National Operations and PM Business Solutions run a data transfer and alignment <b>at least every 90 "
               "days</b>. The preferred maintenance management system supports criticality and associated compliance by:"))
    b.append(ul(["Every item has an attribute recording its criticality score (1 to 9).",
                 "Schedules for critical items (scores 6 and 9) are created under the task type <b>PPM – Critical</b>.",
                 "Every item has an attribute recording whether Associated Compliance is True or False.",
                 "Schedules for items with Associated Compliance are created under the task type "
                 "<b>PPM – Associated Compliance</b>.",
                 "Critical and associated-compliance activities must be completed <b>within 30 days of the task "
                 "generation date</b>."]))
    b.append(h2("13. Ownership and review"))
    b.append(p("<b>Approver:</b> Head of Operations. <b>Owner:</b> National Facilities Manager – Engineering Services. "
               "<b>Review cycle:</b> every 2 years (next review June 2027). For questions, contact the National Facilities "
               "Manager – Engineering Services."))
    return "".join(b)


def build_page(body):
    cloud = ('<svg width="44" height="30" viewBox="0 0 44 30" aria-hidden="true"><path fill="#FFFFFF" d="M18.3 3.6c1.6-1.7 3.9-2.7 '
             '6.4-2.7 3.4 0 6.3 1.9 7.9 4.6 1.4-.6 2.9-.9 4.5-.9 6 0 10.9 4.9 10.9 11s-4.9 11-10.9 11c-.7 0-1.5-.1-2.2-.2-1.4 2.5-4.1 4.2'
             '-7.1 4.2-1.3 0-2.5-.3-3.6-.9-1.4 3.3-4.7 5.6-8.5 5.6-4 0-7.4-2.5-8.7-6-.6.1-1.1.1-1.7.1C3.700 26.400.1 22.900.1 18.600c0-2.900 '
             '1.600-5.400 4-6.800-.3-.9-.5-1.900-.5-2.900 0-5 4-9 9-9 2.200 0 4.300.8 5.700 2.700z" transform="scale(.9)"/></svg>')
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Asset Inventory Management (AIM) Standard – Overview and Quick Reference</title>
<style>
  body {{ margin:0; background:#F3F3F3; color:{INK}; font-family:"Salesforce Sans", -apple-system, "Segoe UI", Arial, sans-serif; font-size:15px; }}
  header {{ background:linear-gradient(135deg,{NAVY},{BLUE}); color:#fff; padding:28px 0 26px; }}
  .wrap {{ max-width:960px; margin:0 auto; padding:0 24px; }}
  .brand {{ display:flex; align-items:center; gap:10px; font-size:14px; letter-spacing:.04em; text-transform:uppercase; opacity:.95; }}
  header h1 {{ font-size:30px; margin:14px 0 6px; font-weight:600; }}
  header p {{ margin:0; opacity:.9; }}
  .pills {{ margin-top:14px; }}
  .pills span {{ display:inline-block; background:rgba(255,255,255,.18); border-radius:12px; padding:3px 12px; margin-right:8px; font-size:13px; }}
  main {{ background:#fff; margin:-14px auto 32px; max-width:960px; padding:8px 32px 28px; border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,.16); }}
  footer {{ text-align:center; color:{GREY}; font-size:12px; padding-bottom:28px; }}
  @media print {{ body {{ background:#fff; }} main {{ box-shadow:none; margin:0; }} header {{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }} }}
</style></head>
<body>
<header><div class="wrap">
  <div class="brand">{cloud} Salesforce Knowledge</div>
  <h1>Asset Inventory Management (AIM) Standard</h1>
  <p>Overview and quick reference for asset categories, criticality and lifecycle</p>
  <div class="pills"><span>Standard v1.2</span><span>Internal use</span><span>Field Service</span></div>
</div></header>
<main>{body}</main>
<footer>Condensed from the AIM Standard v1.2. The standard is the authority. Generated by scripts/build_aim_article.py.</footer>
</body></html>
"""


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    body = build_body()
    (OUT / "aim-standard-body.html").write_text(body, encoding="utf-8")
    (OUT / "aim-standard-article.html").write_text(build_page(body), encoding="utf-8")
    meta = {
        "title": "Asset Inventory Management (AIM) Standard – Overview and Quick Reference",
        "urlName": "aim-standard-overview",
        "question": "What does the AIM Standard require for asset categories, criticality assessment and asset lifecycle?",
        "summary": ("Condensed guide to the Asset Inventory Management (AIM) Standard v1.2: roles, service types, asset "
                    "categories 1, 2, 2N and 3, impact and condition scoring, the criticality matrix, associated "
                    "compliance, mandatory attributes, review frequencies and the add and retire asset workflows."),
    }
    (OUT / "aim-standard-article.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"body={len(body)} chars, summary={len(meta['summary'])} chars")


if __name__ == "__main__":
    main()
