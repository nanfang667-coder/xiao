import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires the explicit .ts extension.
import { parseBulkTableText, tableRowsToBulkSources } from "./bulk-parser.ts";

test("parses pasted tab-separated alley rows", () => {
  const rows = parseBulkTableText(
    "城市\t位置\t图片中的情况描述\t价格\n天津\t河东大王庄附近\t路上有人在等\t200",
  );
  assert.deepEqual(tableRowsToBulkSources(rows), [
    {
      sourceRow: 2,
      city: "天津",
      fields: [
        { label: "位置", value: "河东大王庄附近" },
        { label: "图片中的情况描述", value: "路上有人在等" },
        { label: "价格", value: "200" },
      ],
    },
  ]);
});

test("preserves commas and newlines inside quoted CSV cells", () => {
  const rows = parseBulkTableText(
    '城市,位置,描述\n武汉,"田园南路,二道巷","第一行\n第二行"',
  );
  const [source] = tableRowsToBulkSources(rows);
  assert.equal(source.city, "武汉");
  assert.deepEqual(source.fields, [
    { label: "位置", value: "田园南路,二道巷" },
    { label: "描述", value: "第一行\n第二行" },
  ]);
});

test("accepts a Markdown pipe table and skips its separator row", () => {
  const rows = parseBulkTableText(
    "| 城市 | 位置 |\n| --- | --- |\n| 西安 | 二道巷 |",
  );
  const [source] = tableRowsToBulkSources(rows);
  assert.equal(source.city, "西安");
  assert.deepEqual(source.fields, [{ label: "位置", value: "二道巷" }]);
});