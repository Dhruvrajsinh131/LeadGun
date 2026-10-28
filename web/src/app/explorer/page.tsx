"use client";

import { useEffect, useState } from "react";
import type { Lead } from "@prisma/client";
import LeadCard from "@/components/LeadCard";
import Icon from "@/components/Icon";
import {
  Badge,
  Button,
  EmptyState,
  FreshnessBadge,
  IconButton,
  LoadingState,
  PageHeader,
  PlatformBadge,
  ScoreRing,
  StatusBadge,
  platformMeta,
} from "@/components/ui";
import type { LeadDetail, LeadPatch } from "@/types";

const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const PLATFORMS = ["reddit", "x", "linkedin", "upwork"];
const STATUSES = ["new", "saved", "contacted", "replied", "interested", "archived", "lost"];

export default function ExplorerPage() {
  const [view, setView] = useState<"card" | "list">("card");
  const [items, setItems] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState("");
  const [status, setStatus] = useState("");
  const [saved, setSaved] = useState("");
  const [contacted, setContacted] = useState("");
  const [minScore, setMinScore] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState("discoveredAt:desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<LeadDetail | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (q) params.set("q", q);
      if (platform) params.set("platform", platform);
      if (status) params.set("status", status);
      if (saved) params.set("saved", saved);
      if (contacted) params.set("contacted", contacted);
      if (minScore) params.set("minScore", minScore);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (sort) params.set("sort", sort);

      try {
        const res = await fetch(`${base}/api/leads?${params.toString()}`);
        const data = (await res.json()) as { items?: Lead[]; total?: number };
        if (cancelled) return;
        setItems(data.items || []);
        setTotal(data.total || 0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const timer = setTimeout(load, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [page, pageSize, platform, status, saved, contacted, sort, q, minScore, dateFrom, dateTo, refreshTick]);

  const applyFilters = (event?: React.FormEvent) => {
    event?.preventDefault();
    setPage(1);
    setRefreshTick((tick) => tick + 1);
  };

  const resetFilters = () => {
    setQ("");
    setPlatform("");
    setStatus("");
    setSaved("");
    setContacted("");
    setMinScore("");
    setDateFrom("");
    setDateTo("");
    setSort("discoveredAt:desc");
    setPage(1);
    setRefreshTick((tick) => tick + 1);
  };

  const openDetails = async (id: string) => {
    const res = await fetch(`${base}/api/leads/${id}`);
    const data = (await res.json()) as { lead?: LeadDetail };
    setDetails(data.lead || null);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const leadId = params.get("lead");
    if (!leadId) return;

    let cancelled = false;
    fetch(`${base}/api/leads/${leadId}`)
      .then((response) => response.json())
      .then((data: { lead?: LeadDetail }) => {
        if (!cancelled) setDetails(data.lead || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSelect = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((item) => item.id)));
  };

  const bulkSetStatus = async (nextStatus: string) => {
    await Promise.all(
      [...selected].map((id) =>
        fetch(`${base}/api/leads/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        })
      )
    );
    setSelected(new Set());
    setRefreshTick((tick) => tick + 1);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const extraFilters = [saved, contacted, minScore, dateFrom, dateTo].filter(Boolean).length;

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 px-5 pb-28 pt-6 lg:px-10 lg:pb-12 lg:pt-10">
      <PageHeader
        eyebrow="Lead intelligence"
        icon="travel_explore"
        title={
          <>
            Explore every <span className="text-gradient">signal.</span>
          </>
        }
        description="Search, filter, and triage every captured lead. Save the best, enrich the rest, and move the pipeline forward."
        actions={
          <>
            <div className="flex items-center rounded-full border border-outline-variant/80 bg-surface-container-low/80 p-1">
              <button
                type="button"
                onClick={() => setView("card")}
                aria-label="Card view"
                className={`grid h-9 w-9 place-items-center rounded-full transition ${
                  view === "card" ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <Icon name="grid_view" size={18} filled={view === "card"} />
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                aria-label="List view"
                className={`grid h-9 w-9 place-items-center rounded-full transition ${
                  view === "list" ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <Icon name="view_list" size={19} filled={view === "list"} />
              </button>
            </div>
            <IconButton
              icon="refresh"
              label="Refresh leads"
              variant="tonal"
              onClick={() => setRefreshTick((tick) => tick + 1)}
              className={loading ? "animate-spin" : ""}
            />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary" icon="database">
          {total.toLocaleString()} leads indexed
        </Badge>
        <Badge tone={extraFilters > 0 ? "secondary" : "neutral"} icon="tune">
          {extraFilters > 0 ? `${extraFilters} advanced filters` : "No advanced filters"}
        </Badge>
        {loading ? (
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-on-surface-variant/60">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-tertiary" />
            Syncing
          </span>
        ) : null}
      </div>

      <form onSubmit={applyFilters} className="m3-card space-y-4 p-4 md:p-5">
        <div className="flex flex-col gap-2 md:flex-row">
          <div className="relative min-w-0 flex-1">
            <Icon name="search" size={20} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant/55" />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search names, companies, posts, capabilities…"
              className="m3-field h-12 pl-11 pr-4"
              aria-label="Search leads"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" icon="filter_alt" className="h-12 flex-1 px-6 md:flex-none">
              Apply
            </Button>
            <IconButton icon="restart_alt" label="Reset filters" variant="tonal" onClick={resetFilters} className="h-12 w-12" />
          </div>
        </div>

        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => {
              setPlatform("");
              setPage(1);
            }}
            className={platform === "" ? "m3-chip-active" : "m3-chip"}
          >
            <Icon name="apps" size={15} filled={platform === ""} />
            All sources
          </button>
          {PLATFORMS.map((source) => {
            const meta = platformMeta(source);
            const active = platform === source;
            return (
              <button
                key={source}
                type="button"
                onClick={() => {
                  setPlatform(source);
                  setPage(1);
                }}
                className={active ? "m3-chip-active" : "m3-chip"}
              >
                <Icon name={meta.icon} size={15} filled={active} />
                {source === "x" ? "X / Twitter" : source.charAt(0).toUpperCase() + source.slice(1)}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
          <SelectField label="Status" icon="flag" value={status} onChange={(value) => { setStatus(value); setPage(1); }}>
            <option value="">All statuses</option>
            {STATUSES.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </SelectField>
          <SelectField label="Saved" icon="bookmark" value={saved} onChange={(value) => { setSaved(value); setPage(1); }}>
            <option value="">Any</option>
            <option value="true">Saved</option>
            <option value="false">Not saved</option>
          </SelectField>
          <SelectField label="Outreach" icon="send" value={contacted} onChange={(value) => { setContacted(value); setPage(1); }}>
            <option value="">Any</option>
            <option value="true">Contacted</option>
            <option value="false">Uncontacted</option>
          </SelectField>
          <label className="block min-w-0">
            <span className="m3-label mb-1.5 block">Min score</span>
            <div className="relative">
              <Icon name="speed" size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50" />
              <input
                type="number"
                min={0}
                max={100}
                value={minScore}
                onChange={(event) => setMinScore(event.target.value)}
                placeholder="0"
                className="m3-field h-10 pl-9 pr-3"
              />
            </div>
          </label>
          <label className="block min-w-0">
            <span className="m3-label mb-1.5 block">From</span>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="m3-field h-10 px-3" />
          </label>
          <label className="block min-w-0">
            <span className="m3-label mb-1.5 block">To</span>
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="m3-field h-10 px-3" />
          </label>
          <SelectField label="Sort" icon="sort" value={sort} onChange={(value) => { setSort(value); setPage(1); }}>
            <option value="discoveredAt:desc">Newest first</option>
            <option value="discoveredAt:asc">Oldest first</option>
            <option value="leadScore:desc">Highest score</option>
            <option value="leadScore:asc">Lowest score</option>
          </SelectField>
        </div>
      </form>

      {selected.size > 0 ? (
        <div className="sticky top-3 z-30 flex flex-wrap items-center gap-2 rounded-[1.4rem] border border-primary/25 bg-surface-container-high/95 px-3 py-2.5 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
          <span className="flex items-center gap-2 px-2 text-xs font-extrabold text-primary">
            <Icon name="check_circle" size={18} filled />
            {selected.size} selected
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button variant="tonal" icon="send" className="h-8 px-3 text-xs" onClick={() => bulkSetStatus("contacted")}>
              Contacted
            </Button>
            <Button variant="tonal" icon="local_fire_department" className="h-8 px-3 text-xs" onClick={() => bulkSetStatus("interested")}>
              Interested
            </Button>
            <Button variant="outlined" icon="archive" className="h-8 px-3 text-xs" onClick={() => bulkSetStatus("archived")}>
              Archive
            </Button>
            <IconButton icon="close" label="Clear selection" onClick={() => setSelected(new Set())} className="h-8 w-8" />
          </div>
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <LoadingState label="Scanning the lead index…" />
      ) : view === "card" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {items.map((lead, index) => (
            <div
              key={lead.id}
              className={`relative animate-enter rounded-[1.75rem] transition ${
                selected.has(lead.id) ? "ring-2 ring-primary ring-offset-4 ring-offset-background" : ""
              }`}
              style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
            >
              <LeadCard
                lead={lead}
                onChanged={() => setRefreshTick((tick) => tick + 1)}
                selected={selected.has(lead.id)}
                onSelect={() => toggleSelect(lead.id)}
                onOpenDetails={() => openDetails(lead.id)}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="m3-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-outline-variant/70 bg-surface-container-high/50 text-[10px] uppercase tracking-[0.14em] text-on-surface-variant/70">
                  <th className="p-4">
                    <input
                      type="checkbox"
                      checked={items.length > 0 && selected.size === items.length}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 accent-[#cbbbff]"
                      aria-label="Select all leads"
                    />
                  </th>
                  <th className="px-4 py-3 font-extrabold">Lead</th>
                  <th className="px-4 py-3 font-extrabold">Source</th>
                  <th className="px-4 py-3 font-extrabold">Signal</th>
                  <th className="px-4 py-3 font-extrabold">Score</th>
                  <th className="px-4 py-3 font-extrabold">Status</th>
                  <th className="px-4 py-3 text-right font-extrabold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/50">
                {items.map((lead) => {
                  const meta = platformMeta(lead.platform);
                  return (
                    <tr key={lead.id} className="group transition hover:bg-on-surface/4">
                      <td className="p-4">
                        <input
                          type="checkbox"
                          checked={selected.has(lead.id)}
                          onChange={() => toggleSelect(lead.id)}
                          className="h-4 w-4 accent-[#cbbbff]"
                          aria-label={`Select lead ${lead.username || lead.name || lead.id}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[0.7rem] border ${meta.tile}`}>
                            <Icon name={meta.icon} size={16} filled />
                          </span>
                          <div className="min-w-0">
                            <div className="max-w-[190px] truncate text-xs font-extrabold text-on-surface">
                              {lead.username || lead.name || "Unknown"}
                            </div>
                            <div className="max-w-[190px] truncate text-[10px] font-semibold text-on-surface-variant/60">
                              {lead.jobTitle || lead.title || "No title"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <PlatformBadge platform={lead.platform} />
                      </td>
                      <td className="max-w-[290px] px-4 py-3">
                        <p className="truncate text-xs text-on-surface-variant">
                          {lead.postContent || lead.title || "—"}
                        </p>
                        <div className="mt-1.5 flex gap-1">
                          {lead.freshness ? <FreshnessBadge lead={lead} /> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-display text-sm font-bold tabular-nums text-on-surface">{lead.leadScore ?? 0}</span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={lead.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <IconButton icon="visibility" label="View details" onClick={() => openDetails(lead.id)} className="h-8 w-8" />
                          <a
                            href={lead.postUrl || "#"}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="Open original post"
                            className="m3-icon-button h-8 w-8"
                          >
                            <Icon name="open_in_new" size={16} />
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && items.length === 0 ? (
        <EmptyState
          icon="search_off"
          title="No leads match this signal"
          description="Try loosening the filters, switching sources, or kicking off a fresh AI search."
          action={
            <Button variant="tonal" icon="restart_alt" onClick={resetFilters}>
              Reset filters
            </Button>
          }
        />
      ) : null}

      <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
        <div className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant/60">
          <Icon name="page_info" size={16} />
          Page {page} of {totalPages} · {total.toLocaleString()} leads
        </div>
        <div className="flex items-center gap-2">
          <SelectField label="" icon="expand_more" value={String(pageSize)} onChange={(value) => { setPageSize(Number(value)); setPage(1); }} compact>
            {[12, 24, 48, 96].map((size) => (
              <option key={size} value={size}>{size} per page</option>
            ))}
          </SelectField>
          <IconButton
            icon="chevron_left"
            label="Previous page"
            variant="tonal"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          />
          <IconButton
            icon="chevron_right"
            label="Next page"
            variant="tonal"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          />
        </div>
      </div>

      {details ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/65 p-2 backdrop-blur-sm md:p-3" onClick={() => setDetails(null)}>
          <div
            className="m3-card-raised flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] border-outline-variant/80"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3 border-b border-outline-variant/70 p-5">
              <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-[1rem] border ${platformMeta(details.platform).tile}`}>
                <Icon name={platformMeta(details.platform).icon} size={23} filled />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate font-display text-lg font-semibold tracking-tight">
                    {details.username || details.name || "Lead"}
                  </h2>
                  <PlatformBadge platform={details.platform} />
                </div>
                <p className="mt-1 truncate text-xs font-semibold text-on-surface-variant/70">
                  {details.jobTitle || details.title || details.clientLocation || "No role detected"}
                </p>
              </div>
              <ScoreRing score={details.leadScore ?? 0} size={52} />
              <IconButton icon="close" label="Close details" onClick={() => setDetails(null)} />
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <LeadDetail
                lead={details}
                onRefresh={async () => {
                  const res = await fetch(`${base}/api/leads/${details.id}`);
                  const data = (await res.json()) as { lead?: LeadDetail };
                  setDetails(data.lead || null);
                  setRefreshTick((tick) => tick + 1);
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SelectField({
  label,
  icon,
  value,
  onChange,
  children,
  compact = false,
}: {
  label: string;
  icon: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <label className={`block min-w-0 ${compact ? "w-[132px]" : ""}`}>
      {label ? <span className="m3-label mb-1.5 block">{label}</span> : null}
      <div className="relative">
        <Icon
          name={icon}
          size={17}
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-on-surface-variant/50 ${
            compact ? "right-2.5" : "left-3"
          }`}
        />
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`m3-field h-10 appearance-none pr-8 text-xs font-semibold ${compact ? "pl-3" : "pl-9"}`}
        >
          {children}
        </select>
      </div>
    </label>
  );
}

function LeadDetail({ lead, onRefresh }: { lead: LeadDetail; onRefresh: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [drafting, setDrafting] = useState(false);

  const patch = async (data: LeadPatch) => {
    await fetch(`${base}/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    await onRefresh();
  };

  const addNote = async () => {
    if (!note.trim()) return;
    await fetch(`${base}/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: note }),
    });
    setNote("");
    await onRefresh();
  };

  const draftReply = async () => {
    setDrafting(true);
    try {
      const res = await fetch(`${base}/api/ai/draft-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const data = (await res.json()) as { draft?: string; error?: string };
      setReply(data.draft || data.error || "");
    } finally {
      setDrafting(false);
    }
  };

  const recordOutreach = async (nextStatus: string, direction = "outbound") => {
    await fetch(`${base}/api/leads/${lead.id}/outreach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageContent: reply || "manual", direction, status: nextStatus }),
    });
    await onRefresh();
  };

  const activityIcon = (type: string) =>
    type === "discovered"
      ? "travel_explore"
      : type === "note"
        ? "note_add"
        : type === "status_change"
          ? "swap_horiz"
          : type === "reply_received"
            ? "reply"
            : type === "outreach"
              ? "send"
              : "bolt";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={lead.status} />
        {lead.freshness ? <FreshnessBadge lead={lead} /> : null}
        {lead.grade ? <Badge tone="primary" icon="workspace_premium">Grade {lead.grade}</Badge> : null}
        {lead.budget ? <Badge tone="success" icon="payments">{lead.budget}</Badge> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {lead.postUrl ? (
          <a href={lead.postUrl} target="_blank" rel="noreferrer" className="m3-button-outlined h-9 px-3 text-xs">
            <Icon name="open_in_new" size={16} />
            Original post
          </a>
        ) : null}
        {lead.profileUrl ? (
          <a href={lead.profileUrl} target="_blank" rel="noreferrer" className="m3-button-outlined h-9 px-3 text-xs">
            <Icon name="person" size={16} />
            Profile
          </a>
        ) : null}
      </div>

      <section className="rounded-[1.4rem] border border-outline-variant/60 bg-surface-container-low/70 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Icon name="notes" size={18} className="text-primary" />
          <h3 className="text-xs font-extrabold uppercase tracking-[0.14em] text-on-surface-variant">Post content</h3>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-6 text-on-surface">{lead.postContent || lead.title || "No content."}</p>
      </section>

      {lead.reasoning ? (
        <section className="rounded-[1.4rem] border border-primary/15 bg-primary/8 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Icon name="psychology" size={18} className="text-primary" />
            <h3 className="text-xs font-extrabold uppercase tracking-[0.14em] text-primary">Why this lead</h3>
          </div>
          <p className="text-sm leading-6 text-on-surface-variant">{lead.reasoning}</p>
        </section>
      ) : null}

      {lead.capabilities?.length > 0 || lead.skills?.length > 0 ? (
        <section>
          <h3 className="m3-label mb-2">Capabilities</h3>
          <div className="flex flex-wrap gap-1.5">
            {[...(lead.capabilities || []), ...(lead.skills || [])].map((capability) => (
              <span key={capability} className="m3-chip">{capability}</span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-[1.4rem] border border-outline-variant/60 bg-surface-container-low/70 p-4">
        <h3 className="mb-2 text-xs font-extrabold uppercase tracking-[0.14em] text-on-surface-variant">Add a note</h3>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          placeholder="What did you notice about this lead?"
          className="w-full resize-none rounded-2xl border border-outline-variant/80 bg-surface-container/80 p-3 text-sm outline-none transition placeholder:text-on-surface-variant/50 focus:border-primary/60 focus:ring-4 focus:ring-primary/10"
        />
        <div className="mt-2 flex justify-end">
          <Button variant="tonal" icon="note_add" className="h-9 px-4 text-xs" onClick={addNote} disabled={!note.trim()}>
            Add note
          </Button>
        </div>
        {lead.activities?.length > 0 ? (
          <div className="mt-4 space-y-2 border-t border-outline-variant/50 pt-4">
            {lead.activities.slice(0, 6).map((activity) => (
              <div key={activity.id} className="flex items-start gap-2.5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-container-high text-on-surface-variant">
                  <Icon name={activityIcon(activity.activityType)} size={14} />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-on-surface-variant/60">
                    {String(activity.activityType).replaceAll("_", " ")} · {new Date(activity.createdAt).toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-on-surface-variant">{activity.description}</p>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="flex flex-wrap gap-2">
        <Button variant="filled" icon="send" className="h-9 px-4 text-xs" onClick={() => patch({ status: "contacted" })}>
          Contacted
        </Button>
        <Button
          variant="tonal"
          icon={lead.isSaved ? "bookmark_added" : "bookmark_add"}
          className="h-9 px-4 text-xs"
          onClick={() => patch({ isSaved: !lead.isSaved })}
        >
          {lead.isSaved ? "Saved" : "Save"}
        </Button>
        <Button variant="tonal" icon="local_fire_department" className="h-9 px-4 text-xs" onClick={() => patch({ status: "interested" })}>
          Interested
        </Button>
        <Button variant="outlined" icon="archive" className="h-9 px-4 text-xs" onClick={() => patch({ isArchived: true })}>
          Archive
        </Button>
      </section>

      <section className="rounded-[1.4rem] border border-outline-variant/60 bg-surface-container-low/70 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-extrabold uppercase tracking-[0.14em] text-on-surface-variant">AI reply draft</h3>
            <p className="mt-1 text-xs text-on-surface-variant/60">Personalized from the captured signal.</p>
          </div>
          <Button variant="filled" icon="auto_awesome" className="h-9 px-4 text-xs" onClick={draftReply} disabled={drafting}>
            {drafting ? "Drafting…" : "Draft"}
          </Button>
        </div>
        <textarea
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          rows={6}
          placeholder="Your AI reply will appear here…"
          className="w-full resize-none rounded-2xl border border-outline-variant/80 bg-surface-container/80 p-3 text-sm leading-6 outline-none transition placeholder:text-on-surface-variant/50 focus:border-primary/60 focus:ring-4 focus:ring-primary/10"
        />
        <div className="mt-2 flex flex-wrap justify-end gap-1.5">
          <Button variant="outlined" icon="content_copy" className="h-9 px-3 text-xs" onClick={() => navigator.clipboard.writeText(reply)} disabled={!reply}>
            Copy
          </Button>
          <Button variant="tonal" icon="save" className="h-9 px-3 text-xs" onClick={() => recordOutreach("draft")} disabled={!reply}>
            Save draft
          </Button>
          <Button variant="filled" icon="outbox" className="h-9 px-3 text-xs" onClick={() => recordOutreach("sent")} disabled={!reply}>
            Mark sent
          </Button>
        </div>
      </section>

      {lead.outreach?.length > 0 ? (
        <section>
          <h3 className="m3-label mb-2">Outreach history</h3>
          <div className="space-y-2">
            {lead.outreach.map((outreach) => (
              <div key={outreach.id} className="rounded-2xl border border-outline-variant/60 bg-surface-container-low/70 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={outreach.direction === "inbound" ? "secondary" : "tertiary"} icon={outreach.direction === "inbound" ? "call_received" : "call_made"}>
                    {outreach.direction}
                  </Badge>
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface-variant/50">{outreach.status}</span>
                  <span className="ml-auto text-[10px] font-semibold text-on-surface-variant/50">{new Date(outreach.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-2 line-clamp-3 text-xs leading-5 text-on-surface-variant">{outreach.messageContent}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
