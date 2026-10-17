/**
 * Policy Gate —— 確認が必要な操作をコードの関門として表現する。
 * 純粋関数・副作用なし。UI Automation なしで単体テストできる。
 */

/** 操作を許可するアプリ（--app に渡す名前。大文字小文字は区別しない） */
export const DEFAULT_ALLOWED_APPS = [
  "電卓",
  "Calculator",
  "メモ帳",
  "Notepad",
  "ペイント",
  "Paint",
  "Microsoft Edge",
  "Google Chrome",
];

/** 対象要素の文言がこれに当たったら、必ず止めて確認する */
export const SENSITIVE_LABEL_PATTERNS = [
  { id: "delete", re: /删除|移除|清空|削除|消去|ごみ箱|ゴミ箱|フォーマット|delete|remove|erase|format/i },
  { id: "send", re: /发送|提交|发布|回复|送信|投稿|返信|提出|公開|send|submit|post|reply|publish/i },
  { id: "payment", re: /支付|付款|购买|下单|充值|订阅|开通|支払|購入|注文|決済|課金|定期購読|サブスク|pay|purchase|buy|subscribe|checkout/i },
  { id: "auth", re: /授权|权限|登录|密码|验证码|許可|権限|ログイン|サインイン|パスワード|認証コード|authorize|permission|sign in|login|password|captcha/i },
  { id: "share", re: /上传|分享|导出|アップロード|共有|エクスポート|upload|share|export/i },
  { id: "install", re: /安装|インストール|install/i },
  { id: "settings", re: /系统设置|偏好设置|安全设置|システム設定|セキュリティ設定|Windows の設定|コントロール パネル|system settings|security settings|control panel/i },
];

export const DEFAULT_THRESHOLDS = {
  doneProbability: 0.9, // 完了確率 ≥ この値 → 終了
  riskConfirm: 0.2, // リスク確率 ≥ この値 → 止めて確認
  minConfidence: 0.5, // 対象の確信度 < この値 → エスカレーション（再試行／人に聞く）
  lowRiskMinConfidence: 0.4, // 副作用ゼロのアプリ（電卓／メモ帳など）は 0.4 まで緩める
  stopConfidence: 0.3, // 対象の確信度 < この値 → 即停止
};

/** 副作用ゼロでいつでもやり直せるアプリ：確信度の下限を緩めてよい（安全は risk／危険語で担保） */
export const LOW_RISK_APPS = ["電卓", "Calculator", "メモ帳", "Notepad", "ペイント", "Paint"];

const includesApp = (list, app) => list.some((a) => a.toLowerCase() === String(app ?? "").toLowerCase());

export function matchSensitive(label = "") {
  // 見えない文字（ゼロ幅スペースなど）を挟んで危険語をすり抜けられないように除去してから判定する
  const text = String(label).replace(/\p{Cf}/gu, "");
  return SENSITIVE_LABEL_PATTERNS.find((p) => p.re.test(text)) ?? null;
}

/**
 * @param {object} input
 * @param {object} input.decision  normalizeDecision の出力（targetLabel は切り詰め前の完全なラベル）
 * @param {string} input.app
 * @param {string[]} [input.allowedApps]
 * @param {number} [input.step]
 * @param {number} [input.maxSteps]
 * @param {object} [input.thresholds]
 * @param {boolean} [input.dryRun]
 * @returns {{verdict:"proceed"|"done"|"confirm"|"escalate"|"stop", kind?:string, reasons:string[]}}
 */
export function evaluatePolicy({
  decision,
  app,
  allowedApps = DEFAULT_ALLOWED_APPS,
  step = 1,
  maxSteps = 30,
  thresholds = DEFAULT_THRESHOLDS,
  dryRun = false,
}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const fmt = (n) => (typeof n === "number" ? n.toFixed(2) : "n/a");

  if (step > maxSteps) {
    return { verdict: "stop", kind: "budget", reasons: [`step ${step} が上限 ${maxSteps} を超えました`] };
  }
  if (typeof decision?.done === "number" && decision.done >= t.doneProbability) {
    return { verdict: "done", reasons: [`完了確率 ${fmt(decision.done)}`] };
  }

  const reasons = [];
  if (!includesApp(allowedApps, app)) reasons.push(`アプリ「${app}」は許可リストにありません`);
  const sensitive = matchSensitive(decision?.targetLabel);
  if (sensitive) reasons.push(`対象が「${sensitive.id}」系の要注意操作の可能性：${decision.targetLabel}`);
  if (typeof decision?.risk === "number" && decision.risk >= t.riskConfirm) {
    reasons.push(`Jev のリスク判定 ${fmt(decision.risk)} ≥ ${t.riskConfirm}`);
  }
  if (decision?.action === "ask_user") reasons.push("Jev がユーザーの介入が必要と判断");
  if (reasons.length) return { verdict: "confirm", kind: "sensitive", reasons, dryRun };

  if (![decision?.confidence, decision?.risk, decision?.done].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) {
    return { verdict: "escalate", kind: "invalid_decision", reasons: ["判断の確率が欠けているか 0–1 の範囲外です"] };
  }
  if (typeof decision?.confidence === "number" && decision.confidence < t.stopConfidence) {
    return { verdict: "stop", kind: "low_confidence", reasons: [`対象の確信度 ${fmt(decision.confidence)} < ${t.stopConfidence}`] };
  }
  const minConfidence = includesApp(LOW_RISK_APPS, app) ? t.lowRiskMinConfidence : t.minConfidence;
  if (typeof decision?.confidence === "number" && decision.confidence < minConfidence) {
    return {
      verdict: "escalate",
      kind: "low_confidence",
      reasons: [`対象の確信度 ${fmt(decision.confidence)} < ${minConfidence}`],
      minConfidence,
    };
  }
  if (decision?.targetIndex == null && decision?.action !== "wait") {
    return { verdict: "escalate", kind: "no_target", reasons: ["対象要素が選ばれていません"] };
  }

  return { verdict: "proceed", reasons: [] };
}
