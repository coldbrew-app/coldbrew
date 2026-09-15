import { useState, type FormEvent } from "react";

import { Icons } from "./icons";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";

type WidgetConnectionFormCopy = {
  cancel: string;
  connect: string;
  connecting: string;
  description: string;
  invalidWidgetURL: string;
  openWidgetSettings: string;
  title: string;
  widgetURLHelp: string;
  widgetURLLabel: string;
  widgetURLPlaceholder: string;
  widgetURLSafety: string;
};

export function WidgetConnectionForm({
  copy,
  fieldId,
  isError,
  isPending,
  onClose,
  onConnect,
  onReset,
  settingsURL,
}: {
  copy: WidgetConnectionFormCopy;
  fieldId: string;
  isError: boolean;
  isPending: boolean;
  onClose: () => void;
  onConnect: (widgetURL: string, onSuccess: () => void) => void;
  onReset: () => void;
  settingsURL: string;
}) {
  const [widgetURL, setWidgetURL] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = widgetURL.trim();
    if (url.length === 0 || isPending) return;
    onConnect(url, () => {
      setWidgetURL("");
      onClose();
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <div className="flex flex-col gap-2">
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </div>
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <Field data-invalid={isError || undefined}>
            <FieldLabel htmlFor={fieldId}>{copy.widgetURLLabel}</FieldLabel>
            <Input
              aria-invalid={isError || undefined}
              autoComplete="off"
              id={fieldId}
              maxLength={4096}
              onChange={(event) => {
                setWidgetURL(event.target.value);
                onReset();
              }}
              placeholder={copy.widgetURLPlaceholder}
              spellCheck={false}
              type="url"
              value={widgetURL}
            />
            <FieldDescription>
              <a
                className="inline-flex items-center gap-1 rounded-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                href={settingsURL}
                rel="noopener noreferrer"
                target="_blank"
              >
                {copy.openWidgetSettings}
                <Icons.externalLink aria-hidden="true" size={12} />
              </a>{" "}
              {copy.widgetURLHelp}
            </FieldDescription>
            {isError && <FieldError>{copy.invalidWidgetURL}</FieldError>}
          </Field>
          <div className="flex items-start gap-2 rounded-xl bg-muted/70 p-3 text-xs leading-relaxed text-muted-foreground">
            <Icons.secure aria-hidden="true" className="shrink-0 text-primary" size={15} />
            <p>{copy.widgetURLSafety}</p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button disabled={isPending} onClick={onClose} type="button" variant="outline">
              {copy.cancel}
            </Button>
            <Button disabled={widgetURL.trim().length === 0 || isPending} type="submit">
              {isPending ? copy.connecting : copy.connect}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
