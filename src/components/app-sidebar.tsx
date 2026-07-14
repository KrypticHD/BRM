"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Landmark,
  Layers,
  TrendingUp,
  ArrowLeftRight,
  Coins,
  Target,
  FileText,
  Eye,
  Settings,
} from "lucide-react";
import { BrmLogo } from "@/components/brm-logo";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/(app)/actions";

const NAV_ITEMS = [
  { label: "Overview", icon: Home, href: "/" },
  { label: "Portfolio", icon: Landmark, href: null },
  { label: "Holdings", icon: Layers, href: null },
  { label: "Performance", icon: TrendingUp, href: null },
  { label: "Transactions", icon: ArrowLeftRight, href: null },
  { label: "Dividends", icon: Coins, href: null },
  { label: "Goals", icon: Target, href: null },
  { label: "Reports", icon: FileText, href: null },
  { label: "Watchlist", icon: Eye, href: null },
  { label: "Settings", icon: Settings, href: "/settings" },
];

export function AppSidebar({ email }: { email: string }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-6">
      <div className="flex items-center gap-2 px-2 text-primary">
        <BrmLogo className="h-6 w-6" />
        <span className="text-lg font-semibold tracking-tight">BRM</span>
      </div>

      <nav className="mt-8 flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map(({ label, icon: Icon, href }) => {
          const active = href !== null && pathname === href;
          const content = (
            <span
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                  : href
                    ? "text-sidebar-foreground hover:bg-sidebar-accent"
                    : "text-sidebar-foreground/50"
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              {label}
            </span>
          );

          if (!href) {
            return (
              <div key={label} className="cursor-default select-none">
                {content}
              </div>
            );
          }

          return (
            <Link key={label} href={href}>
              {content}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3 border-t border-sidebar-border pt-4">
        <div className="flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
            {email.charAt(0).toUpperCase()}
          </div>
          <span className="truncate text-xs text-sidebar-foreground/70">{email}</span>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="secondary" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    </aside>
  );
}
