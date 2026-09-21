import type { LucideIcon } from "lucide-react";
import {
  Gamepad2,
  Home,
  Building2,
  Users,
  BarChart3,
  ClipboardList,
  Palette,
  Settings,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  // A página inicial é a grelha de pastas (/folders). Os alertas e as
  // contagens por estado que viviam no antigo dashboard estão em /analytics.
  { href: "/folders", label: "Início", icon: Home },
  { href: "/apps", label: "Aplicações", icon: Gamepad2 },
  { href: "/workspaces", label: "Espaços de trabalho", icon: Building2, adminOnly: true },
  { href: "/leads", label: "Leads", icon: ClipboardList },
  { href: "/analytics", label: "Estatísticas", icon: BarChart3 },
  { href: "/users", label: "Utilizadores", icon: Users, adminOnly: true },
  { href: "/brand", label: "Identidade visual", icon: Palette, adminOnly: true },
  { href: "/settings", label: "Configurações", icon: Settings, adminOnly: true },
];
