import type { IconComponent } from "../icons";

const panel = "cosmic-panel";

type MetricProps = {
  title: string;
  value: string;
  note: string;
  subnote?: string;
  icon: IconComponent;
  iconClass: string;
};

function Metric({ title, value, note, subnote, icon: MetricIcon, iconClass }: MetricProps) {
  return (
    <article className={`${panel} relative flex min-h-[148px] flex-col gap-4 overflow-hidden p-5`}>
      <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
        <span>{title}</span>
        <span className={`grid size-8 place-items-center rounded-full ${iconClass}`}>
          <MetricIcon aria-hidden="true" />
        </span>
      </div>
      <strong className="block font-heading text-[32px] leading-none font-medium tracking-tight text-card-foreground tabular-nums">
        {value}
      </strong>
      <p
        className={`text-[11px] font-semibold ${subnote ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}
      >
        {note}
        {subnote && <span className="font-normal text-muted-foreground"> {subnote}</span>}
      </p>
    </article>
  );
}

export { Metric };
