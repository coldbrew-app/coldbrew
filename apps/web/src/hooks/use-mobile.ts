import { useMediaQuery } from "@siberiacancode/reactuse";

export function useIsMobile() {
  return useMediaQuery("(max-width: 1023px)");
}
