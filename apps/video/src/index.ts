import { delay } from "@coldbrew/packages/delay.js";
import { logger } from "@coldbrew/packages/logger.js";
import dayjs from "dayjs";
import dedent from "dedent-js";
import { ok, safeTry } from "neverthrow";

import { store } from "./sensors/db/index.js";
import { VideoToSave } from "./sensors/db/store.js";
import { extractYoutubeUrls, getYoutubeDurationMinutes, youtubeVideoId } from "./youtube.js";

async function main() {
  while (true) {
    await using _ = delay(2500);
    logger.debug("while (true): " + dayjs().format("HH:mm:ss"));

    const donations = await store.getUnparsedDonations();

    donations_loop: for (const donation of donations) {
      const urls = extractYoutubeUrls(donation.message);
      const videos: VideoToSave[] = [];

      urls_loop: for (const url of urls) {
        const $iteration = await safeTry(async function* () {
          const durationMinutes = yield* getYoutubeDurationMinutes(url);
          const providerVideoId = youtubeVideoId(url);
          if (providerVideoId === null) return ok();
          const queueAmount =
            donation.amountInUserCurrency ??
            (donation.money.currency === donation.queueCurrency ? donation.money.amount : null);
          logger.debug("videos.push", { url, queueAmount, durationMinutes });
          videos.push({
            provider: "youtube",
            providerVideoId,
            url,
            queueAmount,
            queueCurrency: donation.queueCurrency,
            durationMinutes,
          });
          return ok();
        });
        if ($iteration.isOk()) continue urls_loop;
        const error = $iteration.error;

        logger.warn(dedent`
          skip url: "${url}".
          ${error}
        `);

        if (error.type == "http error" && error.status == 429) {
          continue donations_loop;
        }
      }

      await store.setDonationParsed(donation, videos);
    }
  }
}

main();
