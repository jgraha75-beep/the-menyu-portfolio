begin;

create table public.financial_transactions (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  category text not null check (category in ('registration_income', 'spectator_income', 'merchandise_income', 'drink_income', 'venue_expense', 'staff_payout', 'other_cost', 'refund', 'adjustment')),
  description text not null,
  expected_amount bigint not null check (abs(expected_amount) <= 1000000000),
  actual_amount bigint not null check (abs(actual_amount) <= 1000000000),
  party text not null default '',
  occurred_at timestamptz not null,
  source text not null check (source in ('manual', 'cost_import', 'correction')),
  source_id text,
  correction_of text,
  correction_reason text,
  created_by_name text not null,
  created_by_role text not null,
  created_at timestamptz not null,
  unique (event_id, id),
  check (category = 'adjustment' or (expected_amount >= 0 and actual_amount >= 0)),
  check ((source = 'correction' and correction_of is not null and length(trim(correction_reason)) >= 3) or source <> 'correction')
);

create index financial_transactions_event_date
  on public.financial_transactions(event_id, occurred_at, id);

alter table public.financial_transactions enable row level security;
revoke all on public.financial_transactions from anon, authenticated;

alter function public.commit_event_aggregate(text, bigint, boolean, jsonb, jsonb)
  rename to commit_event_aggregate_v2;

create function public.commit_event_aggregate(
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
  v_revision bigint;
begin
  v_revision := public.commit_event_aggregate_v2(
    p_event_id,
    p_expected_revision,
    p_create,
    p_event,
    p_projection
  );

  -- Older application versions do not emit this projection. Keep the table
  -- untouched during a rolling deploy until a finance-aware writer arrives.
  if p_projection ? 'financial_transactions' then
    delete from public.financial_transactions where event_id = p_event_id;
    insert into public.financial_transactions
      select * from jsonb_populate_recordset(null::public.financial_transactions, coalesce(p_projection -> 'financial_transactions', '[]'::jsonb));
  end if;

  return v_revision;
end;
$$;

revoke execute on function public.commit_event_aggregate_v2(text, bigint, boolean, jsonb, jsonb)
  from public, anon, authenticated;
revoke execute on function public.commit_event_aggregate(text, bigint, boolean, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_event_aggregate_v2(text, bigint, boolean, jsonb, jsonb)
  to service_role;
grant execute on function public.commit_event_aggregate(text, bigint, boolean, jsonb, jsonb)
  to service_role;

commit;
