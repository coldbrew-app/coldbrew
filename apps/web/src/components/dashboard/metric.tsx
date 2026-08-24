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
    <article className={`${panel} relative min-h-[148px] overflow-hidden p-5`}>
      <span className="absolute top-0 left-6 h-1 w-12 rounded-b-full bg-current text-primary" />
      <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
        <span>{title}</span>
        <span className={`grid size-9 place-items-center rounded-xl ${iconClass}`}>
          <MetricIcon aria-hidden="true" />
        </span>
      </div>
      <strong className="mt-4 block font-heading text-[29px] leading-none font-semibold tracking-tight text-card-foreground">
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
