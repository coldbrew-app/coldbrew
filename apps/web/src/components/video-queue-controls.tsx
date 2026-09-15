import type { VideoQueue } from "@streambrew/packages/schemas.js";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const i18n = createI18n({
  videoQueues: { en: "Video queues", ru: "Очереди видео" },
  loadingQueues: { en: "Loading queues…", ru: "Загружаем очереди…" },
  createVideoQueue: { en: "New queue", ru: "Новая очередь" },
  editVideoQueue: { en: "Edit queue", ru: "Редактировать очередь" },
  queueName: { en: "Queue name", ru: "Название очереди" },
  defaultVideoQueue: { en: "Default queue", ru: "Очередь по умолчанию" },
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
  cancel: { en: "Cancel", ru: "Отменить" },
  saving: { en: "Saving…", ru: "Сохраняем…" },
  save: { en: "Save", ru: "Сохранить" },
});

type QueueFormProps = {
  id: string;
  queue?: VideoQueue;
  onCancel: () => void;
  onSaved: (queue: VideoQueue) => void;
};

function useQueueForm(queue: VideoQueue | undefined, onSaved: (queue: VideoQueue) => void) {
  const [label, setLabel] = useState(queue?.label ?? "");
  const [isDefault, setIsDefault] = useState(queue?.isDefault ?? false);
  const { create, update } = useVideoQueueMutations();
  const mutation = queue ? update : create;
  const trimmedLabel = label.trim();
  const isDirty = queue
    ? trimmedLabel !== queue.label || isDefault !== queue.isDefault
    : trimmedLabel.length > 0;
  const submit = () => {
    if (!trimmedLabel || !isDirty || mutation.isPending) return;
    if (queue) {
      update.mutate(
        { videoQueueId: queue.videoQueueId, label: trimmedLabel, isDefault },
        { onSuccess: onSaved },
      );
      return;
    }
    create.mutate({ label: trimmedLabel }, { onSuccess: onSaved });
  };

  return { isDefault, isDirty, label, mutation, setIsDefault, setLabel, submit, trimmedLabel };
}

type QueueFormModel = ReturnType<typeof useQueueForm>;

function QueueSaveButton({ form }: { form: QueueFormModel }) {
  const { t } = useI18n(i18n);
  const action = form.mutation.isPending ? "saving" : "save";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={t(action)}
            className="col-start-1 row-start-1 h-8 rounded-none"
            disabled={!form.trimmedLabel || !form.isDirty || form.mutation.isPending}
            size="icon"
            type="submit"
            variant="ghost"
          >
            {form.mutation.isPending ? (
              <Icons.loader aria-hidden="true" className="animate-spin" />
            ) : (
              <Icons.submit aria-hidden="true" />
            )}
          </Button>
        }
      />
      <TooltipContent>{t(action)}</TooltipContent>
    </Tooltip>
  );
}

function QueueCancelButton({ form, onCancel }: { form: QueueFormModel; onCancel: () => void }) {
  const { t } = useI18n(i18n);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={t("cancel")}
            className="col-start-3 row-start-1 h-8 rounded-none"
            disabled={form.mutation.isPending}
            onClick={onCancel}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Icons.cancel aria-hidden="true" />
          </Button>
        }
      />
      <TooltipContent>{t("cancel")}</TooltipContent>
    </Tooltip>
  );
}

function DefaultQueueSwitch({ form, queue }: { form: QueueFormModel; queue: VideoQueue }) {
  const { t } = useI18n(i18n);

  return (
    <Field
      className="col-span-3 row-start-2 min-h-8 w-auto border-t border-input px-2 text-muted-foreground sm:col-span-1 sm:col-start-4 sm:row-start-1 sm:border-t-0 sm:border-l"
      orientation="horizontal"
    >
      <Switch
        checked={form.isDefault}
        disabled={queue.isDefault || form.mutation.isPending}
        id="default-video-queue"
        onCheckedChange={form.setIsDefault}
        size="sm"
      />
      <FieldLabel className="whitespace-nowrap" htmlFor="default-video-queue">
        {t("defaultVideoQueue")}
      </FieldLabel>
    </Field>
  );
}

