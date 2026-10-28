"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { createPortal } from "react-dom";
import remarkGfm from "remark-gfm";
import LeadCard from "@/components/LeadCard";
import Icon from "@/components/Icon";
import { Badge, IconButton } from "@/components/ui";
import { NEW_CHAT_EVENT, readActiveConversation, rememberActiveConversation } from "@/lib/chatSession";
import type { Lead } from "@prisma/client";
import type { ConversationDetail, ConversationSummary, ScrapeJobDetail, ScrapeJobSummary } from "@/types";

const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type Msg = { role: "user" | "assistant"; content: string };

const JOB_STATUS: Record<string, { label: string; icon: string; tone: "primary" | "secondary" | "tertiary" | "success" | "error" | "neutral" }> = {
  started: { label: "Starting scrape", icon: "progress_activity", tone: "primary" },
  scraping: { label: "Scraping sources", icon: "radar", tone: "tertiary" },
  ai_processing: { label: "Filtering signal", icon: "auto_awesome", tone: "secondary" },
  completed: { label: "Scrape complete", icon: "task_alt", tone: "success" },
  failed: { label: "Scrape failed", icon: "error", tone: "error" },
  timeout: { label: "Scrape timed out", icon: "timer", tone: "error" },
};

const SUGGESTIONS = [
  { text: "Show me the latest 10 leads.", icon: "bolt", label: "Fresh signals" },
  { text: "Show only leads from LinkedIn.", icon: "work", label: "LinkedIn only" },
  { text: "Find leads collected in the last 24 hours.", icon: "schedule", label: "Last 24 hours" },
  { text: "Find people looking for web development services.", icon: "code", label: "Web dev intent" },
  { text: "Show high-intent leads I haven't contacted.", icon: "local_fire_department", label: "Hot & untouched" },
  { text: "Summarize today's new leads.", icon: "summarize", label: "Daily brief" },
];

function Dots() {
  return (
    <div className="flex items-center gap-1.5 py-2 text-primary">
      <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
      <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
      <span className="h-2 w-2 rounded-full bg-primary animate-bounce" />
    </div>
  );
}

