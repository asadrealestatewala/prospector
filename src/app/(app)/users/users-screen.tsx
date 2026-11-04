"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { History, UserPlus, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusChip, type Tone } from "@/components/ui/chips";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import { ConfirmDialog, Dialog, DialogClose, DialogContent, SidePanel } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toaster";
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { formatPkDateTime } from "@/lib/utils";
import { changeRole, forcePasswordReset, inviteUser, logExport, setActive, setMfaRequired, type ActionResult } from "./actions";

export type UserRow = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  status: "invited" | "active" | "deactivated";
  last_login_at: string | null;
  mfa_required: boolean;
  must_reset_password: boolean;
  created_at: string;
};

export type AuditRow = {
  id: number;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

const STATUS_TONE: Record<UserRow["status"], Tone> = { active: "success", invited: "info", deactivated: "neutral" };
const STATUS_LABEL: Record<UserRow["status"], string> = { active: "Active", invited: "Invited", deactivated: "Deactivated" };

function describeDetails(d: Record<string, unknown>) {
  return Object.entries(d)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export function UsersScreen({ meId, users, audit }: { meId: string; users: UserRow[]; audit: AuditRow[] }) {
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<UserRow | null>(null);
  const [confirm, setConfirm] = React.useState<null | { title: string; description: string; label: string; destructive?: boolean; run: () => Promise<ActionResult> }>(null);
  const [busy, setBusy] = React.useState(false);
  const [actionFilter, setActionFilter] = React.useState("");

  async function run(fn: () => Promise<ActionResult>) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.ok) {
      toast.success(res.message);
      router.refresh();
      return true;
    }
    toast.error(res.error);
    return false;
  }

  const current = selected ? users.find((u) => u.id === selected.id) ?? selected : null;

  const userColumns: Column<UserRow>[] = [
    { key: "name", header: "Name", cell: (u) => <span className="font-medium">{u.full_name || "—"}</span>, value: (u) => u.full_name.toLowerCase() },
    { key: "email", header: "Email", cell: (u) => u.email, value: (u) => u.email },
    { key: "role", header: "Role", cell: (u) => ROLE_LABELS[u.role], value: (u) => ROLE_LABELS[u.role] },
    {
      key: "status",
      header: "Status",
      cell: (u) => (
        <span className="flex flex-wrap gap-1">
          <StatusChip tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</StatusChip>
          {u.must_reset_password ? <StatusChip tone="warning">Password reset due</StatusChip> : null}
        </span>
      ),
      value: (u) => STATUS_LABEL[u.status],
    },
    { key: "mfa", header: "Two-step", cell: (u) => (u.mfa_required ? "Required" : "Optional"), value: (u) => (u.mfa_required ? "Required" : "Optional") },
    { key: "last", header: "Last login", cell: (u) => formatPkDateTime(u.last_login_at), value: (u) => u.last_login_at ?? "" },
  ];

  const actions = Array.from(new Set(audit.map((a) => a.action))).sort();
  const filteredAudit = actionFilter ? audit.filter((a) => a.action === actionFilter) : audit;
  const auditColumns: Column<AuditRow>[] = [
    { key: "time", header: "When (PKT)", cell: (a) => <span className="tabular whitespace-nowrap">{formatPkDateTime(a.created_at)}</span>, value: (a) => a.created_at },
    { key: "who", header: "Who", cell: (a) => a.actor_email ?? "System", value: (a) => a.actor_email ?? "System" },
    { key: "action", header: "Action", cell: (a) => <code className="text-helper">{a.action}</code>, value: (a) => a.action },
    { key: "entity", header: "Record", cell: (a) => a.entity_type, value: (a) => `${a.entity_type} ${a.entity_id ?? ""}` },
    { key: "details", header: "Details", cell: (a) => <span className="line-clamp-1 text-helper text-fg-muted">{describeDetails(a.details)}</span>, value: (a) => describeDetails(a.details) },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        description="Staff accounts, roles and the audit trail."
        actions={
          <Button variant="primary" onClick={() => setInviteOpen(true)}>
            <UserPlus /> Invite user
          </Button>
        }
      />
      <Tabs defaultValue="users">
        <TabsList tabs={[{ value: "users", label: `Users (${users.length})` }, { value: "audit", label: "Audit log" }]} />
        <TabsContent value="users">
          <DataTable
            rows={users}
            columns={userColumns}
            rowKey={(u) => u.id}
            onRowClick={setSelected}
            exportName="prospector-users"
            onExport={(n) => void logExport("users", n)}
            empty={<EmptyState icon={Users} message="No staff accounts yet. Invite your team to get started." />}
          />
        </TabsContent>
        <TabsContent value="audit">
          <DataTable
            rows={filteredAudit}
            columns={auditColumns}
            rowKey={(a) => String(a.id)}
            exportName="prospector-audit-log"
            onExport={(n) => void logExport("audit_log", n)}
            toolbar={
              <label className="flex items-center gap-2 text-helper text-fg-muted">
                Action
                <Select className="h-8 w-56" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
                  <option value="">All actions</option>
                  {actions.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </Select>
              </label>
            }
            empty={<EmptyState icon={History} message="No audited actions yet. Exports, deletes, role changes, key changes and budget edits appear here." />}
          />
          <p className="mt-2 text-helper text-fg-muted">Showing the latest 500 entries. Entries cannot be edited or deleted.</p>
        </TabsContent>
      </Tabs>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} onDone={() => router.refresh()} />

      {current ? (
        <SidePanel open onOpenChange={(o) => !o && setSelected(null)} title={current.full_name || current.email} description={current.email}>
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap gap-2">
              <StatusChip tone={STATUS_TONE[current.status]}>{STATUS_LABEL[current.status]}</StatusChip>
              {current.must_reset_password ? <StatusChip tone="warning">Password reset due</StatusChip> : null}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-body">
              <dt className="text-fg-muted">Last login</dt>
              <dd>{formatPkDateTime(current.last_login_at)}</dd>
              <dt className="text-fg-muted">Added</dt>
              <dd>{formatPkDateTime(current.created_at)}</dd>
            </dl>
            <Field label="Role" htmlFor="role" hint={current.id === meId ? "You cannot change your own role." : ROLE_DESCRIPTIONS[current.role]}>
              <Select
                id="role"
                value={current.role}
                disabled={current.id === meId || busy}
                onChange={(e) => {
                  const role = e.target.value as Role;
                  setConfirm({
                    title: "Change role",
                    description: `${current.email} will become ${ROLE_LABELS[role]} and their access changes immediately.`,
                    label: "Change role",
                    run: () => changeRole(current.id, role),
                  });
                }}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </Select>
            </Field>
            {current.role === "admin" || current.role === "manager" ? (
              <label className="flex items-start gap-3 text-body">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-[var(--brand-600)]"
                  checked={current.mfa_required}
                  disabled={busy}
                  onChange={(e) => void run(() => setMfaRequired(current.id, e.target.checked))}
                />
                <span>
                  Require two-step verification
                  <span className="block text-helper text-fg-muted">They will be asked to set up an authenticator app at next sign in.</span>
                </span>
              </label>
            ) : null}
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  setConfirm({
                    title: "Force password reset",
                    description: `${current.email} will be emailed a reset link and must choose a new password before using Prospector again.`,
                    label: "Force reset",
                    run: () => forcePasswordReset(current.id),
                  })
                }
              >
                Force password reset
              </Button>
              {current.id !== meId ? (
                current.status === "deactivated" ? (
                  <Button variant="secondary" disabled={busy} onClick={() => void run(() => setActive(current.id, true))}>
                    Reactivate account
                  </Button>
                ) : (
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      setConfirm({
                        title: "Deactivate account",
                        description: `${current.email} will be signed out and unable to sign in. Their leads and history stay. 1 account affected.`,
                        label: "Deactivate",
                        destructive: true,
                        run: () => setActive(current.id, false),
                      })
                    }
                  >
                    Deactivate account
                  </Button>
                )
              ) : null}
            </div>
          </div>
        </SidePanel>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.title ?? ""}
        description={confirm?.description ?? ""}
        confirmLabel={confirm?.label ?? "Confirm"}
        destructive={confirm?.destructive}
        loading={busy}
        onConfirm={async () => {
          if (!confirm) return;
          await run(confirm.run);
          setConfirm(null);
        }}
      />
    </>
  );
}

function InviteDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [role, setRole] = React.useState<Role>("sales_agent");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function submit(form: FormData) {
    setPending(true);
    setError(null);
    const res = await inviteUser({
      fullName: String(form.get("fullName") ?? ""),
      email: String(form.get("email") ?? ""),
      role,
      mfaRequired: form.get("mfaRequired") === "on",
    });
    setPending(false);
    if (!res.ok) return setError(res.error);
    toast.success(res.message);
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Invite user" description="They get an email link to set their password.">
        <form action={submit} className="flex flex-col gap-4">
          {error ? <p className="rounded-control bg-error-soft px-3 py-2 text-helper text-error" role="alert">{error}</p> : null}
          <Field label="Full name" htmlFor="fullName">
            <Input id="fullName" name="fullName" required autoComplete="off" />
          </Field>
          <Field label="Email" htmlFor="invite-email">
            <Input id="invite-email" name="email" type="email" required autoComplete="off" />
          </Field>
          <Field label="Role" htmlFor="invite-role" hint={ROLE_DESCRIPTIONS[role]}>
            <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </Select>
          </Field>
          {role === "admin" || role === "manager" ? (
            <label className="flex items-center gap-3 text-body">
              <input type="checkbox" name="mfaRequired" className="size-4 accent-[var(--brand-600)]" />
              Require two-step verification
            </label>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary">Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary" loading={pending}>Send invite</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
