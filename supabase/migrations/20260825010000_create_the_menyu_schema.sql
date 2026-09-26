begin;

create table public.events (
  id text primary key,
  name text not null,
  event_time text,
  prelims_start_time text,
  location text not null default 'Tokyo, Japan',
  time_zone text not null default 'Asia/Tokyo',
  judge_names text[] not null default '{}',
  next_registration_number integer not null default 1 check (next_registration_number > 0),
  lifecycle_status text not null default 'active' check (lifecycle_status in ('active', 'archived')),
  archived_at timestamptz,
  archived_by_name text,
  archived_by_role text,
  revision bigint not null default 0 check (revision >= 0),
  domain_snapshot jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check ((lifecycle_status = 'active' and archived_at is null) or lifecycle_status = 'archived')
);

create table public.staff (
  id text primary key,
  display_name text not null,
  name_key text not null unique,
  created_at timestamptz not null
);

create table public.event_staff (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  staff_id text not null references public.staff(id),
  role text not null,
  signed_in_at timestamptz not null,
  last_active_at timestamptz not null,
  unique (event_id, id),
  unique (event_id, staff_id, role)
);

create table public.people (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  name text not null,
  name_key text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (event_id, id),
  unique (event_id, name_key)
);

create table public.registrations (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  display_code text not null,
  division text not null check (division in ('2v2', 'under15')),
  registration_source text not null check (registration_source in ('early', 'same_day')),
  source_number text not null default '',
  team_name text not null default '',
  member_names text not null default '',
  entry_name text not null default '',
  dob text not null default '',
  parent_name text not null default '',
  genre text not null default '',
  region text not null default '',
  email text not null default '',
  phone text not null default '',
  instagram_team text not null default '',
  instagram_members text[] not null default '{}',
  status text not null check (status in ('Registered', 'Partial', 'Checked in', 'Canceled')),
  needs_review boolean not null default false,
  review_reasons text[] not null default '{}',
  notes text not null default '',
  duplicate_of text[] not null default '{}',
  duplicate_ignored boolean not null default false,
  payment_summary jsonb not null default '{}',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  unique (event_id, id)
);

create unique index registrations_active_display_code_unique
  on public.registrations(event_id, display_code)
  where deleted_at is null;

create table public.registration_members (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  registration_id text not null,
  person_id text,
  member_position smallint not null check (member_position between 1 and 2),
  name text not null default '',
  instagram text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  unique (event_id, id),
  unique (event_id, registration_id, member_position),
  foreign key (event_id, registration_id) references public.registrations(event_id, id),
  foreign key (event_id, person_id) references public.people(event_id, id)
);

create table public.audit_log (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  actor_event_staff_id text,
  staff_name text not null,
  staff_role text not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  details jsonb not null default '{}',
  reversal_of_audit_id text,
  created_at timestamptz not null,
  unique (event_id, id),
  foreign key (event_id, actor_event_staff_id) references public.event_staff(event_id, id),
  foreign key (event_id, reversal_of_audit_id) references public.audit_log(event_id, id) deferrable initially deferred
);

create table public.check_ins (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  registration_member_id text not null,
  checked_in_at timestamptz not null,
  actor_event_staff_id text,
  reversed_at timestamptz,
  reversed_by_audit_id text,
  metadata jsonb not null default '{}',
  unique (event_id, id),
  foreign key (event_id, registration_member_id) references public.registration_members(event_id, id),
  foreign key (event_id, actor_event_staff_id) references public.event_staff(event_id, id),
  foreign key (event_id, reversed_by_audit_id) references public.audit_log(event_id, id)
);

create unique index check_ins_one_active_per_member
  on public.check_ins(event_id, registration_member_id)
  where reversed_at is null;

