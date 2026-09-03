import { useMediaQuery } from "@base-ui/react/unstable-use-media-query";

export function useIsMobile() {
  return useMediaQuery("(max-width: 1023px)", { defaultMatches: false });
}
