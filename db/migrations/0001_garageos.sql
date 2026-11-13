CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE public.staff_role AS ENUM (
  'owner',
  'manager',
  'mechanic',
  'receptionist',
  'accountant'
);

CREATE TYPE public.job_status AS ENUM (
  'received',
  'diagnosing',
  'awaiting_approval',
  'in_progress',
  'awaiting_parts',
  'completed',
  'collected'
);

CREATE TYPE public.payment_method AS ENUM ('cash', 'bank_transfer', 'mpesa');

CREATE TABLE public.workshops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL UNIQUE REFERENCES neon_auth."user"(id) ON DELETE RESTRICT,
  name text NOT NULL DEFAULT 'My workshop'
    CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE RESTRICT,
  email text NOT NULL CHECK (length(email) <= 254),
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 120),
  role public.staff_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workshop_id, id)
);

CREATE TABLE public.mechanics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL,
  specialty text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workshop_id, profile_id),
  FOREIGN KEY (workshop_id, profile_id)
    REFERENCES public.profiles(workshop_id, id) ON DELETE CASCADE
);

CREATE TABLE public.staff_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (length(email) <= 254),
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 120),
  role public.staff_role NOT NULL CHECK (role <> 'owner'),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  invited_by uuid NOT NULL REFERENCES public.profiles(id),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX staff_invites_pending_email_unique
  ON public.staff_invites (workshop_id, lower(email))
  WHERE accepted_at IS NULL;

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 160),
  phone text NOT NULL CHECK (length(btrim(phone)) BETWEEN 3 AND 32),
  email text CHECK (email IS NULL OR length(email) <= 254),
  notes text CHECK (notes IS NULL OR length(notes) <= 4000),
  is_archived boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workshop_id, id),
  FOREIGN KEY (workshop_id, created_by)
    REFERENCES public.profiles(workshop_id, id)
);

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  registration_number text NOT NULL
    CHECK (length(btrim(registration_number)) BETWEEN 2 AND 20),
  make text NOT NULL CHECK (length(btrim(make)) BETWEEN 1 AND 80),
  model text NOT NULL CHECK (length(btrim(model)) BETWEEN 1 AND 100),
  manufacturing_year integer CHECK (manufacturing_year BETWEEN 1886 AND 2200),
  mileage integer CHECK (mileage IS NULL OR mileage >= 0),
  engine_type text CHECK (engine_type IS NULL OR length(engine_type) <= 80),
  photo_path text,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workshop_id, id),
  FOREIGN KEY (workshop_id, customer_id)
    REFERENCES public.customers(workshop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workshop_id, created_by)
    REFERENCES public.profiles(workshop_id, id)
);

CREATE UNIQUE INDEX vehicles_unique_registration_per_workshop
  ON public.vehicles (workshop_id, upper(registration_number));

CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  phone text,
  email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workshop_id, id)
);

CREATE TABLE public.spare_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  sku text NOT NULL CHECK (length(btrim(sku)) BETWEEN 1 AND 80),
  quantity_on_hand integer NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  minimum_stock integer NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
  purchase_price numeric(12, 2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  selling_price numeric(12, 2) NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  supplier_id uuid,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workshop_id, id),
  UNIQUE (workshop_id, sku),
  FOREIGN KEY (workshop_id, supplier_id)
    REFERENCES public.suppliers(workshop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workshop_id, created_by)
    REFERENCES public.profiles(workshop_id, id)
);

