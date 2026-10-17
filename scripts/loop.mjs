/**
 * jev-cu-win ループエンジン：観測（UI Automation）→ 判断（Jev）→ 関門（Policy）→ 実行（UI Automation）。
 * 元実装: https://github.com/Sac-Y/Jev-cu （MIT）
 *
 * このモジュール自体は OS 固有 API を import しない。driver を注入する形にして単体テストできるようにしている。
 * Windows の driver は uia-driver.mjs の createUiaDriver()。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decide as jevDecide } from "./jev-decide.mjs";
import { evaluatePolicy, DEFAULT_ALLOWED_APPS } from "./policy.mjs";

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* --------------------------- UI ツリー解析と候補 --------------------------- */

// 複数語のロール名（長いものを先に）。uia-host.ps1 の $RoleMap と対応させること。
const ROLES = [
  "standard window",
  "search field",
  "text field",
  "radio button",
  "split button",
  "toggle button",
  "close button",
  "minimize button",
  "combo box",
  "menu bar",
  "menu item",
  "list view",
  "list item",
  "tree item",
  "data item",
  "header item",
  "tab list",
  "title bar",
  "status bar",
  "progress bar",
  "scroll bar",
  "button",
  "checkbox",
  "document",
  "container",
  "group",
  "heading",
  "image",
  "link",
  "text",
  "grid",
  "list",
  "tab",
  "toolbar",
  "pane",
  "window",
];

const CLICKABLE_ROLES = new Set([
  "button",
  "split button",
  "toggle button",
  "radio button",
  "close button",
  "minimize button",
  "link",
  "menu item",
  "text field",
  "search field",
  "document",
  "checkbox",
  "combo box",
  "stepper",
  "slider",
  "tab",
  "list item",
  "tree item",
  "data item",
  "header item",
]);

/** UI ツリーのテキストを要素一覧に解析：{index, role, label, depth, raw} */
export function parseAX(axText) {
  const out = [];
  for (const line of String(axText ?? "").split(/\r?\n/)) {
    const m = line.match(/^(\s*)(\d+)\s+(.*)$/);
    if (!m) continue;
    const depth = m[1].replace(/\t/g, "    ").length;
    const rest = m[3].trim();
    const role = ROLES.find((r) => rest === r || rest.startsWith(r + " ")) ?? rest.split(" ")[0];
    const label = rest.slice(role.length).trim();
    out.push({ index: Number(m[2]), role, label, depth, raw: line });
  }
  return out;
}

/**
 * 候補の絞り込み：ロールで選別 + 軽いスコアリング。
 * 教訓（元実装の P0 実測）：位置で機械的に切り捨てると、目的のボタンがリスト項目に押し出される。
 */
export function selectCandidates(elements, goal = "", { max = 40 } = {}) {
  const tokens = String(goal)
    .toLowerCase()
    .split(/[^a-z0-9぀-ヿ一-鿿]+/)
    .filter((t) => t.length >= 2);

  const scored = [];
  for (const el of elements) {
    if (!CLICKABLE_ROLES.has(el.role)) continue;
    if (/\(disabled\)$/.test(el.label)) continue;
    let score = 0;
    if (["button", "split button", "toggle button", "radio button", "menu item", "combo box"].includes(el.role)) score += 3;
    if (["text field", "search field", "document"].includes(el.role)) score += 2;
    if (["link", "tab", "list item", "tree item"].includes(el.role)) score += 1;
    const label = `${el.label}`.toLowerCase();
    if (label) {
      for (const t of tokens) if (label.includes(t)) score += 4;
    } else {
      score -= 2;
    }
    if (/previous|next|today|search|前へ|次へ|今日|検索/i.test(el.label) && /month|search|前|次|検索/i.test(goal)) score += 6;
    scored.push({ ...el, score });
  }

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const clipped = scored.length > max;
  const selected = scored.slice(0, max);
  return Object.assign(selected, { clipped, totalClickable: scored.length });
}

/**
 * Jev に渡す少量のコンテキスト：ウィンドウタイトル + 主要テキスト行（電卓の表示値など）+ フォーカス行。
 * この「状態のフィードバック」があるから Jev は複数ステップを連続して正しくこなせる。
 */
