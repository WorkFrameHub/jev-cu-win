import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { parseAX, selectCandidates, buildContext, runTask } from "../scripts/loop.mjs";
import { evaluatePolicy, matchSensitive } from "../scripts/policy.mjs";
import { buildQuestions, normalizeDecision, sanitizeLabel } from "../scripts/jev-decide.mjs";
import { createPowerShellTransport, createUiaDriver } from "../scripts/uia-driver.mjs";

const fixture = (name) => fs.readFileSync(new URL(`../fixtures/uia/${name}`, import.meta.url), "utf8");
const CALC = fixture("calculator-ja.txt");
const NOTEPAD = fixture("notepad-ja.txt");

/* ------------------------------ 解析と候補 ------------------------------ */

test("parseAX：複数語のロールとラベルを分ける", () => {
  const els = parseAX(NOTEPAD);
  const doc = els.find((e) => e.index === 13);
  assert.equal(doc.role, "document");
  assert.equal(doc.label, "テキスト エディター, ID: RichEditBox");
  assert.equal(els.find((e) => e.index === 9).role, "menu item");
  assert.equal(els.find((e) => e.index === 5).role, "tab list");
  assert.equal(els.find((e) => e.index === 0).role, "standard window");
});

test("parseAX：CRLF でも同じ結果", () => {
  const crlf = CALC.replace(/\r?\n/g, "\r\n");
  assert.equal(parseAX(crlf).length, parseAX(CALC).length);
  assert.ok(parseAX(CALC).length > 40);
});

test("selectCandidates：無効（disabled）な要素は候補にしない", () => {
  const indices = selectCandidates(parseAX(CALC), "recall memory").map((c) => c.index);
  assert.ok(!indices.includes(11));
  assert.ok(!indices.includes(12));
  assert.ok(indices.includes(13));
});

test("selectCandidates：数字ボタンと演算子が全部候補に入る", () => {
  const indices = selectCandidates(parseAX(CALC), "enter the digit 7").map((c) => c.index);
  for (const i of [19, 27, 30, 32, 42]) assert.ok(indices.includes(i), `i${i} が候補にない`);
});

test("selectCandidates：max が小さくても目標語に合う要素を残す", () => {
  const indices = selectCandidates(parseAX(NOTEPAD), "open the ファイル menu", { max: 2 }).map((c) => c.index);
  assert.ok(indices.includes(9));
});

test("buildContext：電卓の表示値とフォーカスを含む", () => {
  const ctx = buildContext(CALC);
  assert.ok(ctx.includes("表示は 0 です"));
  assert.ok(ctx.includes("電卓"));
  assert.ok(ctx.includes("focused UI element"));
});

/* -------------------------------- Policy -------------------------------- */

const safe = { done: 0.05, risk: 0.02, confidence: 0.9, targetIndex: 32, targetLabel: "7, ID: num7Button" };

test("policy：電卓の通常操作は proceed（アプリ名の大文字小文字は無視）", () => {
  assert.equal(evaluatePolicy({ decision: safe, app: "電卓" }).verdict, "proceed");
  assert.equal(evaluatePolicy({ decision: safe, app: "notepad" }).verdict, "proceed");
});

test("policy：許可リスト外のアプリは confirm", () => {
  assert.equal(evaluatePolicy({ decision: safe, app: "Outlook" }).verdict, "confirm");
});

test("policy：日本語の危険語で confirm", () => {
  for (const label of ["ファイルを削除", "メールを送信", "今すぐ購入", "パスワード", "インストール", "OneDrive に共有"]) {
    const gate = evaluatePolicy({ decision: { ...safe, targetLabel: label }, app: "Microsoft Edge" });
    assert.equal(gate.verdict, "confirm", label);
  }
});

test("policy：電卓の「クリア」は危険語扱いしない", () => {
  assert.equal(matchSensitive("クリア, ID: clearButton"), null);
  assert.equal(matchSensitive("バックスペース, ID: backSpaceButton"), null);
});

test("policy：完了確率が高ければ done、確信度が低ければ stop / escalate", () => {
  assert.equal(evaluatePolicy({ decision: { ...safe, done: 0.95 }, app: "電卓" }).verdict, "done");
  assert.equal(evaluatePolicy({ decision: { ...safe, confidence: 0.2 }, app: "電卓" }).verdict, "stop");
  assert.equal(evaluatePolicy({ decision: { ...safe, confidence: 0.35 }, app: "電卓" }).verdict, "escalate");
  assert.equal(evaluatePolicy({ decision: { ...safe, confidence: 0.45 }, app: "電卓" }).verdict, "proceed");
  assert.equal(evaluatePolicy({ decision: { ...safe, confidence: 0.45 }, app: "Microsoft Edge" }).verdict, "escalate");
});

