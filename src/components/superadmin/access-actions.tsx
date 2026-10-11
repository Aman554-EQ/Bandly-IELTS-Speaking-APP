"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { RoleChange, RoleKey, UserStatus } from "@/server/auth/policy";

interface Option {
  label: string;
  change: RoleChange;
  confirm: string;
  destructive?: boolean;
}

function optionsFor(roles: RoleKey[], status: UserStatus): Option[] {
  const o: Option[] = [];
  if (status === "deleted") return o;
  if (roles.includes("admin")) {
    o.push({
      label: "Remove admin",
      change: { kind: "revoke", role: "admin" },
      confirm: "They will lose access to content management.",
      destructive: true,
    });
  } else {
    o.push({
      label: "Make admin",
      change: { kind: "grant", role: "admin" },
      confirm: "They will be able to create, edit, publish and archive content.",
    });
  }
  if (roles.includes("superadmin")) {
    o.push({
      label: "Remove superadmin",
      change: { kind: "revoke", role: "superadmin" },
      confirm: "They will lose user management, analytics and the audit log.",
      destructive: true,
    });
  } else {
    o.push({
      label: "Make superadmin",
      change: { kind: "grant", role: "superadmin" },
      confirm: "They will be able to manage every user, including you.",
    });
  }
  if (status === "active") {
    o.push({
      label: "Suspend",
      change: { kind: "status", status: "suspended" },
      confirm: "They will be signed out of everything in Bandly until reactivated.",
      destructive: true,
    });
  } else {
    o.push({
      label: "Reactivate",
      change: { kind: "status", status: "active" },
      confirm: "They will be able to use Bandly again.",
    });
  }
  return o;
}

/** Role and status buttons for one user (the server enforces every rule again). */
export function AccessActions({
  userId,
  email,
  roles,
  status,
}: {
  userId: string;
  email: string;
  roles: RoleKey[];
  status: UserStatus;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Option | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function apply(o: Option) {
    setPending(null);
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/superadmin/users/${userId}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(o.change),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "The change was not saved.");
      setMessage({ ok: true, text: "Saved." });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "The change was not saved." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {optionsFor(roles, status).map((o) => (
          <Button
            key={o.label}
            size="sm"
            variant={o.destructive ? "danger" : "secondary"}
            disabled={busy}
            onClick={() => setPending(o)}
          >
            {o.label}
          </Button>
        ))}
      </div>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`text-sm font-medium ${message.ok ? "text-success" : "text-danger"}`}
        >
          {message.text}
        </p>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={pending ? `${pending.label}: ${email}?` : ""}
        description={pending?.confirm ?? ""}
        confirmLabel={pending?.label ?? "Confirm"}
        destructive={pending?.destructive}
        onConfirm={() => pending && apply(pending)}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
