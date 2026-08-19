import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { Icons } from "@web/components/icons";

import { createTranslator, useI18n } from "../lib/i18n";

export const Route = createFileRoute("/donations")({
  component: DonationsLayout,
  head: ({ match }) => ({
    meta: [{ title: `${createTranslator(match.context.locale)("donations")} · Coldbrew` }],
  }),
});

function DonationsLayout() {
  const location = useLocation();
  // TODO: remove this check because it isn't typesafe
  const activeTab = location.pathname === "/donations/videos" ? "videos" : "donations";
  const { t } = useI18n();

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="w-full">
        <article className="mt-4 overflow-hidden rounded-xl border border-[#eae8ef] bg-white">
          <div className="flex flex-col gap-4 border-b border-[#efedf3] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-3">
                <div aria-label={t("donationContent")} className="flex gap-1" role="tablist">
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
                    {t("donations")}
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
                    {t("videos")}
                  </Link>
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-[#353248]">
                    {t(activeTab === "donations" ? "allDonations" : "videoQueue")}
                  </h2>
                  <p className="mt-1 text-xs text-[#9491a1]">
                    {activeTab === "donations" ? t("browseDonations") : t("videosForStream")}
                  </p>
                </div>
              </div>
              {activeTab === "donations" && (
                <div className="flex items-center gap-2">
                  <Icons.filter aria-hidden="true" size={15} className="text-violet-600" />
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
