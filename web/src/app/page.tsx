"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import LeadCard from "@/components/LeadCard";
import Icon from "@/components/Icon";
import {
  Badge,
  ButtonLink,
  EmptyState,
  LoadingState,
  PageHeader,
  platformMeta,
} from "@/components/ui";
import type { Stats } from "@/types";

const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export default function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${base}/api/stats`)
      .then((r) => r.json())
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="px-5 py-8 lg:px-10 lg:py-10">
        <LoadingState label="Warming up the signal…" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="px-5 py-8 lg:px-10 lg:py-10">
        <EmptyState
          icon="cloud_off"
          title="Signal unavailable"
          description="The LeadGun API could not be reached. Check that the backend is running on port 3000."
        />
      </div>
    );
  }

  const m = stats.metrics;
  const cards = [
    {
      label: "Total leads",
      value: m.total,
      icon: "groups",
      hint: "All time",
      tile: "bg-primary/15 text-primary border-primary/20",
      bar: "from-primary to-[#8f74ff]",
    },
    {
      label: "Today",
      value: m.today,
      icon: "bolt",
      hint: "New today",
      tile: "bg-tertiary/15 text-tertiary border-tertiary/20",
      bar: "from-tertiary to-[#ff9f4a]",
    },
    {
      label: "This week",
      value: m.week,
      icon: "date_range",
      hint: "Last 7 days",
      tile: "bg-info/15 text-info border-info/20",
      bar: "from-info to-[#5f9fff]",
    },
    {
      label: "Uncontacted",
      value: m.uncontacted,
      icon: "mark_email_unread",
      hint: "Awaiting outreach",
      tile: "bg-secondary/15 text-secondary border-secondary/20",
      bar: "from-secondary to-[#1fd1b4]",
    },
    {
      label: "Replies",
      value: m.replied,
      icon: "reply",
      hint: "Received",
      tile: "bg-[#a8e8ff]/12 text-[#a8e8ff] border-[#a8e8ff]/20",
      bar: "from-[#a8e8ff] to-[#6bb7ff]",
    },
    {
      label: "Interested",
      value: m.interested,
      icon: "local_fire_department",
      hint: "Qualified",
      tile: "bg-error/12 text-error border-error/20",
      bar: "from-error to-[#ff8d83]",
    },
  ];

  const platformBar: Record<string, string> = {
    reddit: "#ff7b52",
    x: "#e7e3f2",
    linkedin: "#8ecaff",
    upwork: "#83f2b1",
  };

  const statusBar: Record<string, string> = {
    new: "#8ecaff",
    saved: "#cbbbff",
    contacted: "#ffc87d",
    replied: "#7ee8d3",
    interested: "#ff8d83",
    archived: "#7d8194",
    lost: "#ffb4ab",
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-7 px-5 pb-28 pt-6 lg:px-10 lg:pb-12 lg:pt-10">
      <PageHeader
        eyebrow="Command center"
        icon="radar"
        title={
          <>
            Your pipeline, <span className="text-gradient">at a glance.</span>
          </>
        }
        description="Live intelligence from every connected source. Spot fresh intent, act fast, and keep the signal moving."
        actions={
          <>
            <ButtonLink href="/ai" icon="auto_awesome">
              Find new leads
            </ButtonLink>
            <ButtonLink href="/explorer" variant="outlined" icon="travel_explore">
              Explore leads
            </ButtonLink>
          </>
        }
      />

      <section className="relative overflow-hidden rounded-[2rem] border border-primary/15 bg-surface-container/60 p-6 shadow-[0_30px_100px_-48px_rgba(97,68,255,0.65)] backdrop-blur-xl md:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_30%,rgba(203,187,255,0.18),transparent_38%),linear-gradient(120deg,rgba(76,51,186,0.12),transparent_46%)]" />
        <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full border border-primary/10" />
        <div className="absolute -right-4 top-2 h-40 w-40 rounded-full border border-secondary/10" />
        <div className="relative z-10 flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <Badge tone="secondary" icon="sensors" filled>
              Live signal
            </Badge>
            <h2 className="mt-5 font-display text-3xl font-semibold leading-[1.08] tracking-[-0.05em] text-on-surface md:text-[2.6rem]">
              Fresh intent is <br className="hidden sm:block" />
              waiting to be found.
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-6 text-on-surface-variant">
              LeadGun watches Reddit, X, LinkedIn, and Upwork around the clock, scores the signal, and serves the
              opportunities worth your attention.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Link href="/ai" className="m3-button-filled">
                <Icon name="auto_awesome" size={18} />
                Ask the AI
              </Link>
            </div>
          </div>

          <div className="relative hidden h-48 w-64 shrink-0 xl:block">
            <div className="absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/15" />
            <div className="absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border border-secondary/15" />
            <div className="absolute left-1/2 top-1/2 grid h-20 w-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[1.65rem] border border-primary/25 bg-primary/15 text-primary shadow-[0_0_70px_rgba(203,187,255,0.2)] backdrop-blur-xl animate-float">
              <Icon name="gps_fixed" size={34} filled />
            </div>
            <div className="absolute right-2 top-6 rounded-2xl border border-outline-variant/70 bg-surface-container-high/85 px-3 py-2 backdrop-blur-xl">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-on-surface-variant/60">Leads</p>
              <p className="font-display text-lg font-bold text-on-surface">{m.total.toLocaleString()}</p>
            </div>
            <div className="absolute bottom-1 left-0 rounded-2xl border border-secondary/20 bg-secondary/10 px-3 py-2 backdrop-blur-xl">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-secondary/70">Today</p>
              <p className="font-display text-lg font-bold text-secondary">+{m.today}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((card, index) => (
          <div
            key={card.label}
            className="m3-card-interactive animate-enter relative overflow-hidden p-4"
            style={{ animationDelay: `${index * 45}ms` }}
          >
            <div className="flex items-start justify-between gap-2">
              <span className={`grid h-9 w-9 place-items-center rounded-[0.9rem] border ${card.tile}`}>
                <Icon name={card.icon} size={18} filled />
              </span>
              <Icon name="north_east" size={16} className="text-on-surface-variant/30" />
            </div>
            <div className="mt-5 font-display text-[1.75rem] font-semibold leading-none tracking-[-0.04em]">
              {Number(card.value || 0).toLocaleString()}
            </div>
            <div className="mt-2 text-xs font-extrabold text-on-surface">{card.label}</div>
            <div className="mt-0.5 text-[10px] font-semibold text-on-surface-variant/60">{card.hint}</div>
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-on-surface/6">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${card.bar}`}
                style={{ width: `${m.total ? Math.max(5, Math.round((card.value / m.total) * 100)) : 5}%` }}
              />
            </div>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="m3-card p-5 md:p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="m3-label">Source mix</p>
              <h3 className="mt-1 font-display text-lg font-semibold tracking-tight">Leads by platform</h3>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
              <Icon name="donut_small" size={21} />
            </span>
          </div>
          <div className="space-y-4">
            {stats.byPlatform.map((platform) => {
              const pct = m.total ? Math.round((platform.count / m.total) * 100) : 0;
              const meta = platformMeta(platform.platform);
              return (
                <div key={platform.platform}>
                  <div className="mb-2 flex items-center gap-2.5">
                    <span className={`grid h-8 w-8 place-items-center rounded-[0.7rem] border ${meta.tile}`}>
                      <Icon name={meta.icon} size={16} filled />
                    </span>
                    <span className="text-sm font-bold capitalize text-on-surface">{platform.platform}</span>
                    <span className="ml-auto text-xs font-extrabold tabular-nums text-on-surface-variant">
                      {platform.count.toLocaleString()}
                    </span>
                    <span className="w-9 text-right text-[10px] font-bold tabular-nums text-on-surface-variant/50">
                      {pct}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-on-surface/6">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.max(3, pct)}%`,
                        background: platformBar[platform.platform] || "#cbbbff",
                        boxShadow: `0 0 18px ${platformBar[platform.platform] || "#cbbbff"}55`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
            {stats.byPlatform.length === 0 ? <p className="text-sm text-on-surface-variant">No source data yet.</p> : null}
          </div>
        </div>

        <div className="m3-card p-5 md:p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="m3-label">Pipeline health</p>
              <h3 className="mt-1 font-display text-lg font-semibold tracking-tight">Status distribution</h3>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-full bg-secondary/10 text-secondary">
              <Icon name="donut_large" size={21} />
            </span>
          </div>
          <div className="space-y-3.5">
            {stats.byStatus.map((status) => {
              const pct = m.total ? Math.round((status.count / m.total) * 100) : 0;
              return (
                <div key={status.status}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-xs font-bold capitalize text-on-surface-variant">{status.status}</span>
                    <span className="ml-auto text-xs font-extrabold tabular-nums text-on-surface">
                      {status.count.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-on-surface/6">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, pct)}%`,
                        background: statusBar[status.status] || "#cbbbff",
                      }}
                    />
                  </div>
                </div>
              );
            })}
            {stats.byStatus.length === 0 ? <p className="text-sm text-on-surface-variant">No status data yet.</p> : null}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="m3-label">Fresh opportunities</p>
            <h2 className="mt-1 font-display text-xl font-semibold tracking-tight">Latest discovered leads</h2>
          </div>
          <Link href="/explorer" className="m3-button-text h-9 px-3 text-xs">
            View all
            <Icon name="arrow_forward" size={16} />
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {stats.latest.map((lead) => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
          {stats.latest.length === 0 ? (
            <div className="md:col-span-2 2xl:col-span-3">
              <EmptyState
                icon="travel_explore"
                title="No leads yet"
                description="Run a scrape or send leads through the ingestion endpoint to start building your pipeline."
                action={
                  <ButtonLink href="/ai" icon="auto_awesome">
                    Start a search
                  </ButtonLink>
                }
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="m3-card p-5 md:p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="m3-label">Timeline</p>
            <h2 className="mt-1 font-display text-lg font-semibold tracking-tight">Recent activity</h2>
          </div>
          <Link href="/activity" className="m3-button-text h-9 px-3 text-xs">
            Open activity
            <Icon name="arrow_forward" size={16} />
          </Link>
        </div>
        <div className="space-y-1">
          {stats.activity.map((activity, index) => {
            const icon =
              activity.activityType === "discovered"
                ? "travel_explore"
                : activity.activityType === "outreach"
                  ? "send"
                  : activity.activityType === "reply_received"
                    ? "reply"
                    : activity.activityType === "status_change"
                      ? "swap_horiz"
                      : activity.activityType === "note"
                        ? "note_add"
                        : "bolt";
            return (
              <div
                key={activity.id}
                className="flex items-start gap-3 rounded-2xl px-2 py-3 transition hover:bg-on-surface/5"
              >
                <span className="relative mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-outline-variant/70 bg-surface-container-high text-on-surface-variant">
                  <Icon name={icon} size={17} />
                  {index < stats.activity.length - 1 ? (
                    <span className="absolute left-1/2 top-9 h-4 w-px -translate-x-1/2 bg-outline-variant/70" />
                  ) : null}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-extrabold capitalize text-on-surface">
                      {String(activity.activityType || "").replaceAll("_", " ")}
                    </span>
                    <span className="text-[10px] font-semibold text-on-surface-variant/50">
                      {new Date(activity.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-on-surface-variant/80">
                    {activity.description}
                  </p>
                </div>
              </div>
            );
          })}
          {stats.activity.length === 0 ? (
            <div className="py-8 text-center text-sm text-on-surface-variant">No activity yet.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