function QueueFormControls({
  form,
  onCancel,
  queue,
}: {
  form: QueueFormModel;
  onCancel: () => void;
  queue?: VideoQueue;
}) {
  const { t } = useI18n(i18n);
  const isNameTaken = form.mutation.error?.data?.code === "CONFLICT";
  const columns = queue
    ? "grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-input bg-background/60 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20 has-[input[aria-invalid=true]]:border-destructive sm:w-fit sm:grid-cols-[auto_16rem_auto_auto]"
    : "grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-input bg-background/60 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20 has-[input[aria-invalid=true]]:border-destructive sm:w-fit sm:grid-cols-[auto_16rem_auto]";

  return (
    <Field className="min-w-0 flex-1 sm:w-auto sm:flex-none" data-invalid={isNameTaken}>
      <FieldLabel className="sr-only" htmlFor="video-queue-name">
        {t("queueName")}
      </FieldLabel>
      <div className={columns}>
        <QueueSaveButton form={form} />
        <Input
          aria-describedby={isNameTaken ? "video-queue-error" : undefined}
          aria-invalid={isNameTaken}
          autoComplete="off"
          className="col-start-2 row-start-1 min-w-0 rounded-none border-0 bg-transparent font-medium focus-visible:ring-0 dark:bg-transparent"
          disabled={form.mutation.isPending}
          id="video-queue-name"
          maxLength={64}
          onChange={(event) => form.setLabel(event.target.value)}
          required
          value={form.label}
        />
        <QueueCancelButton form={form} onCancel={onCancel} />
        {queue && <DefaultQueueSwitch form={form} queue={queue} />}
      </div>
    </Field>
  );
}