CREATE TABLE public.job_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  job_number text NOT NULL DEFAULT (
    'JOB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  customer_id uuid NOT NULL,
  vehicle_id uuid NOT NULL,
  assigned_mechanic_id uuid,
  reported_problem text NOT NULL
    CHECK (length(btrim(reported_problem)) BETWEEN 1 AND 4000),
  inspection_notes text,
  diagnosis text,
  recommended_repairs text,
  status public.job_status NOT NULL DEFAULT 'received',
  labour_charge numeric(12, 2) NOT NULL DEFAULT 0 CHECK (labour_charge >= 0),
  date_received date NOT NULL DEFAULT current_date,
  estimated_completion_date date,
  actual_completion_date date,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workshop_id, id),
  UNIQUE (workshop_id, job_number),
  FOREIGN KEY (workshop_id, customer_id)
    REFERENCES public.customers(workshop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workshop_id, vehicle_id)
    REFERENCES public.vehicles(workshop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workshop_id, assigned_mechanic_id)
    REFERENCES public.profiles(workshop_id, id),
  FOREIGN KEY (workshop_id, created_by)
    REFERENCES public.profiles(workshop_id, id)
);

CREATE INDEX job_cards_workshop_status_idx
  ON public.job_cards (workshop_id, status, date_received DESC);

CREATE TABLE public.job_card_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  job_card_id uuid NOT NULL,
  author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status public.job_status NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workshop_id, job_card_id)
    REFERENCES public.job_cards(workshop_id, id) ON DELETE CASCADE
);

CREATE TABLE public.job_part_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  job_card_id uuid NOT NULL,
  spare_part_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_cost numeric(12, 2) NOT NULL CHECK (unit_cost >= 0),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workshop_id, job_card_id)
    REFERENCES public.job_cards(workshop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workshop_id, spare_part_id)
    REFERENCES public.spare_parts(workshop_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  quotation_number text NOT NULL DEFAULT (
    'QUO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  job_card_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  subtotal numeric(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount numeric(12, 2) NOT NULL DEFAULT 0
    CHECK (discount >= 0 AND discount <= subtotal),
  total numeric(12, 2) GENERATED ALWAYS AS (subtotal - discount) STORED,
  expires_at date,
  approved_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workshop_id, id),
  UNIQUE (workshop_id, quotation_number),
  FOREIGN KEY (workshop_id, job_card_id)
    REFERENCES public.job_cards(workshop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workshop_id, customer_id)
    REFERENCES public.customers(workshop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workshop_id, created_by)
    REFERENCES public.profiles(workshop_id, id)
);

CREATE TABLE public.quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  quotation_id uuid NOT NULL,
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 500),
  quantity numeric(12, 2) NOT NULL CHECK (quantity > 0),
  unit_price numeric(12, 2) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(12, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workshop_id, quotation_id)
    REFERENCES public.quotations(workshop_id, id) ON DELETE CASCADE
);

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  invoice_number text NOT NULL DEFAULT (
    'INV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  job_card_id uuid,
  customer_id uuid NOT NULL,
  amount_total numeric(12, 2) NOT NULL CHECK (amount_total > 0),
  amount_paid numeric(12, 2) NOT NULL DEFAULT 0
    CHECK (amount_paid >= 0 AND amount_paid <= amount_total),
  status text NOT NULL DEFAULT 'unpaid'
    CHECK (status IN ('unpaid', 'partially_paid', 'paid')),
  due_date date,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workshop_id, id),
  UNIQUE (workshop_id, invoice_number),
  FOREIGN KEY (workshop_id, job_card_id)
    REFERENCES public.job_cards(workshop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workshop_id, customer_id)
    REFERENCES public.customers(workshop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workshop_id, created_by)
    REFERENCES public.profiles(workshop_id, id)
);

