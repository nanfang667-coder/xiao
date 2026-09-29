import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error The Node type-stripping test runner needs the explicit .ts extension.
import { extractLabeledArticleFields, PartnerLabeledFieldsError } from "./partner-import-labeled-fields.ts";

const row = (key: string, value: string) => "<tr><th>" + key + "</th><td>" + value + "</td></tr>";
const table = (...rows: string[]) => "<table><tbody>" + rows.join("") + "</tbody></table>";

test("two-column table maps fixed source labels to distinct destinations and discards appearance", () => {
  const result = extractLabeledArticleFields(table(
    row("服务", "虚构服务甲<br>虚构服务乙"), row("年龄", "20"), row("颜值", "不应保留"),
    row("价格", "虚构价格"), row("微信", "synthetic-wechat"), row("QQ", "synthetic-qq"), row("地址", "虚构地址"),
  ));
  assert.deepEqual(result, { recognizedLabels: 7, fields: {
    services: "虚构服务甲\n虚构服务乙", age: "20", price: "虚构价格", wechat: "synthetic-wechat", qq: "synthetic-qq", address: "虚构地址",
  } });
  assert.equal(JSON.stringify(result).includes("不应保留"), false);
});

test("all supported aliases map exactly and strip only a label colon", () => {
  const aliases: [string, string][] = [
    ["服务内容", "services"], ["服务项目", "services"], ["年龄", "age"],
    ["城市", "city"], ["省份", "city"], ["区域", "district"], ["区县", "district"],
    ["收费", "price"], ["费用", "price"], ["电话", "phone"], ["手机", "phone"], ["手机号", "phone"],
    ["微信号", "wechat"], ["QQ号", "qq"], ["详细地址", "address"], ["备注", "courseNotes"],
    ["补充说明", "courseNotes"], ["其他联系方式", "otherContact"],
  ];
  for (const [key, destination] of aliases) {
    assert.deepEqual(extractLabeledArticleFields(table(row(" " + key + "： ", "虚构值")))?.fields,
      { [destination]: "虚构值" });
  }
});

test("ordinary prose, partial labels, categories and names are not inferred", () => {
  for (const html of ["<p>年龄只是数字，服务需要耐心。</p>", "<p>这是服务：普通描述</p>",
    table(row("类别", "虚构类别"), row("标题", "虚构标题"), row("年龄说明", "虚构说明")),
    "<p><span>年龄</span>只是数字</p>"]) {
    assert.equal(extractLabeledArticleFields(html), null);
  }
});

test("unknown table rows and article metadata do not become services or notes", () => {
  const result = extractLabeledArticleFields("<p>未声明文章导语</p>" + table(
    row("服务", "仅此服务"), row("身高", "丢弃身高"), row("颜值", "丢弃颜值"),
  ) + "<p>未声明文章页尾</p>");
  assert.deepEqual(result, { recognizedLabels: 2, fields: { services: "仅此服务" } });
});

test("empty services and appearance-only structured records stay structured", () => {
  assert.deepEqual(extractLabeledArticleFields(table(row("服务", ""), row("年龄", "20")))?.fields,
    { services: "", age: "20" });
  assert.deepEqual(extractLabeledArticleFields(table(row("颜值", "丢弃"))), { fields: {}, recognizedLabels: 1 });
  assert.deepEqual(extractLabeledArticleFields(table(row("年龄", "20")))?.fields, { age: "20" });
});

test("duplicate field rows and aliases fail without guessing even for equal values", () => {
  for (const html of [table(row("年龄", "20"), row("年龄", "20")),
    table(row("服务", "甲"), row("服务内容", "乙")), table(row("城市", "甲"), row("省份", "乙")),
    table(row("年龄", "20")) + "<p>年龄：21</p>"]) {
    assert.throws(() => extractLabeledArticleFields(html), { code: "DETAIL_AMBIGUOUS_FIELDS" });
  }
});

test("ignored authoritative fields still form boundaries but do not cause duplicate errors", () => {
  const result = extractLabeledArticleFields(table(row("年龄", "20"), row("年龄", "21"))
    + "<p>服务：虚构服务<br>年龄：22<br>不应进入服务<br>颜值：丢弃</p>", ["age"]);
  assert.deepEqual(result, { recognizedLabels: 5, fields: { services: "虚构服务" } });
});

test("malformed recognized table structures fail safely", () => {
  for (const body of ["<tr><th>服务</th></tr>", "<tr><th>服务</th><td>甲</td><td>乙</td></tr>",
    row("服务", table(row("年龄", "20")))]) {
    assert.throws(() => extractLabeledArticleFields(table(body)), { code: "DETAIL_AMBIGUOUS_FIELDS" });
  }
});

test("table fields strip inert and hidden contents without executing anything", () => {
  const result = extractLabeledArticleFields(table(row("服务", "有效正文<script>throw new Error('synthetic')</script>"
    + '<span hidden>秘密</span><span style="display:none">隐藏</span>'))
    + '<table hidden>' + row("年龄", "20") + "</table>"
    + '<div class="comments">' + table(row("服务", "错误评论服务")) + "</div>");
  assert.deepEqual(result?.fields, { services: "有效正文" });
});

test("definition lists and dedicated inline label/value pairs use their own values", () => {
  const html = "<dl><dt>服务</dt><dd><p>虚构服务</p></dd><dt>颜值</dt><dd>丢弃</dd></dl>"
    + "<div><span>年龄</span><span>20</span></div><p><strong>微信：</strong><b>synthetic</b></p>";
  assert.deepEqual(extractLabeledArticleFields(html)?.fields, { services: "虚构服务", age: "20", wechat: "synthetic" });
});

