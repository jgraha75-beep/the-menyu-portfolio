begin;

-- Preserve the original projection writer, then put an atomic conflict guard in
-- front of it. This keeps stale-device behavior aligned with JSON persistence:
-- report the current revision before validating the submitted next revision.
alter function public.commit_event_aggregate(text, bigint, boolean, jsonb, jsonb)
  rename to commit_event_aggregate_v1;

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
  v_current_revision bigint;
begin
  select revision
    into v_current_revision
    from public.events
    where id = p_event_id;

  if p_create then
    if found then
      raise exception using errcode = '40001', message = 'REVISION_CONFLICT:' || v_current_revision;
    end if;
  else
    if not found then
      raise exception using errcode = 'P0002', message = 'Event not found';
    end if;
    if v_current_revision <> p_expected_revision then
      raise exception using errcode = '40001', message = 'REVISION_CONFLICT:' || v_current_revision;
    end if;
  end if;

  return public.commit_event_aggregate_v1(
    p_event_id,
    p_expected_revision,
    p_create,
    p_event,
    p_projection
  );
end;
$$;

revoke execute on function public.commit_event_aggregate_v1(text, bigint, boolean, jsonb, jsonb)
  from public, anon, authenticated;
revoke execute on function public.commit_event_aggregate(text, bigint, boolean, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_event_aggregate_v1(text, bigint, boolean, jsonb, jsonb)
  to service_role;
grant execute on function public.commit_event_aggregate(text, bigint, boolean, jsonb, jsonb)
  to service_role;

commit;
