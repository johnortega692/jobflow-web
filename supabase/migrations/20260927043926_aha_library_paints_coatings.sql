-- Library template from the Paints & Coatings JHA (CSI 09 90 00).
insert into public.aha_library (slug, name, scope, csi, equipment, training, inspection, steps)
select
  item->>'slug',
  item->>'name',
  item->>'scope',
  coalesce(item->>'csi', ''),
  coalesce(
    (
      select array_agg(value order by ord)
      from jsonb_array_elements_text(coalesce(item->'equipment', '[]'::jsonb)) with ordinality as t(value, ord)
    ),
    '{}'::text[]
  ),
  coalesce(
    (
      select array_agg(value order by ord)
      from jsonb_array_elements_text(coalesce(item->'training', '[]'::jsonb)) with ordinality as t(value, ord)
    ),
    '{}'::text[]
  ),
  coalesce(
    (
      select array_agg(value order by ord)
      from jsonb_array_elements_text(coalesce(item->'inspection', '[]'::jsonb)) with ordinality as t(value, ord)
    ),
    '{}'::text[]
  ),
  coalesce(item->'steps', '[]'::jsonb)
from jsonb_array_elements($aha_seed$[
  {
    "slug": "paints-coatings",
    "name": "Paints & coatings",
    "scope": "paint",
    "csi": "09 90 00",
    "equipment": [
      "Scissor lift",
      "Boom lift",
      "Rolling scaffold",
      "Ladder",
      "Power tools",
      "Hand tools",
      "Airless sprayer",
      "Respirator",
      "Personal fall arrest"
    ],
    "training": [
      "Scissor lift certification",
      "Boom lift certification",
      "Scaffold user certification",
      "Ladder safety",
      "Airless sprayer operation",
      "Respirator medical clearance, fit test, and use",
      "Personal fall arrest",
      "HazCom / SDS"
    ],
    "inspection": [
      "Lift inspected on delivery and before each shift",
      "Scaffold inspected before each shift by a competent person",
      "Ladder inspected before use",
      "Tools and sprayer inspected daily",
      "Respirator inspected before each use",
      "Fall arrest inspected before each use"
    ],
    "steps": [
      {
        "name": "Site-specific job training",
        "name_es": "Capacitación específica del trabajo",
        "hazards": [
          "Untrained workers harmed by the task"
        ],
        "controls": [
          "Train from this AHA before the work starts",
          "Amend the AHA with Safety if the scope changes"
        ],
        "osha_refs": "1926.21",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      },
      {
        "name": "Put on PPE",
        "name_es": "Colocarse el EPP",
        "hazards": [
          "Head, foot, hand, or eye injury",
          "Hearing damage"
        ],
        "controls": [
          "Hard hat, safety glasses, cut-resistant gloves, reflective vest, and work boots",
          "Hearing protection above 85 dB",
          "Face shield when the task requires it",
          "No loose clothing or jewelry that can snag"
        ],
        "osha_refs": "1926.95 · 1926.102",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      },
      {
        "name": "Enter and leave the building",
        "name_es": "Entrar y salir del edificio",
        "hazards": [
          "Slips, trips, and falls"
        ],
        "controls": [
          "Inspect the route in and out",
          "Keep a clear passage for workers"
        ],
        "osha_refs": "1926.25",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      },
      {
        "name": "Inspect the work area",
        "name_es": "Inspeccionar el área de trabajo",
        "hazards": [
          "Trips",
          "Falls"
        ],
        "controls": [
          "Watch footing and talk with coworkers",
          "Stay clear of pinch points, moving equipment, and overhead work",
          "Keep a clear path of travel"
        ],
        "osha_refs": "1926.25",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      },
      {
        "name": "Review the day's work",
        "name_es": "Revisar el trabajo del día",
        "hazards": [
          "Crews working without a shared plan",
          "Mistakes and injuries"
        ],
        "controls": [
          "Foreman and crew review the day's tasks, hazards, and controls before starting"
        ],
        "osha_refs": "1926.21",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      },
      {
        "name": "Receive and store material",
        "name_es": "Recibir y almacenar material",
        "hazards": [
          "Pinch and crush injuries",
          "Strains from handling"
        ],
        "controls": [
          "Keep hands and feet clear of pinch points",
          "Store material so it cannot be knocked over",
          "Stage close to where it will be used",
          "Stay clear of moving equipment and backup alarms"
        ],
        "osha_refs": "1926.250",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      },
      {
        "name": "Inspect tools before use",
        "name_es": "Inspeccionar herramientas antes de usar",
        "hazards": [
          "Defective power tools",
          "Electric shock",
          "Cuts from spinning tools"
        ],
        "controls": [
          "Tag defective tools and remove them from the site",
          "Do not use tools with missing or modified guards",
          "Use tools only as intended",
          "GFCI on every circuit serving an electric tool"
        ],
        "osha_refs": "1926.300 · 1926.404",
        "em385_refs": "",
        "prob": "U",
        "sev": "R"
      },
      {
        "name": "Inspect the airless sprayer",
        "name_es": "Inspeccionar el equipo airless",
        "hazards": [
          "Defective equipment",
          "Electric shock",
          "High-pressure injection"
        ],
        "controls": [
          "Do not use a rig with broken or missing parts",
          "Tip guard stays on the gun",
          "Confirm the trigger and trigger lock work"
        ],
        "osha_refs": "1926.302",
        "em385_refs": "",
        "prob": "U",
        "sev": "R"
      },
      {
        "name": "Check electrical cords",
        "name_es": "Revisar los cables eléctricos",
        "hazards": [
          "Electrical shock",
          "Electrocution"
        ],
        "controls": [
          "Do not use cords with cuts, worn insulation, or exposed conductors",
          "Hard-service cords and factory-assembled sets",
          "No tape repairs; ground prong intact",
          "GFCI only; do not run cords across walkways"
        ],
        "osha_refs": "1926.405",
        "em385_refs": "",
        "prob": "U",
        "sev": "R"
      },
      {
        "name": "Lift and move materials",
        "name_es": "Levantar y mover materiales",
        "hazards": [
          "Strains",
          "Striking others",
          "Crush and pinch points",
          "Spills"
        ],
        "controls": [
          "Team lift heavy or awkward loads",
          "Use carts and other handling aids",
          "Never move material above other people",
          "Do not stand in front of a wall or floor opening while stocking",
          "Seal liquids before moving"
        ],
        "osha_refs": "1926.250",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      },
      {
        "name": "Carry buckets",
        "name_es": "Cargar cubetas",
        "hazards": [
          "Strains",
          "Striking others",
          "Spills"
        ],
        "controls": [
          "Team lift heavy buckets and balance the load",
          "Use a cart when possible",
          "Seal containers before moving"
        ],
        "osha_refs": "1926.250",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      },
      {
        "name": "Lay out tools and hoses",
        "name_es": "Tender herramientas y mangueras",
        "hazards": [
          "Trips on hoses, cords, and compressors"
        ],
        "controls": [
          "Keep corridors and high-traffic paths clear",
          "Route hoses and cords in order",
          "Pick up scrap before and after the work",
          "Do not leave tools on the floor"
        ],
        "osha_refs": "1926.25",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      },
      {
        "name": "Open paint cans",
        "name_es": "Abrir latas de pintura",
        "hazards": [
          "Punctures and cuts from the opener"
        ],
        "controls": [
          "Wear gloves",
          "Keep the tool edge facing away from the body"
        ],
        "osha_refs": "1926.95",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      },
      {
        "name": "Mix and pour paint",
        "name_es": "Mezclar y verter pintura",
        "hazards": [
          "Skin and eye contact",
          "Paint fumes"
        ],
        "controls": [
          "Safety glasses and gloves",
          "Mix on a level surface in a ventilated area",
          "Read the SDS and wear the respirator it requires"
        ],
        "osha_refs": "1910.1200 · 1926.55",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      },
      {
        "name": "Prepare the substrate",
        "name_es": "Preparar el sustrato",
        "hazards": [
          "Dust inhalation"
        ],
        "controls": [
          "N95 available for voluntary use",
          "Use the respirator required by the SDS or silica plan"
        ],
        "osha_refs": "1926.1153 · 1910.134",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      },
      {
        "name": "Apply coatings",
        "name_es": "Aplicar recubrimientos",
        "hazards": [
          "Splashes to eyes and skin",
          "Paint fumes",
          "Strain from repetitive or awkward reaching"
        ],
        "controls": [
          "Required PPE and ventilation",
          "Follow the SDS, including the respirator",
          "Stretch and set up to avoid awkward positions",
          "Mask off areas from overspray"
        ],
        "osha_refs": "1910.1200 · 1926.55",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      },
      {
        "name": "Spray with an airless",
        "name_es": "Rociar con equipo airless",
        "hazards": [
          "Skin and eye contact",
          "High-pressure fluid injection"
        ],
        "controls": [
          "Never disable the tip guard or trigger lock",
          "Never point the gun at anyone",
          "Unplug and relieve pressure before a tip change, cleaning, or repair",
          "Do not look into a clogged tip or clear it with a finger",
          "Replace a leaking hose; do not hold a rag over the leak",
          "Keep the nozzle in the pail when flushing with the tip off",
          "Follow the operator's manual and the SDS"
        ],
        "osha_refs": "1926.302 · 1910.1200",
        "em385_refs": "",
        "prob": "U",
        "sev": "R"
      },
      {
        "name": "Caulk",
        "name_es": "Aplicar sellador",
        "hazards": [
          "Skin contact",
          "Dizziness or nausea"
        ],
        "controls": [
          "Read the SDS for the sealant",
          "Wear the PPE the SDS specifies"
        ],
        "osha_refs": "1910.1200",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      },
      {
        "name": "Work from a fixed scaffold",
        "name_es": "Trabajar desde andamio fijo",
        "hazards": [
          "Falls causing serious injury",
          "Dropped tools and materials"
        ],
        "controls": [
          "Inspect each shift and green-tag; red-tag defects",
          "Guardrails or personal fall arrest at 6 ft or more",
          "Top rail about 42 in., midrail, and toeboards",
          "Platforms fully planked; plank overlap at least 12 in.",
          "Tether tools and use a bag to raise and lower them"
        ],
        "osha_refs": "1926.451 · 1926.501",
        "em385_refs": "",
        "prob": "S",
        "sev": "R"
      },
      {
        "name": "Work from a ladder",
        "name_es": "Trabajar desde una escalera",
        "hazards": [
          "Falls",
          "Workers below struck by falling objects"
        ],
        "controls": [
          "Ladder rated for the load; no Type III light-duty ladders",
          "Inspect before use",
          "4:1 slope on a straight ladder and 3 points of contact",
          "Extend 36 in. above the landing",
          "Do not stand on the top step or the top 3 rungs of a straight ladder",
          "Secure extension ladders at the top and bottom",
          "Do not overreach; move the ladder"
        ],
        "osha_refs": "1926.1053",
        "em385_refs": "",
        "prob": "S",
        "sev": "R"
      },
      {
        "name": "Work from a rolling scaffold",
        "name_es": "Trabajar desde andamio rodante",
        "hazards": [
          "Scaffold racking or rolling",
          "Falls",
          "Tip-over",
          "Dropped tools"
        ],
        "controls": [
          "Daily inspection, green tag, and red tag for defects",
          "Bracing, guardrails, and full-width planks in place",
          "Lock the wheels or chock the scaffold before climbing",
          "Check the floor for openings, slopes, and debris",
          "Do not exceed the load; keep the area below clear"
        ],
        "osha_refs": "1926.451 · 1926.452(w)",
        "em385_refs": "",
        "prob": "S",
        "sev": "R"
      },
      {
        "name": "Work from a scissor lift",
        "name_es": "Trabajar desde un elevador de tijera",
        "hazards": [
          "Unexpected movement",
          "Falls",
          "Tip-over",
          "Pinch points",
          "Dropped tools"
        ],
        "controls": [
          "Trained operator; inspect before each shift and green-tag",
          "Fall protection on the manufacturer anchor",
          "Firm, level surface at least 10 ft from power lines",
          "Do not stand on the rails or exceed the load rating",
          "Do not ride while the platform is elevated",
          "Keep hands inside while traveling"
        ],
        "osha_refs": "1926.453",
        "em385_refs": "",
        "prob": "S",
        "sev": "R"
      },
      {
        "name": "Work from a boom lift",
        "name_es": "Trabajar desde un elevador de pluma",
        "hazards": [
          "Unexpected movement",
          "Falls",
          "Tip-over",
          "Pinch points",
          "Dropped tools"
        ],
        "controls": [
          "Trained operator; inspect before each shift and green-tag",
          "Personal fall arrest on the manufacturer anchor",
          "Firm, level surface at least 10 ft from power lines",
          "Do not stand on the rails, ride while elevated, or exceed the load",
          "Keep hands inside while traveling and the area below clear"
        ],
        "osha_refs": "1926.453",
        "em385_refs": "",
        "prob": "S",
        "sev": "R"
      },
      {
        "name": "Leading edge work",
        "name_es": "Trabajo en borde de ataque",
        "hazards": [
          "Falls causing serious injury or death",
          "Dropped material or tools"
        ],
        "controls": [
          "Guardrail, safety net, or personal fall arrest",
          "Harness system limited to 1,800 lb arresting force",
          "Rig so free fall is 6 ft or less and the worker cannot hit a lower level",
          "Inspect the system before each use",
          "Use an SRL-LE system rated for a leading edge"
        ],
        "osha_refs": "1926.501 · 1926.502",
        "em385_refs": "",
        "prob": "U",
        "sev": "C"
      },
      {
        "name": "Work around other trades",
        "name_es": "Trabajar cerca de otros oficios",
        "hazards": [
          "Hazardous noise",
          "Hazardous fumes"
        ],
        "controls": [
          "Ear plugs from 85 to 115 dBA; plugs and muffs above 115 dBA",
          "Keep unprotected workers out of areas where coatings give off hazardous fumes"
        ],
        "osha_refs": "1926.52 · 1926.55",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      },
      {
        "name": "Work in hot weather",
        "name_es": "Trabajar en clima caluroso",
        "hazards": [
          "Heat stroke, heat exhaustion, or heat cramps",
          "Sunburn"
        ],
        "controls": [
          "Follow the company heat illness prevention plan",
          "Keep drinking water available",
          "Take scheduled cool-down breaks"
        ],
        "osha_refs": "",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      },
      {
        "name": "Clean up a paint spill",
        "name_es": "Limpiar un derrame de pintura",
        "hazards": [
          "Slips",
          "Chemical exposure and fumes",
          "Property and environmental damage"
        ],
        "controls": [
          "Contain the spill with absorbent",
          "Wear the PPE for the product",
          "Shovel spent absorbent into bags or drums and dispose of it properly"
        ],
        "osha_refs": "1926.25 · 1910.1200",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      },
      {
        "name": "Clean brushes and rollers",
        "name_es": "Limpiar brochas y rodillos",
        "hazards": [
          "Chemical exposure",
          "Paint fumes"
        ],
        "controls": [
          "Required PPE and ventilation",
          "Wash hands and exposed skin when finished",
          "Follow the SDS"
        ],
        "osha_refs": "1910.1200",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      },
      {
        "name": "Clean up the work area",
        "name_es": "Limpiar el área de trabajo",
        "hazards": [
          "Dust",
          "Lacerations",
          "Strains",
          "Slips, trips, and falls"
        ],
        "controls": [
          "Store equipment out of the way",
          "Stack material in the laydown area",
          "Clean through the shift and at the end of the shift",
          "Use a sweeping compound if sweeping; N95 available for voluntary use"
        ],
        "osha_refs": "1926.25",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      }
    ]
  }
]$aha_seed$::jsonb) as item
on conflict (slug) do update
set
  name = excluded.name,
  scope = excluded.scope,
  csi = excluded.csi,
  equipment = excluded.equipment,
  training = excluded.training,
  inspection = excluded.inspection,
  steps = excluded.steps,
  updated_at = now();
