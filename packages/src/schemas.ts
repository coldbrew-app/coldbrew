import { z } from "zod";

export const UserIdSchema = z.number().brand("user id");
export type UserId = z.infer<typeof UserIdSchema>;

export const SlugSchema = z
  .string()
  .regex(/^@[a-zA-Z0-9\-]{3,47}$/)
  .brand("slug");
export type Slug = z.infer<typeof SlugSchema>;

export const AuthUserIdSchema = z.string().brand("auth user id");
export type AuthUserId = z.infer<typeof AuthUserIdSchema>;

export const RefreshTokenSchema = z.string().brand("refresh token");
export type RefreshToken = z.infer<typeof RefreshTokenSchema>;

export const AccessTokenSchema = z.string().nonempty().brand("access token");
export type AccessToken = z.infer<typeof AccessTokenSchema>;

export const DonationSourceSchema = z.enum(["donationalerts"]);
export type DonationSource = z.infer<typeof DonationSourceSchema>;

export const DonationSchema = z.object({
  donationId: z.coerce.bigint(),

  origin: DonationSourceSchema,
  originDonationId: z.string(),

  userId: UserIdSchema,
  author: z.string().nullable(),
  message: z.string().nullable(),
  amount: z.number(),
  createdAt: z.coerce.date(),
});
export type Donation = z.infer<typeof DonationSchema>;

export const VideoSchema = z.object({
  videoId: z.coerce.bigint(),
  videoPriorityId: z.number().int().positive(),
  url: z.url(),
  amount: z.number(),
  durationSeconds: z.number().int().nonnegative().nullable(),
  priorityLabel: z.string().nullable(),
  watchedAt: z.coerce.date().nullable(),
  savedAt: z.coerce.date().nullable(),
  donation: DonationSchema,
});
export type Video = z.infer<typeof VideoSchema>;

export const VideoPrioritySchema = z.object({
  videoPriorityId: z.number().int().positive(),
  label: z.string(),
  minPricePerMinute: z.number().nonnegative(),
});
export type VideoPriority = z.infer<typeof VideoPrioritySchema>;

export const UserInfoSchema = z.object({
  userId: z.number(),
  slug: SlugSchema,

  hasDonationalertsRefreshToken: z.boolean(),
  hasDonationalertsAccessToken: z.boolean(),
});
