-- Everyday paint templates assume water-based coatings.
-- Solvent, isocyanate, and flammable-vapor language stays on hp-coatings.

update public.aha_library
set steps = $brush$[
  { "name": "Mix and box paint", "name_es": "Mezclar la pintura", "hazards": ["Skin and eye contact with coatings"], "controls": ["Review SDS; nitrile gloves, safety glasses", "Wipe spills immediately"], "osha_refs": "1910.1200", "em385_refs": "", "prob": "O", "sev": "M" },
  { "name": "Work from ladders", "name_es": "Trabajo desde escaleras", "hazards": ["Falls from ladder", "Overreaching"], "controls": ["Inspect before use; 3 points of contact", "No standing on top step; move the ladder instead of reaching"], "osha_refs": "1926.1053", "em385_refs": "", "prob": "O", "sev": "R" },
  { "name": "Work from rolling scaffold", "name_es": "Trabajo desde andamio rodante", "hazards": ["Falls from platform", "Tip-over or rolling"], "controls": ["Lock casters; guardrails as required", "No riding while moved; competent-person inspection"], "osha_refs": "1926.451 · 1926.452(w)", "em385_refs": "", "prob": "S", "sev": "R" },
  { "name": "Clean tools and dispose waste", "name_es": "Limpiar herramientas y desechar residuos", "hazards": ["Skin contact with wash water", "Slips from spills"], "controls": ["Wash tools with water in a contained area", "Dispose leftover paint and wash water per the SDS"], "osha_refs": "1910.1200 · 1926.25", "em385_refs": "", "prob": "S", "sev": "M" }
]$brush$::jsonb
where slug = 'brush-roll';

update public.aha_library
set steps = $spray$[
  { "name": "Set up pump and hoses", "name_es": "Instalar bomba y mangueras", "hazards": ["High-pressure injection injury", "Trips on hoses"], "controls": ["Tip guard on; relieve pressure before servicing", "Route hoses out of walkways"], "osha_refs": "Mfr. instructions", "em385_refs": "", "prob": "O", "sev": "R" },
  { "name": "Spray walls and ceilings", "name_es": "Rociar paredes y techos", "hazards": ["Overspray inhalation", "Eye exposure"], "controls": ["Respirator per written program, fit-tested", "Mask off area; ventilate"], "osha_refs": "1910.134 · 1926.57", "em385_refs": "", "prob": "L", "sev": "M" },
  { "name": "Contain overspray", "name_es": "Contener el exceso de rociado", "hazards": ["Overspray on finishes, floors, and HVAC"], "controls": ["Mask and cover adjacent surfaces", "Cover returns and ventilate the work area"], "osha_refs": "1926.57", "em385_refs": "", "prob": "O", "sev": "M" },
  { "name": "Flush pump and clean up", "name_es": "Purgar bomba y limpiar", "hazards": ["Splash during flushing", "Injection during flushing"], "controls": ["Flush with water at low pressure; ground gun to pail", "Gloves and eye protection"], "osha_refs": "Mfr. instructions", "em385_refs": "", "prob": "O", "sev": "M" }
]$spray$::jsonb
where slug = 'airless-spray';

update public.aha_library
set equipment_rows = (
  select coalesce(jsonb_agg(patched order by ord), '[]'::jsonb)
  from (
    select
      ord,
      case
        when elem->>'equipment' = 'Hoses / guns / tips' and elem->>'inspection' = 'Extinguisher staged'
          then jsonb_set(elem, '{inspection}', '"Inspect hoses and fittings before use"')
        else elem
      end as patched
    from jsonb_array_elements(equipment_rows) with ordinality as rows(elem, ord)
    where elem->>'equipment' <> 'Fire extinguisher'
       or coalesce(elem->>'training', '') <> ''
       or coalesce(elem->>'inspection', '') <> ''
  ) kept
)
where slug = 'airless-spray';

-- Job AHAs that still have the unmodified library wording.
update public.project_ahas
set steps = (
  select coalesce(jsonb_agg(
    case
      when step->>'name' = 'Mix and box paint'
        and step->'hazards' = '["Skin and eye contact with coatings", "Solvent vapors"]'::jsonb
        then jsonb_set(
          jsonb_set(
            jsonb_set(step, '{hazards}', '["Skin and eye contact with coatings"]'::jsonb),
            '{controls}',
            '["Review SDS; nitrile gloves, safety glasses", "Wipe spills immediately"]'::jsonb
          ),
          '{osha_refs}',
          '"1910.1200"'
        )
      when step->>'name' = 'Clean tools and dispose waste'
        and step->'hazards' = '["Solvent vapors", "Rags self-heating"]'::jsonb
        then jsonb_set(
          jsonb_set(
            jsonb_set(step, '{hazards}', '["Skin contact with wash water", "Slips from spills"]'::jsonb),
            '{controls}',
            '["Wash tools with water in a contained area", "Dispose leftover paint and wash water per the SDS"]'::jsonb
          ),
          '{osha_refs}',
          '"1910.1200 · 1926.25"'
        )
      when step->>'name' = 'Control ignition sources'
        and step->'hazards' = '["Flammable vapor accumulation"]'::jsonb
        and step->'controls' = '["No hot work or open flame in area", "Extinguisher staged; bond/ground containers"]'::jsonb
        then jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(step, '{name}', '"Contain overspray"'),
              '{name_es}',
              '"Contener el exceso de rociado"'
            ),
            '{hazards}',
            '["Overspray on finishes, floors, and HVAC"]'::jsonb
          ),
          '{controls}',
          '["Mask and cover adjacent surfaces", "Cover returns and ventilate the work area"]'::jsonb
        ) || '{"osha_refs":"1926.57"}'::jsonb
      when step->>'name' = 'Flush pump and clean up'
        and step->'hazards' = '["Solvent splash", "Injection during flushing"]'::jsonb
        then jsonb_set(
          jsonb_set(
            jsonb_set(step, '{hazards}', '["Splash during flushing", "Injection during flushing"]'::jsonb),
            '{controls}',
            '["Flush with water at low pressure; ground gun to pail", "Gloves and eye protection"]'::jsonb
          ),
          '{osha_refs}',
          '"Mfr. instructions"'
        )
      else step
    end
    order by ord
  ), '[]'::jsonb)
  from jsonb_array_elements(steps) with ordinality as rows(step, ord)
)
where steps::text ilike '%solvent%'
   or steps::text ilike '%Flammable vapor%';

update public.project_ahas
set equipment_rows = (
  select coalesce(jsonb_agg(patched order by ord), '[]'::jsonb)
  from (
    select
      ord,
      case
        when elem->>'equipment' = 'Hoses / guns / tips' and elem->>'inspection' = 'Extinguisher staged'
          then jsonb_set(elem, '{inspection}', '"Inspect hoses and fittings before use"')
        else elem
      end as patched
    from jsonb_array_elements(equipment_rows) with ordinality as rows(elem, ord)
    where not (
      elem->>'equipment' = 'Fire extinguisher'
      and coalesce(elem->>'training', '') = ''
      and coalesce(elem->>'inspection', '') = ''
    )
  ) kept
)
where equipment_rows::text ilike '%Fire extinguisher%'
   or equipment_rows::text ilike '%Extinguisher staged%';
