#!/usr/bin/env node
// Instruction-only skill packaging. No API, UI, dependency or credential setup.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = ".jev-cu-win-install.json";
const FILES = ["SKILL.md", "LICENSE"];
const hash = (text) => createHash("sha256").update(text).digest("hex");

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

export function installSkill({ skillsDir = path.join(os.homedir(), ".agents", "skills"), mode = "install", repoDir = REPO_DIR } = {}) {
  if (!["install", "update", "uninstall"].includes(mode)) throw new Error("Unknown mode");
  const root = fs.realpathSync(repoDir);
  const dest = path.resolve(skillsDir, "jev-cu-win");
  const existing = lstatOrNull(dest);
  const exists = existing !== null;
  if (exists) {
    if (mode === "install") throw new Error(`Already exists: ${dest}. Use --update for an owned installation.`);
    if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error("Refusing a linked or non-directory skill target");
    const names = fs.readdirSync(dest).sort();
    if (JSON.stringify(names) !== JSON.stringify([...FILES, MARKER].sort())) throw new Error("Refusing an installation with missing or extra files");
    for (const name of [...FILES, MARKER]) {
      if (!fs.lstatSync(path.join(dest, name)).isFile()) throw new Error("Refusing linked or non-file contents");
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(dest, MARKER), "utf8"));
    if (manifest.repoDir !== root) throw new Error("Installation belongs to another checkout; use that checkout to manage it");
    for (const name of FILES) {
      if (hash(fs.readFileSync(path.join(dest, name))) !== manifest.hashes?.[name]) throw new Error(`Locally changed ${name}; preserve/reconcile it manually first`);
    }
  } else if (mode !== "install") {
    throw new Error(`Not installed: ${dest}`);
  }
  if (mode === "uninstall") {
    // No recursive removal: ownership, exact contents and hashes checked above.
    for (const name of [...FILES, MARKER]) fs.unlinkSync(path.join(dest, name));
    fs.rmdirSync(dest);
    return dest;
  }
  const content = {
    "SKILL.md": fs.readFileSync(path.join(root, "skill", "jev-cu-win", "SKILL.md"), "utf8").replaceAll("{{REPO_DIR}}", root.replaceAll("\\", "/")),
    LICENSE: fs.readFileSync(path.join(root, "LICENSE"), "utf8"),
  };
  if (!exists) fs.mkdirSync(dest, { recursive: true });
  for (const name of FILES) fs.writeFileSync(path.join(dest, name), content[name]);
  fs.writeFileSync(path.join(dest, MARKER), JSON.stringify({ repoDir: root, hashes: Object.fromEntries(FILES.map((name) => [name, hash(content[name])])) }, null, 2) + "\n");
  return dest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { "skills-dir": { type: "string" }, update: { type: "boolean" }, uninstall: { type: "boolean" }, help: { type: "boolean" } } });
    if (values.help) {
      console.log("node scripts/install-skill.mjs [--skills-dir <parent>] [--update | --uninstall]\nDefault parent: $HOME/.agents/skills. Copies instructions and LICENSE only.");
    } else {
      if (values.update && values.uninstall) throw new Error("Choose --update or --uninstall");
      const mode = values.uninstall ? "uninstall" : values.update ? "update" : "install";
      console.log(`${mode}: ${installSkill({ skillsDir: values["skills-dir"], mode })}`);
    }
  } catch (error) {
    console.error(`[install-skill] ${error.message}`);
    process.exitCode = 1;
  }
}
