import {
  donationSourceDetails,
  DonationSourceConnectionStatus,
  DonationSourceMark,
  DonationSourceNameLink,
} from "./donation-source";

export const DONATE_STREAM_NAME = donationSourceDetails("donate_stream").name;

type MarkProps = {
  className?: string;
  size?: "sm" | "lg";
};

export function DonateStreamMark({ className, size = "sm" }: MarkProps) {
  return <DonationSourceMark className={className} size={size} source="donate_stream" />;
}

export function DonateStreamNameLink({ className }: { className?: string }) {
  return <DonationSourceNameLink className={className} source="donate_stream" />;
}

export function DonateStreamConnectionStatus({ connected }: { connected: boolean }) {
  return <DonationSourceConnectionStatus connected={connected} />;
}
