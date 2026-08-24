import { cn } from "@web/lib/utils";

type Props = {
  className?: string;
  variant?: "portal" | "orbit" | "beans";
};

export function CosmicArt({ className, variant = "portal" }: Props) {
  if (variant === "orbit") return <OrbitArt className={className} />;
  if (variant === "beans") return <BeanComets className={className} />;

  return (
    <svg
      aria-hidden="true"
      className={cn("overflow-visible", className)}
      fill="none"
      viewBox="0 0 320 230"
    >
      <path
        d="M41 80C86 24 229 11 286 73C334 126 238 190 145 175C70 163 11 119 41 80Z"
        fill="#4056E8"
        opacity=".22"
      />
      <g
        className="cosmic-orbit"
        style={{ transformBox: "view-box", transformOrigin: "150px 95px" }}
      >
        <ellipse cx="160" cy="101" rx="126" ry="57" stroke="#FFF8ED" strokeDasharray="5 9" />
        <circle cx="46" cy="126" r="8" fill="#FF647C" stroke="#251820" strokeWidth="3" />
        <path d="m267 73 5-12 5 12 12 5-12 5-5 12-5-12-12-5 12-5Z" fill="#FFBD3E" />
      </g>
      <path
        d="M91 95h117v54c0 32-22 54-58 54s-59-22-59-54V95Z"
        fill="#FFF8ED"
        stroke="#251820"
        strokeLinejoin="round"
        strokeWidth="5"
      />
      <path
        d="M208 111h17c30 0 30 43 0 43h-18"
        stroke="#251820"
        strokeLinecap="round"
        strokeWidth="5"
      />
      <ellipse cx="150" cy="96" rx="59" ry="21" fill="#251820" stroke="#251820" strokeWidth="5" />
      <ellipse cx="150" cy="95" rx="45" ry="13" fill="#4056E8" />
      <path d="M116 94c20-16 51-16 70 0-20 15-51 15-70 0Z" fill="#171018" />
      <circle cx="138" cy="89" r="3" fill="#FFBD3E" />
      <circle cx="165" cy="100" r="2.5" fill="#54CFA5" />
      <path d="m176 82 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" fill="#FF647C" />
      <path d="M105 206c31 12 83 12 113-1" stroke="#251820" strokeLinecap="round" strokeWidth="5" />
      <path
        d="M67 47c8-10 20-11 29-3M235 42c8-7 17-7 23 0"
        stroke="#FFF8ED"
        strokeLinecap="round"
        strokeWidth="4"
      />
    </svg>
  );
}

function OrbitArt({ className }: Pick<Props, "className">) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 260 150">
      <path
        d="M18 104C54 36 183 13 242 67"
        stroke="currentColor"
        strokeDasharray="5 8"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <circle cx="28" cy="91" r="11" fill="#54CFA5" stroke="#251820" strokeWidth="3" />
      <circle cx="120" cy="48" r="15" fill="#FF647C" stroke="#251820" strokeWidth="3" />
      <circle cx="218" cy="58" r="9" fill="#FFBD3E" stroke="#251820" strokeWidth="3" />
      <path
        d="M46 116c47 20 121 22 173-10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="3"
      />
      <path d="m84 56 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" fill="#4056E8" />
      <path d="m238 91 2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Z" fill="#FF647C" />
    </svg>
  );
}

function BeanComets({ className }: Pick<Props, "className">) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 180 110">
      <path
        d="M13 24c39 4 63 16 83 40"
        stroke="currentColor"
        strokeDasharray="3 7"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M107 72c-9-13-6-30 7-39 13 9 18 25 10 38-4 7-11 10-17 1Z"
        fill="#FFBD3E"
        stroke="#251820"
        strokeWidth="3"
      />
      <path d="M114 34c2 14-1 27-8 38" stroke="#251820" strokeLinecap="round" strokeWidth="2" />
      <path
        d="M126 28c13-12 26-14 39-13M132 38c16-5 28-2 37 5"
        stroke="#FF647C"
        strokeLinecap="round"
        strokeWidth="4"
      />
      <circle cx="32" cy="28" r="6" fill="#54CFA5" />
      <path d="m62 57 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" fill="#4056E8" />
    </svg>
  );
}
