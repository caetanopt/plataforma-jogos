import {
  LayoutDashboard,
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
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  // A página inicial é a grelha de pastas (/folders); o dashboard de métricas
  // passou a ser um destino secundário, junto às estatísticas.
  { href: "/folders", label: "Início", icon: Home },
  { href: "/apps", label: "Aplicações", icon: Gamepad2 },
  { href: "/workspaces", label: "Espaços de trabalho", icon: Building2, adminOnly: true },
  { href: "/leads", label: "Leads", icon: ClipboardList },
  { href: "/analytics", label: "Estatísticas", icon: BarChart3 },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/users", label: "Utilizadores", icon: Users, adminOnly: true },
  { href: "/brand", label: "Identidade visual", icon: Palette, adminOnly: true },
  { href: "/settings", label: "Configurações", icon: Settings, adminOnly: true },
];
