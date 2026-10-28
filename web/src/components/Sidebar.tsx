"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "./Icon";
import { NEW_CHAT_EVENT, rememberActiveConversation } from "@/lib/chatSession";

const items = [
  { href: "/", label: "Overview", icon: "space_dashboard" },
  { href: "/ai", label: "AI Lead Finder", icon: "auto_awesome" },
  { href: "/explorer", label: "Lead Explorer", icon: "travel_explore" },
  { href: "/saved", label: "Saved Leads", icon: "bookmarks" },
  { href: "/replies", label: "Replies & Outreach", icon: "forum" },
  { href: "/activity", label: "Activity", icon: "monitoring" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Sidebar() {
  const pathname = usePathname();

  const startNewSearch = () => {
    rememberActiveConversation(null);
    if (pathname === "/ai") window.dispatchEvent(new Event(NEW_CHAT_EVENT));
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[276px] flex-col border-r border-outline-variant/60 bg-surface-container-lowest/80 px-4 py-5 backdrop-blur-2xl lg:flex">
      <Link href="/" className="group flex items-center gap-3 px-2">
        <span className="relative grid h-12 w-12 place-items-center overflow-hidden rounded-[1.25rem] bg-gradient-to-br from-[#d4c7ff] via-[#9d7cff] to-[#4c33ba] text-on-primary shadow-[0_16px_40px_-18px_rgba(157,124,255,0.9)]">
          <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_15%,rgba(255,255,255,0.65),transparent_45%)]" />
          <Icon name="gps_fixed" size={25} filled className="relative" />
        </span>
        <span>
          <span className="block font-display text-[17px] font-bold tracking-[-0.04em] text-on-surface">
            LeadGun
          </span>
          <span className="mt-0.5 block text-[10px] font-extrabold uppercase tracking-[0.24em] text-on-surface-variant/60">
            Signal engine
          </span>
        </span>
      </Link>

      <Link
        href="/ai"
        onClick={startNewSearch}
        className="mt-7 flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-extrabold text-on-primary shadow-[0_16px_45px_-20px_rgba(203,187,255,0.9)] transition hover:bg-primary/90 active:scale-[0.99]"
      >
        <Icon name="add" size={20} />
        New search
      </Link>

      <nav className="mt-7 flex-1 space-y-1 overflow-y-auto">
        <div className="m3-label px-4 pb-2">Workspace</div>
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group m3-nav-link ${active ? "m3-nav-link-active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {active ? (
                <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
              ) : null}
              <span
                className={`grid h-9 w-9 place-items-center rounded-full transition ${
                  active
                    ? "bg-primary text-on-primary shadow-[0_8px_24px_-12px_rgba(203,187,255,0.9)]"
                    : "bg-surface-container-high/60 text-on-surface-variant group-hover:bg-surface-container-highest group-hover:text-on-surface"
                }`}
              >
                <Icon name={item.icon} size={19} filled={active} />
              </span>
              <span className="truncate">{item.label}</span>
              {active ? <Icon name="arrow_forward" size={16} className="ml-auto text-primary/70" /> : null}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface-variant/40">
        <span>LeadGun v1.0</span>
        <span>Lead intelligence</span>
      </div>
    </aside>
  );
}
