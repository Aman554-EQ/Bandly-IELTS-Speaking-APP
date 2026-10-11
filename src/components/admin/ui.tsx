"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { type AnyOp, type OpState, useAdminOp } from "./use-admin-op";

export const fieldClass =
  "mt-1 block w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-primary";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="font-semibold">
        {label}
        {hint && <span className="ml-1 font-normal text-muted">({hint})</span>}
      </label>
      {children(id)}
    </div>
  );
}

/** Success, error and "can't publish because…" messages. */
export function OpFeedback({ state, className = "" }: { state: OpState; className?: string }) {
  if (state.error) {
    return (
      <div role="alert" className={`text-sm font-medium text-danger ${className}`}>
        <p>{state.error}</p>
        {state.problems.length > 0 && (
          <ul className="mt-1 list-disc pl-5 font-normal">
            {state.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (state.message) {
    return (
      <p role="status" className={`text-sm font-medium text-success ${className}`}>
        {state.message}
      </p>
    );
  }
  return null;
}

/** One button = one change. With `confirm`, a dialog states the consequence first. */
export function OpButton({
  op,
  label,
  confirm,
  variant = "secondary",
  size = "sm",
  ariaLabel,
  disabled,
}: {
  op: AnyOp;
  label: string;
  confirm?: { title: string; description: string; destructive?: boolean };
  variant?: "primary" | "secondary" | "ghost" | "danger" | "soft";
  size?: "sm" | "md";
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const state = useAdminOp();
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        variant={variant}
        size={size}
        disabled={state.busy || disabled}
        aria-label={ariaLabel}
        onClick={() => (confirm ? setOpen(true) : void state.run(op))}
      >
        {state.busy ? "Working…" : label}
      </Button>
      <OpFeedback state={state} className="max-w-md" />
      {confirm && (
        <ConfirmDialog
          open={open}
          title={confirm.title}
          description={confirm.description}
          confirmLabel={label}
          destructive={confirm.destructive}
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            void state.run(op);
          }}
        />
      )}
    </span>
  );
}

/** ↑ ↓ buttons. */
export function MoveButtons({
  up,
  down,
  name,
  first,
  last,
}: {
  up: AnyOp;
  down: AnyOp;
  name: string;
  first: boolean;
  last: boolean;
}) {
  const state = useAdminOp();
  return (
    <span className="inline-flex items-center">
      <Button
        size="sm"
        variant="ghost"
        disabled={state.busy || first}
        aria-label={`Move ${name} up`}
        onClick={() => void state.run(up)}
      >
        ↑
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={state.busy || last}
        aria-label={`Move ${name} down`}
        onClick={() => void state.run(down)}
      >
        ↓
      </Button>
      {state.error && <OpFeedback state={state} />}
    </span>
  );
}

const TONE = {
  published: "bg-success-soft text-success",
  draft: "bg-surface-2 text-muted",
  archived: "bg-accent-soft text-accent",
} as const;

export function StatusBadge({ status }: { status: "draft" | "published" | "archived" }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${TONE[status]}`}>
      {status === "published" ? "Published" : status === "draft" ? "Draft" : "Archived"}
    </span>
  );
}

export const toLines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
