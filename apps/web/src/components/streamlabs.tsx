import {
  donationSourceDetails,
  DonationSourceBadge,
  DonationSourceConnectionStatus,
  DonationSourceMark,
  DonationSourceNameLink,
} from "./donation-source";

export const STREAMLABS_DONATIONS_URL = donationSourceDetails("streamlabs").url;

type MarkProps = {
  className?: string;
  size?: "sm" | "lg";
};

export function StreamlabsMark({ className, size = "sm" }: MarkProps) {
  return <DonationSourceMark className={className} size={size} source="streamlabs" />;
}

export function StreamlabsConnectionStatus({ connected }: { connected: boolean }) {
  return <DonationSourceConnectionStatus connected={connected} />;
}

export function StreamlabsNameLink({ className }: { className?: string }) {
  return <DonationSourceNameLink className={className} source="streamlabs" />;
}

export function StreamlabsSourceBadge({ className }: { className?: string }) {
  return <DonationSourceBadge className={className} source="streamlabs" />;
}