create table public.charges (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  charge_type text not null check (charge_type in ('entry', 'drink', 'spectator_entry', 'spectator_drink')),
  amount_yen integer not null check (amount_yen >= 0),
  registration_id text,
  registration_member_id text,
  person_id text,
  charge_subject_key text not null,
  charged_at timestamptz not null,
  reversed_at timestamptz,
  reversed_by_audit_id text,
  metadata jsonb not null default '{}',
  unique (event_id, id),
  foreign key (event_id, registration_id) references public.registrations(event_id, id),
  foreign key (event_id, registration_member_id) references public.registration_members(event_id, id),
  foreign key (event_id, person_id) references public.people(event_id, id),
  foreign key (event_id, reversed_by_audit_id) references public.audit_log(event_id, id),
  check ((charge_type in ('entry', 'drink') and registration_member_id is not null) or charge_type in ('spectator_entry', 'spectator_drink'))
);

create unique index charges_one_active_entry_per_member
  on public.charges(event_id, registration_member_id)
  where charge_type = 'entry' and reversed_at is null;

create unique index charges_one_active_drink_per_person
  on public.charges(event_id, charge_subject_key)
  where charge_type = 'drink' and reversed_at is null;

create table public.prelim_scores (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  registration_id text not null,
  judge_number smallint not null check (judge_number in (1, 2)),
  judge_name text not null default '',
  score smallint not null check (score between 1 and 5),
  entered_by_event_staff_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (event_id, id),
  unique (event_id, registration_id, judge_number),
  foreign key (event_id, registration_id) references public.registrations(event_id, id),
  foreign key (event_id, entered_by_event_staff_id) references public.event_staff(event_id, id)
);

create table public.rankings (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  registration_id text not null,
  division text not null check (division in ('2v2', 'under15')),
  prelim_order integer check (prelim_order is null or prelim_order > 0),
  rank integer check (rank is null or rank > 0),
  average_score numeric(3, 2) check (average_score is null or average_score between 1 and 5),
  tie_break_position integer check (tie_break_position is null or tie_break_position > 0),
  override_rank integer check (override_rank is null or override_rank > 0),
  override_reason text,
  override_at timestamptz,
  override_staff_name text,
  updated_at timestamptz not null,
  unique (event_id, id),
  unique (event_id, division, registration_id),
  foreign key (event_id, registration_id) references public.registrations(event_id, id)
);

create table public.brackets (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  division text not null check (division in ('2v2', 'under15')),
  source text not null check (source in ('prelim_seeded', 'seeded_direct')),
  participant_ids text[] not null default '{}',
  format jsonb not null default '{}',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  retired_at timestamptz,
  unique (event_id, id)
);

create unique index brackets_one_active_per_division
  on public.brackets(event_id, division)
  where retired_at is null;

create table public.matches (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  bracket_id text not null,
  round_index integer not null check (round_index >= 0),
  round_name text not null,
  match_number integer not null check (match_number > 0),
  side_a_registration_id text,
  side_b_registration_id text,
  winner_registration_id text,
  decision_method text,
  judge_votes jsonb not null default '[]',
  required_performance_rounds integer not null check (required_performance_rounds > 0),
  performance_rounds_completed integer not null check (performance_rounds_completed >= 0),
  tie_break_count integer not null default 0 check (tie_break_count >= 0),
  tie_break_active boolean not null default false,
  completed_at timestamptz,
  updated_at timestamptz not null,
  retired_at timestamptz,
  unique (event_id, id),
  unique (event_id, bracket_id, round_index, match_number),
  foreign key (event_id, bracket_id) references public.brackets(event_id, id),
  foreign key (event_id, side_a_registration_id) references public.registrations(event_id, id),
  foreign key (event_id, side_b_registration_id) references public.registrations(event_id, id),
  foreign key (event_id, winner_registration_id) references public.registrations(event_id, id)
);

create table public.match_rounds (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  match_id text not null,
  phase text not null check (phase in ('regulation', 'tie_break')),
  round_number integer not null check (round_number > 0),
  completed_at timestamptz not null,
  reversed_at timestamptz,
  metadata jsonb not null default '{}',
  unique (event_id, id),
  foreign key (event_id, match_id) references public.matches(event_id, id)
);

