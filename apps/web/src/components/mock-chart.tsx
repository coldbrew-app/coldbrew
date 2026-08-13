type Props = {
  className?: string;
};

export default function MockChart(props: Props) {
  return (
    <svg
      className={props.className}
      viewBox="0 0 560 196"
      preserveAspectRatio="none"
      aria-label="Donation trend chart"
    >
      <defs>
        <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#8067ed" stopOpacity=".28" />
          <stop offset="1" stopColor="#8067ed" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 16H560M0 70H560M0 124H560M0 178H560" stroke="#f0eef4" />
      <path
        d="M0 165 C25 157 38 153 62 158 S99 143 125 147 S157 157 181 139 S219 118 244 126 S278 92 306 106 S345 114 370 92 S412 61 435 76 S466 111 495 79 S532 49 560 31 L560 196 L0 196Z"
        fill="url(#area)"
      />
      <path
        d="M0 165 C25 157 38 153 62 158 S99 143 125 147 S157 157 181 139 S219 118 244 126 S278 92 306 106 S345 114 370 92 S412 61 435 76 S466 111 495 79 S532 49 560 31"
        fill="none"
        stroke="#7960e5"
        strokeLinecap="round"
        strokeWidth="2.4"
      />
    </svg>
  );
}
