import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Ban,
  BarChart3,
  Columns3,
  FileText,
  FlaskConical,

  Inbox,
  LayoutDashboard,
  Mail,
  MessageCircle,
  Radar,
  Search,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
  Contact,
} from "lucide-react";
import type { ScreenKey } from "@/lib/auth/roles";

export type NavItem = {
  screen: ScreenKey;
  label: string;
  href: string;
  icon: LucideIcon;
  /** SRS 9.1 build step that delivers the screen. */
  step: number;
};

export type NavGroup = { label: string; items: NavItem[] };

/** Sidebar structure from SRS section 4. */
export const NAV: NavGroup[] = [
  { label: "Overview", items: [{ screen: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, step: 9 }] },
  {
    label: "Lead engine",
    items: [
      { screen: "new-search", label: "New Search", href: "/searches/new", icon: Search, step: 2 },
      { screen: "live-progress", label: "Live Progress", href: "/searches", icon: Radar, step: 2 },
      { screen: "leads", label: "Leads", href: "/leads", icon: Contact, step: 2 },
    ],
  },
  {
    label: "Outreach",
    items: [
      { screen: "email-campaigns", label: "Email Campaigns", href: "/campaigns/email", icon: Mail, step: 5 },
      { screen: "whatsapp-campaigns", label: "WhatsApp Campaigns", href: "/campaigns/whatsapp", icon: MessageCircle, step: 6 },
      { screen: "templates", label: "Templates", href: "/templates", icon: FileText, step: 5 },
      { screen: "inbox", label: "Inbox", href: "/inbox", icon: Inbox, step: 7 },
    ],
  },
  {
    label: "Growth",
    items: [
      { screen: "pipeline", label: "Pipeline", href: "/pipeline", icon: Columns3, step: 8 },
      { screen: "results", label: "Results", href: "/results", icon: BarChart3, step: 8 },
      { screen: "ab-tests", label: "A/B Tests", href: "/ab-tests", icon: FlaskConical, step: 8 },
    ],
  },
  {
    label: "Compliance",
    items: [
      { screen: "do-not-contact", label: "Do-Not-Contact", href: "/do-not-contact", icon: Ban, step: 4 },
      { screen: "consent-log", label: "Consent Log", href: "/consent-log", icon: ShieldCheck, step: 4 },
    ],
  },
  {
    label: "Admin",
    items: [
      { screen: "costs", label: "Costs", href: "/costs", icon: Wallet, step: 1 },
      { screen: "users", label: "Users", href: "/users", icon: Users, step: 1 },
      { screen: "settings", label: "Settings", href: "/settings", icon: Settings, step: 1 },
      { screen: "system-health", label: "System Health", href: "/system-health", icon: Activity, step: 9 },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV.flatMap((g) => g.items);
