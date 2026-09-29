"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import type { ImportActionState } from "@/lib/partner-import-types";
import { deletePartnerDrafts } from "./actions";
import { approvePartnerDrafts, assignPartnerDrafts } from "./assignment-actions";

type DraftRow = {
  id: number;
  version: number;
  status: string;
  sourceName: string;
  createdLabel: string;
  teamUsername?: string | null;
};
type TeamAccountOption = { id: number; username: string };
type UpdateState = ImportActionState & { updatedTokens?: string[] };
const statusLabels: Record<string, string> = {
  pending: "待初审", ready: "待分配", assigned: "成员处理中", returned: "退回修改", submitted: "待终审",
  published: "已发布", rejected: "已拒绝",
};
const removable = (draft: DraftRow) => draft.status === "pending" || draft.status === "rejected";
const selectable = (draft: DraftRow, assignmentReady: boolean) => removable(draft) || assignmentReady && draft.status === "ready";
const token = (draft: DraftRow) => `${draft.id}:${draft.version}`;

export function DraftList({ drafts, emptyLabel, teamAccounts = [], assignmentReady = false }: {
  drafts: DraftRow[]; emptyLabel: string; teamAccounts?: TeamAccountOption[]; assignmentReady?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<string[] | null>(null);
  const [teamAccountId, setTeamAccountId] = useState("");
  const [state, action, deleting] = useActionState(deletePartnerDrafts, {} as ImportActionState);
  async function finishUpdate(
    handler: (previous: ImportActionState, form: FormData) => Promise<ImportActionState>,
    previous: UpdateState, form: FormData,
  ): Promise<UpdateState> {
    if (!assignmentReady) return { error: "团队分配功能尚未启用。" };
    const result = await handler(previous, form);
    if (result.error) return { ...result, updatedTokens: previous.updatedTokens };
    const ids = new Set(result.updatedDraftIds ?? []);
    const updatedTokens = form.getAll("draft").filter((value): value is string =>
      typeof value === "string" && ids.has(Number(value.split(":")[0])));
    setSelected(values => values.filter(value => !updatedTokens.includes(value)));
    setConfirmation(null);
    router.refresh();
    return { ...result, updatedTokens: [...new Set([...(previous.updatedTokens ?? []), ...updatedTokens])] };
  }
  const [approveState, approveAction, approving] = useActionState<UpdateState, FormData>(
    (previous, form) => finishUpdate(approvePartnerDrafts, previous, form), {});
  const [assignState, assignAction, assigning] = useActionState<UpdateState, FormData>(
    (previous, form) => finishUpdate(assignPartnerDrafts, previous, form), {});
  const pending = deleting || approving || assigning;
  const deleted = new Set(state.deletedDraftIds ?? []);
  const updated = new Set([...(approveState.updatedTokens ?? []), ...(assignState.updatedTokens ?? [])]);
  const rows = drafts.filter(draft => !deleted.has(draft.id));
  const eligible = rows.filter(draft => selectable(draft, assignmentReady) && !updated.has(token(draft))).map(token);
  // A refreshed status or version cannot inherit a selection or a delete confirmation.
  const chosen = selected.filter(value => eligible.includes(value));
  const chosenRows = rows.filter(draft => chosen.includes(token(draft)));
  const canApprove = assignmentReady && chosen.length > 0 && chosenRows.every(draft => draft.status === "pending");
  const canAssign = assignmentReady && chosen.length > 0 && chosenRows.every(draft => draft.status === "ready");
  const canDelete = chosen.length > 0 && chosenRows.every(removable);
  const accountAvailable = teamAccounts.some(account => String(account.id) === teamAccountId);
  const allSelected = eligible.length > 0 && chosen.length === eligible.length;
  const confirming = canDelete && confirmation !== null
    && confirmation.length === chosen.length && confirmation.every(value => chosen.includes(value));
  const hiddenDrafts = (values: string[]) => values.map(value => <input key={value} type="hidden" name="draft" value={value} />);

  function toggle(value: string) {
    setSelected(chosen.includes(value) ? chosen.filter(item => item !== value) : [...chosen, value]);
    setConfirmation(null);
  }

  return <div className="mt-3">
    {eligible.length > 0 && <div className="flex flex-wrap items-center gap-3 rounded-xl bg-gray-50 p-3">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={allSelected} disabled={pending}
          ref={element => { if (element) element.indeterminate = chosen.length > 0 && !allSelected; }}
          onChange={() => { setSelected(allSelected ? [] : eligible); setConfirmation(null); }}
          className="h-4 w-4 accent-pink-500" />
        全选本页
      </label>
      <span className="text-sm text-gray-500" aria-live="polite">已选 {chosen.length} 条</span>
      {assignmentReady && rows.some(draft => draft.status === "pending") && <form action={approveAction} data-operation="approve-selected"
        onSubmit={event => { if (pending || !canApprove) event.preventDefault(); }}>
        {hiddenDrafts(canApprove ? chosen : [])}
        <button type="submit" disabled={pending || !canApprove}
          className="rounded-lg bg-pink-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {approving ? "正在同意…" : "同意所选"}
        </button>
      </form>}
      {assignmentReady && rows.some(draft => draft.status === "ready") && <form action={assignAction} data-operation="assign-selected"
        onSubmit={event => { if (pending || !canAssign || !accountAvailable) event.preventDefault(); }}
        className="flex flex-wrap items-center gap-2">
        {hiddenDrafts(canAssign ? chosen : [])}
        <label className="text-sm text-gray-700">分配给
          <select name="teamAccountId" value={teamAccountId} disabled={pending || teamAccounts.length === 0}
            onChange={event => { setTeamAccountId(event.target.value); setConfirmation(null); }}
            className="ml-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
            <option value="">选择团队成员</option>
            {teamAccounts.map(account => <option key={account.id} value={String(account.id)}>{account.username}</option>)}
          </select>
        </label>
        <button type="submit" disabled={pending || !canAssign || !accountAvailable}
          className="rounded-lg bg-pink-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {assigning ? "正在分配…" : "分配所选"}
        </button>
        {teamAccounts.length === 0 && <p className="text-xs text-gray-500">暂无可用团队成员，请先启用成员账号及其站点。</p>}
      </form>}
      {rows.some(removable) && <button type="button" disabled={pending || !canDelete}
        onClick={() => setConfirmation([...chosen])}
        className="ml-auto rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">
        删除所选
      </button>}
      <p className="w-full text-xs leading-5 text-gray-500">{assignmentReady ? "待初审稿同意后进入待分配，再交给成员补充并提交终审。请按相同处理阶段选择；只有待初审和已拒绝稿可以删除。" : "仅选择本页的待审稿和已拒绝稿。删除会移除草稿及其私有照片，已发布帖子不受影响。"}</p>
    </div>}

    <form action={action} data-operation="delete" onSubmit={event => {
      const submitter = (event.nativeEvent as SubmitEvent | undefined)?.submitter;
      if (!confirming || pending || submitter?.getAttribute("name") !== "confirmDelete") event.preventDefault();
    }}>
      {confirming && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3" role="group" aria-labelledby="delete-drafts-heading">
        <p id="delete-drafts-heading" className="text-sm font-semibold text-red-800">确认删除所选的 {chosen.length} 条草稿？</p>
        <p className="mt-1 text-xs leading-5 text-red-700">草稿内容和私有照片将被删除，无法撤销。以后重新导入同一页，这些帖子可能再次进入待审区。</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="submit" name="confirmDelete" value="yes" disabled={pending}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {deleting ? "正在删除…" : `确认删除 ${chosen.length} 条`}
          </button>
          <button type="button" disabled={pending} onClick={() => setConfirmation(null)}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 disabled:opacity-50">取消</button>
        </div>
      </div>}
      {hiddenDrafts(canDelete ? chosen : [])}
    </form>
    <div aria-live="polite">
      {[state, approveState, assignState].map((result, index) => <div key={index}>
        {result.error && <p role="alert" className="mt-3 text-sm text-red-700">{result.error}</p>}
        {result.message && <p className="mt-3 text-sm text-emerald-700">{result.message}</p>}
      </div>)}
    </div>

    <div className="mt-3 divide-y divide-gray-100">
      {rows.map(draft => <div key={draft.id} className="flex flex-wrap items-center gap-3 py-3">
        <input type="checkbox" aria-label={`选择草稿 #${draft.id}`}
          title={selectable(draft, assignmentReady) ? `选择草稿 #${draft.id}` : "此稿件当前只能查看"}
          checked={chosen.includes(token(draft))} disabled={pending || !selectable(draft, assignmentReady) || updated.has(token(draft))}
          onChange={() => toggle(token(draft))} className="h-4 w-4 shrink-0 accent-pink-500" />
        <Link href={`/adminzhangzhang/partner-import/drafts/${draft.id}`} prefetch={false}
          className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800">草稿 #{draft.id} <span className="ml-2 font-normal text-gray-500">{!assignmentReady && draft.status === "pending" ? "待审查" : statusLabels[draft.status] ?? "未知状态"}</span></p>
            <p className="mt-1 break-words text-xs text-gray-500">{draft.sourceName} · {draft.createdLabel}</p>
            {assignmentReady && draft.teamUsername && <p className="mt-1 break-words text-xs text-gray-500">负责人：{draft.teamUsername}</p>}
          </div>
          <span className="text-sm text-pink-600">{draft.status === "pending" ? "审查内容" : "查看记录"} →</span>
        </Link>
        {assignmentReady && draft.status === "pending" && <form action={approveAction} data-operation={`approve-${draft.id}`}
          onSubmit={event => { if (pending || updated.has(token(draft))) event.preventDefault(); }}>
          {hiddenDrafts([token(draft)])}
          <button type="submit" disabled={pending || updated.has(token(draft))} aria-label={`同意草稿 #${draft.id}`}
            className="rounded-lg border border-pink-200 px-3 py-2 text-sm font-semibold text-pink-600 disabled:opacity-50">同意</button>
        </form>}
      </div>)}
      {rows.length === 0 && <p className="py-5 text-sm text-gray-500">{emptyLabel}</p>}
    </div>
  </div>;
}
