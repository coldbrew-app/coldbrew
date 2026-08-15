import { delay } from "@omnistream/packages/delay.js";
import { isInstanceof } from "@omnistream/packages/isInstanceof.js";
import { logger } from "@omnistream/packages/logger.js";
import { HttpError } from "@omnistream/packages/neverthrow/fetch.js";
import dayjs from "dayjs";
import dedent from "dedent-js";

import { store } from "./sensors/db/index.js";
import { VideoToSave } from "./sensors/db/store.js";
import { extractYoutubeUrls, getYoutubeDurationMinutes } from "./youtube.js";

async function main() {
  while (true) {
    await using _ = delay(2500);
    logger.debug("while (true): " + dayjs().format("HH:mm:ss"));

    const donations = await store.getUnparsedDonations();

    donations_loop: for (const donation of donations) {
      const urls = extractYoutubeUrls(donation.message);
      const videos: VideoToSave[] = [];

      urls_loop: for (const url of urls) {
        const $durationMinutes = await getYoutubeDurationMinutes(url);

        if ($durationMinutes.isOk()) {
          logger.debug("videos.push", {
            url,
            amount: donation.amount,
            durationMinutes: $durationMinutes.value,
          });
          videos.push({
            url,
            amount: donation.amount,
            durationMinutes: $durationMinutes.value,
          });
          continue urls_loop;
        }

        logger.warn(dedent`
          skip url: "${url}".
          ${$durationMinutes.error}
        `);

        if (
          isInstanceof($durationMinutes.error, HttpError) &&
          $durationMinutes.error.isTooManyRequests
        ) {
          continue donations_loop;
        } else {
          continue urls_loop;
        }
      }

      await store.setDonationParsed(donation, videos);
    }
  }
}

main();
