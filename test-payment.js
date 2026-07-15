/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// 直接编译实际支付模块；只替换 Next 的 server-only 标记，不发起网络请求。
const source = fs.readFileSync(path.join(__dirname, "src/lib/qianhe-payment.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;

const paymentModule = { exports: {} };
const localRequire = (id) => {
  if (id === "server-only") return {};
  return require(id);
};
new Function("require", "module", "exports", compiled)(
  localRequire,
  paymentModule,
  paymentModule.exports,
);

const { createQianheSignature, verifyQianheNotification } = paymentModule.exports;
process.env.QIANHE_MCH_ID = "M100";
process.env.QIANHE_MCH_KEY = "secret";

const notification = {
  mchId: "M100",
  tradeNo: "P100",
  outTradeNo: "GP771",
  amount: 3800,
  body: "", // 空字符串不参与签名
  state: 2,
  notifyTime: 1700000000000,
  unknownField: "x", // 平台新增的扩展字段必须参与签名
};

const signature = createQianheSignature(notification, "secret");
assert.equal(signature, "24ab26a44a2b97ae51f5d6290c42a92b");

const verified = verifyQianheNotification({ ...notification, sign: signature });
assert.deepEqual(
  {
    merchantOrderNo: verified.merchantOrderNo,
    tradeNo: verified.tradeNo,
    amountCents: verified.amountCents,
    state: verified.state,
  },
  { merchantOrderNo: "GP771", tradeNo: "P100", amountCents: 3800, state: 2 },
);

assert.throws(
  () => verifyQianheNotification({ ...notification, amount: 1, sign: signature }),
  /signature/i,
);

console.log("payment signature tests passed");
