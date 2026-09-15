import { readFile, statfs } from "node:fs/promises";
import { availableParallelism, loadavg, totalmem, uptime } from "node:os";
import { performance } from "node:perf_hooks";

import { ChatActivitySnapshotSchema, ChatProviderSchema } from "@streambrew/packages/chat.js";
import { z } from "zod";

import { chatService } from "./chat/client.js";
import { donationIntegration } from "./donation-integration/client.js";
import { sql } from "./sensors/db/index.js";

const PeriodCountsSchema = z.object({
  day: z.int().nonnegative(),
  week: z.int().nonnegative(),
  month: z.int().nonnegative(),
});

const CapacitySchema = z.object({
  usedBytes: z.number().nonnegative(),
  totalBytes: z.number().positive(),
});

const ServiceStatusSchema = z.object({
  id: z.enum(["web", "database", "chat", "donations", "activity"]),
  status: z.enum(["healthy", "unavailable"]),
  latencyMs: z.number().nonnegative(),
});

export const AdminDashboardSchema = z.object({
  capturedAt: z.coerce.date(),
  system: z.object({
    cpuCount: z.int().positive(),
    loadAverage: z.tuple([
      z.number().nonnegative(),
      z.number().nonnegative(),
      z.number().nonnegative(),
    ]),
    memory: CapacitySchema,
    memoryScope: z.enum(["container", "system", "process"]),
    disk: CapacitySchema.nullable(),
    serverUptimeSeconds: z.number().nonnegative(),
    webUptimeSeconds: z.number().nonnegative(),
    webRssBytes: z.number().nonnegative(),
  }),
  services: z.array(ServiceStatusSchema),
  database: z.object({
    sizeBytes: z.number().nonnegative(),
    connections: z.int().nonnegative(),
    maxConnections: z.int().positive(),
  }),
  users: z.object({
    total: z.int().nonnegative(),
    registered: PeriodCountsSchema,
    activeByDonations: PeriodCountsSchema,
  }),
  multichat: z.object({
    activity: ChatActivitySnapshotSchema.nullable(),
    configuredUsers: z.int().nonnegative(),
    newlyConfigured: PeriodCountsSchema,
    connectionCount: z.int().nonnegative(),
    enabledSourceCount: z.int().nonnegative(),
    overlaysConfigured: z.int().nonnegative(),
    providers: z.array(
      z.object({
        provider: ChatProviderSchema,
        users: z.int().nonnegative(),
        connections: z.int().nonnegative(),
      }),
    ),
  }),
  traffic: z.object({
    donations: PeriodCountsSchema,
  }),
  queues: z.object({
    donationScans: z.object({
      pending: z.int().nonnegative(),
      retried: z.int().nonnegative(),
      oldestSeconds: z.number().nonnegative().nullable(),
    }),
    videoMetadata: z.object({
      pending: z.int().nonnegative(),
      retried: z.int().nonnegative(),
      oldestSeconds: z.number().nonnegative().nullable(),
    }),
    alerts: z.object({
      inProgress: z.int().nonnegative(),
      interruptedDay: z.int().nonnegative(),
    }),
    deadLetters: z.int().nonnegative().nullable(),
  }),
});

type ServiceID = z.infer<typeof ServiceStatusSchema>["id"];

const databaseSummarySchema = z.object({
  totalUsers: z.int().nonnegative(),
  registeredDay: z.int().nonnegative(),
  registeredWeek: z.int().nonnegative(),
  registeredMonth: z.int().nonnegative(),
  donationActiveDay: z.int().nonnegative(),
  donationActiveWeek: z.int().nonnegative(),
  donationActiveMonth: z.int().nonnegative(),
  donationCountDay: z.int().nonnegative(),
  donationCountWeek: z.int().nonnegative(),
  donationCountMonth: z.int().nonnegative(),
  multichatConfiguredUsers: z.int().nonnegative(),
  multichatConfiguredDay: z.int().nonnegative(),
  multichatConfiguredWeek: z.int().nonnegative(),
  multichatConfiguredMonth: z.int().nonnegative(),
  chatConnectionCount: z.int().nonnegative(),
  enabledChatSourceCount: z.int().nonnegative(),
  chatOverlayCount: z.int().nonnegative(),
  databaseSizeBytes: z.number().nonnegative(),
  databaseConnections: z.int().nonnegative(),
  databaseMaxConnections: z.int().positive(),
});