test("a definition term cannot consume multiple or unrelated values", () => {
  for (const html of ["<dl><dt>服务</dt><dd>甲</dd><dd>乙</dd></dl>", "<dl><dt>服务</dt></dl>"]) {
    assert.throws(() => extractLabeledArticleFields(html), { code: "DETAIL_AMBIGUOUS_FIELDS" });
  }
});

test("colon fields within one block preserve multiline services and discard other field payloads", () => {
  const html = "<p>服务：虚构服务甲<br>虚构服务乙<br>年龄: 20<br>颜值：丢弃<br>也丢弃<br>微信：synthetic</p>";
  assert.deepEqual(extractLabeledArticleFields(html)?.fields,
    { services: "虚构服务甲\n虚构服务乙", age: "20", wechat: "synthetic" });
});

test("unknown colon labels terminate services and are not copied into notes", () => {
  assert.deepEqual(extractLabeledArticleFields("<p>服务：虚构服务<br>身高：丢弃<br>丢弃续行<br>备注：明确备注</p>")?.fields,
    { services: "虚构服务", courseNotes: "明确备注" });
});

test("service lines never extend across separate DOM blocks", () => {
  assert.deepEqual(extractLabeledArticleFields("<div><p>服务：虚构服务</p><p>作者元数据</p><p>年龄：20</p></div>")?.fields,
    { services: "虚构服务", age: "20" });
});

test("plain text and line breaks are supported without mistaking HTTPS values for labels", () => {
  assert.deepEqual(extractLabeledArticleFields("服务：虚构服务<br>https://synthetic.example/info<br>年龄：20")?.fields,
    { services: "虚构服务\nhttps://synthetic.example/info", age: "20" });
});

test("limits and errors never contain source values or attributes", () => {
  const privateValue = "synthetic-private-value";
  const cases = [table(row("年龄", privateValue), row("年龄", privateValue)),
    table(row("服务", privateValue.repeat(600))), "x".repeat(2_000_001),
    "<div>".repeat(65) + "<p>年龄：20</p>" + "</div>".repeat(65), "<span></span>".repeat(20_001)];
  for (const html of cases) assert.throws(() => extractLabeledArticleFields(html), (error: unknown) => {
    assert.ok(error instanceof PartnerLabeledFieldsError);
    assert.equal(error.message.includes(privateValue), false);
    assert.ok(["DETAIL_AMBIGUOUS_FIELDS", "DETAIL_LIMIT"].includes(error.code));
    return true;
  });
});


test("nested fields inside appearance or unknown tables are never promoted into mapped fields", () => {
  const nested = table(row("服务", "丢弃嵌套服务"));
  const result = extractLabeledArticleFields(table(row("颜值", nested), row("未知字段", nested), row("年龄", "20")));
  assert.deepEqual(result?.fields, { age: "20" });
});

test("discarded appearance pairs cannot reactivate a detached nested field", () => {
  const html = "<div><span>颜值</span><div><span>服务</span><span>丢弃嵌套值</span></div></div>"
    + "<div><span>年龄</span><span>20</span></div>";
  assert.deepEqual(extractLabeledArticleFields(html)?.fields, { age: "20" });
});


test("valid fields reject nested field structures instead of flattening their values", () => {
  for (const html of [
    "<div><span>服务</span><div><span>年龄</span><span>20</span></div></div>",
    table(row("服务", "<div><span>年龄</span><span>20</span></div>")),
    "<dl><dt>服务</dt><dd><p>年龄：20</p></dd></dl>",
  ]) assert.throws(() => extractLabeledArticleFields(html), { code: "DETAIL_AMBIGUOUS_FIELDS" });
});

test("appearance and ignored fields own their entire subtree across markup forms", () => {
  const children = [table(row("年龄", "20")), "<dl><dt>年龄</dt><dd>20</dd></dl>",
    "<div><span>年龄</span><span>20</span></div>", "<p>年龄：20</p>"];
  for (const child of children) {
    for (const html of [table(row("颜值", child)), "<dl><dt>颜值</dt><dd>" + child + "</dd></dl>",
      "<div><span>颜值</span><div>" + child + "</div></div>"]) {
      assert.deepEqual(extractLabeledArticleFields(html)?.fields, {});
    }
    assert.deepEqual(extractLabeledArticleFields("<div><span>服务</span><div>" + child + "</div></div>", ["services"])?.fields, {});
  }
});

test("unknown paired field containers cannot promote nested known fields", () => {
  const html = "<div><span>身高</span><div>服务：不应识别</div></div>" + table(row("年龄", "20"));
  assert.deepEqual(extractLabeledArticleFields(html)?.fields, { age: "20" });
});

test("declaration headings and line tails cannot contribute mapped fields", () => {
  const result = extractLabeledArticleFields('<p>服务：虚构服务<br>声明信息<br>电话：虚构声明电话</p>'
    + '<section><h3>声明信息</h3><p>微信：虚构声明微信</p></section><p>年龄：28</p>');
  assert.deepEqual(result?.fields, { services: "虚构服务", age: "28" });
});
test("a service cell strips a plain declaration before nested-field validation", () => {
  assert.deepEqual(extractLabeledArticleFields(table(row("服务", "虚构服务<br>声明信息<br>电话：虚构声明电话")))?.fields, { services: "虚构服务" });
});

test("root-level declaration sections in HTML fragments cannot create contact fields", () => {
  for (const marker of ["<h2>声明信息</h2>", "<p>声明信息</p>", "<div><h2>声明信息</h2></div>"]) {
    const result = extractLabeledArticleFields("<p>服务：虚构服务</p>" + marker + "<p>电话：虚构声明电话</p><h2>其他资料</h2><p>年龄：28</p>");
    assert.deepEqual(result?.fields, { services: "虚构服务", age: "28" });
  }
});