function NewQueueHelp() {
  const { t } = useI18n(i18n);

  return (
    <div className="flex min-h-8 shrink-0 items-center">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={t("newQueuePrioritiesHelp")}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Icons.help aria-hidden="true" />
            </Button>
          }
        />
        <TooltipContent>{t("newQueuePrioritiesHelp")}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function QueueForm({ id, queue, onCancel, onSaved }: QueueFormProps) {
  const { t } = useI18n(i18n);
  const form = useQueueForm(queue, onSaved);

  return (
    <form
      autoComplete="off"
      className="flex w-full min-w-0 flex-col gap-1.5 sm:w-fit"
      id={id}
      onSubmit={(event) => {
        event.preventDefault();
        form.submit();
      }}
    >
      <div className="flex min-w-0 flex-col items-center gap-1 sm:flex-row">
        <QueueFormControls form={form} onCancel={onCancel} queue={queue} />
        {!queue && <NewQueueHelp />}
      </div>
      {form.mutation.error && (
        <FieldError className="max-w-sm" id="video-queue-error">
          {t(form.mutation.error.data?.code === "CONFLICT" ? "queueNameTaken" : "queueSaveFailed")}
        </FieldError>
      )}
    </form>
  );
}

function QueueLink({ onNavigate, queue }: { onNavigate: () => void; queue: VideoQueue }) {
  return (
    <Link
      key={queue.videoQueueId}
      to="/videos"
      onClick={onNavigate}
      className={buttonVariants({ variant: "ghost", size: "sm", className: "max-w-full" })}
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
  );
}

function SelectedQueueLink({
  onEdit,
  onNavigate,
  queue,
}: {
  onEdit: () => void;
  onNavigate: () => void;
  queue: VideoQueue;
}) {
  const { t } = useI18n(i18n);

  return (
    <div className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] items-center">
      <Link
        to="/videos"
        onClick={onNavigate}
        aria-current="page"
        className={buttonVariants({
          variant: "secondary",
          size: "sm",
          className: "min-w-0 overflow-hidden rounded-r-none pr-2",
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
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={t("editVideoQueue")}
              className="w-5 rounded-l-none border-0 border-l border-secondary-foreground/10"
              onClick={onEdit}
              size="icon-sm"
              variant="secondary"
            >
              <Icons.edit aria-hidden="true" className="size-3" />
            </Button>
          }
        />
        <TooltipContent>{t("editVideoQueue")}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function QueueTab({
  editing,
  onEdit,
  onNavigate,
  onSaved,
  queue,
  selected,
}: {
  editing: boolean;
  onEdit: () => void;
  onNavigate: () => void;
  onSaved: (queue: VideoQueue) => void;
  queue: VideoQueue;
  selected: boolean;
}) {
  if (editing)
    return (
      <QueueForm id="video-queue-editor" queue={queue} onCancel={onNavigate} onSaved={onSaved} />
    );
  if (selected) return <SelectedQueueLink onEdit={onEdit} onNavigate={onNavigate} queue={queue} />;
  return <QueueLink onNavigate={onNavigate} queue={queue} />;
}

function CreateQueueControl({
  creating,
  disabled,
  onCancel,
  onCreate,
  onSaved,
}: {
  creating: boolean;
  disabled: boolean;
  onCancel: () => void;
  onCreate: () => void;
  onSaved: (queue: VideoQueue) => void;
}) {
  const { t } = useI18n(i18n);
  if (creating) return <QueueForm id="video-queue-editor" onCancel={onCancel} onSaved={onSaved} />;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={t("createVideoQueue")}
            disabled={disabled}
            onClick={onCreate}
            size="icon-sm"
            variant="outline"
          >
            <Icons.addQueue aria-hidden="true" />
          </Button>
        }
      />
      <TooltipContent>{t("createVideoQueue")}</TooltipContent>
    </Tooltip>
  );
}

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
  const onSaved = (queue: VideoQueue) => {
    setEditing(null);
    onSelect(queue.videoQueueId);
  };

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 py-2">
      <nav aria-label={t("videoQueues")} className="flex min-w-0 flex-wrap items-center gap-1">
        {queuesQ.isLoading && (
          <span role="status" className="text-sm text-muted-foreground">
            {t("loadingQueues")}
          </span>
        )}
        {queues.map((queue) => (
          <QueueTab
            key={queue.videoQueueId}
            editing={editing !== "new" && editing?.videoQueueId === queue.videoQueueId}
            onEdit={() => setEditing(queue)}
            onNavigate={() => setEditing(null)}
            onSaved={onSaved}
            queue={queue}
            selected={selected?.videoQueueId === queue.videoQueueId}
          />
        ))}
        <CreateQueueControl
          creating={editing === "new"}
          disabled={queuesQ.isLoading || queuesQ.isError}
          onCancel={() => setEditing(null)}
          onCreate={() => setEditing("new")}
          onSaved={onSaved}
        />
      </nav>
      {queuesQ.isError && (
        <QueryErrorState
          className="min-h-20 p-2"
          isRetrying={queuesQ.isFetching}
          onRetry={() => void queuesQ.refetch()}
        />
      )}
    </div>
  );
}

function VideoQueueOptions({ queues }: { queues: VideoQueue[] }) {
  return queues.map((queue) => (
    <option key={queue.videoQueueId} value={queue.videoQueueId}>
      {queue.label}
    </option>
  ));
}

export function VideoQueueSelect({
  queues,
  value,
  onChange,
  disabled,
  label,
  variant = "field",
}: {
  queues: VideoQueue[];
  value: number;
  onChange: (videoQueueId: number) => void;
  disabled?: boolean;
  label: string;
  variant?: "field" | "action";
}) {
  if (variant === "action") {
    return (
      <Tooltip>
        <label className="relative inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[min(var(--radius-md),12px)] border border-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-[select:disabled]:pointer-events-none has-[select:disabled]:cursor-default has-[select:disabled]:opacity-50">
          <span className="sr-only">{label}</span>
          <Icons.moveToQueue aria-hidden="true" className="size-3.5" />
          <TooltipTrigger
            render={
              <select
                aria-label={label}
                className="absolute inset-0 size-full cursor-pointer opacity-0 outline-none disabled:cursor-default"
                disabled={disabled}
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
              >
                <VideoQueueOptions queues={queues} />
              </select>
            }
          />
        </label>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }

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
        <VideoQueueOptions queues={queues} />
      </select>
    </label>
  );
}