create table public.timers (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  scope text not null check (scope in ('prelims', 'bracket')),
  division text not null check (division in ('2v2', 'under15')),
  version bigint not null default 0 check (version >= 0),
  duration_seconds integer not null check (duration_seconds between 1 and 600),
  remaining_seconds integer not null check (remaining_seconds between 0 and 600),
  status text not null check (status in ('idle', 'running', 'paused')),
  started_at timestamptz,
  updated_at timestamptz not null,
  unique (event_id, id),
  unique (event_id, scope, division)
);

create table public.backups (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  kind text not null check (kind in ('manual', 'pre_restore')),
  reason text not null default '',
  source_revision bigint not null check (source_revision >= 0),
  event_name text not null,
  created_by_name text not null,
  created_by_role text not null,
  event_digest text not null check (event_digest ~ '^[a-f0-9]{64}$'),
  payload jsonb not null,
  created_at timestamptz not null,
  unique (event_id, id)
);

create table public.exports (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  kind text not null check (kind in ('combined', 'registrations', 'rankings', 'bracket', 'staff')),
  format text not null check (format in ('csv', 'pdf')),
  language text not null check (language in ('en', 'ja')),
  filename text not null,
  content_base64 text not null,
  content_digest text not null check (content_digest ~ '^[a-f0-9]{64}$'),
  created_by_name text not null,
  created_by_role text not null,
  created_at timestamptz not null,
  unique (event_id, id)
);