export default function AiPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [scrapeJobs, setScrapeJobs] = useState<ScrapeJobSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const loadedJobsRef = useRef<Set<string>>(new Set());
  const loadRequestRef = useRef(0);

  const fetchConversations = async () => {
    try {
      const response = await fetch(`${base}/api/chat`);
      const data = (await response.json()) as { conversations?: ConversationSummary[] };
      if (Array.isArray(data.conversations)) setConversations(data.conversations);
    } catch {}
  };

  const loadConversation = async (id: string) => {
    const request = ++loadRequestRef.current;
    try {
      const response = await fetch(`${base}/api/chat/${id}`);
      if (request !== loadRequestRef.current) return;
      if (!response.ok) {
        if (readActiveConversation() === id) rememberActiveConversation(null);
        return;
      }
      const data = (await response.json()) as { conversation?: ConversationDetail };
      if (request !== loadRequestRef.current) return;
      if (data.conversation) {
        setConversationId(data.conversation.id);
        setMessages((data.conversation.messages || []).map((message) => ({ role: message.role as Msg["role"], content: message.content })));
        setLeads([]);
        setLeadsLoading(false);
        setScrapeJobs([]);
        loadedJobsRef.current.clear();
        rememberActiveConversation(data.conversation.id);
      }
    } catch {}
  };

  const newChat = useCallback(() => {
    loadRequestRef.current++;
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setInput("");
    setLeads([]);
    setScrapeJobs([]);
    loadedJobsRef.current.clear();
    rememberActiveConversation(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchConversations();
      if (cancelled) return;
      const stored = readActiveConversation();
      if (stored) await loadConversation(stored);
      if (!cancelled) setRestoring(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleNewChat = () => newChat();
    window.addEventListener(NEW_CHAT_EVENT, handleNewChat);
    return () => window.removeEventListener(NEW_CHAT_EVENT, handleNewChat);
  }, [newChat]);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${base}/api/scrape/jobs?conversationId=${conversationId}`);
        const data = (await response.json()) as { jobs?: ScrapeJobSummary[] };
        if (cancelled || !Array.isArray(data.jobs)) return;
        setScrapeJobs(data.jobs);

        const finished = data.jobs.filter(
          (job) =>
            job.status === "completed" &&
            Array.isArray(job.leadIds) &&
            job.leadIds.length > 0 &&
            !loadedJobsRef.current.has(job.id)
        );

        for (const job of finished) {
          loadedJobsRef.current.add(job.id);
          try {
            const detailResponse = await fetch(`${base}/api/scrape/jobs/${job.id}`);
            const detail = (await detailResponse.json()) as ScrapeJobDetail;
            if (cancelled || !Array.isArray(detail.leads) || detail.leads.length === 0) continue;
            setLeads((previous) => {
              const existing = new Set(previous.map((lead) => lead.id));
              return [...previous, ...detail.leads.filter((lead) => !existing.has(lead.id))];
            });
          } catch {}
        }
      } catch {}
    };

    load();
    const timer = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [conversationId]);

  useEffect(() => {
    if (messages.length === 0 && leads.length === 0) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, leads, leadsLoading]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMessage = text.trim();
    setMessages((previous) => [...previous, { role: "user", content: userMessage }, { role: "assistant", content: "" }]);
    setInput("");
    setLeads([]);
    setLeadsLoading(true);
    setLoading(true);
    let current = "";
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: userMessage }),
        signal: controller.signal,
      });
      const returnedConversationId = response.headers.get("X-Conversation-Id");
      if (returnedConversationId) {
        setConversationId(returnedConversationId);
        rememberActiveConversation(returnedConversationId);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        current += decoder.decode(value, { stream: true });
        setMessages((previous) => {
          const copy = [...previous];
          copy[copy.length - 1] = { role: "assistant", content: current };
          return copy;
        });
      }

      const activeConversationId = conversationId || returnedConversationId;
      if (activeConversationId) {
        try {
          const leadsResponse = await fetch(`${base}/api/chat/leads?conversationId=${activeConversationId}`);
          const leadsData = (await leadsResponse.json()) as { leads?: Lead[] };
          if (Array.isArray(leadsData.leads)) setLeads(leadsData.leads);
        } catch {}
      }
      await fetchConversations();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setMessages((previous) => {
          const copy = [...previous];
          copy[copy.length - 1] = { role: "assistant", content: current || "(stopped)" };
          return copy;
        });
      } else {
        setMessages((previous) => {
          const copy = [...previous];
          copy[copy.length - 1] = { role: "assistant", content: `Error: ${error instanceof Error ? error.message : String(error)}` };
          return copy;
        });
      }
    } finally {
      setLoading(false);
      setLeadsLoading(false);
      abortRef.current = null;
    }
  };

  const activeJob = scrapeJobs[0];

  return (
    <div className="h-[calc(100dvh-5.75rem)] min-h-[580px] p-3 lg:h-screen lg:p-5">
      <div className="m3-card flex h-full overflow-hidden rounded-[2rem] bg-surface-container-low/60">
        <aside className="hidden w-[278px] shrink-0 flex-col border-r border-outline-variant/60 bg-surface-container-low/50 lg:flex">
          <div className="px-4 pb-2 pt-4">
            <div className="px-1">
              <p className="m3-label">Your threads</p>
              <h2 className="mt-1 font-display text-base font-semibold tracking-tight">Chat history</h2>
            </div>
          </div>

          <div className="no-scrollbar flex-1 space-y-1 overflow-y-auto px-3 pb-4">
            {conversations.map((conversation) => {
              const active = conversationId === conversation.id;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => loadConversation(conversation.id)}
                  className={`group flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left transition ${
                    active ? "bg-primary/15 text-primary" : "text-on-surface-variant hover:bg-on-surface/6 hover:text-on-surface"
                  }`}
                >
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
                      active ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant"
                    }`}
                  >
                    <Icon name="chat_bubble" size={16} filled={active} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-extrabold">{conversation.title || "Untitled search"}</span>
                    <span className="mt-0.5 block text-[10px] font-semibold text-on-surface-variant/50">
                      {new Date(conversation.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </span>
                  {active ? <Icon name="chevron_right" size={16} /> : null}
                </button>
              );
            })}
            {conversations.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <Icon name="forum" size={28} className="text-on-surface-variant/30" />
                <p className="mt-2 text-xs font-semibold text-on-surface-variant/60">No conversations yet.</p>
              </div>
            ) : null}
          </div>

          <div className="p-4">
            <div className="rounded-[1.4rem] border border-secondary/15 bg-secondary/8 p-3.5">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-secondary/15 text-secondary">
                  <Icon name="neurology" size={18} />
                </span>
                <div>
                  <p className="text-[11px] font-extrabold text-on-surface">Assistant ready</p>
                  <p className="text-[9px] font-semibold text-on-surface-variant/60">GPT-powered lead search</p>
                </div>
                <span className="ml-auto h-1.5 w-1.5 animate-pulse-soft rounded-full bg-secondary" />
              </div>
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-outline-variant/60 px-4 py-3 md:px-6">
            <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-[1rem] bg-gradient-to-br from-[#d4c7ff] via-[#9d7cff] to-[#4c33ba] text-on-primary shadow-[0_12px_30px_-14px_rgba(157,124,255,0.9)]">
              <Icon name="auto_awesome" size={22} filled />
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-container bg-success" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate font-display text-base font-semibold tracking-tight">AI Lead Finder</h1>
                <Badge tone="secondary" icon="bolt" filled >
                  Live
                </Badge>
              </div>
              <p className="truncate text-[11px] font-semibold text-on-surface-variant/60">
                Search your memory, scrape fresh intent, and summarize the signal.
              </p>
            </div>
            <IconButton icon="history" label="Chat history" variant="tonal" onClick={() => setHistoryOpen(true)} className="lg:hidden" />
            <IconButton icon="add_comment" label="New chat" variant="tonal" onClick={newChat} className="lg:hidden" />
          </header>

          <div className="no-scrollbar flex gap-2 overflow-x-auto border-b border-outline-variant/50 px-4 py-2 lg:hidden">
            {conversations.slice(0, 8).map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => loadConversation(conversation.id)}
                className={conversationId === conversation.id ? "m3-chip-active" : "m3-chip"}
              >
                <Icon name="chat_bubble" size={14} />
                <span className="max-w-36 truncate">{conversation.title || "Untitled"}</span>
              </button>
            ))}
          </div>

          {activeJob ? (
            <div className="border-b border-outline-variant/50 px-4 py-2.5 md:px-6">
              <div className="no-scrollbar flex items-center gap-2 overflow-x-auto">
                {scrapeJobs.slice(0, 4).map((job) => {
                  const status = JOB_STATUS[job.status] || JOB_STATUS.started;
                  const running = !["completed", "failed", "timeout"].includes(job.status);
                  return (
                    <span
                      key={job.id}
                      className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-extrabold ${
                        status.tone === "success"
                          ? "border-success/25 bg-success/10 text-success"
                          : status.tone === "error"
                            ? "border-error/25 bg-error/10 text-error"
                            : status.tone === "secondary"
                              ? "border-secondary/25 bg-secondary/10 text-secondary"
                              : "border-primary/20 bg-primary/10 text-primary"
                      }`}
                    >
                      <Icon name={status.icon} size={15} filled className={running ? "animate-spin" : ""} />
                      {status.label}
                      {job.keywords?.length ? <span className="text-on-surface-variant/60">· {job.keywords.slice(0, 2).join(", ")}</span> : null}
                      {Array.isArray(job.leadIds) && job.leadIds.length > 0 ? (
                        <span className="text-on-surface-variant/60">· {job.leadIds.length} leads</span>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6 lg:px-8">
            <div className="mx-auto flex max-w-4xl flex-col gap-6">
              {restoring ? (
                <div className="flex items-center gap-2 py-16 text-xs font-semibold text-on-surface-variant/60">
                  <Icon name="progress_activity" size={17} className="animate-spin text-primary" />
                  Restoring your last chat…
                </div>
              ) : null}

              {!restoring && messages.length === 0 ? (
                <div className="animate-enter py-4 md:py-8">
                  <div className="max-w-2xl">
                    <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-primary">
                      <Icon name="auto_awesome" size={14} filled />
                      LeadGun assistant
                    </div>
                    <h2 className="font-display text-4xl font-semibold leading-[1.05] tracking-[-0.055em] text-on-surface md:text-5xl">
                      What should we <span className="text-gradient">hunt down?</span>
                    </h2>
                    <p className="mt-4 max-w-xl text-sm leading-6 text-on-surface-variant">
                      Ask about your lead memory, or describe the exact buyer intent you want. I can search, scrape, and
                      summarize without leaving this chat.
                    </p>
                  </div>

                  <div className="mt-8 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {SUGGESTIONS.map((suggestion, index) => (
                      <button
                        key={suggestion.text}
                        type="button"
                        onClick={() => send(suggestion.text)}
                        className="m3-card-interactive group flex items-start gap-3 p-4 text-left animate-enter"
                        style={{ animationDelay: `${index * 45}ms` }}
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[0.85rem] border border-primary/15 bg-primary/10 text-primary">
                          <Icon name={suggestion.icon} size={18} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] font-extrabold uppercase tracking-[0.12em] text-on-surface-variant/50">
                            {suggestion.label}
                          </span>
                          <span className="mt-1 block text-xs font-semibold leading-5 text-on-surface">
                            {suggestion.text}
                          </span>
                        </span>
                        <Icon name="north_east" size={16} className="mt-1 text-on-surface-variant/30 transition group-hover:text-primary" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`animate-enter flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {message.role === "assistant" ? (
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                      <Icon name="auto_awesome" size={17} filled />
                    </span>
                  ) : null}

                  {message.role === "user" ? (
                    <div className="max-w-[85%] rounded-[1.4rem] rounded-br-md bg-primary px-4 py-3 text-sm font-semibold leading-6 text-on-primary shadow-[0_12px_32px_-18px_rgba(203,187,255,0.8)]">
                      {message.content}
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1 pt-0.5">
                      {message.content ? (
                        <div className="m3-markdown max-w-none text-sm leading-7 text-on-surface-variant">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                        </div>
                      ) : loading && index === messages.length - 1 ? (
                        <Dots />
                      ) : null}
                    </div>
                  )}

                  {message.role === "user" ? (
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-container-high text-on-surface-variant">
                      <Icon name="person" size={17} filled />
                    </span>
                  ) : null}
                </div>
              ))}

              {leadsLoading && messages.length > 0 ? (
                <div className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant/60">
                  <Icon name="radar" size={16} className="animate-spin text-secondary" />
                  Looking for matching leads…
                </div>
              ) : null}

              {leads.length > 0 && !leadsLoading ? (
                <div className="animate-enter space-y-3 border-t border-outline-variant/50 pt-6">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="m3-label">Surfaced for you</p>
                      <h3 className="mt-1 font-display text-lg font-semibold tracking-tight">
                        {leads.length} matching {leads.length === 1 ? "lead" : "leads"}
                      </h3>
                    </div>
                    <Badge tone="primary" icon="auto_awesome" filled>
                      AI results
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {leads.map((lead) => (
                      <LeadCard key={lead.id} lead={lead} />
                    ))}
                  </div>
                </div>
              ) : null}

              <div ref={bottomRef} />
            </div>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              send(input);
            }}
            className="border-t border-outline-variant/60 bg-surface-container-low/60 p-3 md:p-4"
          >
            <div className="mx-auto max-w-4xl">
              <div className="relative flex items-end gap-2 rounded-[1.55rem] border border-outline-variant/80 bg-surface-container-high/80 p-1.5 pl-4 shadow-[0_18px_50px_-30px_rgba(0,0,0,0.95)] backdrop-blur-xl transition focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10">
                <Icon name="auto_awesome" size={20} className="mb-3 text-primary/70" />
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      send(input);
                    }
                  }}
                  rows={1}
                  placeholder="Ask LeadGun anything…"
                  className="max-h-32 min-h-11 flex-1 resize-none bg-transparent py-3 text-sm leading-6 text-on-surface outline-none placeholder:text-on-surface-variant/50"
                  aria-label="Message LeadGun Assistant"
                />
                {loading ? (
                  <IconButton
                    icon="stop_circle"
                    label="Stop response"
                    variant="tonal"
                    className="mb-0.5 h-10 w-10 text-error"
                    onClick={() => abortRef.current?.abort()}
                  />
                ) : null}
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  aria-label="Send message"
                  className="mb-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-[1rem] bg-primary text-on-primary transition hover:bg-primary/90 disabled:opacity-35"
                >
                  <Icon name="arrow_upward" size={20} />
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between px-1 text-[10px] font-semibold text-on-surface-variant/40">
                <span className="flex items-center gap-1.5">
                  <Icon name="lock" size={13} />
                  Private to your workspace
                </span>
                <span className="hidden sm:inline">Enter to send · Shift + Enter for a new line</span>
              </div>
            </div>
          </form>
        </main>
      </div>

      {historyOpen
        ? createPortal(
            <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="Chat history">
          <button
            type="button"
            aria-label="Close chat history"
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            onClick={() => setHistoryOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[78dvh] flex-col overflow-hidden rounded-t-[2rem] border border-outline-variant/70 bg-surface-container-high/95 shadow-[0_-30px_90px_-20px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
            <div className="flex items-center gap-3 border-b border-outline-variant/60 px-5 py-4">
              <span className="grid h-10 w-10 place-items-center rounded-[0.9rem] bg-primary/15 text-primary">
                <Icon name="history" size={21} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="m3-label">Your threads</p>
                <h2 className="font-display text-base font-semibold tracking-tight">Chat history</h2>
              </div>
              <IconButton icon="close" label="Close chat history" variant="tonal" onClick={() => setHistoryOpen(false)} />
            </div>
            <div className="no-scrollbar flex-1 space-y-1 overflow-y-auto p-3 pb-8">
              {conversations.map((conversation) => {
                const active = conversationId === conversation.id;
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => {
                      loadConversation(conversation.id);
                      setHistoryOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${
                      active ? "bg-primary/15 text-primary" : "text-on-surface-variant hover:bg-on-surface/6 hover:text-on-surface"
                    }`}
                  >
                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                        active ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant"
                      }`}
                    >
                      <Icon name="chat_bubble" size={17} filled={active} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-extrabold">{conversation.title || "Untitled search"}</span>
                      <span className="mt-0.5 block text-[10px] font-semibold text-on-surface-variant/50">
                        {new Date(conversation.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </span>
                    {active ? <Icon name="check_circle" size={17} filled /> : <Icon name="chevron_right" size={16} />}
                  </button>
                );
              })}
              {conversations.length === 0 ? (
                <div className="px-3 py-12 text-center">
                  <Icon name="forum" size={32} className="text-on-surface-variant/30" />
                  <p className="mt-2 text-xs font-semibold text-on-surface-variant/60">No conversations yet.</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>,
            document.body,
          )
        : null}
    </div>
  );
}
