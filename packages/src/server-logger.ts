import {
  connect,
  DiscardPolicy,
  RetentionPolicy,
  StorageType,
  StringCodec,
  type JetStreamClient,
} from "nats";

type Level = "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

interface LogEvent {
  id: string;
  occurredAt: string;
  level: Level;
  service: string;
  environment: string;
  message: string;
  fields?: LogFields;
}

const queueCapacity = 256;
const codec = StringCodec();
let jetStreamPromise: Promise<JetStreamClient> | undefined;
let pending = 0;
let dropped = 0;

function isSensitive(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  return ["authorization", "cookie", "password", "secret", "token"].some((part) =>
    normalized.includes(part),
  );
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      isSensitive(key) ? "[REDACTED]" : redact(child),
    ]),
  );
}

function normalize(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
      ...(value.cause === undefined ? {} : { cause: normalize(value.cause) }),
    };
  }
  try {
    return redact(JSON.parse(JSON.stringify(value)));
  } catch {
    return String(value);
  }
}

function subject(service: string): string {
  const namespace = process.env["NATS_NAMESPACE"];
  return `${namespace ? `${namespace}.` : ""}ops.logs.${service}`;
}

function streamName(): string {
  const namespace = process.env["NATS_NAMESPACE"];
  if (!namespace) return "OPERATIONAL_LOGS";
  return `CB_${namespace.toUpperCase().replaceAll(/[^A-Z0-9_-]/g, "_")}_OPERATIONAL_LOGS`;
}

async function connectJetStream(): Promise<JetStreamClient> {
  const servers = (process.env["NATS_SERVERS"] ?? "nats://localhost:4222")
    .split(",")
    .map((server) => server.trim());
  const connection = await connect({ servers, name: "web operational logs", timeout: 2_000 });
  const manager = await connection.jetstreamManager();
  const name = streamName();
  try {
    await manager.streams.info(name);
  } catch {
    try {
      await manager.streams.add({
        name,
        subjects: [subject(">")],
        storage: StorageType.File,
        retention: RetentionPolicy.Limits,
        discard: DiscardPolicy.Old,
        max_age: 7 * 24 * 60 * 60 * 1_000_000_000,
        max_bytes: 128 * 1024 * 1024,
        duplicate_window: 2 * 60 * 1_000_000_000,
      });
    } catch {
      await manager.streams.info(name);
    }
  }
  return connection.jetstream();
}

function getJetStream(): Promise<JetStreamClient> {
  jetStreamPromise ??= connectJetStream().catch((error) => {
    jetStreamPromise = undefined;
    throw error;
  });
  return jetStreamPromise;
}

async function publish(event: LogEvent): Promise<void> {
  try {
    const jetstream = await getJetStream();
    await jetstream.publish(subject("web"), codec.encode(JSON.stringify(event)), {
      msgID: event.id,
      timeout: 2_000,
    });
  } catch (error) {
    console.error("publish operational log event", error);
  }
}

function write(level: Level, message: string, fields?: LogFields): void {
  const event: LogEvent = {
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    level,
    service: "web",
    environment: process.env["APP_ENV"] ?? process.env["NODE_ENV"] ?? "development",
    message,
    ...(fields && Object.keys(fields).length > 0 ? { fields: normalize(fields) as LogFields } : {}),
  };
  console.log(JSON.stringify(event));
  if (pending >= queueCapacity) {
    dropped += 1;
    if (dropped === 1 || (dropped & (dropped - 1)) === 0) {
      console.error(`operational log queue full; dropped ${dropped} events`);
    }
    return;
  }
  pending += 1;
  void publish(event).finally(() => {
    pending -= 1;
  });
}

export function logInfo(message: string, fields?: LogFields): void {
  write("info", message, fields);
}

export function logWarn(message: string, fields?: LogFields): void {
  write("warn", message, fields);
}

export function logError(message: string, error: unknown, fields?: LogFields): void {
  write("error", message, { ...fields, error: normalize(error) });
}