/* ---------------------------- Jev リクエスト ---------------------------- */

test("buildQuestions / normalizeDecision の往復", () => {
  const candidates = selectCandidates(parseAX(CALC), "enter 7");
  const { questions, criteria } = buildQuestions("enter 7", candidates);
  assert.ok(questions.target.criteria.i32.includes("7"));
  const d = normalizeDecision(
    { target: { choice: "i32", confidence: 0.9 }, action: { choice: "click_element" }, done: { noul: 0.1 }, risk: { noul: "0.01" } },
    criteria,
  );
  assert.equal(d.targetIndex, 32);
  assert.equal(d.risk, 0.01);
  assert.equal(normalizeDecision({ target: { choice: "i999" } }, criteria).targetIndex, null);
});

test("sanitizeLabel：URL を消して 120 文字に切る", () => {
  assert.equal(sanitizeLabel("link: 開く https://example.com/a?b=c"), "link: 開く");
  assert.equal(sanitizeLabel("x".repeat(300)).length, 120);
});

/* ------------------------------ runTask ------------------------------ */

function fakeDriver(observations) {
  const calls = [];
  let i = 0;
  return {
    calls,
    async bind(app) { calls.push(["bind", app]); },
    async observe() { return observations[Math.min(i++, observations.length - 1)]; },
    async click(target) { calls.push(["click", target]); },
    async setValue(index, text) { calls.push(["setValue", index, text]); },
    async typeText(text) { calls.push(["typeText", text]); },
    async pressKey(key) { calls.push(["pressKey", key]); },
    async scroll(index, dir) { calls.push(["scroll", index, dir]); },
    async drag() {},
  };
}

const tmpTrace = () => fs.mkdtempSync(path.join(os.tmpdir(), "jev-cu-win-"));
const quiet = () => {};

test("runTask：試運転では何もクリックしない", async () => {
  const driver = fakeDriver([CALC]);
  const r = await runTask({
    driver, appName: "電卓", goal: "enter 7", emit: quiet, traceDir: tmpTrace(),
    decide: async () => ({ ...safe, action: "click_element" }),
  });
  assert.equal(r.status, "dry_run");
  assert.equal(r.planned.targetIndex, 32);
  assert.deepEqual(driver.calls, [["bind", "電卓"]]);
});

test("runTask：実行モードでクリックし、完了で止まる", async () => {
  const after = CALC.replace("表示は 0 です", "表示は 7 です");
  const driver = fakeDriver([CALC, after]);
  let n = 0;
  const r = await runTask({
    driver, appName: "電卓", goal: "enter 7", dryRun: false, emit: quiet, traceDir: tmpTrace(),
    decide: async () => (n++ === 0 ? { ...safe, action: "click_element" } : { ...safe, done: 0.97 }),
  });
  assert.equal(r.status, "done");
  assert.deepEqual(driver.calls.at(-1), ["click", 32]);
});

test("runTask：切り詰められた長いラベルの奥にある危険語も関門で止める", async () => {
  const longLabel = "x".repeat(130) + " delete";
  const ax = `Window: "Edge", App: msedge.\n0 standard window Edge\n\t1 button ${longLabel}\n\t2 button 戻る`;
  const driver = fakeDriver([ax]);
  const r = await runTask({
    driver, appName: "Microsoft Edge", goal: "go", dryRun: false, emit: quiet, traceDir: tmpTrace(),
    decide: async () => ({ ...safe, targetIndex: 1, targetLabel: sanitizeLabel(longLabel), action: "click_element" }),
  });
  assert.equal(r.status, "confirm");
  assert.equal(driver.calls.filter(([c]) => c === "click").length, 0);
});

test("runTask：confirm はユーザーが承認したときだけ実行", async () => {
  const ax = `Window: "x", App: x.\n0 standard window x\n\t1 button 削除\n\t2 button 戻る`;
  for (const approved of [false, true]) {
    const driver = fakeDriver([ax, ax + "\n"]);
    let n = 0;
    const r = await runTask({
      driver, appName: "メモ帳", goal: "delete", dryRun: false, maxSteps: 1, emit: quiet, traceDir: tmpTrace(),
      decide: async () => (n++ === 0 ? { ...safe, targetIndex: 1, action: "click_element" } : { ...safe, done: 1 }),
      onConfirm: async () => approved,
    });
    assert.equal(r.status, approved ? "max_steps" : "confirm");
    assert.equal(driver.calls.some(([c]) => c === "click"), approved);
  }
});

test("runTask：set_value は --text の文字を渡す", async () => {
  const driver = fakeDriver([NOTEPAD, NOTEPAD + "\n"]);
  let n = 0;
  await runTask({
    driver, appName: "メモ帳", goal: "write hello", dryRun: false, maxSteps: 2, emit: quiet, traceDir: tmpTrace(),
    resources: { text: "こんにちは" },
    decide: async () => (n++ === 0 ? { ...safe, targetIndex: 13, action: "set_value" } : { ...safe, done: 0.99 }),
  });
  assert.deepEqual(driver.calls.at(-1), ["setValue", 13, "こんにちは"]);
});

