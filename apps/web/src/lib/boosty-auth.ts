import { z } from "zod";

const BoostyAuthSchema = z.object({
  expiresAt: z.int().positive().max(8_640_000_000_000_000),
  accessToken: z
    .string()
    .trim()
    .min(1)
    .max(8192)
    .regex(/^[!-~]+$/),
  refreshToken: z
    .string()
    .trim()
    .min(1)
    .max(8192)
    .regex(/^[!-~]+$/),
});

export function parseBoostyAuth(auth: string) {
  return BoostyAuthSchema.parse(JSON.parse(decodeURIComponent(auth.trim())));
}
