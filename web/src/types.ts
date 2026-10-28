import type { ChatMessage, Lead, LeadActivity, Outreach } from "@prisma/client";

export type Metrics = {
  total: number;
  today: number;
  week: number;
  uncontacted: number;
  saved: number;
  replied: number;
  interested: number;
  outreachCount: number;
};

type StatsActivity = LeadActivity & {
  lead?: Pick<Lead, "platform" | "username" | "title"> | null;
};

export type Stats = {
  metrics: Metrics;
  byPlatform: Array<{ platform: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  latest: Lead[];
  activity: StatsActivity[];
};

export type LeadDetail = Lead & {
  activities: LeadActivity[];
  outreach: Outreach[];
};

export type ConversationSummary = {
  id: string;
  title: string | null;
  createdAt?: string;
  updatedAt: string;
};

export type ConversationDetail = ConversationSummary & {
  messages: Array<Pick<ChatMessage, "role" | "content">>;
};

export type ScrapeJobSummary = {
  id: string;
  status: string;
  sources?: string[];
  keywords: string[];
  leadIds: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type ScrapeJobDetail = ScrapeJobSummary & {
  leads: Lead[];
};

export type LeadPatch = Partial<Pick<Lead, "status" | "isSaved" | "isArchived">> & {
  notes?: string;
};

export type ScraperSetting = {
  id: string;
  label: string;
  description: string;
  icon: string;
  enabled: boolean;
};
