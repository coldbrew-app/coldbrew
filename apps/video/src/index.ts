import { delay } from "@omnistream/packages/delay.js";
import { divide } from "@omnistream/packages/neverthrow/divide.js";

import { store } from "./sensors/db/index.js";
import { VideoToSave } from "./sensors/db/store.js";
import { findYoutubeUrls, getYoutubeDurationSeconds } from "./youtube.js";

async function main() {
  while (true) {
    await using _ = delay(1000);

    const donations = await store.getUnparsedDonations();

    for (const donation of donations) {
      const urls = findYoutubeUrls(donation.message);
      const priorities = await store.getVideoPriorities(donation.userId);

      const videos: VideoToSave[] = [];

      for (const url of urls) {
        const $durationSeconds = await getYoutubeDurationSeconds(url);
        if ($durationSeconds.isErr()) {
          console.warn(`skip url: "${url}". Failed to get duration seconds`);
          continue;
        }
        const durationSeconds = $durationSeconds.value;

        const $pricePerMinute = divide(durationSeconds, 60).map((v) => Math.ceil(v));
        if ($pricePerMinute.isErr()) {
          console.warn(`skip url: "${url}". Division error: ${$pricePerMinute.error.message}`);
          continue;
        }
        const pricePerMinute = $pricePerMinute.value;

        const priorityId = priorities
          .toSorted((a, b) => b.minPricePerMinute - a.minPricePerMinute)
          .find((p) => p.minPricePerMinute < pricePerMinute)?.videoPriorityId;
        if (priorityId === undefined) {
          console.warn(
            `skip url: "${url}". Priority not found for pricePerMinute = ${pricePerMinute}`,
          );
          continue;
        }

        videos.push({ url, durationSeconds, videoPriorityId: priorityId });
      }

      await store.saveVideos(donation, videos);
    }
  }
}

main();