CREATE TABLE public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL,
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 500),
  quantity numeric(12, 2) NOT NULL CHECK (quantity > 0),
  unit_price numeric(12, 2) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(12, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workshop_id, invoice_id)
    REFERENCES public.invoices(workshop_id, id) ON DELETE CASCADE
);

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  method public.payment_method NOT NULL,
  reference text CHECK (reference IS NULL OR length(reference) <= 120),
  recorded_by uuid NOT NULL REFERENCES public.profiles(id),
  paid_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workshop_id, invoice_id)
    REFERENCES public.invoices(workshop_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  spare_part_id uuid NOT NULL,
  job_card_id uuid,
  transaction_type text NOT NULL
    CHECK (transaction_type IN ('opening_stock', 'receipt', 'adjustment', 'usage')),
  quantity_change integer NOT NULL CHECK (quantity_change <> 0),
  unit_cost numeric(12, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  note text,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workshop_id, spare_part_id)
    REFERENCES public.spare_parts(workshop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workshop_id, job_card_id)
    REFERENCES public.job_cards(workshop_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  vehicle_id uuid,
  scheduled_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workshop_id, customer_id)
    REFERENCES public.customers(workshop_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workshop_id, vehicle_id)
    REFERENCES public.vehicles(workshop_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_id uuid NOT NULL REFERENCES public.workshops(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  entity_type text NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 100),
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payments_workshop_paid_at_idx
  ON public.payments (workshop_id, paid_at DESC);
CREATE INDEX appointments_workshop_scheduled_at_idx
  ON public.appointments (workshop_id, scheduled_at);
CREATE INDEX activity_logs_workshop_created_at_idx
  ON public.activity_logs (workshop_id, created_at DESC);

CREATE SCHEMA IF NOT EXISTS app;

CREATE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('garageos.user_id', true), '')::uuid
$$;

CREATE FUNCTION app.current_user_email()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('garageos.user_email', true), '')
$$;

CREATE FUNCTION app.current_workshop_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('garageos.workshop_id', true), '')::uuid
$$;

CREATE FUNCTION app.current_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT p.id
  FROM public.profiles AS p
  WHERE p.id = app.current_user_id()
    AND p.workshop_id = app.current_workshop_id()
$$;

CREATE FUNCTION app.has_role(role_names text[])
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = app.current_user_id()
      AND p.workshop_id = app.current_workshop_id()
      AND p.role::text = ANY (role_names)
  )
$$;

ALTER TABLE public.workshops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workshops FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mechanics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mechanics FORCE ROW LEVEL SECURITY;
ALTER TABLE public.staff_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_invites FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.spare_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spare_parts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.job_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_cards FORCE ROW LEVEL SECURITY;
ALTER TABLE public.job_card_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_card_updates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.job_part_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_part_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY workshops_select ON public.workshops
  FOR SELECT USING (id = app.current_workshop_id() OR owner_id = app.current_user_id());
CREATE POLICY workshops_insert ON public.workshops
  FOR INSERT WITH CHECK (owner_id = app.current_user_id());
CREATE POLICY workshops_update ON public.workshops
  FOR UPDATE USING (id = app.current_workshop_id() AND app.has_role(ARRAY['owner']))
  WITH CHECK (id = app.current_workshop_id() AND app.has_role(ARRAY['owner']));

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT USING (id = app.current_user_id() OR workshop_id = app.current_workshop_id());
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT WITH CHECK (
    id = app.current_user_id()
    OR (workshop_id = app.current_workshop_id() AND app.has_role(ARRAY['owner', 'manager']))
  );
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE
  USING (
    id = app.current_user_id()
    OR (workshop_id = app.current_workshop_id() AND app.has_role(ARRAY['owner', 'manager']))
  )
  WITH CHECK (
    id = app.current_user_id()
    OR (workshop_id = app.current_workshop_id() AND app.has_role(ARRAY['owner', 'manager']))
  );

CREATE POLICY mechanics_select ON public.mechanics
  FOR SELECT USING (workshop_id = app.current_workshop_id());
CREATE POLICY mechanics_manage ON public.mechanics
  FOR ALL
  USING (workshop_id = app.current_workshop_id() AND app.has_role(ARRAY['owner', 'manager']))
  WITH CHECK (workshop_id = app.current_workshop_id() AND app.has_role(ARRAY['owner', 'manager']));

CREATE POLICY staff_invites_select ON public.staff_invites
  FOR SELECT USING (
    (workshop_id = app.current_workshop_id() AND app.has_role(ARRAY['owner', 'manager']))
    OR lower(email) = lower(app.current_user_email())
  );
CREATE POLICY staff_invites_insert ON public.staff_invites
  FOR INSERT WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager'])
  );
