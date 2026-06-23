-- Public RPC wrappers (Supabase client calls public schema by default)

create or replace function public.manpower_login(p_pin text) returns jsonb
language sql security invoker set search_path = public, manpower_api
as $$ select manpower_api.login(p_pin); $$;

create or replace function public.manpower_logout(p_token uuid) returns boolean
language sql security invoker set search_path = public, manpower_api
as $$ select manpower_api.logout(p_token); $$;

create or replace function public.manpower_session_info(p_token uuid) returns jsonb
language sql security invoker set search_path = public, manpower_api
as $$ select manpower_api.session_info(p_token); $$;

create or replace function public.manpower_get_state(p_token uuid, p_week_id uuid default null) returns jsonb
language sql security invoker set search_path = public, manpower_api
as $$ select manpower_api.get_state(p_token, p_week_id); $$;

create or replace function public.manpower_set_assignment(p_token uuid, p_week_id uuid, p_employee_id uuid, p_day_key text, p_value text) returns boolean
language sql security invoker set search_path = public, manpower_api
as $$ select manpower_api.set_assignment(p_token, p_week_id, p_employee_id, p_day_key, p_value); $$;

create or replace function public.manpower_add_job(p_token uuid, p_week_id uuid, p_name text, p_supervisor_label text default null, p_project_id uuid default null, p_row_color text default '#ffffff') returns uuid
language sql security invoker set search_path = public, manpower_api
as $$ select manpower_api.add_job(p_token, p_week_id, p_name, p_supervisor_label, p_project_id, p_row_color); $$;

create or replace function public.manpower_import_projects(p_token uuid, p_week_id uuid) returns int
language sql security invoker set search_path = public, manpower_api
as $$ select manpower_api.import_projects(p_token, p_week_id); $$;

create or replace function public.manpower_set_hours_budget(p_token uuid, p_job_name text, p_budgeted_hours numeric) returns boolean
language sql security invoker set search_path = public, manpower_api
as $$ select manpower_api.set_hours_budget(p_token, p_job_name, p_budgeted_hours); $$;

create or replace function public.manpower_log_week_hours(p_token uuid, p_job_name text, p_week_label text, p_hours numeric) returns boolean
language sql security invoker set search_path = public, manpower_api
as $$ select manpower_api.log_week_hours(p_token, p_job_name, p_week_label, p_hours); $$;

create or replace function public.manpower_admin_list_supers(p_token uuid) returns jsonb
language sql security invoker set search_path = public, manpower_api
as $$ select manpower_api.admin_list_supers(p_token); $$;

create or replace function public.manpower_admin_upsert_super(p_token uuid, p_name text, p_pin text, p_supervisor_label text default null, p_is_admin boolean default false, p_super_id uuid default null) returns uuid
language sql security invoker set search_path = public, manpower_api
as $$ select manpower_api.admin_upsert_super(p_token, p_name, p_pin, p_supervisor_label, p_is_admin, p_super_id); $$;

create or replace function public.manpower_admin_set_super_active(p_token uuid, p_super_id uuid, p_active boolean) returns boolean
language sql security invoker set search_path = public, manpower_api
as $$ select manpower_api.admin_set_super_active(p_token, p_super_id, p_active); $$;

create or replace function public.manpower_admin_list_employees(p_token uuid) returns jsonb
language sql security invoker set search_path = public, manpower_api
as $$ select manpower_api.admin_list_employees(p_token); $$;

create or replace function public.manpower_admin_upsert_employee(p_token uuid, p_name text, p_role text default 'normal', p_sort_order int default 0, p_employee_id uuid default null) returns uuid
language sql security invoker set search_path = public, manpower_api
as $$ select manpower_api.admin_upsert_employee(p_token, p_name, p_role, p_sort_order, p_employee_id); $$;

create or replace function public.manpower_admin_set_employee_active(p_token uuid, p_employee_id uuid, p_active boolean) returns boolean
language sql security invoker set search_path = public, manpower_api
as $$ select manpower_api.admin_set_employee_active(p_token, p_employee_id, p_active); $$;

grant execute on all functions in schema public to anon, authenticated;