const queueSummarySchema = z.object({
  donationScanPending: z.int().nonnegative(),
  donationScanRetried: z.int().nonnegative(),
  donationScanOldestSeconds: z.number().nonnegative().nullable(),
  videoMetadataPending: z.int().nonnegative(),
  videoMetadataRetried: z.int().nonnegative(),
  videoMetadataOldestSeconds: z.number().nonnegative().nullable(),
  alertsInProgress: z.int().nonnegative(),
  alertsInterruptedDay: z.int().nonnegative(),
});

const providerSummarySchema = z.object({
  provider: ChatProviderSchema,
  users: z.int().nonnegative(),
  connections: z.int().nonnegative(),
});

async function loadDatabaseMetrics() {
  const startedAt = performance.now();
  const [summaryRows, queueRows, providerRows] = await Promise.all([
    sql`
      WITH user_account AS (
        SELECT "user".user_id, auth_user."createdAt" AS created_at
        FROM "user"
        JOIN auth.auth_user AS auth_user ON auth_user.id = "user".auth_user_id
      ),
      connected_multichat AS (
        SELECT user_id, min(connected_at) AS first_connected_at
        FROM chat_provider_connection
        WHERE status = 'connected'
        GROUP BY user_id
      )
      SELECT
        (SELECT count(*)::int FROM user_account) AS total_users,
        (SELECT count(*)::int FROM user_account WHERE created_at >= now() - interval '24 hours') AS registered_day,
        (SELECT count(*)::int FROM user_account WHERE created_at >= now() - interval '7 days') AS registered_week,
        (SELECT count(*)::int FROM user_account WHERE created_at >= now() - interval '30 days') AS registered_month,
        (SELECT count(DISTINCT user_id)::int FROM donation WHERE occurred_at >= now() - interval '24 hours') AS donation_active_day,
        (SELECT count(DISTINCT user_id)::int FROM donation WHERE occurred_at >= now() - interval '7 days') AS donation_active_week,
        (SELECT count(DISTINCT user_id)::int FROM donation WHERE occurred_at >= now() - interval '30 days') AS donation_active_month,
        (SELECT count(*)::int FROM donation WHERE occurred_at >= now() - interval '24 hours') AS donation_count_day,
        (SELECT count(*)::int FROM donation WHERE occurred_at >= now() - interval '7 days') AS donation_count_week,
        (SELECT count(*)::int FROM donation WHERE occurred_at >= now() - interval '30 days') AS donation_count_month,
        (SELECT count(*)::int FROM connected_multichat) AS multichat_configured_users,
        (SELECT count(*)::int FROM connected_multichat WHERE first_connected_at >= now() - interval '24 hours') AS multichat_configured_day,
        (SELECT count(*)::int FROM connected_multichat WHERE first_connected_at >= now() - interval '7 days') AS multichat_configured_week,
        (SELECT count(*)::int FROM connected_multichat WHERE first_connected_at >= now() - interval '30 days') AS multichat_configured_month,
        (SELECT count(*)::int FROM chat_provider_connection WHERE status = 'connected') AS chat_connection_count,
        (SELECT count(*)::int FROM chat_source WHERE enabled) AS enabled_chat_source_count,
        (SELECT count(*)::int FROM chat_overlay WHERE token_hash IS NOT NULL) AS chat_overlay_count,
        pg_database_size(current_database())::float8 AS database_size_bytes,
        (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS database_connections,
        current_setting('max_connections')::int AS database_max_connections
    `,
    sql`
      SELECT
        (SELECT count(*)::int FROM donation_video_scan WHERE completed_at IS NULL) AS donation_scan_pending,
        (SELECT count(*)::int FROM donation_video_scan WHERE completed_at IS NULL AND attempts > 0) AS donation_scan_retried,
        (
          SELECT greatest(0, extract(epoch FROM now() - min(available_at)))::float8
          FROM donation_video_scan
          WHERE completed_at IS NULL
        ) AS donation_scan_oldest_seconds,
        (SELECT count(*)::int FROM video_metadata_job WHERE completed_at IS NULL) AS video_metadata_pending,
        (SELECT count(*)::int FROM video_metadata_job WHERE completed_at IS NULL AND attempts > 0) AS video_metadata_retried,
        (
          SELECT greatest(0, extract(epoch FROM now() - min(available_at)))::float8
          FROM video_metadata_job
          WHERE completed_at IS NULL
        ) AS video_metadata_oldest_seconds,
        (
          SELECT count(*)::int
          FROM donation_alert_playback
          WHERE status IN ('preparing', 'pending', 'playing')
        ) AS alerts_in_progress,
        (
          SELECT count(*)::int
          FROM donation_alert_playback
          WHERE status = 'interrupted' AND finished_at >= now() - interval '24 hours'
        ) AS alerts_interrupted_day
    `,
    sql`
      SELECT
        provider::text,
        count(DISTINCT user_id)::int AS users,
        count(*)::int AS connections
      FROM chat_provider_connection
      WHERE status = 'connected'
      GROUP BY provider
      ORDER BY count(DISTINCT user_id) DESC, provider
    `,
  ]);

  return {
    summary: databaseSummarySchema.parse(summaryRows[0]),
    queues: queueSummarySchema.parse(queueRows[0]),
    providers: z.array(providerSummarySchema).parse(providerRows),
    latencyMs: performance.now() - startedAt,
  };
}

