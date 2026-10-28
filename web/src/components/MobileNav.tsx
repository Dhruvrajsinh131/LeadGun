"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "./Icon";

const items = [
  { href: "/", label: "Home", icon: "space_dashboard" },
  { href: "/ai", label: "AI", icon: "auto_awesome" },
  { href: "/explorer", label: "Explore", icon: "travel_explore" },
  { href: "/saved", label: "Saved", icon: "bookmarks" },
  { href: "/replies", label: "Replies", icon: "forum" },
  { href: "/settings", label: "Setup", icon: "settings" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-3 bottom-3 z-50 flex items-center justify-between gap-1 rounded-[1.75rem] border border-outline-variant/70 bg-surface-container-high/90 px-2 py-2 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.95)] backdrop-blur-2xl lg:hidden">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[1.15rem] px-1 py-2 transition ${
              active ? "bg-primary/15 text-primary" : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <Icon name={item.icon} size={21} filled={active} />
            <span className="max-w-full truncate text-[8px] font-extrabold uppercase tracking-[0.04em]">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
