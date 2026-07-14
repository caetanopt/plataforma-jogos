import {
  LayoutDashboard,
  Gamepad2,
  FolderKanban,
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
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/apps", label: "Aplicações", icon: Gamepad2 },
  { href: "/folders", label: "Pastas", icon: FolderKanban },
  { href: "/workspaces", label: "Espaços de trabalho", icon: Building2, adminOnly: true },
  { href: "/leads", label: "Leads", icon: ClipboardList },
  { href: "/analytics", label: "Estatísticas", icon: BarChart3 },
  { href: "/users", label: "Utilizadores", icon: Users, adminOnly: true },
  { href: "/brand", label: "Identidade visual", icon: Palette, adminOnly: true },
  { href: "/settings", label: "Configurações", icon: Settings, adminOnly: true },
];
