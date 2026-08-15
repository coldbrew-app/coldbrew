import { z } from "zod";

export const UserIdSchema = z.number().brand("user id");
export type UserId = z.infer<typeof UserIdSchema>;

export const VideoIdSchema = z.coerce.bigint().brand("video id");
export type VideoId = z.infer<typeof VideoIdSchema>;

export const VideoPriorityIdSchema = z.number().brand("video priority id");
export type VideoPriorityId = z.infer<typeof VideoPriorityIdSchema>;

export const DonationIdSchema = z.coerce.bigint().brand("donation id");
export type DonationId = z.infer<typeof DonationIdSchema>;

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
  donationId: DonationIdSchema,

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
  videoId: VideoIdSchema,
  videoPriorityId: VideoPriorityIdSchema,
  url: z.url(),
  amount: z.number(),
  durationMinutes: z.number().int().nonnegative().nullable(),
  priorityLabel: z.string().nullable(),
  watchedAt: z.coerce.date().nullable(),
  savedAt: z.coerce.date().nullable(),
  donation: DonationSchema,
});
export type Video = z.infer<typeof VideoSchema>;

export const VideoPrioritySchema = z.object({
  videoPriorityId: z.number().int().positive(),
  label: z.string().trim().min(1).max(64),
  minPricePerMinute: z.number().nonnegative(),
});
export type VideoPriority = z.infer<typeof VideoPrioritySchema>;

export const UserInfoSchema = z.object({
  userId: UserIdSchema,
  slug: SlugSchema,

  hasDonationalertsRefreshToken: z.boolean(),
  hasDonationalertsAccessToken: z.boolean(),
});

export const DonationAlertsUserSchema = z.object({
  userId: UserIdSchema,
  accessToken: AccessTokenSchema,
  refreshToken: RefreshTokenSchema,
});
export type DonationAlertsUser = z.infer<typeof DonationAlertsUserSchema>;
