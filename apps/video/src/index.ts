import { convertWithDefaultRate } from "@coldbrew/packages/currency.js";
import { logger } from "@coldbrew/packages/logger.js";
import {
  extractYoutubeUrls,
  getYoutubeTiming,
  youtubeVideoId,
} from "@coldbrew/packages/youtube.js";
import { delay } from "@lebedevna/delay";
import dayjs from "dayjs";
import dedent from "dedent-js";
import { ok, safeTry } from "neverthrow";

import { store } from "./sensors/db/index.js";
import { VideoToSave } from "./sensors/db/store.js";

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
          const timing = yield* getYoutubeTiming(url);
          const providerVideoId = youtubeVideoId(url);
          if (providerVideoId === null) return ok();
          const queueAmount =
            convertWithDefaultRate(donation.amount, donation.currency, donation.queueCurrency)
              ?.amount ?? null;
          logger.debug("videos.push", { url, queueAmount, ...timing });
          videos.push({
            provider: "youtube",
            providerVideoId,
            url,
            queueAmount,
            ...timing,
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
