import type { LucideIcon } from "lucide-react";
import {
  CircleCheck, Compass, Crown, FileText, Globe, History, Image, LayoutDashboard, Mail, Megaphone,
  MessageCircle, Receipt, Rocket, Search, Send, Settings, Smartphone, SquareKanban, TrendingUp, UserCog, Users, Zap,
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
  Tasks: CircleCheck,
  Operations: Compass,
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
  const Icon = icons[name];
  if (!Icon) return <>{fallback}</>;
  return <Icon className="lucide-nav-icon" size={size} strokeWidth={1.9} aria-hidden="true" />;
}
