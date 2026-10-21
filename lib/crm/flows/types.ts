import type { DueSpec } from "../due";
import type { FlowItem } from "../../flows/item";
import type { SizeBand, SupplyChannel, VisitWindow } from "../intel";
import type { OutcomeCode } from "../outcomes";
import type {
  BusinessType, ContactRole, LeadSource, LostReason, NextKind, NotFitReason, PriceTier, SkipReason, Verification,
} from "../vocab";

export type StepKind =
  | "choice" | "multi" | "input" | "roles" | "basics" | "link" | "pin" | "hours" | "stars" | "driver" | "date"
  | "amount"   // numeric entry, prefilled from ctx.vars[step.input.field]
  | "pick"     // searchable list from step.choices
  | "stepper"; // one +/- row per ctx.items entry

/** Everything an answer can contribute. Merged left to right; a later answer wins. */
export interface FlowSet {
  outcome?: OutcomeCode;
  verification?: Verification;
  contact_id?: number;
  contact_role?: ContactRole;
  decider_role?: ContactRole;
  next_kind?: NextKind;
  next_title?: string;
  due?: DueSpec;
  next_assignee?: "owner" | "group_manager" | "driver_pool";
  lost_reason?: LostReason;
  not_fit?: NotFitReason;
  skip_reason?: SkipReason;
  invalid?: boolean;
  source?: LeadSource;
  business_type?: BusinessType;
  price_tier?: PriceTier;
  owner?: "me" | "pool" | number;
  referred_by?: number;
  pin_mode?: "gps" | "map";
  product_id?: number;
  sample_qty?: string;
  share?: "whatsapp" | "telegram";
  redial?: boolean;
  open_order?: boolean;
  spawn_lead?: boolean;
  handoff?: "talked_now";
  size_band?: SizeBand;
  supply_channel?: SupplyChannel;
  visit_window?: VisitWindow;
  /** Driver-visit flows only: the visit produced a partial-interest handoff to sales. */
  handoff_sales?: boolean;
  /** Driver-visit flows only: the lead location's 1-5 stars for the three criteria. */
  stars?: { potential?: number; volume?: number; ease?: number };
}

export interface FlowProgress { acc: FlowSet; values: Record<string, string> }
export type NextFn = (ctx: FlowContext, s: FlowProgress) => string;
type Dyn<T> = T | ((ctx: FlowContext, s: FlowProgress) => T);

export interface FlowOption {
  id: string;
  label: string;
  sub?: string;
  tone?: "rec" | "bad";
  group?: string;
  next?: string | NextFn;
  save?: boolean;
  set?: FlowSet;
  /** Plain strings written into `state.values` when this option is tapped (non-CRM flows). */
  put?: Record<string, string>;
  url?: string;
}

export interface FlowInput {
  field: string;
  placeholder: string;
  ltr?: boolean;
  optional?: boolean;
  /** `amount` steps: allow a decimal point (a count in kilograms). Whole numbers by default. */
  decimal?: boolean;
  /** `amount` steps: 0 is a valid answer. */
  allowZero?: boolean;
  /** `amount` steps: the unit printed under the number. Defaults to تومان; a step whose unit
   *  varies per item reads `ctx.vars["<field>_unit"]` instead. */
  unit?: string;
}

export interface FlowStep {
  id: string;
  kind: StepKind;
  q: string;
  sub?: Dyn<string>;
  options: Dyn<FlowOption[]>;
  /** multi steps: the toggles; the answer value is their ids joined by ",". */
  choices?: Dyn<{ id: string; label: string }[]>;
  input?: FlowInput;
  timeStep?: boolean;
  skipable?: boolean;
}

export interface FlowConfig {
  id: string;
  start: (ctx: FlowContext) => string;
  steps: Record<string, FlowStep>;
  skipStep?: string;
  budget: { common: number; longest: number };
}

export interface FlowContext {
  entry:
    | "call" | "talked_now" | "add_lead" | "driver_visit"
    | "delivery" | "payment" | "complaint" | "outcome" | "order_quick" | "order_action"
    | "stock_count" | "receive" | "lifecycle" | "visit_plan" | "place" | "expense";
  firstContact: boolean;
  attemptNo: number;
  maxMisses: number;
  isManager: boolean;
  vars: Record<string, string>;
  knownContacts: { id: number; name: string | null; role: ContactRole }[];
  products: { id: number; name: string; price_toman: number | null }[];
  reps: { id: number; name: string; open: number }[];
  recentCustomers: { id: number; name: string }[];
  /** Lines a non-CRM flow asks about (delivery lines, products). Optional so CRM contexts are unchanged. */
  items?: FlowItem[];
  /** Named lists a non-CRM flow chooses from (expense categories, recent suppliers). Optional so CRM contexts are unchanged. */
  lists?: Record<string, { id: number; label: string }[]>;
}

export const EMPTY_CONTEXT: FlowContext = {
  entry: "call", firstContact: false, attemptNo: 1, maxMisses: 5, isManager: false,
  vars: {}, knownContacts: [], products: [], reps: [], recentCustomers: [],
};

export interface FlowAnswer { step: string; option: string; value?: string }
export interface FlowState { stack: string[]; answers: FlowAnswer[]; acc: FlowSet; values: Record<string, string>; saved: boolean }

export interface ResolvedOption { id: string; label: string; sub?: string; tone?: "rec" | "bad"; group?: string; due?: DueSpec; saves: boolean; url?: string }
export interface ResolvedStep {
  id: string; kind: StepKind; q: string; sub?: string; options: ResolvedOption[];
  choices: { id: string; label: string }[]; input?: FlowInput; timeStep: boolean; skipable: boolean;
}
