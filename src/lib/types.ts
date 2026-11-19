export type Page =
  | "Overview"
  | "Jobs"
  | "Customers"
  | "Vehicles"
  | "Appointments"
  | "Inventory"
  | "Invoices"
  | "Reports"
  | "Team";

export type Role =
  | "owner"
  | "manager"
  | "mechanic"
  | "receptionist"
  | "accountant";

export type JobStatus =
  | "received"
  | "diagnosing"
  | "awaiting_approval"
  | "in_progress"
  | "awaiting_parts"
  | "completed"
  | "collected";

export interface Profile {
  id: string;
  workshop_id: string;
  full_name: string;
  role: Role;
  workshop?: { name: string } | null;
}

export interface Customer {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  is_archived: boolean;
  created_at: string;
}

export interface Vehicle {
  id: string;
  customer_id: string;
  registration_number: string;
  make: string;
  model: string;
  manufacturing_year: number | null;
  mileage: number | null;
  engine_type: string | null;
  photo_path: string | null;
  customer?: Pick<Customer, "full_name"> | null;
}

export interface JobCard {
  id: string;
  job_number: string;
  customer_id: string;
  vehicle_id: string;
  assigned_mechanic_id: string | null;
  reported_problem: string;
  inspection_notes: string | null;
  diagnosis: string | null;
  status: JobStatus;
  date_received: string;
  estimated_completion_date: string | null;
  actual_completion_date: string | null;
  customer?: Pick<Customer, "full_name" | "phone"> | null;
  vehicle?: Pick<Vehicle, "registration_number" | "make" | "model"> | null;
  mechanic?: Pick<Profile, "full_name"> | null;
}

export interface SparePart {
  id: string;
  name: string;
  sku: string;
  quantity_on_hand: number;
  minimum_stock: number;
  purchase_price: number;
  selling_price: number;
  supplier_id: string | null;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  job_card_id: string | null;
  customer_id: string;
  amount_total: number;
  amount_paid: number;
  status: "unpaid" | "partially_paid" | "paid";
  due_date: string | null;
  created_at: string;
  customer?: Pick<Customer, "full_name"> | null;
  job?: Pick<JobCard, "job_number"> | null;
}

export interface Payment {
  id: string;
  amount: number;
  method: "cash" | "bank_transfer" | "mpesa";
  reference: string | null;
  paid_at: string;
  invoice?: {
    invoice_number: string;
    customer?: Pick<Customer, "full_name"> | null;
  } | null;
}

export interface Appointment {
  id: string;
  customer_id: string;
  vehicle_id: string | null;
  scheduled_at: string;
  reason: string;
  status: "scheduled" | "completed" | "cancelled";
  customer?: Pick<Customer, "full_name"> | null;
  vehicle?: Pick<Vehicle, "registration_number"> | null;
}

export interface GarageData {
  staff: Pick<Profile, "id" | "full_name" | "role">[];
  customers: Customer[];
  vehicles: Vehicle[];
  jobs: JobCard[];
  parts: SparePart[];
  invoices: Invoice[];
  payments: Payment[];
  appointments: Appointment[];
}
