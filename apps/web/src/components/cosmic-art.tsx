import { cn } from "@web/lib/utils";

import cosmicCup from "../../assets/cosmic-cup.png";

const orbitBodyClassName =
  "animate-cosmic-orbit-travel [offset-path:path('M_46_126_A_126_57_0_0_1_274_76_A_126_57_0_0_1_46_126')] [offset-rotate:0deg] motion-reduce:animate-none";

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
      <image height="160" href={cosmicCup} width="240" x="45" y="47" />
      <g>
        <ellipse
          className="animate-cosmic-orbit-dashes motion-reduce:animate-none"
          cx="160"
          cy="101"
          pathLength="588"
          rx="126"
          ry="57"
          stroke="#FFF8ED"
          strokeDasharray="5 9"
        />
        <g className={orbitBodyClassName}>
          <circle r="8" fill="#FF647C" stroke="#251820" strokeWidth="3" />
        </g>
        <g
          className={cn(
            orbitBodyClassName,
            "[animation-delay:-9s] motion-reduce:[offset-distance:50%]",
          )}
        >
          <path d="M-5-5 0-17 5-5 17 0 5 5 0 17-5 5-17 0-5-5Z" fill="#FFBD3E" />
        </g>
      </g>
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