export function buildContext(axText, { maxTextLines = 6 } = {}) {
  const lines = String(axText ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const head = lines.slice(0, 2);
  const texts = parseAX(axText)
    .filter((element) => element.role === "text" && element.label)
    .slice(0, maxTextLines)
    .map((element) => element.raw.trim());
  const focus = lines.find((l) => /focused UI element/i.test(l));
  return [...head, ...texts, focus].filter(Boolean).join("\n").slice(0, 1_500);
}

/* ------------------------------- メインループ ------------------------------- */

const defaultEmit = (line) => console.log(line);

export async function runTask({
  driver,
  appName,
  goal,
  dryRun = true,
  maxSteps = 30,
  candidateMax = 40,
  allowedApps = DEFAULT_ALLOWED_APPS,
  thresholds,
  decide = jevDecide,
  emit = defaultEmit,
  traceDir = path.join(PROJECT_DIR, "runs"),
  traceId,
  resources = {}, // { text, key, direction, at, from, to }：入力文字などは事前に用意する（Jev は文章を生成しない）
  constraints = "",
  plan = "",
  jevOptions = {},
  verify, // 任意：UI ツリー全文 → boolean。指定すると最終目標をこれで検証する
  settleChecks = 6, // 文字入力後、画面が落ち着くまで読み直す最大回数
  settleDelayMs = 300,
  onConfirm, // 任意：({decision, gate}) → boolean。confirm 判定のとき人に確認し、true なら実行する
}) {
  const runId = traceId ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${appName.replace(/[^\p{L}\p{N}]+/gu, "")}`;
  fs.mkdirSync(traceDir, { recursive: true });
  const tracePath = path.join(traceDir, `${runId}.jsonl`);
  const record = (entry) => fs.appendFileSync(tracePath, JSON.stringify({ ts: new Date().toISOString(), runId, ...entry }) + "\n");

  emit(`[jev-cu-win] run=${runId} app=${appName} dryRun=${dryRun} goal=${goal}`);
  record({ event: "start", appName, goal, dryRun, maxSteps, plan });

  await driver.bind(appName);
  let observation = await driver.observe({ full: true });
  const recentActions = [];
  const typedTexts = new Set();
  const startedAt = Date.now();

  for (let step = 1; step <= maxSteps; step++) {
    const planned = typeof resources === "function" ? ((await resources(step, null)) ?? {}) : {};
    if (verify && (await verify(observation))) {
      return finish("done", { steps: step - 1, tracePath, verified: true, elapsedMs: Date.now() - startedAt });
    }
    const stepGoal = planned.jevGoal ?? goal;

    let candidates = selectCandidates(parseAX(observation), stepGoal, { max: candidateMax });
    if (candidates.length < 2) {
      observation = await driver.observe({ full: true });
      candidates = selectCandidates(parseAX(observation), stepGoal, { max: candidateMax });
      if (candidates.length < 2) {
        record({ event: "no_candidates", step });
        return finish("escalate", {
          steps: step - 1,
          tracePath,
          message: "候補要素が足りず判断できません",
          elapsedMs: Date.now() - startedAt,
        });
      }
    }
    if (candidates.clipped) {
      emit(`[step ${step}] 候補を絞り込み：${candidates.totalClickable} → ${candidateMax}（ロール／関連度順）`);
    }

    let decision;
    try {
      decision = await decide({
        goal: stepGoal,
        app: appName,
        candidates,
        context: buildContext(observation),
        recentActions,
        constraints: [planned.jevPlan ?? "", plan ? `Plan (from planner): ${plan}` : "", constraints].filter(Boolean).join("\n"),
        ...jevOptions,
      });
    } catch (err) {
      record({ event: "decide_error", step, message: err.message });
      return finish("error", { steps: step - 1, tracePath, message: err.message, elapsedMs: Date.now() - startedAt });
    }

    const selected = candidates.find((c) => c.index === decision.targetIndex);
    if (decision.targetIndex != null && !selected) {
      return finish("escalate", { steps: step - 1, tracePath, message: "対象が現在の候補にありません", elapsedMs: Date.now() - startedAt });
    }
    // Jev に送る説明文は 120 文字で切り詰められている。関門は切り詰め前の完全なラベルで判定する。
    if (selected) decision = { ...decision, targetLabel: selected.label };
    let gate = evaluatePolicy({ decision, app: appName, allowedApps, step, maxSteps, thresholds, dryRun });
    const target = decision.targetIndex != null ? `i${decision.targetIndex} (${decision.targetLabel ?? "?"})` : "—";
    emit(
      `[step ${step}] Jev ${decision.latencyMs}ms · ${decision.action ?? "?"} ${target} · ` +
        `conf=${fmt(decision.confidence)} risk=${fmt(decision.risk)} done=${fmt(decision.done)} → ${gate.verdict}` +
        (gate.reasons.length ? ` · ${gate.reasons.join("；")}` : ""),
    );
    record({ event: "step", step, candidates: candidates.length, decision: stripRaw(decision), gate });

    if (gate.verdict === "done" && (verify || stepGoal !== goal)) {
      return finish("escalate", { steps: step - 1, tracePath, decision, message: "Jev は完了と判断しましたが最終目標は未検証です", elapsedMs: Date.now() - startedAt });
    }
    if (gate.verdict === "done") {
      return finish("done", { steps: step - 1, tracePath, decision, gate, elapsedMs: Date.now() - startedAt });
    }
    // ask_user は「止まって人に聞く」の意味で、実行できる操作ではない。y/N を出さずに止める。
    if (decision.action === "ask_user") {
      return finish("ask_user", {
        steps: step - 1,
        tracePath,
        decision,
        message: `Jev が人の判断を求めて止まりました（完了済みの可能性があります）。現在の画面：\n${screenSummary(observation)}`,
        elapsedMs: Date.now() - startedAt,
      });
    }
    if (gate.verdict === "confirm" && !dryRun && onConfirm && decision.targetIndex != null) {
      const approved = await onConfirm({ decision, gate });
      record({ event: "confirm", step, approved });
      if (approved) gate = { verdict: "proceed", reasons: ["ユーザーが承認"] };
    }
    if (gate.verdict !== "proceed") {
      return finish(gate.verdict, { steps: step - 1, tracePath, decision, gate, elapsedMs: Date.now() - startedAt });
    }
    if (dryRun) {
      return finish("dry_run", {
        steps: 0,
        tracePath,
        planned: { action: decision.action, targetIndex: decision.targetIndex, targetLabel: decision.targetLabel },
        gate,
        elapsedMs: Date.now() - startedAt,
      });
    }

    const tAct = Date.now();
    const stepResources = typeof resources === "function" ? ((await resources(step, decision)) ?? {}) : resources;
    // type_text は追記なので、同じ文字を 2 回打つと内容が重複する。2 回目は打たずに止める。
    if (decision.action === "type_text") {
      const text = String(stepResources.text ?? "");
      if (typedTexts.has(text)) {
        return finish("escalate", {
          steps: step - 1,
          tracePath,
          decision,
          message: `同じ文字をもう一度入力しようとしたので止めました（入力済みの可能性があります）。現在の画面：\n${screenSummary(observation)}`,
          elapsedMs: Date.now() - startedAt,
        });
      }
      typedTexts.add(text);
    }
    try {
      await executeAction(driver, decision, stepResources);
    } catch (err) {
      record({ event: "action_error", step, message: err.message });
      return finish("error", { steps: step, tracePath, message: `操作に失敗：${err.message}`, elapsedMs: Date.now() - startedAt });
    }
    const actMs = Date.now() - tAct;

    await sleep(300); // UI の更新を待つ
    const previousObservation = observation;
    observation = await driver.observe({ full: true });
    // 文字入力はアプリ側の描画が遅れる。画面が落ち着くまで読み直し、書きかけの状態で判断させない。
    if (["type_text", "set_value"].includes(decision.action)) {
      for (let i = 0; i < settleChecks; i++) {
        await sleep(settleDelayMs);
        const again = await driver.observe({ full: true });
        if (again === observation) break;
        observation = again;
      }
    }
    const noChange = observation === previousObservation;
    recentActions.push(`${decision.action} i${decision.targetIndex} (${decision.targetLabel ?? ""}) → ${noChange ? "no change" : "changed"}`);
    emit(`         └ 操作 ${actMs}ms · ${noChange ? "画面変化なし" : "画面が変化"}`);
    record({ event: "action", step, actMs, noChange, action: decision.action, targetIndex: decision.targetIndex });
  }

  if (verify && (await verify(observation))) {
    return finish("done", { steps: maxSteps, tracePath, verified: true, elapsedMs: Date.now() - startedAt });
  }
  return finish("max_steps", { steps: maxSteps, tracePath, elapsedMs: Date.now() - startedAt });

  function finish(status, extra) {
    record({ event: "finish", status, ...stripDecision(extra) });
    emit(`[jev-cu-win] 終了：${status} · ${(extra.elapsedMs / 1000).toFixed(1)}s · trace=${tracePath}`);
    return { status, ...extra };
  }
}

export async function executeAction(driver, decision, resources = {}) {
  switch (decision.action) {
    case "click_element":
      if (Array.isArray(resources.at)) return driver.click(resources.at);
      return driver.click(decision.targetIndex, resources.mouseButton ? { mouseButton: resources.mouseButton } : undefined);
    case "click_at":
      if (!Array.isArray(resources.at)) throw new Error("click_at には座標（--at x,y）が必要です");
      return driver.click(resources.at);
    case "drag":
      if (!Array.isArray(resources.from) || !Array.isArray(resources.to)) throw new Error("drag には --from と --to が必要です");
      return driver.drag(resources.from, resources.to);
    case "set_value":
      return driver.setValue(decision.targetIndex, String(resources.text ?? ""));
    case "type_text":
      return driver.typeText(String(resources.text ?? ""));
    case "press_key":
      return driver.pressKey(String(resources.key ?? "Enter"));
    case "scroll":
      return driver.scroll(decision.targetIndex, String(resources.direction ?? "down"), 1);
    case "wait":
      return sleep(500);
    default:
      throw new Error(`未対応の操作：${decision.action}`);
  }
}

/** 画面の主要テキスト（電卓の表示値など）を人が読む用にまとめる */
function screenSummary(axText) {
  const texts = parseAX(axText)
    .filter((e) => e.role === "text" && e.label)
    .slice(0, 6)
    .map((e) => `  ${e.label}`);
  return texts.length ? texts.join("\n") : "  （テキストなし）";
}

const fmt = (n) => (typeof n === "number" ? n.toFixed(2) : "n/a");
const stripRaw = ({ raw, ...rest }) => rest;
const stripDecision = (extra) => (extra.decision ? { ...extra, decision: stripRaw(extra.decision) } : extra);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