CREATE POLICY staff_invites_update ON public.staff_invites
  FOR UPDATE
  USING (
    (workshop_id = app.current_workshop_id() AND app.has_role(ARRAY['owner', 'manager']))
    OR lower(email) = lower(app.current_user_email())
  )
  WITH CHECK (
    (workshop_id = app.current_workshop_id() AND app.has_role(ARRAY['owner', 'manager']))
    OR lower(email) = lower(app.current_user_email())
  );
CREATE POLICY staff_invites_delete ON public.staff_invites
  FOR DELETE USING (
    workshop_id = app.current_workshop_id() AND app.has_role(ARRAY['owner', 'manager'])
  );

CREATE POLICY customers_select ON public.customers
  FOR SELECT USING (workshop_id = app.current_workshop_id());
CREATE POLICY customers_insert ON public.customers
  FOR INSERT WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'receptionist'])
  );
CREATE POLICY customers_update ON public.customers
  FOR UPDATE
  USING (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'receptionist'])
  )
  WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'receptionist'])
  );

CREATE POLICY vehicles_select ON public.vehicles
  FOR SELECT USING (workshop_id = app.current_workshop_id());
CREATE POLICY vehicles_insert ON public.vehicles
  FOR INSERT WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'receptionist'])
  );
CREATE POLICY vehicles_update ON public.vehicles
  FOR UPDATE
  USING (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'receptionist'])
  )
  WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'receptionist'])
  );

CREATE POLICY suppliers_select ON public.suppliers
  FOR SELECT USING (workshop_id = app.current_workshop_id());
CREATE POLICY suppliers_manage ON public.suppliers
  FOR ALL
  USING (workshop_id = app.current_workshop_id() AND app.has_role(ARRAY['owner', 'manager']))
  WITH CHECK (workshop_id = app.current_workshop_id() AND app.has_role(ARRAY['owner', 'manager']));

CREATE POLICY spare_parts_select ON public.spare_parts
  FOR SELECT USING (workshop_id = app.current_workshop_id());
CREATE POLICY spare_parts_insert ON public.spare_parts
  FOR INSERT WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager'])
  );
CREATE POLICY spare_parts_update ON public.spare_parts
  FOR UPDATE
  USING (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'mechanic'])
  )
  WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'mechanic'])
  );

CREATE POLICY job_cards_select ON public.job_cards
  FOR SELECT USING (
    workshop_id = app.current_workshop_id()
    AND (
      app.has_role(ARRAY['owner', 'manager', 'receptionist', 'accountant'])
      OR assigned_mechanic_id = app.current_profile_id()
    )
  );
CREATE POLICY job_cards_insert ON public.job_cards
  FOR INSERT WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'receptionist'])
  );
CREATE POLICY job_cards_update ON public.job_cards
  FOR UPDATE
  USING (
    workshop_id = app.current_workshop_id()
    AND (
      app.has_role(ARRAY['owner', 'manager', 'receptionist'])
      OR (app.has_role(ARRAY['mechanic']) AND assigned_mechanic_id = app.current_profile_id())
    )
  )
  WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND (
      app.has_role(ARRAY['owner', 'manager', 'receptionist'])
      OR (app.has_role(ARRAY['mechanic']) AND assigned_mechanic_id = app.current_profile_id())
    )
  );

CREATE POLICY job_card_updates_select ON public.job_card_updates
  FOR SELECT USING (
    workshop_id = app.current_workshop_id()
    AND (
      app.has_role(ARRAY['owner', 'manager', 'receptionist', 'accountant'])
      OR EXISTS (
        SELECT 1
        FROM public.job_cards AS j
        WHERE j.workshop_id = job_card_updates.workshop_id
          AND j.id = job_card_updates.job_card_id
          AND j.assigned_mechanic_id = app.current_profile_id()
      )
    )
  );
CREATE POLICY job_card_updates_insert ON public.job_card_updates
  FOR INSERT WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND author_id = app.current_profile_id()
  );

