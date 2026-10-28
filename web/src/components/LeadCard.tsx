"use client";

import Link from "next/link";
import { Lead } from "@prisma/client";
import Icon from "./Icon";
import { Badge, FreshnessBadge, IconButton, ScoreRing, StatusBadge, platformMeta } from "./ui";
import type { LeadPatch } from "@/types";

export default function LeadCard({
  lead,
  onChanged,
  selected,
  onSelect,
  onOpenDetails,
}: {
  lead: Lead;
  onChanged?: () => void;
  selected?: boolean;
  onSelect?: () => void;
  onOpenDetails?: () => void;
}) {
  const patch = async (data: LeadPatch) => {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000"}/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    onChanged?.();
  };

  const score = lead.leadScore ?? 0;
  const meta = platformMeta(lead.platform);
  const posted = lead.postedAt || lead.discoveredAt;

  return (
    <article className="m3-card-interactive group relative flex h-full flex-col gap-4 overflow-hidden p-5">
      <span className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-primary/0 blur-3xl transition duration-500 group-hover:bg-primary/10" />

      <div className="relative flex items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[1rem] border ${meta.tile}`}>
          <Icon name={meta.icon} size={21} filled />
        </span>

        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-extrabold tracking-tight text-on-surface">
              {lead.username || lead.name || "Unknown lead"}
            </h3>
            {score >= 80 ? (
              <Badge tone="error" icon="local_fire_department" filled >
                Hot
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs font-semibold text-on-surface-variant/80">
            {lead.jobTitle || lead.title || lead.clientLocation || "No role detected"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-on-surface-variant/55">
              {lead.platform}
            </span>
            {lead.grade ? (
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface-variant/45">
                · Grade {lead.grade}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2 self-start">
          {onSelect ? (
            <button
              type="button"
              onClick={onSelect}
              aria-label={selected ? "Deselect lead" : "Select lead"}
              aria-pressed={selected}
              className={`grid h-7 w-7 place-items-center rounded-full transition ${
                selected
                  ? "text-primary"
                  : "text-on-surface-variant/35 hover:text-on-surface-variant"
              }`}
            >
              <Icon name={selected ? "check_box" : "check_box_outline_blank"} size={20} filled={selected} />
            </button>
          ) : null}
          <ScoreRing score={score} />
        </div>
      </div>

      <p className="relative line-clamp-3 text-sm leading-6 text-on-surface-variant">
        {lead.postContent || lead.title || "No post content available."}
      </p>

      <div className="relative mt-auto flex flex-wrap items-center gap-1.5">
        <StatusBadge status={lead.status} />
        {lead.freshness ? <FreshnessBadge lead={lead} /> : null}
        {lead.capabilities?.slice(0, 2).map((capability) => (
          <span key={capability} className="m3-chip">
            {capability}
          </span>
        ))}
      </div>

      <div className="relative flex items-center gap-1 border-t border-outline-variant/60 pt-3">
        <span className="mr-auto flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-on-surface-variant/60">
          <Icon name="schedule" size={15} />
          <span className="truncate">
            {posted ? new Date(posted).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Date unknown"}
          </span>
        </span>

        {lead.postUrl ? (
          <a
            href={lead.postUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open original post"
            title="Open original post"
            className="m3-icon-button h-9 w-9"
          >
            <Icon name="open_in_new" size={18} />
          </a>
        ) : null}
        {onOpenDetails ? (
          <button
            type="button"
            onClick={onOpenDetails}
            aria-label="View lead details"
            title="View lead details"
            className="m3-icon-button h-9 w-9"
          >
            <Icon name="arrow_outward" size={18} />
          </button>
        ) : (
          <Link
            href={`/explorer?lead=${lead.id}`}
            aria-label="View lead details"
            title="View lead details"
            className="m3-icon-button h-9 w-9"
          >
            <Icon name="arrow_outward" size={18} />
          </Link>
        )}
        <IconButton
          icon={lead.isSaved ? "bookmark_added" : "bookmark_add"}
          label={lead.isSaved ? "Remove from saved" : "Save lead"}
          size={18}
          filled={lead.isSaved}
          className={`h-9 w-9 ${lead.isSaved ? "text-primary" : ""}`}
          onClick={() => patch({ isSaved: !lead.isSaved })}
        />
        <IconButton
          icon="send"
          label="Mark as contacted"
          size={18}
          className="h-9 w-9"
          onClick={() => patch({ status: "contacted" })}
        />
        <IconButton
          icon="archive"
          label="Archive lead"
          size={18}
          className="h-9 w-9"
          onClick={() => patch({ isArchived: true })}
        />
      </div>
    </article>
  );
}
