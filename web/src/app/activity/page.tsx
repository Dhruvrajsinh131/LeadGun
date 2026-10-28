"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { Badge, ButtonLink, EmptyState, LoadingState, PageHeader } from "@/components/ui";
import type { Stats } from "@/types";

const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

const activityMeta: Record<string, { icon: string; tone: string; label: string }> = {
  discovered: { icon: "travel_explore", tone: "bg-primary/15 text-primary border-primary/20", label: "Discovered" },
  outreach: { icon: "send", tone: "bg-tertiary/15 text-tertiary border-tertiary/20", label: "Outreach" },
  reply_received: { icon: "reply", tone: "bg-secondary/15 text-secondary border-secondary/20", label: "Reply" },
  status_change: { icon: "swap_horiz", tone: "bg-info/15 text-info border-info/20", label: "Status" },
  note: { icon: "note_add", tone: "bg-[#e8b6ff]/12 text-[#e8b6ff] border-[#e8b6ff]/20", label: "Note" },
  draft: { icon: "edit_note", tone: "bg-primary/15 text-primary border-primary/20", label: "Draft" },
};

const FILTERS = [
  { key: "all", label: "All activity", icon: "apps" },
  { key: "discovered", label: "Discovered", icon: "travel_explore" },
  { key: "outreach", label: "Outreach", icon: "send" },
  { key: "reply_received", label: "Replies", icon: "reply" },
  { key: "note", label: "Notes", icon: "note_add" },
];

export default function ActivityPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    fetch(`${base}/api/stats`)
      .then((response) => response.json())
      .then(setStats)
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-[1400px] px-5 pb-28 pt-6 lg:px-10 lg:pt-10">
        <EmptyState
          icon="cloud_off"
          title="Activity unavailable"
          description="The activity feed could not be loaded. Check that the backend is running."
        />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="mx-auto max-w-[1400px] px-5 pb-28 pt-6 lg:px-10 lg:pt-10">
        <LoadingState label="Loading the signal timeline…" />
      </div>
    );
  }

  const activities = (stats.activity || []).filter((activity) => filter === "all" || activity.activityType === filter);
  const counts = (stats.activity || []).reduce((accumulator: Record<string, number>, activity) => {
    accumulator[activity.activityType] = (accumulator[activity.activityType] || 0) + 1;
    return accumulator;
  }, {});

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 px-5 pb-28 pt-6 lg:px-10 lg:pb-12 lg:pt-10">
      <PageHeader
        eyebrow="Signal timeline"
        icon="monitoring"
        title={
          <>
            Everything that <span className="text-gradient">moved.</span>
          </>
        }
        description="A chronological readout of discovery, outreach, replies, notes, and pipeline changes across your workspace."
        actions={
          <>
            <ButtonLink href="/explorer" variant="outlined" icon="travel_explore">
              Lead explorer
            </ButtonLink>
            <ButtonLink href="/ai" icon="auto_awesome">
              Ask for a recap
            </ButtonLink>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
        <section className="m3-card overflow-hidden">
          <div className="border-b border-outline-variant/60 p-4 md:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <div>
                <p className="m3-label">Event stream</p>
                <h2 className="mt-1 font-display text-lg font-semibold tracking-tight">Recent activity</h2>
              </div>
              <Badge tone="primary" icon="bolt" className="ml-auto">
                {activities.length} events
              </Badge>
            </div>

            <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto">
              {FILTERS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setFilter(item.key)}
                  className={filter === item.key ? "m3-chip-active" : "m3-chip"}
                >
                  <Icon name={item.icon} size={15} filled={filter === item.key} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 md:p-5">
            {activities.length === 0 ? (
              <EmptyState
                icon="event_busy"
                title="No events in this stream"
                description="Try another filter or start a fresh search to generate new activity."
              />
            ) : (
              <div className="space-y-1">
                {activities.map((activity, index) => {
                  const meta = activityMeta[activity.activityType] || {
                    icon: "bolt",
                    tone: "bg-primary/15 text-primary border-primary/20",
                    label: activity.activityType,
                  };
                  return (
                    <div key={activity.id} className="group relative flex gap-3 rounded-2xl px-2 py-3 transition hover:bg-on-surface/5">
                      <div className="relative flex flex-col items-center">
                        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[0.85rem] border ${meta.tone}`}>
                          <Icon name={meta.icon} size={18} />
                        </span>
                        {index < activities.length - 1 ? (
                          <span className="mt-1 w-px flex-1 bg-outline-variant/70" />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1 pb-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-on-surface">
                            {meta.label}
                          </span>
                          {activity.lead ? (
                            <span className="text-[10px] font-bold text-on-surface-variant/50">
                              · {activity.lead.platform} · {activity.lead.username || activity.lead.title || "lead"}
                            </span>
                          ) : null}
                          <span className="ml-auto shrink-0 text-[10px] font-semibold text-on-surface-variant/40">
                            {new Date(activity.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm leading-6 text-on-surface-variant">{activity.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="m3-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="m3-label">Live snapshot</p>
                <h2 className="mt-1 font-display text-lg font-semibold tracking-tight">Workspace pulse</h2>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-full bg-secondary/10 text-secondary">
                <Icon name="pulse_alert" size={20} />
              </span>
            </div>

            <div className="mt-5 space-y-2.5">
              {[
                { label: "Total leads", value: stats.metrics.total, icon: "groups" },
                { label: "New today", value: stats.metrics.today, icon: "bolt" },
                { label: "Uncontacted", value: stats.metrics.uncontacted, icon: "mark_email_unread" },
                { label: "Replies", value: stats.metrics.replied, icon: "reply" },
                { label: "Interested", value: stats.metrics.interested, icon: "local_fire_department" },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-2.5 rounded-2xl border border-outline-variant/50 bg-surface-container-low/60 px-3 py-2.5">
                  <Icon name={row.icon} size={17} className="text-on-surface-variant/60" />
                  <span className="text-xs font-bold text-on-surface-variant">{row.label}</span>
                  <span className="ml-auto font-display text-sm font-bold tabular-nums text-on-surface">
                    {Number(row.value || 0).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="m3-card p-5">
            <p className="m3-label">Event mix</p>
            <h2 className="mt-1 font-display text-lg font-semibold tracking-tight">Last 15 events</h2>
            <div className="mt-4 space-y-3">
              {["discovered", "outreach", "reply_received", "note", "status_change"].map((key) => {
                const meta = activityMeta[key] || activityMeta.discovered;
                const count = counts[key] || 0;
                const total = Math.max(1, stats.activity?.length || 0);
                return (
                  <div key={key}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <Icon name={meta.icon} size={15} className="text-on-surface-variant/55" />
                      <span className="text-[11px] font-bold capitalize text-on-surface-variant">{meta.label}</span>
                      <span className="ml-auto text-[10px] font-extrabold tabular-nums text-on-surface-variant/60">{count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-on-surface/6">
                      <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(4, (count / total) * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <Link href="/explorer" className="m3-button-outlined mt-5 h-9 w-full text-xs">
              <Icon name="travel_explore" size={16} />
              View all leads
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
