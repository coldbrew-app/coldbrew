import type { LucideIcon } from "lucide-react";

const panel = "rounded-xl border border-[#eae8ef] bg-white";

type MetricProps = {
  title: string;
  value: string;
  note: string;
  subnote?: string;
  icon: LucideIcon;
  iconClass: string;
};

function Metric({ title, value, note, subnote, icon: MetricIcon, iconClass }: MetricProps) {
  return (
    <article className={`${panel} min-h-[148px] p-5`}>
      <div className="flex items-center justify-between text-xs font-semibold text-[#858194]">
        <span>{title}</span>
        <span className={`grid size-8 place-items-center rounded-lg ${iconClass}`}>
          <MetricIcon aria-hidden="true" />
        </span>
      </div>
      <strong className="mt-4 block text-[27px] leading-none font-bold tracking-tight text-[#312e44]">
        {value}
      </strong>
      <p
        className={`mt-3 text-[11px] font-semibold ${subnote ? "text-emerald-600" : "text-[#a19eac]"}`}
      >
        {note}
        {subnote && <span className="font-normal text-[#a19eac]"> {subnote}</span>}
      </p>
    </article>
  );
}

export { Metric };
