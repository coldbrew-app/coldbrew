import { isIP } from "node:net";

import { RestreamServerUrlSchema, type RestreamServerUrl } from "@streambrew/packages/restream.js";

function isPrivateIPv4(hostname: string) {
  const octets = hostname.split(".").map(Number);
  const [first = -1, second = -1] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isPrivateIPv6(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized)
  );
}

export class InvalidRestreamTargetError extends Error {
  constructor() {
    super("Invalid restream destination server URL.");
  }
}

export function normalizeRestreamServerUrl(input: string): RestreamServerUrl {
  try {
    const url = new URL(input.trim());
    if (
      (url.protocol !== "rtmp:" && url.protocol !== "rtmps:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.hostname === "" ||
      url.hostname === "localhost"
    ) {
      throw new InvalidRestreamTargetError();
    }
    const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1");
    const ipVersion = isIP(hostname);
    if (
      (ipVersion === 4 && isPrivateIPv4(hostname)) ||
      (ipVersion === 6 && isPrivateIPv6(hostname))
    ) {
      throw new InvalidRestreamTargetError();
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return RestreamServerUrlSchema.parse(url.href.replace(/\/$/, ""));
  } catch (error) {
    if (error instanceof InvalidRestreamTargetError) throw error;
    throw new InvalidRestreamTargetError();
  }
}
