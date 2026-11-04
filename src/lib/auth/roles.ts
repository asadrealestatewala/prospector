/** Roles and screen access from SRS section 2. Shared by the server guards and the sidebar. */
export const ROLES = ["admin", "manager", "lead_expert", "sales_agent"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  lead_expert: "Lead expert",
  sales_agent: "Sales agent",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Owns the system, sets budgets, keys and users",
  manager: "Reviews results and approves campaigns",
  lead_expert: "Runs searches and builds lists",
  sales_agent: "Answers replies and books demos",
};

export type ScreenKey =
  | "dashboard"
  | "new-search"
  | "live-progress"
  | "leads"
  | "lead-detail"
  | "email-campaigns"
  | "whatsapp-campaigns"
  | "templates"
  | "inbox"
  | "pipeline"
  | "results"
  | "ab-tests"
  | "do-not-contact"
  | "consent-log"
  | "costs"
  | "users"
  | "settings"
  | "system-health";

const ALL: Role[] = ["admin", "manager", "lead_expert", "sales_agent"];

export const SCREEN_ACCESS: Record<ScreenKey, Role[]> = {
  dashboard: ["admin", "manager"],
  "new-search": ["admin", "lead_expert"],
  "live-progress": ["admin", "lead_expert"],
  leads: ["admin", "manager", "lead_expert"],
  "lead-detail": ALL,
  "email-campaigns": ["admin", "manager"],
  "whatsapp-campaigns": ["admin", "manager"],
  templates: ["admin", "manager"],
  inbox: ["admin", "manager", "sales_agent"],
  pipeline: ["admin", "manager", "sales_agent"],
  results: ["admin", "manager"],
  "ab-tests": ["admin", "manager"],
  "do-not-contact": ["admin"],
  "consent-log": ["admin"],
  costs: ["admin"],
  users: ["admin"],
  settings: ["admin"],
  "system-health": ["admin"],
};

/** Each role lands on its own home screen after login (SRS screen 1). */
export const ROLE_HOME: Record<Role, string> = {
  admin: "/dashboard",
  manager: "/dashboard",
  lead_expert: "/searches/new",
  sales_agent: "/inbox",
};

export function canAccess(role: Role | null | undefined, screen: ScreenKey): boolean {
  return Boolean(role && SCREEN_ACCESS[screen].includes(role));
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
