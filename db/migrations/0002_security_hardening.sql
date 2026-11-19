CREATE UNIQUE INDEX invoices_one_per_job
  ON public.invoices (workshop_id, job_card_id)
  WHERE job_card_id IS NOT NULL;

REVOKE UPDATE, DELETE ON public.profiles FROM garageos_app;
REVOKE UPDATE ON public.workshops FROM garageos_app;
GRANT UPDATE (name) ON public.workshops TO garageos_app;
REVOKE UPDATE ON public.staff_invites FROM garageos_app;
GRANT UPDATE (accepted_at) ON public.staff_invites TO garageos_app;
REVOKE UPDATE, DELETE ON public.activity_logs FROM garageos_app;

DROP POLICY profiles_update ON public.profiles;
DROP POLICY profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT WITH CHECK (
    id = app.current_user_id()
    AND lower(email) = lower(app.current_user_email())
    AND (
      (role = 'owner' AND EXISTS (
        SELECT 1 FROM public.workshops w
        WHERE w.id = profiles.workshop_id AND w.owner_id = app.current_user_id()
      ))
      OR EXISTS (
        SELECT 1 FROM public.staff_invites i
        WHERE i.workshop_id = profiles.workshop_id
          AND i.role = profiles.role
          AND lower(i.email) = lower(app.current_user_email())
          AND i.token_hash = current_setting('garageos.invite_token_hash', true)
          AND i.accepted_at IS NULL AND i.expires_at > now()
      )
    )
  );

DROP POLICY staff_invites_insert ON public.staff_invites;
CREATE POLICY staff_invites_insert ON public.staff_invites
  FOR INSERT WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND invited_by = app.current_profile_id()
    AND (
      app.has_role(ARRAY['owner'])
      OR (app.has_role(ARRAY['manager']) AND role <> 'manager')
    )
  );

CREATE FUNCTION app.guard_invite_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.accepted_at IS NOT NULL OR NEW.accepted_at IS NULL
     OR OLD.expires_at <= now() THEN
    RAISE EXCEPTION 'Invitation cannot be accepted' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER staff_invites_accept_once
  BEFORE UPDATE ON public.staff_invites
  FOR EACH ROW EXECUTE FUNCTION app.guard_invite_acceptance();

DROP POLICY job_part_usage_select ON public.job_part_usage;
CREATE POLICY job_part_usage_select ON public.job_part_usage
  FOR SELECT USING (
    workshop_id = app.current_workshop_id()
    AND (
      app.has_role(ARRAY['owner', 'manager', 'receptionist', 'accountant'])
      OR EXISTS (
        SELECT 1 FROM public.job_cards j
        WHERE j.id = job_part_usage.job_card_id
          AND j.workshop_id = job_part_usage.workshop_id
          AND j.assigned_mechanic_id = app.current_profile_id()
      )
    )
  );

DROP POLICY job_part_usage_insert ON public.job_part_usage;
CREATE POLICY job_part_usage_insert ON public.job_part_usage
  FOR INSERT WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND created_by = app.current_profile_id()
    AND (
      app.has_role(ARRAY['owner', 'manager'])
      OR (app.has_role(ARRAY['mechanic']) AND EXISTS (
        SELECT 1 FROM public.job_cards j
        WHERE j.id = job_part_usage.job_card_id
          AND j.workshop_id = job_part_usage.workshop_id
          AND j.assigned_mechanic_id = app.current_profile_id()
          AND j.status NOT IN ('completed', 'collected')
      ))
    )
  );
