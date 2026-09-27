-- Second AHA library batch. Upsert on slug; existing rows are left unchanged.
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
    "slug": "occupied-spaces",
    "name": "Work in occupied spaces",
    "scope": "general",
    "csi": "01 35 00",
    "equipment": [
      "Barricades & signage",
      "Floor protection",
      "Fans / air scrubbers"
    ],
    "training": [
      "Site-specific orientation",
      "HazCom / SDS"
    ],
    "inspection": [
      "Daily barricade & egress check"
    ],
    "steps": [
      {
        "name": "Coordinate work areas with tenant / building",
        "name_es": "Coordinar áreas de trabajo con el inquilino",
        "hazards": [
          "Occupants entering the work area",
          "Odor complaints"
        ],
        "controls": [
          "Schedule with building manager; after-hours for high-odor work",
          "Post notice to occupants ahead of work"
        ],
        "osha_refs": "1926.200",
        "em385_refs": "",
        "prob": "O",
        "sev": "M"
      },
      {
        "name": "Isolate and barricade work area",
        "name_es": "Aislar y delimitar el área de trabajo",
        "hazards": [
          "Public contact with wet paint, ladders, tools"
        ],
        "controls": [
          "Barricade and sign work area",
          "Keep exits and egress paths clear; never leave ladders unattended"
        ],
        "osha_refs": "1926.200 · 1926.34",
        "em385_refs": "",
        "prob": "O",
        "sev": "M"
      },
      {
        "name": "Control odors and vapors",
        "name_es": "Controlar olores y vapores",
        "hazards": [
          "Vapor migration into occupied areas and HVAC"
        ],
        "controls": [
          "Low/zero-VOC products where specified",
          "Coordinate HVAC isolation with building engineer; ventilate to exterior"
        ],
        "osha_refs": "1926.55",
        "em385_refs": "",
        "prob": "O",
        "sev": "M"
      },
      {
        "name": "Secure materials at end of shift",
        "name_es": "Asegurar materiales al final del turno",
        "hazards": [
          "Unattended chemicals and equipment"
        ],
        "controls": [
          "Close containers and lock up materials",
          "Remove or secure ladders"
        ],
        "osha_refs": "1926.152",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      }
    ]
  },
  {
    "slug": "wallcovering-removal",
    "name": "Wallcovering removal",
    "scope": "wallcovering",
    "csi": "09 72 00",
    "equipment": [
      "Wallpaper steamer",
      "Scoring tool",
      "Scrapers",
      "Drop cloths"
    ],
    "training": [
      "Steamer operation",
      "HazCom / SDS"
    ],
    "inspection": [
      "Steamer cord & GFCI check",
      "Hazardous materials survey reviewed"
    ],
    "steps": [
      {
        "name": "Review existing substrate",
        "name_es": "Revisar el sustrato existente",
        "hazards": [
          "Unknown coatings — lead or asbestos in older buildings"
        ],
        "controls": [
          "Confirm hazardous materials survey before disturbing",
          "Stop work and notify PM if suspect material is found"
        ],
        "osha_refs": "1926.62 · 1926.1101",
        "em385_refs": "",
        "prob": "S",
        "sev": "R"
      },
      {
        "name": "Score and apply remover",
        "name_es": "Rayar y aplicar removedor",
        "hazards": [
          "Skin and eye contact with remover",
          "Blade cuts"
        ],
        "controls": [
          "Review SDS; gloves and safety glasses",
          "Guarded scoring tool; cut-resistant gloves"
        ],
        "osha_refs": "1910.1200 · 1926.95",
        "em385_refs": "",
        "prob": "O",
        "sev": "M"
      },
      {
        "name": "Steam and strip paper",
        "name_es": "Aplicar vapor y retirar papel",
        "hazards": [
          "Burns from steam and hot plate",
          "Shock from wet cords"
        ],
        "controls": [
          "Heat-resistant gloves; keep plate moving and away from body",
          "GFCI on all cords; keep cords out of water"
        ],
        "osha_refs": "1926.404(b) · 1926.416",
        "em385_refs": "",
        "prob": "S",
        "sev": "R"
      },
      {
        "name": "Scrape and clean up",
        "name_es": "Raspar y limpiar",
        "hazards": [
          "Slips on wet paper and paste",
          "Flying debris"
        ],
        "controls": [
          "Bag scraps as you go; wipe floors",
          "Eye protection while scraping"
        ],
        "osha_refs": "1926.25 · 1926.102",
        "em385_refs": "",
        "prob": "O",
        "sev": "M"
      }
    ]
  },
  {
    "slug": "lead-paint",
    "name": "Disturbing lead-containing paint",
    "scope": "paint",
    "csi": "09 91 23",
    "equipment": [
      "HEPA vacuums & HEPA tools",
      "Poly sheeting",
      "Disposable coveralls",
      "Respirators"
    ],
    "training": [
      "Lead worker training",
      "Respirator fit test"
    ],
    "inspection": [
      "Exposure assessment on file",
      "Daily containment check"
    ],
    "steps": [
      {
        "name": "Exposure assessment",
        "name_es": "Evaluación de exposición",
        "hazards": [
          "Lead exposure above the PEL"
        ],
        "controls": [
          "Initial exposure assessment / air monitoring",
          "Interim protection until assessment is complete"
        ],
        "osha_refs": "1926.62",
        "em385_refs": "",
        "prob": "O",
        "sev": "R"
      },
      {
        "name": "Set up containment",
        "name_es": "Instalar contención",
        "hazards": [
          "Lead dust spreading to other areas"
        ],
        "controls": [
          "Poly barriers; restrict access with signage",
          "HEPA vacuums on hand before work starts"
        ],
        "osha_refs": "1926.62",
        "em385_refs": "",
        "prob": "O",
        "sev": "R"
      },
      {
        "name": "Wet scrape / HEPA sand",
        "name_es": "Raspado húmedo / lijado con HEPA",
        "hazards": [
          "Lead dust inhalation and ingestion"
        ],
        "controls": [
          "Wet methods and HEPA-shrouded tools",
          "No dry sweeping or compressed air"
        ],
        "osha_refs": "1926.62",
        "em385_refs": "",
        "prob": "O",
        "sev": "R"
      },
      {
        "name": "Hygiene and waste handling",
        "name_es": "Higiene y manejo de residuos",
        "hazards": [
          "Take-home lead",
          "Improper disposal"
        ],
        "controls": [
          "Wash hands and face before eating; remove coveralls at exit",
          "Bag, seal, and label waste per project requirements"
        ],
        "osha_refs": "1926.62",
        "em385_refs": "",
        "prob": "O",
        "sev": "M"
      }
    ]
  },
  {
    "slug": "exterior-painting",
    "name": "Exterior painting",
    "scope": "paint",
    "csi": "09 91 13",
    "equipment": [
      "Extension ladders",
      "Boom or scissor lift",
      "Airless sprayer",
      "Barricades"
    ],
    "training": [
      "Ladder safety",
      "Aerial lift operator",
      "Heat illness prevention"
    ],
    "inspection": [
      "Daily ladder check",
      "Wind check before spraying"
    ],
    "steps": [
      {
        "name": "Protect public and vehicles",
        "name_es": "Proteger al público y vehículos",
        "hazards": [
          "Overspray on people and vehicles",
          "Falling tools or materials"
        ],
        "controls": [
          "Barricade below work; move or cover vehicles",
          "Stop spraying when wind carries overspray"
        ],
        "osha_refs": "1926.200",
        "em385_refs": "",
        "prob": "O",
        "sev": "M"
      },
      {
        "name": "Work from extension ladders",
        "name_es": "Trabajo desde escaleras de extensión",
        "hazards": [
          "Falls",
          "Ladder slipping on uneven ground"
        ],
        "controls": [
          "Set at 4:1, extend 3 ft above landing, secure top",
          "Level, firm footing"
        ],
        "osha_refs": "1926.1053",
        "em385_refs": "",
        "prob": "O",
        "sev": "R"
      },
      {
        "name": "Work near overhead power lines",
        "name_es": "Trabajo cerca de líneas eléctricas",
        "hazards": [
          "Electrocution from ladders, poles, or lifts"
        ],
        "controls": [
          "Non-conductive ladders",
          "Maintain at least 10 ft clearance from lines"
        ],
        "osha_refs": "1926.416 · 1926.1053(b)(12)",
        "em385_refs": "",
        "prob": "S",
        "sev": "C"
      },
      {
        "name": "Weather conditions",
        "name_es": "Condiciones del clima",
        "hazards": [
          "Heat",
          "Wet or windy conditions"
        ],
        "controls": [
          "Follow heat illness plan",
          "Stop work in rain or high wind"
        ],
        "osha_refs": "Cal/OSHA T8 §3395",
        "em385_refs": "",
        "prob": "O",
        "sev": "M"
      }
    ]
  },
  {
    "slug": "hp-coatings",
    "name": "High-performance coatings (epoxy / urethane)",
    "scope": "paint",
    "csi": "09 96 00",
    "equipment": [
      "Mixing drill / jiffy mixer",
      "Airless sprayer",
      "Respirators",
      "Ventilation fans"
    ],
    "training": [
      "Respirator fit test",
      "HazCom / SDS",
      "Isocyanate awareness (urethanes)"
    ],
    "inspection": [
      "Respirator cartridge change schedule",
      "Ventilation check"
    ],
    "steps": [
      {
        "name": "Mix two-component coatings",
        "name_es": "Mezclar recubrimientos de dos componentes",
        "hazards": [
          "Skin sensitization from epoxy / amines",
          "Splash"
        ],
        "controls": [
          "Nitrile gloves and sleeves; goggles",
          "Mix per manufacturer ratio in a ventilated area"
        ],
        "osha_refs": "1910.1200",
        "em385_refs": "",
        "prob": "L",
        "sev": "M"
      },
      {
        "name": "Apply coatings",
        "name_es": "Aplicar recubrimientos",
        "hazards": [
          "Solvent and isocyanate vapors"
        ],
        "controls": [
          "Respirator per written program; supplied-air or PAPR where SDS requires",
          "Exhaust ventilation during application"
        ],
        "osha_refs": "1910.134 · 1926.55",
        "em385_refs": "",
        "prob": "O",
        "sev": "R"
      },
      {
        "name": "Control ignition sources",
        "name_es": "Controlar fuentes de ignición",
        "hazards": [
          "Flammable vapor accumulation"
        ],
        "controls": [
          "No ignition sources in area",
          "Extinguisher staged; bond/ground containers"
        ],
        "osha_refs": "1926.150 · 1926.152",
        "em385_refs": "",
        "prob": "S",
        "sev": "C"
      },
      {
        "name": "Cure and restrict access",
        "name_es": "Curado y acceso restringido",
        "hazards": [
          "Contact with uncured coating",
          "Re-entry vapors"
        ],
        "controls": [
          "Post area until cured",
          "Ventilate before re-occupancy"
        ],
        "osha_refs": "1926.200",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      }
    ]
  },
  {
    "slug": "floor-coatings",
    "name": "Concrete floor coatings & sealers",
    "scope": "paint",
    "csi": "09 67 23",
    "equipment": [
      "Floor grinder with shroud & HEPA vac",
      "Squeegees & rollers",
      "Respirators"
    ],
    "training": [
      "Silica competent person",
      "Respirator fit test",
      "HazCom / SDS"
    ],
    "inspection": [
      "Grinder shroud & vac check",
      "Silica exposure control plan on site"
    ],
    "steps": [
      {
        "name": "Grind and prep concrete",
        "name_es": "Pulir y preparar el concreto",
        "hazards": [
          "Respirable crystalline silica",
          "Noise"
        ],
        "controls": [
          "Shrouded grinder with HEPA vac per Table 1; respirator per Table 1",
          "Hearing protection"
        ],
        "osha_refs": "1926.1153 · 1926.52",
        "em385_refs": "",
        "prob": "L",
        "sev": "R"
      },
      {
        "name": "Repair cracks and joints",
        "name_es": "Reparar grietas y juntas",
        "hazards": [
          "Skin contact with fillers",
          "Flying chips"
        ],
        "controls": [
          "Gloves",
          "Eye protection"
        ],
        "osha_refs": "1910.1200 · 1926.102",
        "em385_refs": "",
        "prob": "O",
        "sev": "M"
      },
      {
        "name": "Apply primer and coating",
        "name_es": "Aplicar primario y recubrimiento",
        "hazards": [
          "Vapors in enclosed areas",
          "Slips on wet coating"
        ],
        "controls": [
          "Ventilate; respirator per SDS",
          "Work toward the exit; spiked shoes on wet coating"
        ],
        "osha_refs": "1926.55 · 1910.134",
        "em385_refs": "",
        "prob": "O",
        "sev": "M"
      },
      {
        "name": "Cure and restrict access",
        "name_es": "Curado y acceso restringido",
        "hazards": [
          "Foot or forklift traffic on uncured floor"
        ],
        "controls": [
          "Barricade and sign",
          "Coordinate re-entry with facility"
        ],
        "osha_refs": "1926.200",
        "em385_refs": "",
        "prob": "S",
        "sev": "M"
      }
    ]
  },
  {
    "slug": "steel-deck",
    "name": "Structural steel & deck painting",
    "scope": "paint",
    "csi": "09 91 23",
    "equipment": [
      "Power tools (grinders, needle scalers)",
      "Airless sprayer",
      "Boom or scissor lift",
      "Respirators"
    ],
    "training": [
      "Aerial lift operator",
      "Respirator fit test",
      "Lead / chromium awareness"
    ],
    "inspection": [
      "Existing coating test results on file",
      "Pre-use lift inspection"
    ],
    "steps": [
      {
        "name": "Test existing coatings",
        "name_es": "Analizar recubrimientos existentes",
        "hazards": [
          "Lead or hexavalent chromium in existing paint"
        ],
        "controls": [
          "Test before disturbing",
          "Follow exposure assessment and compliance plan if positive"
        ],
        "osha_refs": "1926.62 · 1926.1126",
        "em385_refs": "",
        "prob": "O",
        "sev": "R"
      },
      {
        "name": "Power tool cleaning (SSPC-SP 3)",
        "name_es": "Limpieza con herramienta eléctrica (SSPC-SP 3)",
        "hazards": [
          "Flying particles",
          "Noise and dust"
        ],
        "controls": [
          "Face shield over safety glasses",
          "Hearing protection; HEPA-shrouded tools"
        ],
        "osha_refs": "1926.102 · 1926.52",
        "em385_refs": "",
        "prob": "L",
        "sev": "M"
      },
      {
        "name": "Spray or roll overhead from lift",
        "name_es": "Pintar por encima de la cabeza desde elevador",
        "hazards": [
          "Falls",
          "Overspray in eyes"
        ],
        "controls": [
          "Follow lift AHA controls",
          "Goggles for overhead work"
        ],
        "osha_refs": "1926.453 · 1926.102",
        "em385_refs": "",
        "prob": "O",
        "sev": "R"
      },
      {
        "name": "Protect facility and equipment",
        "name_es": "Proteger instalaciones y equipo",
        "hazards": [
          "Overspray on product, vehicles, equipment"
        ],
        "controls": [
          "Mask and cover equipment below",
          "Coordinate shutdowns with facility; wind check outdoors"
        ],
        "osha_refs": "Site requirements",
        "em385_refs": "",
        "prob": "O",
        "sev": "N"
      }
    ]
  },
  {
    "slug": "active-facility",
    "name": "Work in active industrial facility",
    "scope": "general",
    "csi": "01 35 00",
    "equipment": [
      "Barricades",
      "High-visibility vests",
      "Owner lockout devices"
    ],
    "training": [
      "Owner site orientation",
      "LOTO awareness",
      "HazCom / SDS"
    ],
    "inspection": [
      "Daily walk with facility contact"
    ],
    "steps": [
      {
        "name": "Site orientation and permits",
        "name_es": "Orientación del sitio y permisos",
        "hazards": [
          "Unknown site hazards"
        ],
        "controls": [
          "Complete owner orientation",
          "Obtain required permits (hot work, lift, confined space)"
        ],
        "osha_refs": "1926.21",
        "em385_refs": "",
        "prob": "O",
        "sev": "M"
      },
      {
        "name": "Work near operating equipment",
        "name_es": "Trabajo cerca de equipo en operación",
        "hazards": [
          "Moving parts and stored energy",
          "Hot surfaces"
        ],
        "controls": [
          "Owner-performed lockout before work on or near equipment; verify zero energy",
          "Never operate owner equipment"
        ],
        "osha_refs": "1910.147 · 1926.417",
        "em385_refs": "",
        "prob": "S",
        "sev": "C"
      },
      {
        "name": "Forklift and vehicle traffic",
        "name_es": "Tráfico de montacargas y vehículos",
        "hazards": [
          "Struck-by"
        ],
        "controls": [
          "Hi-vis vests; barricade work zone",
          "Spotter; coordinate traffic routes with facility"
        ],
        "osha_refs": "1926.200 · 1910.178",
        "em385_refs": "",
        "prob": "O",
        "sev": "R"
      },
      {
        "name": "Housekeeping and egress",
        "name_es": "Orden y salidas",
        "hazards": [
          "Blocked exits",
          "Trips"
        ],
        "controls": [
          "Keep aisles and exits clear",
          "Stage materials only in approved areas"
        ],
        "osha_refs": "1926.25 · 1926.34",
        "em385_refs": "",
        "prob": "O",
        "sev": "M"
      }
    ]
  },
  {
    "slug": "boom-lift",
    "name": "Boom lift work",
    "scope": "access",
    "csi": "01 54 00",
    "equipment": [
      "Articulating or telescopic boom lift",
      "Full-body harness & lanyard"
    ],
    "training": [
      "Aerial lift operator",
      "Fall protection"
    ],
    "inspection": [
      "Pre-use lift inspection",
      "Harness & lanyard inspection"
    ],
    "steps": [
      {
        "name": "Pre-use inspection",
        "name_es": "Inspección antes de usar",
        "hazards": [
          "Equipment malfunction"
        ],
        "controls": [
          "Daily inspection checklist",
          "Operator trained and authorized"
        ],
        "osha_refs": "1926.453",
        "em385_refs": "",
        "prob": "S",
        "sev": "R"
      },
      {
        "name": "Set up and travel",
        "name_es": "Instalación y desplazamiento",
        "hazards": [
          "Tip-over on slopes, soft ground, openings",
          "Overhead power lines"
        ],
        "controls": [
          "Check ground conditions and slope limits; use a spotter",
          "Maintain power-line clearance"
        ],
        "osha_refs": "1926.453 · 1926.416",
        "em385_refs": "",
        "prob": "S",
        "sev": "C"
      },
      {
        "name": "Work from basket",
        "name_es": "Trabajo desde la canasta",
        "hazards": [
          "Fall or ejection from basket",
          "Crush against overhead structure"
        ],
        "controls": [
          "Harness tied to basket anchor; feet on basket floor",
          "Watch overhead clearance while elevating"
        ],
        "osha_refs": "1926.453(b)(2)(v)",
        "em385_refs": "",
        "prob": "S",
        "sev": "C"
      }
    ]
  },
  {
    "slug": "heat-illness",
    "name": "Heat illness prevention",
    "scope": "general",
    "csi": "01 35 00",
    "equipment": [
      "Drinking water",
      "Shade / cool-down area",
      "Fans"
    ],
    "training": [
      "Heat illness prevention"
    ],
    "inspection": [
      "Daily temperature check",
      "Water and shade on site"
    ],
    "steps": [
      {
        "name": "Provide water, shade and rest",
        "name_es": "Proveer agua, sombra y descanso",
        "hazards": [
          "Heat exhaustion",
          "Heat stroke"
        ],
        "controls": [
          "Fresh water available all shift",
          "Shade or cool-down area; preventative cool-down breaks"
        ],
        "osha_refs": "Cal/OSHA T8 §3395 · §3396",
        "em385_refs": "",
        "prob": "O",
        "sev": "R"
      },
      {
        "name": "Acclimatize and monitor crew",
        "name_es": "Aclimatar y observar al personal",
        "hazards": [
          "New or returning workers at higher risk"
        ],
        "controls": [
          "Close observation of new workers during first 14 days",
          "Buddy system in high heat"
        ],
        "osha_refs": "Cal/OSHA T8 §3395",
        "em385_refs": "",
        "prob": "S",
        "sev": "R"
      },
      {
        "name": "Respond to symptoms",
        "name_es": "Responder a síntomas",
        "hazards": [
          "Delayed response to heat stroke"
        ],
        "controls": [
          "Crew knows site address and emergency procedure",
          "Call 911 and begin cooling immediately"
        ],
        "osha_refs": "Cal/OSHA T8 §3395",
        "em385_refs": "",
        "prob": "S",
        "sev": "C"
      }
    ]
  }
]$aha_seed$::jsonb) as item
on conflict (slug) do nothing;