async function readCgroupMemory() {
  const candidates = [
    ["/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory.max"],
    ["/sys/fs/cgroup/memory/memory.usage_in_bytes", "/sys/fs/cgroup/memory/memory.limit_in_bytes"],
  ] as const;
  for (const [usagePath, limitPath] of candidates) {
    const values = await Promise.all([
      readFile(usagePath, "utf8").catch(() => null),
      readFile(limitPath, "utf8").catch(() => null),
    ]);
    if (values[0] === null || values[1] === null || values[1].trim() === "max") continue;
    const usedBytes = Number(values[0].trim());
    const totalBytes = Number(values[1].trim());
    if (
      Number.isFinite(usedBytes) &&
      usedBytes >= 0 &&
      Number.isFinite(totalBytes) &&
      totalBytes > 0 &&
      totalBytes <= totalmem() * 2
    ) {
      return { usedBytes, totalBytes };
    }
  }
  return null;
}

async function readLinuxSystemMemory() {
  const content = await readFile("/proc/meminfo", "utf8").catch(() => null);
  if (content === null) return null;
  const totalKiB = Number(/^MemTotal:\s+(\d+)\s+kB$/m.exec(content)?.[1]);
  const availableKiB = Number(/^MemAvailable:\s+(\d+)\s+kB$/m.exec(content)?.[1]);
  if (!Number.isFinite(totalKiB) || !Number.isFinite(availableKiB) || totalKiB <= 0) return null;
  const totalBytes = totalKiB * 1024;
  return { usedBytes: Math.max(0, totalBytes - availableKiB * 1024), totalBytes };
}

async function loadMemoryMetrics(webRssBytes: number) {
  if (process.platform === "linux") {
    const cgroup = await readCgroupMemory();
    if (cgroup) return { capacity: cgroup, scope: "container" as const };

    const system = await readLinuxSystemMemory();
    if (system) return { capacity: system, scope: "system" as const };
  }

  return {
    capacity: { usedBytes: webRssBytes, totalBytes: totalmem() },
    scope: "process" as const,
  };
}

