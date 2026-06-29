-- Seed scope materials + crew kit items for Job Scope Kit wizard
-- Run in Supabase SQL editor after 030_field_tools.sql

INSERT INTO public.field_tools_scope_materials (scope_id, name, unit, default_qty, sort_order)
SELECT s.id, m.name, m.unit, m.default_qty, m.sort_order
FROM public.field_tools_scope_library s
JOIN (VALUES
  ('Gyp Ceiling', '9" Roller Cover', 'ea', 4, 1),
  ('Gyp Ceiling', '18" Roller Cover', 'ea', 2, 2),
  ('Gyp Ceiling', 'Masking Film', 'roll', 1, 3),
  ('Gyp Ceiling', 'Painters Tape 2"', 'roll', 2, 4),
  ('Walls Interior', '9" Roller Cover', 'ea', 6, 1),
  ('Walls Interior', 'Cut Bucket', 'ea', 2, 2),
  ('Walls Interior', 'Sandpaper 120', 'sheet', 10, 3),
  ('Walls Interior', 'Caulk White', 'tube', 4, 4),
  ('Exterior', '9" Roller Cover', 'ea', 4, 1),
  ('Exterior', 'Extension Pole', 'ea', 2, 2),
  ('Exterior', 'Plastic 10x100', 'roll', 1, 3),
  ('Wallcovering', 'Smoother', 'ea', 2, 1),
  ('Wallcovering', 'Seam Roller', 'ea', 2, 2),
  ('Doors and Frames', '4" Foam Roller', 'ea', 4, 1),
  ('Doors and Frames', 'Foam Brush', 'ea', 4, 2),
  ('Epoxy Floor', 'Epoxy Roller', 'ea', 2, 1),
  ('Epoxy Floor', 'Spiked Shoes', 'pair', 2, 2),
  ('Stairwell', '9" Roller Cover', 'ea', 4, 1),
  ('Stairwell', 'Drop Cloth', 'ea', 4, 2)
) AS m(scope_name, name, unit, default_qty, sort_order)
  ON lower(trim(s.name)) = lower(trim(m.scope_name))
WHERE NOT EXISTS (SELECT 1 FROM public.field_tools_scope_materials LIMIT 1);

INSERT INTO public.field_tools_crew_kit_items (crew_kit_id, name, unit, qty_per_man, sort_order)
SELECT k.id, i.name, i.unit, i.qty_per_man, i.sort_order
FROM public.field_tools_crew_kits k
JOIN (VALUES
  ('One Man Setup', 'Cut Bucket', 'ea', 1, 1),
  ('One Man Setup', '9" Roller Frame', 'ea', 1, 2),
  ('One Man Setup', '2" Brush', 'ea', 1, 3),
  ('One Man Setup', '9" Roller Cover', 'ea', 2, 4),
  ('Sprayer Setup', 'Airless Tip', 'ea', 1, 1),
  ('Sprayer Setup', 'Spray Shield', 'ea', 1, 2),
  ('Sprayer Setup', 'Masking Plastic', 'roll', 1, 3),
  ('Sprayer Setup', 'Gloves', 'pair', 2, 4),
  ('Roller Setup', '18" Roller Frame', 'ea', 1, 1),
  ('Roller Setup', '18" Roller Cover', 'ea', 2, 2),
  ('Roller Setup', 'Extension Pole', 'ea', 1, 3),
  ('Roller Setup', 'Drop Cloth', 'ea', 2, 4)
) AS i(kit_name, name, unit, qty_per_man, sort_order)
  ON lower(trim(k.name)) = lower(trim(i.kit_name))
WHERE NOT EXISTS (SELECT 1 FROM public.field_tools_crew_kit_items LIMIT 1);
