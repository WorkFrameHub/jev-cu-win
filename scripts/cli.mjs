#!/usr/bin/env node
/**
 * jev-cu-win コマンドライン。
 *
 *   node scripts/cli.mjs windows                         開いているウィンドウ一覧
 *   node scripts/cli.mjs observe --app 電卓               UI ツリーを表示（Jev は呼ばない）
 *   node scripts/cli.mjs run --app 電卓 --goal "press 7"  試運転（何もクリックしない）
 *   node scripts/cli.mjs run --app 電卓 --goal "press 7" --execute   実際に操作する
 */
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { runTask } from "./loop.mjs";
import { DEFAULT_ALLOWED_APPS } from "./policy.mjs";
import { createUiaDriver } from "./uia-driver.mjs";

const HELP = `jev-cu-win — Jev に「次にどこを押すか」を決めさせて Windows アプリを操作します

使い方:
  node scripts/cli.mjs windows
  node scripts/cli.mjs observe --app <アプリ>
  node scripts/cli.mjs run --app <アプリ> --goal "<英語の目標>" [オプション]

<アプリ> はウィンドウタイトル（例: 電卓, メモ帳）かプロセス名（例: notepad）

run のオプション:
  --execute            実際に操作する（付けないと試運転：Jev の判断を表示するだけ）
  --max-steps <n>      最大ステップ数（既定 10）
  --text <文字列>      入力する文字（type_text / set_value 用）
  --key <キー>         押すキー（例: Enter, ctrl+s）
  --direction <向き>   スクロール方向 up/down/left/right
  --at <x,y>           ウィンドウ左上基準でクリックする座標
  --allow-app <名前>   許可リストにアプリを追加（複数回指定可）
  --plan <文>          Jev に渡す手順のヒント
  --done-when <文字>   画面にこの文字が出たら完了（例: "表示は 36 です"。複数回指定可）
  --yes                確認が必要な操作も自動で承認する（非推奨）
`;

function parsePoint(value, name) {
  if (value == null) return undefined;
  const m = String(value).match(/^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/);
  if (!m) throw new Error(`${name} は "x,y" の形で指定してください`);
  return [Number(m[1]), Number(m[2])];
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      app: { type: "string" },
      goal: { type: "string" },
      execute: { type: "boolean", default: false },
      "max-steps": { type: "string", default: "10" },
      text: { type: "string" },
      key: { type: "string" },
      direction: { type: "string" },
      at: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      "allow-app": { type: "string", multiple: true, default: [] },
      plan: { type: "string", default: "" },
      "done-when": { type: "string", multiple: true, default: [] },
      yes: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    console.log(HELP);
    return;
  }

  const driver = createUiaDriver();
  try {
    if (command === "windows") {
      for (const w of await driver.listWindows()) console.log(`${w.title}\t(${w.process})`);
      return;
    }
    if (!values.app) throw new Error("--app を指定してください");

    if (command === "observe") {
      await driver.bind(values.app);
      console.log(await driver.observe());
      return;
    }

    if (command === "run") {
      if (!values.goal) throw new Error("--goal を指定してください");
      const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
      const onConfirm = async ({ decision, gate }) => {
        if (values.yes) return true;
        if (!rl) return false;
        console.log(`\n⚠ 確認が必要です：${gate.reasons.join("；")}`);
        const answer = await rl.question(`  ${decision.action} → i${decision.targetIndex} (${decision.targetLabel}) を実行しますか？ [y/N] `);
        return /^y(es)?$/i.test(answer.trim());
      };
      try {
        const result = await runTask({
          driver,
          appName: values.app,
          goal: values.goal,
          dryRun: !values.execute,
          maxSteps: Number(values["max-steps"]) || 10,
          allowedApps: [...DEFAULT_ALLOWED_APPS, ...values["allow-app"]],
          plan: values.plan,
          resources: {
            text: values.text,
            key: values.key,
            direction: values.direction,
            at: parsePoint(values.at, "--at"),
            from: parsePoint(values.from, "--from"),
            to: parsePoint(values.to, "--to"),
          },
          onConfirm,
          verify: values["done-when"].length ? (ax) => values["done-when"].every((t) => ax.includes(t)) : undefined,
        });
        if (result.status === "dry_run") {
          console.log(`\n試運転：次は ${result.planned.action} → i${result.planned.targetIndex} (${result.planned.targetLabel})`);
          console.log("実際に操作するには --execute を付けてください。");
        } else if (result.message) {
          console.log(`\n${result.message}`);
        }
        process.exitCode = ["done", "dry_run"].includes(result.status) ? 0 : 2;
      } finally {
        rl?.close();
      }
      return;
    }

    throw new Error(`不明なコマンド：${command}\n\n${HELP}`);
  } finally {
    driver.close();
  }
}

main().catch((err) => {
  console.error(`[jev-cu-win] ${err.message}`);
  process.exit(1);
});