/* ---------------------------- PowerShell 通信 ---------------------------- */

function fakeSpawn(handler) {
  return () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    let buf = "";
    child.stdin.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const req = JSON.parse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        child.stdout.write(JSON.stringify({ id: req.id, ...handler(req) }) + "\n");
      }
    });
    return child;
  };
}

test("uia-driver：JSON 行で要求・応答し、click の種類を振り分ける", async () => {
  const seen = [];
  const transport = createPowerShellTransport({
    spawnImpl: fakeSpawn((req) => {
      seen.push([req.cmd, req.args]);
      if (req.cmd === "observe") return { ok: true, result: { text: CALC } };
      if (req.cmd === "bind") return { ok: false, error: "window not found" };
      return { ok: true, result: {} };
    }),
  });
  const driver = createUiaDriver({ transport });
  assert.equal(await driver.observe(), CALC);
  await driver.click(32);
  await driver.click([10, 20], { mouseButton: "right" });
  await assert.rejects(driver.bind("nothing"), /window not found/);
  assert.deepEqual(seen.slice(1, 3), [
    ["click", { index: 32, button: "left" }],
    ["clickAt", { x: 10, y: 20, button: "right" }],
  ]);
});

test("runTask：ask_user は確認を出さずに止まり、何もクリックしない", async () => {
  const shown = CALC.replace("表示は 0 です", "表示は 36 です");
  const driver = fakeDriver([shown]);
  let asked = false;
  const r = await runTask({
    driver, appName: "電卓", goal: "calculate 12 times 3", dryRun: false, emit: quiet, traceDir: tmpTrace(),
    decide: async () => ({ ...safe, targetIndex: 19, action: "ask_user", confidence: 0.5 }),
    onConfirm: async () => (asked = true),
  });
  assert.equal(r.status, "ask_user");
  assert.equal(asked, false);
  assert.ok(r.message.includes("表示は 36 です"));
  assert.equal(driver.calls.some(([c]) => c === "click"), false);
});

test("runTask：verify（--done-when）が満たされたら Jev の判断を待たずに完了", async () => {
  const shown = CALC.replace("表示は 0 です", "表示は 7 です");
  const driver = fakeDriver([CALC, shown]);
  let calls = 0;
  const r = await runTask({
    driver, appName: "電卓", goal: "enter 7", dryRun: false, emit: quiet, traceDir: tmpTrace(),
    decide: async () => { calls++; return { ...safe, done: 0.1, action: "click_element" }; },
    verify: (ax) => ax.includes("表示は 7 です"),
  });
  assert.equal(r.status, "done");
  assert.equal(r.verified, true);
  assert.equal(calls, 1);
});

test("見えない文字（ゼロ幅スペース）を挟んだ危険語も検出する", () => {
  assert.equal(matchSensitive("削​除").id, "delete");
  assert.equal(matchSensitive("del‍ete file").id, "delete");
  assert.equal(sanitizeLabel("Microsoft​ Edge"), "Microsoft Edge");
});

test("runTask：同じ文字を 2 回入力しようとしたら止める", async () => {
  const driver = fakeDriver([NOTEPAD, NOTEPAD + "\n"]);
  const r = await runTask({
    driver, appName: "メモ帳", goal: "type", dryRun: false, maxSteps: 5, emit: quiet, traceDir: tmpTrace(),
    settleChecks: 0, resources: { text: "1\n2\n3" },
    decide: async () => ({ ...safe, targetIndex: 13, action: "type_text" }),
  });
  assert.equal(r.status, "escalate");
  assert.equal(driver.calls.filter(([c]) => c === "typeText").length, 1);
});

test("runTask：文字入力のあとは画面が落ち着くまで読み直してから判断する", async () => {
  const partial = NOTEPAD.replace("0 文字", "3 文字");
  const full = NOTEPAD.replace("0 文字", "9 文字");
  const driver = fakeDriver([NOTEPAD, partial, full, full]);
  const seen = [];
  let n = 0;
  await runTask({
    driver, appName: "メモ帳", goal: "type", dryRun: false, maxSteps: 2, emit: quiet, traceDir: tmpTrace(),
    settleDelayMs: 1, resources: { text: "abc" },
    decide: async ({ context }) => { seen.push(context); return n++ === 0 ? { ...safe, targetIndex: 13, action: "type_text" } : { ...safe, done: 0.99 }; },
  });
  assert.ok(seen[1].includes("9 文字"), "2 回目の判断は落ち着いた後の画面で行う");
});
