import type { LucideIcon } from "lucide-react";
import type { PermissionAction } from "@/server/permissions";
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
  /**
   * Permissão que a página exige (a mesma de `requirePagePermission`). A
   * entrada só aparece a quem a tem — antes era "só admin" ou "todos", e o
   * Visualizador via "Leads" para depois ser recusado.
   */
  permission?: PermissionAction;
}

export const NAV_ITEMS: NavItem[] = [
  // A página inicial é a grelha de pastas (/folders). Os alertas e as
  // contagens por estado que viviam no antigo dashboard estão em /analytics.
  { href: "/folders", label: "Início", icon: Home },
  { href: "/apps", label: "Aplicações", icon: Gamepad2 },
  { href: "/workspaces", label: "Espaços de trabalho", icon: Building2, permission: "workspace:manage" },
  { href: "/leads", label: "Leads", icon: ClipboardList, permission: "leads:view" },
  { href: "/analytics", label: "Estatísticas", icon: BarChart3, permission: "stats:view" },
  { href: "/users", label: "Utilizadores", icon: Users, permission: "user:manage" },
  { href: "/brand", label: "Identidade visual", icon: Palette, permission: "brand:manage" },
  { href: "/settings", label: "Configurações", icon: Settings, permission: "audit:view" },
];