create or replace function public.commit_event_aggregate(
  p_event_id text,
  p_expected_revision bigint,
  p_create boolean,
  p_event jsonb,
  p_projection jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current_revision bigint;
  v_event public.events%rowtype;
  v_updated_at timestamptz;
begin
  select * into v_event from jsonb_populate_record(null::public.events, p_projection -> 'events' -> 0);
  if v_event.id is distinct from p_event_id or v_event.domain_snapshot is distinct from p_event then
    raise exception using errcode = '22023', message = 'Event projection does not match its aggregate';
  end if;
  if v_event.revision <> p_expected_revision + 1 then
    raise exception using errcode = '22023', message = 'Event revision must increase by exactly one';
  end if;
  v_updated_at := v_event.updated_at;

  if p_create then
    if exists (select 1 from public.events where id = p_event_id) then
      select revision into v_current_revision from public.events where id = p_event_id;
      raise exception using errcode = '40001', message = 'REVISION_CONFLICT:' || v_current_revision;
    end if;
    insert into public.events select v_event.*;
  else
    select revision into v_current_revision from public.events where id = p_event_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'Event not found'; end if;
    if v_current_revision <> p_expected_revision then
      raise exception using errcode = '40001', message = 'REVISION_CONFLICT:' || v_current_revision;
    end if;
    update public.events set
      name = v_event.name, event_time = v_event.event_time, prelims_start_time = v_event.prelims_start_time,
      location = v_event.location, time_zone = v_event.time_zone, judge_names = v_event.judge_names,
      next_registration_number = v_event.next_registration_number, lifecycle_status = v_event.lifecycle_status,
      archived_at = v_event.archived_at, archived_by_name = v_event.archived_by_name, archived_by_role = v_event.archived_by_role,
      revision = v_event.revision, domain_snapshot = p_event, updated_at = v_event.updated_at
    where id = p_event_id;
  end if;

  insert into public.staff
    select * from jsonb_populate_recordset(null::public.staff, coalesce(p_projection -> 'staff', '[]'::jsonb))
  on conflict (id) do update set display_name = excluded.display_name, name_key = excluded.name_key;

  insert into public.event_staff
    select * from jsonb_populate_recordset(null::public.event_staff, coalesce(p_projection -> 'event_staff', '[]'::jsonb))
  on conflict (id) do update set role = excluded.role, signed_in_at = least(public.event_staff.signed_in_at, excluded.signed_in_at), last_active_at = greatest(public.event_staff.last_active_at, excluded.last_active_at);

  insert into public.people
    select * from jsonb_populate_recordset(null::public.people, coalesce(p_projection -> 'people', '[]'::jsonb))
  on conflict (id) do update set name = excluded.name, name_key = excluded.name_key, updated_at = excluded.updated_at;

  update public.registration_members set deleted_at = v_updated_at
    where event_id = p_event_id and deleted_at is null
      and not exists (select 1 from jsonb_array_elements(coalesce(p_projection -> 'registration_members', '[]'::jsonb)) item where item ->> 'id' = public.registration_members.id);
  update public.registrations set deleted_at = v_updated_at
    where event_id = p_event_id and deleted_at is null
      and not exists (select 1 from jsonb_array_elements(coalesce(p_projection -> 'registrations', '[]'::jsonb)) item where item ->> 'id' = public.registrations.id);

  insert into public.registrations
    select * from jsonb_populate_recordset(null::public.registrations, coalesce(p_projection -> 'registrations', '[]'::jsonb))
  on conflict (id) do update set
    display_code = excluded.display_code, division = excluded.division, registration_source = excluded.registration_source,
    source_number = excluded.source_number, team_name = excluded.team_name, member_names = excluded.member_names, entry_name = excluded.entry_name,
    dob = excluded.dob, parent_name = excluded.parent_name, genre = excluded.genre, region = excluded.region, email = excluded.email, phone = excluded.phone,
    instagram_team = excluded.instagram_team, instagram_members = excluded.instagram_members, status = excluded.status,
    needs_review = excluded.needs_review, review_reasons = excluded.review_reasons, notes = excluded.notes,
    duplicate_of = excluded.duplicate_of, duplicate_ignored = excluded.duplicate_ignored, payment_summary = excluded.payment_summary,
    updated_at = excluded.updated_at, deleted_at = null;

  insert into public.registration_members
    select * from jsonb_populate_recordset(null::public.registration_members, coalesce(p_projection -> 'registration_members', '[]'::jsonb))
  on conflict (id) do update set person_id = excluded.person_id, member_position = excluded.member_position, name = excluded.name, instagram = excluded.instagram, updated_at = excluded.updated_at, deleted_at = null;

  insert into public.audit_log
    select * from jsonb_populate_recordset(null::public.audit_log, coalesce(p_projection -> 'audit_log', '[]'::jsonb))
  on conflict (id) do nothing;

  update public.check_ins set reversed_at = v_updated_at,
    reversed_by_audit_id = (select id from public.audit_log where event_id = p_event_id and action in ('undo_check_in', 'cancel_registration', 'restore_event_backup') order by created_at desc limit 1)
    where event_id = p_event_id and reversed_at is null
      and not exists (select 1 from jsonb_array_elements(coalesce(p_projection -> 'check_ins', '[]'::jsonb)) item where item ->> 'id' = public.check_ins.id);
  insert into public.check_ins
    select * from jsonb_populate_recordset(null::public.check_ins, coalesce(p_projection -> 'check_ins', '[]'::jsonb))
  on conflict (id) do update set checked_in_at = excluded.checked_in_at, actor_event_staff_id = excluded.actor_event_staff_id, reversed_at = null, reversed_by_audit_id = null, metadata = excluded.metadata;

  update public.charges set reversed_at = v_updated_at,
    reversed_by_audit_id = (select id from public.audit_log where event_id = p_event_id and action in ('undo_check_in', 'cancel_registration', 'restore_event_backup') order by created_at desc limit 1)
    where event_id = p_event_id and reversed_at is null
      and not exists (select 1 from jsonb_array_elements(coalesce(p_projection -> 'charges', '[]'::jsonb)) item where item ->> 'id' = public.charges.id);
  insert into public.charges
    select * from jsonb_populate_recordset(null::public.charges, coalesce(p_projection -> 'charges', '[]'::jsonb))
  on conflict (id) do update set amount_yen = excluded.amount_yen, registration_id = excluded.registration_id, registration_member_id = excluded.registration_member_id, person_id = excluded.person_id, charge_subject_key = excluded.charge_subject_key, charged_at = excluded.charged_at, reversed_at = null, reversed_by_audit_id = null, metadata = excluded.metadata;

  delete from public.prelim_scores where event_id = p_event_id;
  insert into public.prelim_scores select * from jsonb_populate_recordset(null::public.prelim_scores, coalesce(p_projection -> 'prelim_scores', '[]'::jsonb));
  delete from public.rankings where event_id = p_event_id;
  insert into public.rankings select * from jsonb_populate_recordset(null::public.rankings, coalesce(p_projection -> 'rankings', '[]'::jsonb));

  update public.brackets set retired_at = v_updated_at
    where event_id = p_event_id and retired_at is null
      and not exists (select 1 from jsonb_array_elements(coalesce(p_projection -> 'brackets', '[]'::jsonb)) item where item ->> 'id' = public.brackets.id);
  insert into public.brackets
    select * from jsonb_populate_recordset(null::public.brackets, coalesce(p_projection -> 'brackets', '[]'::jsonb))
  on conflict (id) do update set participant_ids = excluded.participant_ids, format = excluded.format, updated_at = excluded.updated_at, retired_at = null;

  update public.matches set retired_at = v_updated_at
    where event_id = p_event_id and retired_at is null
      and not exists (select 1 from jsonb_array_elements(coalesce(p_projection -> 'matches', '[]'::jsonb)) item where item ->> 'id' = public.matches.id);
  insert into public.matches
    select * from jsonb_populate_recordset(null::public.matches, coalesce(p_projection -> 'matches', '[]'::jsonb))
  on conflict (id) do update set side_a_registration_id = excluded.side_a_registration_id, side_b_registration_id = excluded.side_b_registration_id,
    winner_registration_id = excluded.winner_registration_id, decision_method = excluded.decision_method, judge_votes = excluded.judge_votes,
    required_performance_rounds = excluded.required_performance_rounds, performance_rounds_completed = excluded.performance_rounds_completed,
    tie_break_count = excluded.tie_break_count, tie_break_active = excluded.tie_break_active, completed_at = excluded.completed_at, updated_at = excluded.updated_at, retired_at = null;

  update public.match_rounds set reversed_at = v_updated_at
    where event_id = p_event_id and reversed_at is null
      and not exists (select 1 from jsonb_array_elements(coalesce(p_projection -> 'match_rounds', '[]'::jsonb)) item where item ->> 'id' = public.match_rounds.id);
  insert into public.match_rounds
    select * from jsonb_populate_recordset(null::public.match_rounds, coalesce(p_projection -> 'match_rounds', '[]'::jsonb))
  on conflict (id) do update set reversed_at = null, metadata = excluded.metadata;

  insert into public.timers
    select * from jsonb_populate_recordset(null::public.timers, coalesce(p_projection -> 'timers', '[]'::jsonb))
  on conflict (id) do update set version = excluded.version, duration_seconds = excluded.duration_seconds, remaining_seconds = excluded.remaining_seconds, status = excluded.status, started_at = excluded.started_at, updated_at = excluded.updated_at;

  return v_event.revision;
end;
$$;

create or replace function public.delete_event_aggregate(p_event_id text, p_expected_revision bigint)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare v_current_revision bigint;
begin
  select revision into v_current_revision from public.events where id = p_event_id for update;
  if not found then return false; end if;
  if v_current_revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'REVISION_CONFLICT:' || v_current_revision;
  end if;
  delete from public.events where id = p_event_id;
  return true;
end;
$$;

alter table public.events enable row level security;
alter table public.staff enable row level security;
alter table public.event_staff enable row level security;
alter table public.people enable row level security;
alter table public.registrations enable row level security;
alter table public.registration_members enable row level security;
alter table public.check_ins enable row level security;
alter table public.charges enable row level security;
alter table public.prelim_scores enable row level security;
alter table public.rankings enable row level security;
alter table public.brackets enable row level security;
alter table public.matches enable row level security;
alter table public.match_rounds enable row level security;
alter table public.timers enable row level security;
alter table public.audit_log enable row level security;
alter table public.backups enable row level security;
alter table public.exports enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke execute on function public.commit_event_aggregate(text, bigint, boolean, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.delete_event_aggregate(text, bigint) from public, anon, authenticated;
grant execute on function public.commit_event_aggregate(text, bigint, boolean, jsonb, jsonb) to service_role;
grant execute on function public.delete_event_aggregate(text, bigint) to service_role;

commit;
