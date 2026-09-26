begin;

-- The project keeps the Data API private. Only the backend-only service role
-- may read or mutate the relational projection and recovery/export records.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select, update on all sequences in schema public to service_role;

-- Preserve the same boundary for event-owned tables added by later migrations.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select, update on sequences to service_role;

commit;