async function loadSystemMetrics() {
  const [oneMinute, fiveMinutes, fifteenMinutes] = loadavg();
  const webRssBytes = process.memoryUsage().rss;
  const [memory, disk] = await Promise.all([
    loadMemoryMetrics(webRssBytes),
    statfs("/")
      .then((stats) => {
        const totalBytes = stats.blocks * stats.bsize;
        const availableBytes = stats.bavail * stats.bsize;
        return { usedBytes: Math.max(0, totalBytes - availableBytes), totalBytes };
      })
      .catch(() => null),
  ]);

  return {
    cpuCount: availableParallelism(),
    loadAverage: [oneMinute, fiveMinutes, fifteenMinutes] as [number, number, number],
    memory: memory.capacity,
    memoryScope: memory.scope,
    disk,
    serverUptimeSeconds: uptime(),
    webUptimeSeconds: process.uptime(),
    webRssBytes,
  };
}

async function measureService<Value>(id: ServiceID, operation: () => Promise<Value>) {
  const startedAt = performance.now();
  try {
    const data = await operation();
    return {
      data,
      service: { id, status: "healthy" as const, latencyMs: performance.now() - startedAt },
    };
  } catch {
    return {
      data: null,
      service: { id, status: "unavailable" as const, latencyMs: performance.now() - startedAt },
    };
  }
}

export async function getAdminDashboard() {
  const [databaseMetrics, system, chatHealth, donationHealth, activity, deadLetters] =
    await Promise.all([
      loadDatabaseMetrics(),
      loadSystemMetrics(),
      measureService("chat", () => chatService.health()),
      measureService("donations", () => donationIntegration.health()),
      measureService("activity", () => chatService.adminActivity()),
      chatService.deadLetters(undefined, 1).catch(() => null),
    ]);
  const summary = databaseMetrics.summary;
  const queues = databaseMetrics.queues;

  return AdminDashboardSchema.parse({
    capturedAt: new Date(),
    system,
    services: [
      { id: "web", status: "healthy", latencyMs: 0 },
      {
        id: "database",
        status: "healthy",
        latencyMs: databaseMetrics.latencyMs,
      },
      chatHealth.service,
      donationHealth.service,
      activity.service,
    ],
    database: {
      sizeBytes: summary.databaseSizeBytes,
      connections: summary.databaseConnections,
      maxConnections: summary.databaseMaxConnections,
    },
    users: {
      total: summary.totalUsers,
      registered: {
        day: summary.registeredDay,
        week: summary.registeredWeek,
        month: summary.registeredMonth,
      },
      activeByDonations: {
        day: summary.donationActiveDay,
        week: summary.donationActiveWeek,
        month: summary.donationActiveMonth,
      },
    },
    multichat: {
      activity: activity.data,
      configuredUsers: summary.multichatConfiguredUsers,
      newlyConfigured: {
        day: summary.multichatConfiguredDay,
        week: summary.multichatConfiguredWeek,
        month: summary.multichatConfiguredMonth,
      },
      connectionCount: summary.chatConnectionCount,
      enabledSourceCount: summary.enabledChatSourceCount,
      overlaysConfigured: summary.chatOverlayCount,
      providers: databaseMetrics.providers,
    },
    traffic: {
      donations: {
        day: summary.donationCountDay,
        week: summary.donationCountWeek,
        month: summary.donationCountMonth,
      },
    },
    queues: {
      donationScans: {
        pending: queues.donationScanPending,
        retried: queues.donationScanRetried,
        oldestSeconds: queues.donationScanOldestSeconds,
      },
      videoMetadata: {
        pending: queues.videoMetadataPending,
        retried: queues.videoMetadataRetried,
        oldestSeconds: queues.videoMetadataOldestSeconds,
      },
      alerts: {
        inProgress: queues.alertsInProgress,
        interruptedDay: queues.alertsInterruptedDay,
      },
      deadLetters: deadLetters?.total ?? null,
    },
  });
}
