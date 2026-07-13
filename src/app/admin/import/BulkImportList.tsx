"use client";

import Link from "next/link";
import { useState } from "react";
import { importLfgTeacher, importSelectedLfgTeachers } from "./actions";

type Item = {
  cid: number;
  shi_id: number;
  title: string;
};

const MAX_BULK_IMPORTS = 10;

export function BulkImportList({
  items,
  importedByCid,
  page,
}: {
  items: Item[];
  importedByCid: Record<string, number>;
  page: number;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const available = items.filter((item) => !importedByCid[String(item.cid)]);
  const selectedSet = new Set(selected);

  function toggle(cid: number) {
    setSelected((current) => {
      if (current.includes(cid)) return current.filter((item) => item !== cid);
      if (current.length >= MAX_BULK_IMPORTS) {
        alert(`单次最多选择 ${MAX_BULK_IMPORTS} 条`);
        return current;
      }
      return [...current, cid];
    });
  }

  function toggleAll() {
    const selectable = available.slice(0, MAX_BULK_IMPORTS).map((item) => item.cid);
    const allSelected = selectable.length > 0 && selectable.every((cid) => selectedSet.has(cid));
    setSelected(allSelected ? [] : selectable);
  }

  return (
    <form action={importSelectedLfgTeachers}>
      <input type="hidden" name="page" value={page} />
      <div className="mb-3 flex items-center justify-between rounded-xl bg-white px-3 py-2 shadow-sm">
        <button type="button" onClick={toggleAll} className="text-xs font-medium text-pink-600">
          全选本页（最多 {MAX_BULK_IMPORTS} 条）
        </button>
        <span className="text-xs text-gray-400">已选 {selected.length} 条</span>
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const localId = importedByCid[String(item.cid)];
          const checked = selectedSet.has(item.cid);
          return (
            <div key={item.cid} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                {!localId && (
                  <input
                    type="checkbox"
                    name="cids"
                    value={item.cid}
                    checked={checked}
                    onChange={() => toggle(item.cid)}
                    className="h-5 w-5 flex-none accent-pink-500"
                    aria-label={`选择 ${item.title}`}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="line-clamp-2 text-sm font-semibold text-gray-800">{item.title}</h2>
                  <p className="mt-1 text-xs text-gray-400">cid {item.cid} · 地区 {item.shi_id}</p>
                </div>
                {localId ? (
                  <Link href={`/admin/${localId}/edit`} className="self-center rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-600">
                    已导入
                  </Link>
                ) : (
                  <button
                    type="submit"
                    name="cid"
                    value={item.cid}
                    formAction={importLfgTeacher}
                    className="self-center rounded-lg bg-pink-500 px-3 py-2 text-xs font-bold text-white"
                  >
                    导入（2 金币）
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-3 mt-4 rounded-2xl border border-pink-100 bg-white/95 p-3 shadow-lg backdrop-blur">
        <button
          type="submit"
          disabled={selected.length === 0}
          onClick={(event) => {
            if (!confirm(`确认导入 ${selected.length} 条信息？预计消耗 ${selected.length * 2} 金币。`)) {
              event.preventDefault();
            }
          }}
          className="w-full rounded-xl bg-pink-500 py-3 text-sm font-bold text-white disabled:bg-gray-300"
        >
          导入已选（{selected.length} 条 / 预计 {selected.length * 2} 金币）
        </button>
      </div>
    </form>
  );
}
