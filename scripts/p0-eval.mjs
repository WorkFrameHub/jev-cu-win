#!/usr/bin/env node
/**
 * P0 オフライン評価：保存した UI ツリー + 正解の要素で、Jev の要素選択の正確さを測る。
 * Windows でなくても動く（Jev API は呼ぶので API キーが必要）。
 *
 * fixtures/p0/cases.json：
 *   [{ "name": "...", "app": "電卓", "goal": "...", "axFile": "fixtures/uia/calculator-ja.txt", "expectedIndex": 32 }]
 *
 *   npm run p0 [-- --limit 3]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decide } from "./jev-decide.mjs";
import { parseAX, selectCandidates, buildContext } from "./loop.mjs";

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CASES_PATH = path.join(PROJECT_DIR, "fixtures", "p0", "cases.json");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const cases = JSON.parse(fs.readFileSync(CASES_PATH, "utf8")).slice(0, limit);
if (!cases.length) {
  console.error("ケースがありません：fixtures/p0/cases.json を書いてください");
  process.exit(1);
}

const rows = [];
for (const c of cases) {
  const ax = fs.readFileSync(path.join(PROJECT_DIR, c.axFile), "utf8");
  const candidates = selectCandidates(parseAX(ax), c.goal, { max: c.max ?? 40 });
  let decision;
  let error = null;
  try {
    decision = await decide({ goal: c.goal, app: c.app, candidates, context: buildContext(ax), constraints: c.constraints ?? "" });
  } catch (err) {
    error = err.message;
  }

  const hit = !error && decision.targetIndex === c.expectedIndex;
  const row = {
    name: c.name,
    expected: c.expectedIndex,
    got: error ? `ERR ${error}` : `i${decision.targetIndex} ${decision.targetLabel ?? ""}`,
    hit,
    conf: decision?.confidence ?? null,
    ms: decision?.latencyMs ?? null,
    tokens: decision?.usage?.input_tokens ?? decision?.usage?.inputTokens ?? null,
    cost: decision?.costUsd ?? null,
    candidates: candidates.length,
  };
  rows.push(row);
  console.log(
    `${hit ? "OK " : "NG "} ${c.name}  期待=i${row.expected}  結果=${row.got}` +
      (error ? "" : `  conf=${row.conf?.toFixed?.(2) ?? "n/a"} ${row.ms}ms ${row.tokens}tok`),
  );
}

const ok = rows.filter((r) => r.hit);
const lat = rows.map((r) => r.ms).filter((n) => typeof n === "number").sort((a, b) => a - b);
const tokens = rows.reduce((a, r) => a + (r.tokens ?? 0), 0);
const cost = rows.reduce((a, r) => a + (r.cost ?? 0), 0);
const p50 = lat.length ? lat[Math.floor(lat.length / 2)] : null;

console.log(`\n正解率 ${ok.length}/${rows.length} · p50 ${p50 ?? "n/a"}ms · tokens ${tokens} · 費用 ≈ $${cost.toFixed(6)}`);

const reportDir = path.join(PROJECT_DIR, "runs");
fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `p0-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), accuracy: `${ok.length}/${rows.length}`, p50Ms: p50, tokens, costUsd: cost, rows }, null, 2));
console.log(`レポート：${reportPath}`);
