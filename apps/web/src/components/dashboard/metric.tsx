import type { IconComponent } from "../icons";

const panel = "rounded-2xl border border-border bg-card shadow-sm shadow-primary/5";

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
    <article className={`${panel} min-h-[148px] p-5`}>
      <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
        <span>{title}</span>
        <span className={`grid size-8 place-items-center rounded-lg ${iconClass}`}>
          <MetricIcon aria-hidden="true" />
        </span>
      </div>
      <strong className="mt-4 block text-[27px] leading-none font-bold tracking-tight text-card-foreground">
        {value}
      </strong>
      <p
        className={`mt-3 text-[11px] font-semibold ${subnote ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}
      >
        {note}
        {subnote && <span className="font-normal text-muted-foreground"> {subnote}</span>}
      </p>
    </article>
  );
}

export { Metric };
