-- Company AHA templates and per-job Activity Hazard Analyses.

create table if not exists public.aha_library (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  scope text not null check (scope in ('paint', 'wallcovering', 'access')),
  csi text not null default '',
  equipment text[] not null default '{}',
  training text[] not null default '{}',
  inspection text[] not null default '{}',
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_ahas (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  library_id uuid references public.aha_library(id) on delete set null,
  seq integer not null,
  name text not null default '',
  scope text not null check (scope in ('paint', 'wallcovering', 'access')),
  csi text not null default '',
  status text not null default 'draft' check (status in ('draft', 'submitted', 'accepted')),
  competent_person text not null default '',
  equipment text[] not null default '{}',
  training text[] not null default '{}',
  inspection text[] not null default '{}',
  steps jsonb not null default '[]'::jsonb,
  options jsonb not null default '{"spanish":false,"matrix":true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, seq)
);

create index if not exists project_ahas_library_id_idx on public.project_ahas (library_id);
create index if not exists project_ahas_updated_at_idx on public.project_ahas (updated_at desc);
create index if not exists aha_library_updated_at_idx on public.aha_library (updated_at desc);

drop trigger if exists aha_library_updated_at on public.aha_library;
create trigger aha_library_updated_at
  before update on public.aha_library
  for each row execute function public.set_updated_at();

drop trigger if exists project_ahas_updated_at on public.project_ahas;
create trigger project_ahas_updated_at
  before update on public.project_ahas
  for each row execute function public.set_updated_at();

alter table public.aha_library enable row level security;
alter table public.project_ahas enable row level security;

drop policy if exists "aha_library_select" on public.aha_library;
create policy "aha_library_select" on public.aha_library
  for select to authenticated
  using (public.is_approved_user());

drop policy if exists "aha_library_insert" on public.aha_library;
create policy "aha_library_insert" on public.aha_library
  for insert to authenticated
  with check (public.is_approved_user());

drop policy if exists "aha_library_update" on public.aha_library;
create policy "aha_library_update" on public.aha_library
  for update to authenticated
  using (public.is_approved_user());

drop policy if exists "aha_library_delete" on public.aha_library;
create policy "aha_library_delete" on public.aha_library
  for delete to authenticated
  using (public.is_approved_user());

drop policy if exists "project_ahas_select" on public.project_ahas;
create policy "project_ahas_select" on public.project_ahas
  for select to authenticated
  using (public.is_approved_user());

drop policy if exists "project_ahas_insert" on public.project_ahas;
create policy "project_ahas_insert" on public.project_ahas
  for insert to authenticated
  with check (public.is_approved_user());

drop policy if exists "project_ahas_update" on public.project_ahas;
create policy "project_ahas_update" on public.project_ahas
  for update to authenticated
  using (public.is_approved_user());

drop policy if exists "project_ahas_delete" on public.project_ahas;
create policy "project_ahas_delete" on public.project_ahas
  for delete to authenticated
  using (public.is_approved_user());

-- Seed from supabase/seed/aha_library_seed.json. Upsert on slug so re-running is safe.
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
    "slug": "surface-prep",
    "name": "Surface prep & patching",
    "scope": "paint",
    "csi": "09 91 23",
    "equipment": ["HEPA vacuum sander", "Drop cloths", "Step ladder"],
    "training": ["Silica awareness", "HazCom / SDS"],
    "inspection": ["Daily ladder check", "HEPA filter check"],
    "steps": [
      { "name": "Mobilize and stage materials", "name_es": "Movilizar y preparar materiales", "hazards": ["Strains from lifting buckets and boxes", "Trips in staging area"], "controls": ["Two-person lift over 50 lb", "Keep aisles clear; stage on carts"], "osha_refs": "1926.25", "em385_refs": "", "prob": "O", "sev": "M" },
      { "name": "Mask and protect finishes", "name_es": "Enmascarar y proteger acabados", "hazards": ["Cuts from utility knives", "Slips on plastic sheeting"], "controls": ["Retractable blades, cut-resistant gloves", "Tape down sheeting edges"], "osha_refs": "1926.95", "em385_refs": "", "prob": "O", "sev": "M" },
      { "name": "Patch and sand drywall", "name_es": "Parchar y lijar tablaroca", "hazards": ["Respirable dust from joint compound", "Eye irritation"], "controls": ["HEPA vacuum sanders or wet sanding", "N95 minimum, safety glasses"], "osha_refs": "1926.1153 · 1926.102", "em385_refs": "", "prob": "L", "sev": "M" },
      { "name": "Clean up and dispose", "name_es": "Limpiar y desechar", "hazards": ["Dust re-entrainment"], "controls": ["HEPA vac only, no dry sweeping", "Bag and remove debris daily"], "osha_refs": "1926.25", "em385_refs": "", "prob": "S", "sev": "N" }
    ]
  },
  {
    "slug": "brush-roll",
    "name": "Interior brush & roll",
    "scope": "paint",
    "csi": "09 91 23",
    "equipment": ["Step & extension ladders", "Rolling scaffold", "Brushes / rollers / poles"],
    "training": ["Ladder safety", "Scaffold user", "HazCom / SDS"],
    "inspection": ["Daily ladder check", "Scaffold inspected by competent person"],
    "steps": [
      { "name": "Mix and box paint", "name_es": "Mezclar la pintura", "hazards": ["Skin and eye contact with coatings", "Solvent vapors"], "controls": ["Review SDS; nitrile gloves, safety glasses", "Mix in a ventilated area"], "osha_refs": "1910.1200 · 1926.55", "em385_refs": "", "prob": "O", "sev": "M" },
      { "name": "Work from ladders", "name_es": "Trabajo desde escaleras", "hazards": ["Falls from ladder", "Overreaching"], "controls": ["Inspect before use; 3 points of contact", "No standing on top step; move the ladder instead of reaching"], "osha_refs": "1926.1053", "em385_refs": "", "prob": "O", "sev": "R" },
      { "name": "Work from rolling scaffold", "name_es": "Trabajo desde andamio rodante", "hazards": ["Falls from platform", "Tip-over or rolling"], "controls": ["Lock casters; guardrails as required", "No riding while moved; competent-person inspection"], "osha_refs": "1926.451 · 1926.452(w)", "em385_refs": "", "prob": "S", "sev": "R" },
      { "name": "Clean tools and dispose waste", "name_es": "Limpiar herramientas y desechar residuos", "hazards": ["Solvent vapors", "Rags self-heating"], "controls": ["Clean in a ventilated area", "Oily/solvent rags in closed metal can"], "osha_refs": "1926.152", "em385_refs": "", "prob": "S", "sev": "M" }
    ]
  },
  {
    "slug": "airless-spray",
    "name": "Airless spray application",
    "scope": "paint",
    "csi": "09 91 23",
    "equipment": ["Airless sprayer", "Hoses / guns / tips", "Respirators", "Fire extinguisher"],
    "training": ["Respirator fit test", "Sprayer operation", "HazCom / SDS"],
    "inspection": ["Hose & tip guard check", "Extinguisher staged"],
    "steps": [
      { "name": "Set up pump and hoses", "name_es": "Instalar bomba y mangueras", "hazards": ["High-pressure injection injury", "Trips on hoses"], "controls": ["Tip guard on; relieve pressure before servicing", "Route hoses out of walkways"], "osha_refs": "Mfr. instructions", "em385_refs": "", "prob": "O", "sev": "R" },
      { "name": "Spray walls and ceilings", "name_es": "Rociar paredes y techos", "hazards": ["Overspray inhalation", "Eye exposure"], "controls": ["Respirator per written program, fit-tested", "Mask off area; ventilate"], "osha_refs": "1910.134 · 1926.57", "em385_refs": "", "prob": "L", "sev": "M" },
      { "name": "Control ignition sources", "name_es": "Controlar fuentes de ignición", "hazards": ["Flammable vapor accumulation"], "controls": ["No hot work or open flame in area", "Extinguisher staged; bond/ground containers"], "osha_refs": "1926.150 · 1926.152", "em385_refs": "", "prob": "S", "sev": "C" },
      { "name": "Flush pump and clean up", "name_es": "Purgar bomba y limpiar", "hazards": ["Solvent splash", "Injection during flushing"], "controls": ["Flush at low pressure; ground gun to pail", "Gloves and eye protection"], "osha_refs": "1926.152", "em385_refs": "", "prob": "O", "sev": "M" }
    ]
  },
  {
    "slug": "wallcovering-install",
    "name": "Wallcovering installation",
    "scope": "wallcovering",
    "csi": "09 72 00",
    "equipment": ["Paste table / pasting machine", "Ladders or rolling scaffold", "Snap-off blades, straightedge"],
    "training": ["Ladder safety", "Safe lifting", "HazCom / SDS"],
    "inspection": ["Daily ladder check", "Blade disposal container on site"],
    "steps": [
      { "name": "Receive and stage rolls", "name_es": "Recibir y almacenar rollos", "hazards": ["Back strain from heavy bolts"], "controls": ["Two-person lift; use carts or dollies", "Store flat and off the floor"], "osha_refs": "1926.250", "em385_refs": "", "prob": "O", "sev": "M" },
      { "name": "Prime and apply adhesive", "name_es": "Aplicar primario y adhesivo", "hazards": ["Skin irritation", "Slips on spilled paste"], "controls": ["Nitrile gloves", "Wipe spills immediately; drop cloth at paste table"], "osha_refs": "1910.1200", "em385_refs": "", "prob": "O", "sev": "M" },
      { "name": "Hang from ladders or scaffold", "name_es": "Colgar desde escalera o andamio", "hazards": ["Falls", "Overreaching with wet drops"], "controls": ["Right ladder height; 3 points of contact", "Two installers on tall drops"], "osha_refs": "1926.1053 · 1926.451", "em385_refs": "", "prob": "O", "sev": "R" },
      { "name": "Trim with razor and straightedge", "name_es": "Recortar con navaja y regla", "hazards": ["Lacerations"], "controls": ["Fresh blades; cut away from body", "Cut-resistant gloves; blade disposal container"], "osha_refs": "1926.95", "em385_refs": "", "prob": "L", "sev": "M" }
    ]
  },
  {
    "slug": "scissor-lift",
    "name": "Scissor lift work",
    "scope": "access",
    "csi": "01 54 00",
    "equipment": ["Scissor lift"],
    "training": ["Aerial lift operator", "Fall protection awareness"],
    "inspection": ["Pre-use lift inspection", "Floor load & openings check"],
    "steps": [
      { "name": "Pre-use inspection", "name_es": "Inspección antes de usar", "hazards": ["Equipment malfunction"], "controls": ["Daily inspection checklist", "Operator trained and authorized"], "osha_refs": "1926.453", "em385_refs": "", "prob": "S", "sev": "R" },
      { "name": "Travel and position lift", "name_es": "Mover y posicionar el elevador", "hazards": ["Tip-over or crush", "Floor openings"], "controls": ["Check floor load and openings", "Spotter in tight areas; travel lowered"], "osha_refs": "1926.453", "em385_refs": "", "prob": "S", "sev": "C" },
      { "name": "Work from platform", "name_es": "Trabajo desde la plataforma", "hazards": ["Falls from platform"], "controls": ["Gate closed; stay within guardrails", "No climbing rails; follow mfr. tie-off rule"], "osha_refs": "1926.453", "em385_refs": "", "prob": "S", "sev": "R" }
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
