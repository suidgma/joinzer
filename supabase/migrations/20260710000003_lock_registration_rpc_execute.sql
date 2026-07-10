-- Security: these SECURITY DEFINER registration functions trust their parameters (no
-- internal auth.uid() check) and were EXECUTE-able by anon/authenticated via
-- /rest/v1/rpc/… — letting anyone register/pair into tournaments directly, bypassing the
-- server routes' organizer/self authorization. They are ONLY ever invoked from server
-- routes via the service role (each route authenticates + authorizes first), so revoke
-- the default PUBLIC execute and grant only service_role (postgres owner keeps it).
revoke execute on function public.register_doubles_pair(uuid, uuid, uuid, uuid, text) from public;
grant  execute on function public.register_doubles_pair(uuid, uuid, uuid, uuid, text) to service_role;

revoke execute on function public.pair_solo_registrations(uuid, uuid) from public;
grant  execute on function public.pair_solo_registrations(uuid, uuid) to service_role;

revoke execute on function public.self_register_doubles(uuid, uuid, uuid, text, text) from public;
grant  execute on function public.self_register_doubles(uuid, uuid, uuid, text, text) to service_role;
