import type { LucideIcon } from "lucide-react";
import { getDisplayCurrency } from "@/lib/display-currency";
import {
  CalendarDays, CalendarHeart, CircleCheck, Crown, FileText, Globe, History, Image, LayoutDashboard, Mail, Megaphone,
  MessageCircle, BookOpen, Receipt, ReceiptEuro, ReceiptPoundSterling, ReceiptText, Rocket, Search, Send, Settings, Smartphone, SquareKanban, TrendingUp, UserCog, UserPlus, Users, Workflow, Zap,
} from "lucide-react";

// Line icons used in place of emojis across the app shell (sidebar, settings link, tool tabs).
// Lead Factory keeps its animated image and AI Assistant keeps its own icon.
const icons: Record<string, LucideIcon> = {
  Overview: LayoutDashboard,
  Settings,
  Clients: Users,
  CRM: SquareKanban,
  "CRM Automations": Zap,
  Automations: Zap,
  Conversations: MessageCircle,
  Invoicing: Receipt,
  Bookkeeping: BookOpen,
  Tasks: CircleCheck,
  Scheduling: CalendarDays,
  Content: CalendarHeart,
  Operations: Workflow,
  Onboarding: UserPlus,
  Team: UserCog,
  Chess: Crown,
  Activity: History,
  Integrations: Rocket,
  Sites: Globe,
  "Media Library": Image,
  SEO: Search,
  "Google Ads": Megaphone,
  "Meta Ads": Smartphone,
  "Email Marketing": Mail,
  "Cold Outreach": Send,
  "Proposal Studio": FileText,
  "Report Studio": TrendingUp,
};

export function NavIcon({ name, fallback, size = 17 }: { name: string; fallback?: string; size?: number }) {
  // Invoicing shows a receipt with the sub-account's own currency sign.
  const currency = name === "Invoicing" ? getDisplayCurrency() : "";
  const Icon = currency === "EUR" ? ReceiptEuro : currency === "GBP" ? ReceiptPoundSterling : currency === "USD" ? Receipt : currency ? ReceiptText : icons[name];
  if (!Icon) return <>{fallback}</>;
  return <Icon className="lucide-nav-icon" size={size} strokeWidth={1.9} aria-hidden="true" />;
}
