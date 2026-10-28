"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Lead } from "@prisma/client";
import Icon from "@/components/Icon";
import {
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  LoadingState,
  PageHeader,
  ScoreRing,
  StatusBadge,
  platformMeta,
} from "@/components/ui";
import type { Metrics } from "@/types";

const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export default function RepliesPage() {
  const [items, setItems] = useState<Lead[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [leadsResponse, statsResponse] = await Promise.all([
          fetch(`${base}/api/leads?contacted=true&pageSize=100`),
          fetch(`${base}/api/stats`),
        ]);
        const [leadsData, statsData] = (await Promise.all([
          leadsResponse.json(),
          statsResponse.json(),
        ])) as [{ items?: Lead[] }, { metrics?: Metrics }];
        setItems(leadsData.items || []);
        setMetrics(statsData.metrics || null);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const sent = metrics?.outreachCount ?? 0;
  const replied = metrics?.replied ?? 0;
  const interested = metrics?.interested ?? 0;
  const contacted = items.length;

  const cards = [
    {
      label: "In outreach",
      value: contacted,
      icon: "send",
      hint: "Contacted or beyond",
      tile: "bg-tertiary/15 text-tertiary border-tertiary/20",
    },
    {
      label: "Replies",
      value: replied,
      icon: "reply",
      hint: "Conversations opened",
      tile: "bg-secondary/15 text-secondary border-secondary/20",
    },
    {
      label: "Interested",
      value: interested,
      icon: "local_fire_department",
      hint: "High-intent responses",
      tile: "bg-error/12 text-error border-error/20",
    },
    {
      label: "Messages",
      value: sent,
      icon: "outbox",
      hint: "Recorded outreach",
      tile: "bg-primary/15 text-primary border-primary/20",
    },
  ];

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 px-5 pb-28 pt-6 lg:px-10 lg:pb-12 lg:pt-10">
      <PageHeader
        eyebrow="Conversation desk"
        icon="forum"
        title={
          <>
            Replies & <span className="text-gradient">outreach.</span>
          </>
        }
        description="Every lead that has entered the conversation. Keep context close and reply while the intent is still warm."
        actions={
          <>
            <ButtonLink href="/explorer" variant="outlined" icon="travel_explore">
              Open explorer
            </ButtonLink>
            <ButtonLink href="/ai" icon="auto_awesome">
              Ask for a brief
            </ButtonLink>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map((card, index) => (
          <div
            key={card.label}
            className="m3-card animate-enter p-4"
            style={{ animationDelay: `${index * 45}ms` }}
          >
            <div className="flex items-start justify-between">
              <span className={`grid h-9 w-9 place-items-center rounded-[0.9rem] border ${card.tile}`}>
                <Icon name={card.icon} size={18} filled />
              </span>
              <Icon name="north_east" size={15} className="text-on-surface-variant/25" />
            </div>
            <p className="mt-4 font-display text-2xl font-semibold tracking-[-0.04em]">
              {Number(card.value || 0).toLocaleString()}
            </p>
            <p className="mt-1 text-xs font-extrabold text-on-surface">{card.label}</p>
            <p className="mt-0.5 text-[10px] font-semibold text-on-surface-variant/55">{card.hint}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary" icon="mark_email_read">
          {items.length.toLocaleString()} active {items.length === 1 ? "conversation" : "conversations"}
        </Badge>
        {loading ? (
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-on-surface-variant/60">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary" />
            Syncing outreach
          </span>
        ) : null}
      </div>

      {loading && items.length === 0 ? <LoadingState label="Loading outreach desk…" /> : null}

      {!loading && items.length === 0 ? (
        <EmptyState
          icon="mark_email_unread"
          title="No outreach yet"
          description="Open a lead, draft a reply with AI, and mark it as contacted to start a conversation here."
          action={
            <ButtonLink href="/explorer" icon="travel_explore">
              Find a lead to contact
            </ButtonLink>
          }
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {items.map((lead, index) => {
          const meta = platformMeta(lead.platform);
          return (
            <article
              key={lead.id}
              className="m3-card-interactive animate-enter flex flex-col gap-4 p-5"
              style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
            >
              <div className="flex items-start gap-3">
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[1rem] border ${meta.tile}`}>
                  <Icon name={meta.icon} size={21} filled />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-sm font-extrabold text-on-surface">
                      {lead.username || lead.name || "Unknown lead"}
                    </h2>
                    <StatusBadge status={lead.status} />
                  </div>
                  <p className="mt-1 truncate text-[11px] font-semibold text-on-surface-variant/65">
                    {lead.jobTitle || lead.title || lead.clientLocation || "No role detected"}
                  </p>
                </div>
                <ScoreRing score={lead.leadScore ?? 0} size={46} />
              </div>

              <p className="line-clamp-2 text-sm leading-6 text-on-surface-variant">
                {lead.postContent || lead.title || "No message preview available."}
              </p>

              <div className="flex items-center gap-2 border-t border-outline-variant/60 pt-3">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-on-surface-variant/50">
                  <Icon name="schedule" size={14} />
                  {lead.discoveredAt ? new Date(lead.discoveredAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Unknown"}
                </span>
                {lead.isSaved ? (
                  <span className="ml-1 flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-primary/70">
                    <Icon name="bookmark" size={13} filled />
                    Saved
                  </span>
                ) : null}
                <div className="ml-auto flex items-center gap-1.5">
                  {lead.postUrl ? (
                    <a
                      href={lead.postUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open original post"
                      className="m3-icon-button h-9 w-9"
                    >
                      <Icon name="open_in_new" size={17} />
                    </a>
                  ) : null}
                  <Link href={`/explorer?lead=${lead.id}`} className="m3-button-tonal h-9 px-4 text-xs">
                    <Icon name="forum" size={16} />
                    Open thread
                  </Link>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {!loading && items.length > 0 ? (
        <div className="flex justify-center pt-1">
          <Button variant="outlined" icon="refresh" onClick={() => window.location.reload()} className="h-9 px-4 text-xs">
            Refresh desk
          </Button>
        </div>
      ) : null}
    </div>
  );
}
