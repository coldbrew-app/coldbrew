import {
  donationSourceDetails,
  DonationSourceBadge,
  DonationSourceConnectionStatus,
  DonationSourceMark,
  DonationSourceNameLink,
} from "./donation-source";

export const DONATION_ALERTS_DONATIONS_URL = donationSourceDetails("donationalerts").url;

type MarkProps = {
  className?: string;
  size?: "sm" | "lg";
};

export function DonationAlertsMark({ className, size = "sm" }: MarkProps) {
  return <DonationSourceMark className={className} size={size} source="donationalerts" />;
}

export function DonationAlertsNameLink({ className }: { className?: string }) {
  return <DonationSourceNameLink className={className} source="donationalerts" />;
}

export function DonationAlertsConnectionStatus({ connected }: { connected: boolean }) {
  return <DonationSourceConnectionStatus connected={connected} />;
}

export function DonationAlertsSourceBadge({ className }: { className?: string }) {
  return <DonationSourceBadge className={className} source="donationalerts" />;
}
