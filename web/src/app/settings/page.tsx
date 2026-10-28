"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { Badge, LoadingState, PageHeader } from "@/components/ui";
import type { ScraperSetting } from "@/types";

const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export default function SettingsPage() {
  const [scrapers, setScrapers] = useState<ScraperSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${base}/api/scrapers`);
        if (!response.ok) throw new Error("Could not load scraper settings.");
        const data = (await response.json()) as { scrapers?: ScraperSetting[] };
        if (!cancelled && Array.isArray(data.scrapers)) setScrapers(data.scrapers);
      } catch {
        if (!cancelled) setError("Could not load scraper settings. Is the API running?");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (scraper: ScraperSetting) => {
    if (saving) return;
    const enabled = !scraper.enabled;
    const previous = scrapers;
    setSaving(scraper.id);
    setError(null);
    setScrapers((current) =>
      current.map((item) => (item.id === scraper.id ? { ...item, enabled } : item))
    );
    try {
      const response = await fetch(`${base}/api/scrapers/${scraper.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error("Could not update scraper.");
      const data = (await response.json()) as { scrapers?: ScraperSetting[] };
      if (Array.isArray(data.scrapers)) setScrapers(data.scrapers);
    } catch {
      setScrapers(previous);
      setError(`Could not ${enabled ? "enable" : "disable"} ${scraper.label}. Try again.`);
    } finally {
      setSaving(null);
    }
  };

  const enabledCount = scrapers.filter((scraper) => scraper.enabled).length;

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 px-5 pb-28 pt-6 lg:px-10 lg:pb-12 lg:pt-10">
      <PageHeader
        eyebrow="Scraper controls"
        icon="radar"
        title={
          <>
            Choose your <span className="text-gradient">sources.</span>
          </>
        }
        description="Turn each scraper on or off. Disabled sources are skipped by AI searches and scheduled runs."
        actions={
          scrapers.length > 0 ? (
            <Badge tone={enabledCount > 0 ? "primary" : "neutral"} icon="sensors" filled>
              {enabledCount}/{scrapers.length} active
            </Badge>
          ) : null
        }
      />

      {error ? (
        <div className="flex items-center gap-2.5 rounded-2xl border border-error/25 bg-error/10 px-4 py-3 text-xs font-bold text-error">
          <Icon name="error" size={17} />
          {error}
        </div>
      ) : null}

      {loading ? (
        <LoadingState label="Loading scraper sources…" />
      ) : (
        <section className="m3-card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-outline-variant/60 p-5 md:p-6">
            <span className="grid h-11 w-11 place-items-center rounded-[1rem] border border-primary/20 bg-primary/10 text-primary">
              <Icon name="travel_explore" size={22} />
            </span>
            <div>
              <p className="m3-label">Lead sources</p>
              <h2 className="mt-0.5 font-display text-lg font-semibold tracking-tight">Scraper toggles</h2>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 md:p-5">
            {scrapers.map((scraper) => (
              <div
                key={scraper.id}
                className={`flex items-center gap-3.5 rounded-[1.4rem] border p-4 transition ${
                  scraper.enabled
                    ? "border-primary/25 bg-primary/[0.07]"
                    : "border-outline-variant/60 bg-surface-container-low/60"
                }`}
              >
                <span
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-[0.95rem] border ${
                    scraper.enabled
                      ? "border-primary/20 bg-primary/15 text-primary"
                      : "border-outline-variant/60 bg-surface-container-high text-on-surface-variant/60"
                  }`}
                >
                  <Icon name={scraper.icon} size={21} filled={scraper.enabled} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-extrabold text-on-surface">{scraper.label}</h3>
                    <span
                      className={`text-[9px] font-extrabold uppercase tracking-[0.12em] ${
                        scraper.enabled ? "text-primary" : "text-on-surface-variant/45"
                      }`}
                    >
                      {scraper.enabled ? "On" : "Off"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] font-semibold leading-4 text-on-surface-variant/60">
                    {scraper.description}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={scraper.enabled}
                  aria-label={`${scraper.enabled ? "Disable" : "Enable"} ${scraper.label}`}
                  aria-busy={saving === scraper.id}
                  disabled={saving === scraper.id}
                  onClick={() => toggle(scraper)}
                  className={`relative h-8 w-14 shrink-0 rounded-full border transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 disabled:cursor-wait ${
                    scraper.enabled
                      ? "border-primary bg-primary shadow-[0_8px_22px_-12px_rgba(203,187,255,0.9)]"
                      : "border-outline-variant bg-surface-container-highest"
                  }`}
                >
                  <span
                    className={`absolute top-1 grid h-6 w-6 place-items-center rounded-full transition-all ${
                      scraper.enabled
                        ? "left-7 bg-on-primary text-primary"
                        : "left-1 bg-on-surface-variant text-surface-container-highest"
                    }`}
                  >
                    {saving === scraper.id ? (
                      <Icon name="progress_activity" size={13} className="animate-spin" />
                    ) : null}
                  </span>
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-start gap-2.5 border-t border-outline-variant/50 bg-surface-container-low/40 px-5 py-4 md:px-6">
            <Icon name="page_info" size={17} className="mt-0.5 shrink-0 text-on-surface-variant/50" />
            <p className="text-[11px] font-semibold leading-5 text-on-surface-variant/55">
              Changes apply immediately to new AI searches and scheduled runs. Runs already in progress are not interrupted.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
