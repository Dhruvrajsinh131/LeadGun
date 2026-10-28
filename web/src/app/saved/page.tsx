"use client";

import { useEffect, useState } from "react";
import { Lead } from "@prisma/client";
import LeadCard from "@/components/LeadCard";
import Icon from "@/components/Icon";
import { Badge, ButtonLink, EmptyState, LoadingState, PageHeader } from "@/components/ui";

const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export default function SavedPage() {
  const [items, setItems] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSaved = async () => {
    const response = await fetch(`${base}/api/leads?saved=true&pageSize=100`);
    const data = (await response.json()) as { items?: Lead[] };
    setItems(data.items || []);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const response = await fetch(`${base}/api/leads?saved=true&pageSize=100`);
      const data = (await response.json()) as { items?: Lead[] };
      if (!cancelled) {
        setItems(data.items || []);
        setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 px-5 pb-28 pt-6 lg:px-10 lg:pb-12 lg:pt-10">
      <PageHeader
        eyebrow="Your shortlist"
        icon="bookmarks"
        title={
          <>
            Saved <span className="text-gradient">opportunities.</span>
          </>
        }
        description="The leads you marked as worth a second look. Keep them close, add context, and move them toward a conversation."
        actions={
          <>
            <ButtonLink href="/explorer" variant="outlined" icon="travel_explore">
              Explore all leads
            </ButtonLink>
            <ButtonLink href="/ai" icon="auto_awesome">
              Find more
            </ButtonLink>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary" icon="bookmark_added" filled>
          {items.length.toLocaleString()} saved {items.length === 1 ? "lead" : "leads"}
        </Badge>
        <Badge tone="neutral" icon="sort">
          Newest first
        </Badge>
        {loading ? (
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-on-surface-variant/60">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            Refreshing
          </span>
        ) : null}
      </div>

      {loading && items.length === 0 ? <LoadingState label="Opening your shortlist…" /> : null}

      {!loading && items.length === 0 ? (
        <EmptyState
          icon="bookmark_border"
          title="Your shortlist is empty"
          description="Tap the bookmark icon on any lead to keep it here for fast follow-up."
          action={
            <ButtonLink href="/explorer" icon="travel_explore">
              Browse leads
            </ButtonLink>
          }
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {items.map((lead, index) => (
          <div key={lead.id} className="animate-enter" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
            <LeadCard lead={lead} onChanged={fetchSaved} />
          </div>
        ))}
      </div>

      {!loading && items.length > 0 ? (
        <div className="flex items-center justify-center gap-2 pt-2 text-[11px] font-bold text-on-surface-variant/40">
          <Icon name="task_alt" size={15} />
          Shortlist synced with PostgreSQL
        </div>
      ) : null}
    </div>
  );
}
