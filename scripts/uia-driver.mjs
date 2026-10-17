/**
 * Windows UI Automation ドライバ。
 *
 * scripts/uia-host.ps1 を PowerShell の常駐プロセスとして起動し、
 * 1 行 1 JSON のやり取りで「画面の読み取り」と「操作」を行う。
 * loop.mjs の runTask() が期待する driver インターフェースを実装する。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const HOST_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "uia-host.ps1");

/** PowerShell ホストとの通信路。request(cmd, args) → result を返す */
export function createPowerShellTransport({
  shell = process.env.JEV_CU_POWERSHELL || "powershell.exe",
  script = HOST_SCRIPT,
  timeoutMs = 30_000,
  spawnImpl = spawn,
} = {}) {
  if (spawnImpl === spawn && process.platform !== "win32") {
    throw new Error("jev-cu-win は Windows 専用です（UI Automation を使います）");
  }
  const child = spawnImpl(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let nextId = 1;
  let stderr = "";
  let exited = null;
  const pending = new Map();

  const failAll = (err) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    pending.clear();
  };

  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const text = line.replace(/^﻿/, "").trim();
    if (!text.startsWith("{")) return; // PowerShell の余計な出力は無視
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(`UI Automation：${msg.error}`));
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4_000);
  });
  child.on("error", (err) => {
    exited = err;
    failAll(new Error(`PowerShell を起動できません（${shell}）：${err.message}`));
  });
  child.on("exit", (code) => {
    exited ??= new Error(`PowerShell が終了しました（code ${code}）${stderr ? `：${stderr.trim()}` : ""}`);
    failAll(exited);
  });

  return {
    request(cmd, args = {}) {
      if (exited) return Promise.reject(exited);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`UI Automation：${cmd} が ${timeoutMs}ms 以内に応答しませんでした`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ id, cmd, args }) + "\n");
      });
    },
    close() {
      if (exited) return;
      child.stdin.end();
      setTimeout(() => child.kill(), 2_000).unref();
    },
  };
}

/**
 * runTask() 用 driver。
 * 座標（click_at / drag）はウィンドウ左上を原点とするピクセル。
 */
export function createUiaDriver({ transport, maxNodes = 1500, maxDepth = 40 } = {}) {
  const t = transport ?? createPowerShellTransport();
  return {
    async bind(appName) {
      return t.request("bind", { app: appName });
    },
    async observe() {
      const r = await t.request("observe", { maxNodes, maxDepth });
      return r.text;
    },
    async click(target, options = {}) {
      const button = options.mouseButton ?? "left";
      if (Array.isArray(target)) return t.request("clickAt", { x: target[0], y: target[1], button });
      return t.request("click", { index: target, button });
    },
    async drag(from, to) {
      return t.request("drag", { from, to });
    },
    async setValue(index, text) {
      return t.request("setValue", { index, text });
    },
    async typeText(text) {
      return t.request("typeText", { text });
    },
    async pressKey(key) {
      return t.request("pressKey", { key });
    },
    async scroll(index, direction, pages = 1) {
      return t.request("scroll", { index, direction, pages });
    },
    async listWindows() {
      const r = await t.request("windows");
      return r.windows ?? [];
    },
    close() {
      t.close();
    },
  };
}
