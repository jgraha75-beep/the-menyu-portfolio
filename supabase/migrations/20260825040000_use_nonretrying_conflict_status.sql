begin;

-- PostgREST can retry SQLSTATE 40001 until its upstream timeout. Intentional
-- optimistic-concurrency conflicts use PT409 so callers receive an immediate,
-- stable conflict response. Any true race raised by the original writer is
-- caught and mapped to the same contract.
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
begin
  select revision
    into v_current_revision
    from public.events
    where id = p_event_id;

  if p_create then
    if found then
      raise exception using errcode = 'PT409', message = 'REVISION_CONFLICT:' || v_current_revision;
    end if;
  else
    if not found then
      raise exception using errcode = 'P0002', message = 'Event not found';
    end if;
    if v_current_revision <> p_expected_revision then
      raise exception using errcode = 'PT409', message = 'REVISION_CONFLICT:' || v_current_revision;
    end if;
  end if;

  begin
    return public.commit_event_aggregate_v1(
      p_event_id,
      p_expected_revision,
      p_create,
      p_event,
      p_projection
    );
  exception
    when serialization_failure then
      select revision
        into v_current_revision
        from public.events
        where id = p_event_id;
      raise exception using
        errcode = 'PT409',
        message = 'REVISION_CONFLICT:' || coalesce(v_current_revision, p_expected_revision);
  end;
end;
$$;

create or replace function public.delete_event_aggregate(
  p_event_id text,
  p_expected_revision bigint
)
returns boolean
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
    where id = p_event_id
    for update;
  if not found then
    return false;
  end if;
  if v_current_revision <> p_expected_revision then
    raise exception using errcode = 'PT409', message = 'REVISION_CONFLICT:' || v_current_revision;
  end if;
  delete from public.events where id = p_event_id;
  return true;
end;
$$;

revoke execute on function public.commit_event_aggregate(text, bigint, boolean, jsonb, jsonb)
  from public, anon, authenticated;
revoke execute on function public.delete_event_aggregate(text, bigint)
  from public, anon, authenticated;
grant execute on function public.commit_event_aggregate(text, bigint, boolean, jsonb, jsonb)
  to service_role;
grant execute on function public.delete_event_aggregate(text, bigint)
  to service_role;

commit;
