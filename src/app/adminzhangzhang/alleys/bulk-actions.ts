"use server";

import { revalidatePath } from "next/cache";
import {
  bulkAlleyDuplicateKey,
  MAX_BULK_ALLEY_ROWS,
  MAX_BULK_ALLEY_TOTAL_CHARS,
  prepareBulkAlleySource,
  type BulkAlleyField,
  type BulkAlleyLocationOverride,
  type BulkAlleyPreviewRow,
  type BulkAlleySourceRow,
} from "@/lib/alley-bulk-import";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function readBulkSources(input: unknown): BulkAlleySourceRow[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("没有可处理的批量数据");
  }
  if (input.length > MAX_BULK_ALLEY_ROWS) {
    throw new Error(`每次最多导入 ${MAX_BULK_ALLEY_ROWS} 行`);
  }

  let totalCharacters = 0;
  return input.map((value) => {
    if (!value || typeof value !== "object") throw new Error("数据行格式无效");
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.sourceRow !== "number" ||
      typeof candidate.city !== "string" ||
      !Array.isArray(candidate.fields)
    ) {
      throw new Error("数据行格式无效");
    }

    const fields: BulkAlleyField[] = candidate.fields.map((field) => {
      if (!field || typeof field !== "object") {
        throw new Error("详细信息格式无效");
      }
      const item = field as Record<string, unknown>;
      if (typeof item.label !== "string" || typeof item.value !== "string") {
        throw new Error("详细信息格式无效");
      }
      totalCharacters += item.label.length + item.value.length;
      return { label: item.label, value: item.value };
    });

    totalCharacters += candidate.city.length;
    if (totalCharacters > MAX_BULK_ALLEY_TOTAL_CHARS) {
      throw new Error("本次导入内容过多，请拆分后重试");
    }
    return {
      sourceRow: candidate.sourceRow,
      city: candidate.city,
      fields,
    };
  });
}

function readOverrides(input: unknown): Record<number, BulkAlleyLocationOverride> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  const overrides: Record<number, BulkAlleyLocationOverride> = {};
  for (const [key, value] of Object.entries(input)) {
    const sourceRow = Number(key);
    if (!Number.isSafeInteger(sourceRow) || !value || typeof value !== "object") {
      continue;
    }
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.province !== "string" ||
      typeof candidate.district !== "string" ||
      candidate.province.length > 40 ||
      candidate.district.length > 60
    ) {
      continue;
    }
    if (candidate.province.trim()) {
      overrides[sourceRow] = {
        province: candidate.province,
        district: candidate.district,
      };
    }
  }
  return overrides;
}

function revalidateBulkAlleyPages() {
  revalidatePath("/alley");
  revalidatePath("/adminzhangzhang");
  revalidatePath("/adminzhangzhang/alleys");
  revalidatePath("/sitemap.xml");
}

export async function previewBulkAlleys(
  input: unknown,
  overrideInput: unknown,
): Promise<
  | { ok: true; rows: BulkAlleyPreviewRow[] }
  | { ok: false; message: string }
> {
  await requireAdmin();

  try {
    const sources = readBulkSources(input);
    const overrides = readOverrides(overrideInput);
    const existing = await prisma.alleyPost.findMany({
      select: { title: true, description: true },
    });
    const existingKeys = new Set(
      existing.map((row) => bulkAlleyDuplicateKey(row.title, row.description)),
    );
    const inputKeys = new Set<string>();

    const rows = sources.map<BulkAlleyPreviewRow>((source) => {
      const prepared = prepareBulkAlleySource(
        source,
        overrides[source.sourceRow],
      );
      if (!prepared.success) {
        return {
          ...prepared.data,
          status: prepared.status,
          message: prepared.message,
        };
      }

      const key = bulkAlleyDuplicateKey(
        prepared.data.title,
        prepared.data.description,
      );
      if (existingKeys.has(key) || inputKeys.has(key)) {
        return {
          ...prepared.data,
          status: "duplicate",
          message: existingKeys.has(key)
            ? "系统中已有相同记录"
            : "本次表格中存在重复记录",
        };
      }
      inputKeys.add(key);
      return {
        ...prepared.data,
        status: "ready",
        message: "可以导入",
      };
    });

    return { ok: true, rows };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "预览失败，请稍后重试",
    };
  }
}

export async function importBulkAlleys(
  input: unknown,
  overrideInput: unknown,
  publishInput: unknown,
): Promise<
  | { ok: true; imported: number; skipped: number }
  | { ok: false; message: string }
> {
  await requireAdmin();

  try {
    const sources = readBulkSources(input);
    const overrides = readOverrides(overrideInput);
    const isPublished = publishInput === true;

    const imported = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.alleyPost.findMany({
        select: { title: true, description: true },
      });
      const seenKeys = new Set(
        existing.map((row) =>
          bulkAlleyDuplicateKey(row.title, row.description),
        ),
      );
      const records = [];

      for (const source of sources) {
        const prepared = prepareBulkAlleySource(
          source,
          overrides[source.sourceRow],
        );
        if (!prepared.success) continue;

        const key = bulkAlleyDuplicateKey(
          prepared.data.title,
          prepared.data.description,
        );
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        records.push({
          title: prepared.data.title,
          city: prepared.data.province,
          district: prepared.data.district,
          address: "",
          coverPhoto: "",
          description: prepared.data.description,
          detailPhotos: "[]",
          sortOrder: 100,
          isPublished,
        });
      }

      if (records.length === 0) return 0;
      const result = await transaction.alleyPost.createMany({ data: records });
      return result.count;
    });

    if (imported === 0) {
      return { ok: false, message: "没有可导入的新记录，请检查预览结果" };
    }
    revalidateBulkAlleyPages();
    return { ok: true, imported, skipped: sources.length - imported };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "导入失败，请稍后重试",
    };
  }
}