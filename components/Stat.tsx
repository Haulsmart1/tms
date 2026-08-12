import { cn } from "../lib/cn";

type Tone = "positive" | "warning" | "danger" | "neutral";

const dotTone: Record<Tone, string> = {
  positive: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-ink-3",
};

const subTextTone: Record<Tone, string> = {
  positive: "text-success-strong",
  warning: "text-warning-strong",
  danger: "text-danger-strong",
  neutral: "text-ink-3",
};

type Props = {
  label: string;
  value: string;
  sub?: string;
  subTone?: Tone;
  onClick?: () => void;
};

export default function Stat({ label, value, sub, subTone = "neutral", onClick }: Props) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-col items-start gap-1 rounded-lg border border-line bg-surface p-4 text-left shadow-sm",
        onClick && "cursor-pointer hover:border-primary-tint-border hover:shadow-md",
      )}
    >
      <span className="text-xs font-medium text-ink-3">{label}</span>
      <span className="font-mono text-2xl font-semibold tabular-nums slashed-zero text-ink">{value}</span>
      {sub ? (
        <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", subTextTone[subTone])}>
          <span aria-hidden className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", dotTone[subTone])} />
          {sub}
        </span>
      ) : null}
    </Tag>
  );
}