CREATE POLICY job_part_usage_select ON public.job_part_usage
  FOR SELECT USING (workshop_id = app.current_workshop_id());
CREATE POLICY job_part_usage_insert ON public.job_part_usage
  FOR INSERT WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND created_by = app.current_profile_id()
    AND app.has_role(ARRAY['owner', 'manager', 'mechanic'])
  );

CREATE POLICY quotations_select ON public.quotations
  FOR SELECT USING (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'receptionist', 'accountant'])
  );
CREATE POLICY quotations_manage ON public.quotations
  FOR ALL
  USING (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'receptionist'])
  )
  WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'receptionist'])
  );

CREATE POLICY quotation_items_select ON public.quotation_items
  FOR SELECT USING (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'receptionist', 'accountant'])
  );
CREATE POLICY quotation_items_manage ON public.quotation_items
  FOR ALL
  USING (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'receptionist'])
  )
  WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'receptionist'])
  );

CREATE POLICY invoices_select ON public.invoices
  FOR SELECT USING (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'accountant'])
  );
CREATE POLICY invoices_manage ON public.invoices
  FOR ALL
  USING (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'accountant'])
  )
  WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'accountant'])
  );

CREATE POLICY invoice_items_select ON public.invoice_items
  FOR SELECT USING (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'accountant'])
  );
CREATE POLICY invoice_items_manage ON public.invoice_items
  FOR ALL
  USING (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'accountant'])
  )
  WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'accountant'])
  );

CREATE POLICY payments_select ON public.payments
  FOR SELECT USING (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'accountant'])
  );
CREATE POLICY payments_insert ON public.payments
  FOR INSERT WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND recorded_by = app.current_profile_id()
    AND app.has_role(ARRAY['owner', 'manager', 'accountant'])
  );

CREATE POLICY inventory_transactions_select ON public.inventory_transactions
  FOR SELECT USING (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'mechanic'])
  );
CREATE POLICY inventory_transactions_insert ON public.inventory_transactions
  FOR INSERT WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND created_by = app.current_profile_id()
    AND app.has_role(ARRAY['owner', 'manager', 'mechanic'])
  );

CREATE POLICY appointments_select ON public.appointments
  FOR SELECT USING (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'receptionist'])
  );
CREATE POLICY appointments_insert ON public.appointments
  FOR INSERT WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'receptionist'])
  );
CREATE POLICY appointments_update ON public.appointments
  FOR UPDATE
  USING (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'receptionist'])
  )
  WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'receptionist'])
  );

CREATE POLICY activity_logs_select ON public.activity_logs
  FOR SELECT USING (
    workshop_id = app.current_workshop_id()
    AND app.has_role(ARRAY['owner', 'manager', 'accountant'])
  );
CREATE POLICY activity_logs_insert ON public.activity_logs
  FOR INSERT WITH CHECK (
    workshop_id = app.current_workshop_id()
    AND actor_id = app.current_profile_id()
  );

DO $$
DECLARE
  app_role record;
BEGIN
  SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls,
         rolcanlogin, rolinherit
    INTO app_role
    FROM pg_roles
   WHERE rolname = 'garageos_app';

  IF NOT FOUND THEN
    EXECUTE 'CREATE ROLE garageos_app NOLOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  ELSIF app_role.rolsuper
     OR app_role.rolcreatedb
     OR app_role.rolcreaterole
     OR app_role.rolreplication
     OR app_role.rolbypassrls
     OR app_role.rolcanlogin
     OR app_role.rolinherit THEN
    RAISE EXCEPTION 'Existing garageos_app role has unexpected privileges';
  END IF;

  EXECUTE format('GRANT garageos_app TO %I', current_user);
END $$;

GRANT USAGE ON SCHEMA public, app TO garageos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO garageos_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO garageos_app;
GRANT USAGE ON TYPE public.staff_role, public.job_status, public.payment_method TO garageos_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO garageos_app;

