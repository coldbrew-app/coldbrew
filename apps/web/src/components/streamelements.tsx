import {
  DonationSourceBadge,
  DonationSourceConnectionStatus,
  DonationSourceMark,
  DonationSourceNameLink,
} from "./donation-source";

type MarkProps = {
  className?: string;
  size?: "sm" | "lg";
};

export function StreamElementsMark({ className, size = "sm" }: MarkProps) {
  return <DonationSourceMark className={className} size={size} source="streamelements" />;
}

export function StreamElementsConnectionStatus({ connected }: { connected: boolean }) {
  return <DonationSourceConnectionStatus connected={connected} />;
}

export function StreamElementsNameLink({ className }: { className?: string }) {
  return <DonationSourceNameLink className={className} source="streamelements" />;
}

export function StreamElementsSourceBadge({ className }: { className?: string }) {
  return <DonationSourceBadge className={className} source="streamelements" />;
}
