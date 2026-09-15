import { useState, type FormEvent } from "react";

import { Icons } from "./icons";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";

type WidgetConnectionFormCopyKey =
  | "cancel"
  | "connect"
  | "connecting"
  | "description"
  | "invalidWidgetURL"
  | "openWidgetSettings"
  | "title"
  | "widgetURLHelp"
  | "widgetURLLabel"
  | "widgetURLPlaceholder"
  | "widgetURLSafety";

export function WidgetConnectionForm({
  fieldId,
  isError,
  isPending,
  onClose,
  onConnect,
  onReset,
  settingsURL,
  translate,
}: {
  fieldId: string;
  isError: boolean;
  isPending: boolean;
  onClose: () => void;
  onConnect: (widgetURL: string, onSuccess: () => void) => void;
  onReset: () => void;
  settingsURL: string;
  translate: (key: WidgetConnectionFormCopyKey) => string;
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
          <DialogTitle>{translate("title")}</DialogTitle>
          <DialogDescription>{translate("description")}</DialogDescription>
        </div>
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <Field data-invalid={isError || undefined}>
            <FieldLabel htmlFor={fieldId}>{translate("widgetURLLabel")}</FieldLabel>
            <Input
              aria-invalid={isError || undefined}
              autoComplete="off"
              id={fieldId}
              maxLength={4096}
              onChange={(event) => {
                setWidgetURL(event.target.value);
                onReset();
              }}
              placeholder={translate("widgetURLPlaceholder")}
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
                {translate("openWidgetSettings")}
                <Icons.externalLink aria-hidden="true" size={12} />
              </a>{" "}
              {translate("widgetURLHelp")}
            </FieldDescription>
            {isError && <FieldError>{translate("invalidWidgetURL")}</FieldError>}
          </Field>
          <div className="flex items-start gap-2 rounded-xl bg-muted/70 p-3 text-xs leading-relaxed text-muted-foreground">
            <Icons.secure aria-hidden="true" className="shrink-0 text-primary" size={15} />
            <p>{translate("widgetURLSafety")}</p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button disabled={isPending} onClick={onClose} type="button" variant="outline">
              {translate("cancel")}
            </Button>
            <Button disabled={widgetURL.trim().length === 0 || isPending} type="submit">
              {translate(isPending ? "connecting" : "connect")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
