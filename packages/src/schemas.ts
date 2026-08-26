import { z } from "zod";

export const UserIdSchema = z.number().int().positive().brand("user id");
export type UserId = z.infer<typeof UserIdSchema>;

export const VideoIdSchema = z.coerce.bigint().positive().brand("video id");
export type VideoId = z.infer<typeof VideoIdSchema>;

export const VideoPriorityIdSchema = z.number().int().positive().brand("video priority id");
export type VideoPriorityId = z.infer<typeof VideoPriorityIdSchema>;

export const DonationIdSchema = z.coerce.bigint().positive().brand("donation id");
export type DonationId = z.infer<typeof DonationIdSchema>;

export const SlugSchema = z
  .string()
  .regex(/^@[a-zA-Z0-9\-]{3,47}$/)
  .brand("slug");
export type Slug = z.infer<typeof SlugSchema>;

export const AuthUserIdSchema = z.string().min(1).brand("auth user id");
export type AuthUserId = z.infer<typeof AuthUserIdSchema>;

export const RefreshTokenSchema = z.string().min(1).brand("refresh token");
export type RefreshToken = z.infer<typeof RefreshTokenSchema>;

export const AccessTokenSchema = z.string().min(1).brand("access token");
export type AccessToken = z.infer<typeof AccessTokenSchema>;

export const DonationSourceSchema = z.enum(["donationalerts"]);
export type DonationSource = z.infer<typeof DonationSourceSchema>;

export const VideoSourceSchema = z.enum(["donation", "manual"]);
export type VideoSource = z.infer<typeof VideoSourceSchema>;

export const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .brand("currency code");
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;

export const QueueCurrencySchema = z.enum(["RUB", "USD", "EUR"]);
export type QueueCurrency = z.infer<typeof QueueCurrencySchema>;

const MoneyAmountStringSchema = z.string().regex(/^\d{1,18}(?:\.\d{1,2})?$/);
export const MoneyAmountSchema = z
  .union([
    z.number().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(String),
    MoneyAmountStringSchema,
  ])
  .pipe(MoneyAmountStringSchema)
  .transform((value) => {
    const [integer, fraction = ""] = value.split(".");
    return `${integer}.${fraction.padEnd(2, "0")}`;
  })
  .brand("money amount");
export type MoneyAmount = z.infer<typeof MoneyAmountSchema>;

export const DonationSchema = z.object({
  donationId: DonationIdSchema,
  source: DonationSourceSchema,
  sourceDonationId: z.string().min(1),
  userId: UserIdSchema,
  author: z.string().nullable(),
  message: z.string().nullable(),
  amount: MoneyAmountSchema,
  currency: CurrencyCodeSchema,
  sourceCreatedAt: z.string().min(1),
  occurredAt: z.coerce.date(),
});
export type Donation = z.infer<typeof DonationSchema>;

const VideoBaseSchema = z.object({
  videoId: VideoIdSchema,
  videoPriorityId: VideoPriorityIdSchema.nullable(),
  provider: z.literal("youtube"),
  providerVideoId: z.string().min(1),
  url: z.url(),
  queueAmount: MoneyAmountSchema.nullable(),
  queueCurrency: QueueCurrencySchema,
  startSeconds: z.number().int().nonnegative(),
  endSeconds: z.number().int().positive(),
  priorityLabel: z.string().nullable(),
  watchedAt: z.coerce.date().nullable(),
  bookmarkedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

export const VideoSchema = z
  .discriminatedUnion("source", [
    VideoBaseSchema.extend({
      source: z.literal("donation"),
      donation: DonationSchema,
    }),
    VideoBaseSchema.extend({
      source: z.literal("manual"),
      donation: z.null(),
    }),
  ])
  .refine(({ startSeconds, endSeconds }) => endSeconds > startSeconds, {
    error: "video end must be after video start",
    path: ["endSeconds"],
  });
export type Video = z.infer<typeof VideoSchema>;

export const VideoPrioritySchema = z.object({
  videoPriorityId: VideoPriorityIdSchema,
  label: z.string().trim().min(1).max(64),
  minPricePerMinute: MoneyAmountSchema,
  isDefault: z.boolean(),
});
export type VideoPriority = z.infer<typeof VideoPrioritySchema>;

export const PublicQueueSettingsSchema = z.object({
  enabled: z.boolean(),
  showAmounts: z.boolean(),
  showWatchedVideos: z.boolean(),
});
export type PublicQueueSettings = z.infer<typeof PublicQueueSettingsSchema>;

export const SharedVideoSchema = z
  .object({
    videoId: VideoIdSchema,
    videoPriorityId: VideoPriorityIdSchema.nullable(),
    provider: z.literal("youtube"),
    url: z.url(),
    startSeconds: z.number().int().nonnegative(),
    endSeconds: z.number().int().positive(),
    priorityLabel: z.string().nullable(),
    watchedAt: z.coerce.date().nullable(),
    createdAt: z.coerce.date(),
    displayAmount: MoneyAmountSchema.nullable(),
    displayCurrency: CurrencyCodeSchema.nullable(),
  })
  .refine(({ startSeconds, endSeconds }) => endSeconds > startSeconds, {
    error: "video end must be after video start",
    path: ["endSeconds"],
  })
  .refine(
    ({ displayAmount, displayCurrency }) => (displayAmount === null) === (displayCurrency === null),
    {
      error: "display amount and currency must be present together",
      path: ["displayAmount"],
    },
  );
export type SharedVideo = z.infer<typeof SharedVideoSchema>;

export const UserInfoSchema = z.object({
  userId: UserIdSchema,
  slug: SlugSchema,
  queueCurrency: QueueCurrencySchema,
  hasDonationAlertsConnection: z.boolean(),
  publicQueueSettings: PublicQueueSettingsSchema,
});
export type UserInfo = z.infer<typeof UserInfoSchema>;

export const DonationAlertsUserSchema = z.object({
  userId: UserIdSchema,
  sourceUserId: z.string().min(1),
  accessToken: AccessTokenSchema,
  refreshToken: RefreshTokenSchema,
  tokenVersion: z.number().int().positive(),
  historyCheckpoint: z.string().nullable(),
});
export type DonationAlertsUser = z.infer<typeof DonationAlertsUserSchema>;
