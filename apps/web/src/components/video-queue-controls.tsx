import type { VideoQueue } from "@coldbrew/packages/schemas.js";
import { Link } from "@tanstack/react-router";
import { useVideoQueueMutations, useVideoQueuesQ } from "@web/hooks/api";
import { createI18n, useI18n } from "@web/lib/i18n";
import { useState } from "react";

import { Icons } from "./icons";
import QueryErrorState from "./query-error-state";
import { Button, buttonVariants } from "./ui/button";
import { Field, FieldError, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";

const i18n = createI18n({
  videoQueues: {
    en: "Video queues",
    ru: "Очереди видео",
  },
  loadingQueues: {
    en: "Loading queues…",
    ru: "Загружаем очереди…",
  },
  createVideoQueue: {
    en: "New queue",
    ru: "Новая очередь",
  },
  queueSettings: {
    en: "Queue settings",
    ru: "Настройки очереди",
  },
  queueName: {
    en: "Queue name",
    ru: "Название очереди",
  },
  defaultVideoQueue: {
    en: "Default queue",
    ru: "Очередь по умолчанию",
  },
  newQueuePrioritiesHelp: {
    en: "The same priorities and thresholds apply to all your queues.",
    ru: "Для всех очередей действуют единые приоритеты и пороги.",
  },
  queueNameTaken: {
    en: "A queue with this name already exists. Choose another name.",
    ru: "Очередь с таким названием уже есть. Выберите другое название.",
  },
  queueSaveFailed: {
    en: "Couldn't save the queue. Please try again.",
    ru: "Не удалось сохранить очередь. Попробуйте ещё раз.",
  },
  cancel: {
    en: "Cancel",
    ru: "Отменить",
  },
  saving: {
    en: "Saving…",
    ru: "Сохраняем…",
  },
  save: {
    en: "Save",
    ru: "Сохранить",
  },
});

export function VideoQueueControls({
  videoQueueId,
  onSelect,
}: {
  videoQueueId?: number;
  onSelect: (videoQueueId: number) => void;
}) {
  const { t } = useI18n(i18n);
  const queuesQ = useVideoQueuesQ();
  const [editing, setEditing] = useState<VideoQueue | "new" | null>(null);
  const queues = queuesQ.data ?? [];
  const selected =
    queues.find((queue) => queue.videoQueueId === videoQueueId) ??
    (videoQueueId === undefined ? queues.find((queue) => queue.isDefault) : undefined);

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav
          aria-label={t("videoQueues")}
          className="flex w-full min-w-0 flex-none flex-wrap gap-1 sm:w-auto sm:flex-1"
        >
          {queuesQ.isLoading && (
            <span role="status" className="text-sm text-muted-foreground">
              {t("loadingQueues")}
            </span>
          )}
          {queues.map((queue) => (
            <Link
              key={queue.videoQueueId}
              to="/videos"
              onClick={() => setEditing(null)}
              aria-current={selected?.videoQueueId === queue.videoQueueId ? "page" : undefined}
              className={buttonVariants({
                variant: selected?.videoQueueId === queue.videoQueueId ? "secondary" : "ghost",
                size: "sm",
                className: "max-w-full",
              })}
              search={(previous) => ({
                ...previous,
                videoQueueId: queue.videoQueueId,
                videoId: undefined,
                page: 1,
                videoPriorityId: "all",
              })}
            >
              <span className="truncate">{queue.label}</span>
            </Link>
          ))}
        </nav>
        <Button
          size="sm"
          variant="ghost"
          disabled={!selected}
          onClick={() => selected && setEditing(selected)}
        >
          <Icons.settings aria-hidden="true" />
          {t("queueSettings")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={queuesQ.isLoading || queuesQ.isError}
          onClick={() => setEditing("new")}
        >
          <Icons.addVideo aria-hidden="true" />
          {t("createVideoQueue")}
        </Button>
      </div>
      {queuesQ.isError && (
        <QueryErrorState
          className="min-h-20 p-2"
          isRetrying={queuesQ.isFetching}
          onRetry={() => void queuesQ.refetch()}
        />
      )}
      {editing !== null && (
        <QueueForm
          key={editing === "new" ? "new" : editing.videoQueueId}
          queue={editing === "new" ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSaved={(queue) => {
            setEditing(null);
            onSelect(queue.videoQueueId);
          }}
        />
      )}
    </div>
  );
}

function QueueForm({
  queue,
  onCancel,
  onSaved,
}: {
  queue?: VideoQueue;
  onCancel: () => void;
  onSaved: (queue: VideoQueue) => void;
}) {
  const { t } = useI18n(i18n);
  const [label, setLabel] = useState(queue?.label ?? "");
  const [isDefault, setIsDefault] = useState(queue?.isDefault ?? false);
  const { create, update } = useVideoQueueMutations();
  const mutation = queue ? update : create;
  return (
    <form
      className="flex flex-col gap-3 rounded-lg bg-muted p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (queue)
          update.mutate(
            { videoQueueId: queue.videoQueueId, label: label.trim(), isDefault },
            { onSuccess: onSaved },
          );
        else create.mutate({ label: label.trim() }, { onSuccess: onSaved });
      }}
    >
      <div className="grid gap-3 md:grid-cols-[minmax(12rem,1fr)_auto_auto] md:items-end">
        <Field>
          <FieldLabel htmlFor="video-queue-name">{t("queueName")}</FieldLabel>
          <Input
            id="video-queue-name"
            required
            maxLength={64}
            value={label}
            disabled={mutation.isPending}
            onChange={(event) => setLabel(event.target.value)}
          />
        </Field>
        {queue ? (
          <Field className="min-h-8" orientation="horizontal">
            <Switch
              id="default-video-queue"
              checked={isDefault}
              disabled={queue.isDefault || mutation.isPending}
              onCheckedChange={setIsDefault}
            />
            <FieldLabel htmlFor="default-video-queue">{t("defaultVideoQueue")}</FieldLabel>
          </Field>
        ) : (
          <p className="flex min-h-8 items-center text-xs text-muted-foreground">
            {t("newQueuePrioritiesHelp")}
          </p>
        )}
        <div className="flex min-h-8 flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={!label.trim() || mutation.isPending}>
            {t(mutation.isPending ? "saving" : "save")}
          </Button>
        </div>
      </div>
      {mutation.error && (
        <FieldError>
          {t(mutation.error.data?.code === "CONFLICT" ? "queueNameTaken" : "queueSaveFailed")}
        </FieldError>
      )}
    </form>
  );
}

export function VideoQueueSelect({
  queues,
  value,
  onChange,
  disabled,
  label,
}: {
  queues: VideoQueue[];
  value: number;
  onChange: (videoQueueId: number) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{label}</span>
      <select
        aria-label={label}
        className="h-8 min-w-0 max-w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {queues.map((queue) => (
          <option key={queue.videoQueueId} value={queue.videoQueueId}>
            {queue.label}
          </option>
        ))}
      </select>
    </label>
  );
}
