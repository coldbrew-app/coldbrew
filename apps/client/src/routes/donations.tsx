import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { SlidersHorizontal } from "lucide-react";

export const Route = createFileRoute("/donations")({
  component: DonationsLayout,
});

function DonationsLayout() {
  const location = useLocation();
  // TODO: remove this check because it isn't typesafe
  const activeTab = location.pathname === "/donations/videos" ? "videos" : "donations";

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="mx-auto w-full max-w-7xl px-[clamp(18px,4vw,62px)]">
        <article className="mt-4 overflow-hidden rounded-xl border border-[#eae8ef] bg-white">
          <div className="flex flex-col gap-4 border-b border-[#efedf3] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-3">
                <div aria-label="Donation content" className="flex gap-1" role="tablist">
                  <Link
                    to="/donations"
                    className="rounded-md px-2.5 py-1.5 text-xs font-semibold"
                    activeOptions={{ exact: true }}
                    activeProps={{
                      className: "bg-violet-100 text-violet-700",
                      "aria-selected": true,
                    }}
                    inactiveProps={{ className: "text-[#777385] hover:bg-[#f7f6f9]" }}
                    role="tab"
                  >
                    Donations
                  </Link>
                  <Link
                    to="/donations/videos"
                    className="rounded-md px-2.5 py-1.5 text-xs font-semibold"
                    activeProps={{
                      className: "bg-violet-100 text-violet-700",
                      "aria-selected": true,
                    }}
                    inactiveProps={{ className: "text-[#777385] hover:bg-[#f7f6f9]" }}
                    role="tab"
                  >
                    Videos
                  </Link>
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-[#353248]">
                    {activeTab === "donations" ? "All donations" : "Video queue"}
                  </h2>
                  <p className="mt-1 text-xs text-[#9491a1]">
                    {activeTab === "donations"
                      ? "Browse and search your supporter activity."
                      : "Videos shared by your supporters, ready for your stream."}
                  </p>
                </div>
              </div>
              {activeTab === "donations" && (
                <div className="flex items-center gap-2">
                  <SlidersHorizontal aria-hidden="true" size={15} className="text-violet-600" />
                  <span className="text-xs font-semibold text-[#676376]">DonationAlerts</span>
                </div>
              )}
            </div>
          </div>

          <Outlet />
        </article>
      </div>
    </section>
  );
}
