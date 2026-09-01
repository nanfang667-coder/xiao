"use client";

import Link from "next/link";
import { readSheet } from "read-excel-file/browser";
import { useMemo, useRef, useState, useTransition } from "react";
import { citiesOfProvince, provinces } from "@/data/locations";
import type {
  BulkAlleyLocationOverride,
  BulkAlleyPreviewRow,
  BulkAlleySourceRow,
} from "@/lib/alley-bulk-import";
import { importBulkAlleys, previewBulkAlleys } from "../bulk-actions";
import { parseBulkTableText, tableRowsToBulkSources } from "./bulk-parser";

const statusStyles: Record<BulkAlleyPreviewRow["status"], string> = {
  ready: "bg-emerald-50 text-emerald-700",
  unmatched: "bg-amber-50 text-amber-700",
  invalid: "bg-red-50 text-red-700",
  duplicate: "bg-gray-100 text-gray-500",
};

const statusLabels: Record<BulkAlleyPreviewRow["status"], string> = {
  ready: "可导入",
  unmatched: "待匹配",
  invalid: "内容有误",
  duplicate: "重复跳过",
};

async function readTextFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buffer);
  if (text.includes("�")) text = new TextDecoder("gb18030").decode(buffer);
  return text;
}

export function BulkAlleyImport() {
  const [pastedText, setPastedText] = useState("");
  const [sources, setSources] = useState<BulkAlleySourceRow[]>([]);
  const [previewRows, setPreviewRows] = useState<BulkAlleyPreviewRow[]>([]);
  const [overrides, setOverrides] = useState<
    Record<number, BulkAlleyLocationOverride>
  >({});
  const [isPublished, setIsPublished] = useState(true);
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(
    () => ({
      ready: previewRows.filter((row) => row.status === "ready").length,
      unmatched: previewRows.filter((row) => row.status === "unmatched").length,
      invalid: previewRows.filter((row) => row.status === "invalid").length,
      duplicate: previewRows.filter((row) => row.status === "duplicate").length,
    }),
    [previewRows],
  );

  const requestPreview = (
    nextSources: BulkAlleySourceRow[],
    nextOverrides: Record<number, BulkAlleyLocationOverride>,
  ) => {
    setMessage("");
    setCompleted(false);
    startTransition(async () => {
      try {
        const result = await previewBulkAlleys(nextSources, nextOverrides);
        if (!result.ok) {
          setPreviewRows([]);
          setMessage(result.message);
          return;
        }
        setPreviewRows(result.rows);
      } catch {
        setPreviewRows([]);
        setMessage("预览请求失败，请刷新页面后重试");
      }
    });
  };

  const acceptRows = (rows: unknown[][]) => {
    try {
      const nextSources = tableRowsToBulkSources(rows);
      setSources(nextSources);
      setOverrides({});
      requestPreview(nextSources, {});
    } catch (error) {
      setSources([]);
      setPreviewRows([]);
      setMessage(error instanceof Error ? error.message : "表格解析失败");
    }
  };

  const handleFile = async (file: File) => {
    setMessage("");
    try {
      if (file.size > 5 * 1024 * 1024) {
        throw new Error("文件不能超过 5MB，请拆分后重试");
      }
      const extension = file.name.toLocaleLowerCase();
      if (extension.endsWith(".xlsx")) {
        const rows = await readSheet(file);
        acceptRows(rows);
        return;
      }
      if (extension.endsWith(".csv") || extension.endsWith(".tsv")) {
        const text = await readTextFile(file);
        acceptRows(parseBulkTableText(text));
        return;
      }
      throw new Error("只支持 .xlsx、.csv 或 .tsv 文件");
    } catch (error) {
      setSources([]);
      setPreviewRows([]);
      setMessage(error instanceof Error ? error.message : "文件读取失败");
    }
  };

  const updateOverride = (
    sourceRow: number,
    patch: Partial<BulkAlleyLocationOverride>,
  ) => {
    setOverrides((current) => {
      const existing = current[sourceRow] ?? { province: "", district: "" };
      return {
        ...current,
        [sourceRow]: { ...existing, ...patch },
      };
    });
  };

  const importRows = () => {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await importBulkAlleys(sources, overrides, isPublished);
        if (!result.ok) {
          setMessage(result.message);
          return;
        }
        setCompleted(true);
        setMessage(
          `成功导入 ${result.imported} 条${
            result.skipped > 0 ? `，跳过 ${result.skipped} 条` : ""
          }。`,
        );
      } catch {
        setMessage("导入请求失败，请刷新页面后重试");
      }
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10">
      <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-3 bg-gradient-to-r from-slate-800 to-gray-950 px-4 py-4 text-white shadow-md">
        <Link href="/adminzhangzhang/alleys" className="text-white/90">
          ← 返回
        </Link>
        <h1 className="text-lg font-bold">批量添加暗巷</h1>
      </header>

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold text-gray-800">导入表格</h2>
        <p className="mt-2 text-xs leading-5 text-gray-500">
          第一行必须是表头并包含“城市”列。标题会自动生成为“城市＋站街”，其他所有非空列会按“表头：内容”合并进详细介绍。
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.csv,.tsv"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={isPending}
          onClick={() => fileInputRef.current?.click()}
          className="mt-3 w-full rounded-xl border-2 border-dashed border-pink-200 bg-pink-50/60 px-4 py-6 text-sm font-semibold text-pink-600 disabled:opacity-50"
        >
          选择 Excel / CSV 文件
          <span className="mt-1 block text-xs font-normal text-gray-400">
            支持 .xlsx、.csv、.tsv，每次最多 100 行
          </span>
        </button>

        <div className="my-4 flex items-center gap-3 text-xs text-gray-300">
          <span className="h-px flex-1 bg-gray-100" />或直接粘贴表格
          <span className="h-px flex-1 bg-gray-100" />
        </div>

        <textarea
          value={pastedText}
          onChange={(event) => setPastedText(event.target.value)}
          rows={7}
          placeholder={
            "城市\t位置\t图片中的情况描述\t价格\n天津\t河东大王庄附近\t路上有人在等\t200"
          }
          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pink-400"
        />
        <button
          type="button"
          disabled={isPending || !pastedText.trim()}
          onClick={() => {
            try {
              acceptRows(parseBulkTableText(pastedText));
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : "粘贴内容解析失败",
              );
            }
          }}
          className="mt-3 w-full rounded-xl bg-gray-900 py-2.5 text-sm font-bold text-white disabled:opacity-40"
        >
          解析并预览
        </button>
      </section>

      {message && (
        <div
          className={`mt-4 rounded-xl px-4 py-3 text-sm ${
            completed
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
          role="status"
        >
          {message}
          {completed && (
            <Link
              href="/adminzhangzhang/alleys"
              className="ml-2 font-bold underline"
            >
              返回暗巷管理
            </Link>
          )}
        </div>
      )}

      {previewRows.length > 0 && (
        <>
          <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-gray-800">导入预览</h2>
              <span className="text-xs text-gray-400">
                共 {previewRows.length} 行
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
              <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
                可导入 {counts.ready}
              </div>
              <div className="rounded-lg bg-amber-50 p-2 text-amber-700">
                待匹配 {counts.unmatched}
              </div>
              <div className="rounded-lg bg-red-50 p-2 text-red-700">
                有误 {counts.invalid}
              </div>
              <div className="rounded-lg bg-gray-100 p-2 text-gray-500">
                重复 {counts.duplicate}
              </div>
            </div>
          </section>

          <div className="mt-3 space-y-3">
            {previewRows.map((row) => {
              const override = overrides[row.sourceRow] ?? {
                province: "",
                district: "",
              };
              return (
                <article
                  key={row.sourceRow}
                  className="rounded-2xl bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-gray-400">
                        表格第 {row.sourceRow} 行
                      </p>
                      <h3 className="mt-1 font-bold text-gray-900">
                        {row.title || "未填写城市"}
                      </h3>
                      {(row.province || row.district) && (
                        <p className="mt-1 text-xs text-gray-500">
                          {[row.province, row.district]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-medium ${statusStyles[row.status]}`}
                    >
                      {statusLabels[row.status]}
                    </span>
                  </div>

                  <p className="mt-2 text-xs text-gray-500">{row.message}</p>

                  {row.status === "unmatched" && (
                    <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-amber-50/70 p-3">
                      <select
                        value={override.province}
                        onChange={(event) =>
                          updateOverride(row.sourceRow, {
                            province: event.target.value,
                            district: "",
                          })
                        }
                        className="min-w-0 rounded-lg border border-amber-200 bg-white px-2 py-2 text-xs"
                      >
                        <option value="">选择省份</option>
                        {provinces.map((province) => (
                          <option key={province} value={province}>
                            {province}
                          </option>
                        ))}
                      </select>
                      <select
                        value={override.district}
                        disabled={!override.province}
                        onChange={(event) =>
                          updateOverride(row.sourceRow, {
                            district: event.target.value,
                          })
                        }
                        className="min-w-0 rounded-lg border border-amber-200 bg-white px-2 py-2 text-xs disabled:opacity-50"
                      >
                        <option value="">城市／地区可留空</option>
                        {citiesOfProvince(override.province).map((district) => (
                          <option key={district} value={district}>
                            {district}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {row.description && (
                    <div className="mt-3 whitespace-pre-wrap rounded-xl bg-gray-50 p-3 text-xs leading-5 text-gray-600">
                      {row.description}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {counts.unmatched > 0 && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => requestPreview(sources, overrides)}
              className="mt-4 w-full rounded-xl border border-amber-300 bg-amber-50 py-2.5 text-sm font-bold text-amber-700 disabled:opacity-40"
            >
              应用手动匹配并重新检查
            </button>
          )}

          <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={isPublished}
                onChange={(event) => setIsPublished(event.target.checked)}
                className="h-4 w-4 accent-pink-500"
              />
              <span className="text-sm text-gray-700">导入后立即在前台公开</span>
            </label>
            <p className="mt-2 text-xs text-gray-400">
              图片和详细地址会留空；无法匹配、有误或重复的记录不会写入。
            </p>
            <button
              type="button"
              disabled={isPending || counts.ready === 0 || completed}
              onClick={importRows}
              className="mt-4 w-full rounded-xl bg-pink-500 py-3 text-sm font-bold text-white disabled:opacity-40"
            >
              {isPending ? "处理中…" : `确认导入 ${counts.ready} 条`}
            </button>
          </section>
        </>
      )}
    </div>
  );
}