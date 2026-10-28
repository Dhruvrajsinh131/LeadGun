import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import Icon from "./Icon";

type ButtonVariant = "filled" | "tonal" | "outlined" | "text";

const buttonClasses: Record<ButtonVariant, string> = {
  filled: "m3-button-filled",
  tonal: "m3-button-tonal",
  outlined: "m3-button-outlined",
  text: "m3-button-text",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: string;
  trailingIcon?: string;
};

export function Button({
  variant = "filled",
  icon,
  trailingIcon,
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button className={`${buttonClasses[variant]} ${className}`} {...props}>
      {icon ? <Icon name={icon} size={19} /> : null}
      {children}
      {trailingIcon ? <Icon name={trailingIcon} size={18} /> : null}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "filled",
  icon,
  trailingIcon,
  className = "",
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  icon?: string;
  trailingIcon?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${buttonClasses[variant]} ${className}`}>
      {icon ? <Icon name={icon} size={19} /> : null}
      {children}
      {trailingIcon ? <Icon name={trailingIcon} size={18} /> : null}
    </Link>
  );
}

export function IconButton({
  icon,
  label,
  variant = "plain",
  size = 20,
  className = "",
  filled = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: string;
  label: string;
  variant?: "plain" | "filled" | "tonal";
  size?: number;
  filled?: boolean;
}) {
  const variantClass =
    variant === "filled"
      ? "m3-icon-button-filled"
      : variant === "tonal"
        ? "m3-icon-button-tonal"
        : "m3-icon-button";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`${variantClass} ${className}`}
      {...props}
    >
      <Icon name={icon} size={size} filled={filled} />
    </button>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  icon,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: string;
  icon?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? (
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.16em] text-primary">
            {icon ? <Icon name={icon} size={15} filled /> : null}
            {eyebrow}
          </div>
        ) : null}
        <h1 className="font-display text-3xl font-semibold tracking-[-0.045em] text-on-surface md:text-[2.65rem] md:leading-[1.05]">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-on-surface-variant md:text-[15px]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

const badgeTones = {
  neutral: "border-outline-variant/70 bg-surface-container-high/80 text-on-surface-variant",
  primary: "border-primary/25 bg-primary/12 text-primary",
  secondary: "border-secondary/25 bg-secondary/10 text-secondary",
  tertiary: "border-tertiary/25 bg-tertiary/10 text-tertiary",
  success: "border-success/25 bg-success/10 text-success",
  error: "border-error/25 bg-error/10 text-error",
  info: "border-info/25 bg-info/10 text-info",
};

type BadgeTone = keyof typeof badgeTones;

export function Badge({
  children,
  icon,
  tone = "neutral",
  className = "",
  filled = false,
}: {
  children: ReactNode;
  icon?: string;
  tone?: BadgeTone;
  className?: string;
  filled?: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-extrabold capitalize tracking-wide ${badgeTones[tone]} ${className}`}
    >
      {icon ? <Icon name={icon} size={14} filled={filled} /> : null}
      {children}
    </span>
  );
}

const platformStyle: Record<string, { icon: string; tone: BadgeTone; tile: string }> = {
  reddit: {
    icon: "forum",
    tone: "tertiary",
    tile: "bg-[#ff6a3d]/12 text-[#ff8a66] border-[#ff6a3d]/20",
  },
  x: {
    icon: "alternate_email",
    tone: "neutral",
    tile: "bg-on-surface/8 text-on-surface border-on-surface/15",
  },
  linkedin: {
    icon: "work",
    tone: "info",
    tile: "bg-[#60a5fa]/12 text-[#8ecaff] border-[#60a5fa]/20",
  },
  upwork: {
    icon: "work_history",
    tone: "success",
    tile: "bg-[#14a800]/12 text-[#83f2b1] border-[#14a800]/20",
  },
};

export function platformMeta(platform: string) {
  return (
    platformStyle[platform?.toLowerCase()] || {
      icon: "public",
      tone: "neutral" as BadgeTone,
      tile: "bg-on-surface/8 text-on-surface-variant border-outline-variant",
    }
  );
}

export function PlatformBadge({ platform }: { platform: string }) {
  const meta = platformMeta(platform);
  return (
    <Badge tone={meta.tone} icon={meta.icon}>
      {platform || "unknown"}
    </Badge>
  );
}

const statusStyle: Record<string, { icon: string; tone: BadgeTone; label: string }> = {
  new: { icon: "fiber_new", tone: "info", label: "New" },
  saved: { icon: "bookmark", tone: "primary", label: "Saved" },
  contacted: { icon: "send", tone: "tertiary", label: "Contacted" },
  replied: { icon: "reply", tone: "secondary", label: "Replied" },
  interested: { icon: "local_fire_department", tone: "error", label: "Interested" },
  archived: { icon: "archive", tone: "neutral", label: "Archived" },
  lost: { icon: "block", tone: "error", label: "Lost" },
};

export function StatusBadge({ status }: { status: string }) {
  const meta = statusStyle[status?.toLowerCase()] || {
    icon: "circle",
    tone: "neutral" as BadgeTone,
    label: status || "Unknown",
  };
  return (
    <Badge tone={meta.tone} icon={meta.icon}>
      {meta.label}
    </Badge>
  );
}

export function FreshnessBadge({ lead }: { lead: { isHealthy?: boolean | null; isFresh?: boolean | null; ageLabel?: string | null } }) {
  if (lead.isHealthy) {
    return (
      <Badge tone="success" icon="bolt" filled>
        Fresh{lead.ageLabel ? ` · ${lead.ageLabel}` : ""}
      </Badge>
    );
  }
  if (lead.isFresh) {
    return (
      <Badge tone="tertiary" icon="schedule">
        Aging{lead.ageLabel ? ` · ${lead.ageLabel}` : ""}
      </Badge>
    );
  }
  return (
    <Badge tone="error" icon="history">
      Stale{lead.ageLabel ? ` · ${lead.ageLabel}` : ""}
    </Badge>
  );
}

export function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="m3-card flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-[1.4rem] border border-primary/20 bg-primary/10 text-primary">
        <Icon name={icon} size={32} />
      </div>
      <h3 className="font-display text-lg font-semibold tracking-tight text-on-surface">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-sm text-sm leading-6 text-on-surface-variant">{description}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label = "Loading signal…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm font-semibold text-on-surface-variant">
      <span className="relative flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-50" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
      </span>
      {label}
    </div>
  );
}

export function ScoreRing({ score, size = 48 }: { score: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, score || 0));
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(#cbbbff ${clamped * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
      }}
      title={`Lead score ${clamped}`}
    >
      <div
        className="grid place-items-center rounded-full bg-surface-container-high font-display text-[11px] font-bold text-on-surface"
        style={{ width: size - 7, height: size - 7 }}
      >
        {clamped}
      </div>
    </div>
  );
}
