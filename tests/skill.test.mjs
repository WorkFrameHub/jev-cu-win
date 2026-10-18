import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultSkillsDir, installSkill } from "../scripts/install-skill.mjs";

function workspace(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "jev-cu-win-skill-"));
  t.after(() => {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(temp));
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const repoDir = path.join(temp, "checkout with spaces");
  fs.mkdirSync(path.join(repoDir, "skill", "jev-cu-win"), { recursive: true });
  fs.writeFileSync(path.join(repoDir, "skill", "jev-cu-win", "SKILL.md"), "checkout: {{REPO_DIR}}\n");
  fs.writeFileSync(path.join(repoDir, "LICENSE"), "MIT fixture\n");
  return { repoDir, skillsDir: path.join(temp, "skills") };
}

test("skill lifecycle materializes paths, updates owned copy, and uninstalls only that skill", (t) => {
  const options = workspace(t);
  const dest = installSkill(options);
  assert.equal(fs.readFileSync(path.join(dest, "SKILL.md"), "utf8"), `checkout: ${fs.realpathSync(options.repoDir).replaceAll("\\", "/")}\n`);
  assert.equal(fs.readFileSync(path.join(dest, "LICENSE"), "utf8"), "MIT fixture\n");
  assert.throws(() => installSkill(options), /Already exists/);
  fs.writeFileSync(path.join(options.repoDir, "skill", "jev-cu-win", "SKILL.md"), "updated {{REPO_DIR}}\n");
  installSkill({ ...options, mode: "update" });
  assert.ok(fs.readFileSync(path.join(dest, "SKILL.md"), "utf8").startsWith("updated "));
  fs.writeFileSync(path.join(options.skillsDir, "unrelated.txt"), "keep");
  installSkill({ ...options, mode: "uninstall" });
  assert.equal(fs.existsSync(dest), false);
  assert.equal(fs.readFileSync(path.join(options.skillsDir, "unrelated.txt"), "utf8"), "keep");
});

test("skill update and uninstall refuse user edits and extra files without removing them", (t) => {
  const options = workspace(t);
  const dest = installSkill(options);
  const skill = path.join(dest, "SKILL.md");
  const original = fs.readFileSync(skill);
  fs.writeFileSync(skill, "user edit");
  for (const mode of ["update", "uninstall"]) assert.throws(() => installSkill({ ...options, mode }), /Locally changed/);
  assert.equal(fs.readFileSync(skill, "utf8"), "user edit");
  fs.writeFileSync(skill, original);
  fs.writeFileSync(path.join(dest, "notes.txt"), "keep");
  for (const mode of ["update", "uninstall"]) assert.throws(() => installSkill({ ...options, mode }), /extra files/);
  assert.equal(fs.readFileSync(path.join(dest, "notes.txt"), "utf8"), "keep");
});

test("skill management refuses another checkout and an unmanaged existing directory", (t) => {
  const options = workspace(t);
  const dest = installSkill(options);
  const other = path.join(options.repoDir, "other");
  fs.mkdirSync(other);
  for (const mode of ["update", "uninstall"]) assert.throws(() => installSkill({ ...options, repoDir: other, mode }), /another checkout/);
  fs.unlinkSync(path.join(dest, ".jev-cu-win-install.json"));
  assert.throws(() => installSkill({ ...options, mode: "uninstall" }), /missing or extra/);
  assert.equal(fs.existsSync(path.join(dest, "SKILL.md")), true);
});

test("default skills directory per target: Codex .agents/skills, Claude Code .claude/skills", () => {
  const home = path.join(os.tmpdir(), "home");
  assert.equal(defaultSkillsDir(undefined, home), path.join(home, ".agents", "skills"));
  assert.equal(defaultSkillsDir("codex", home), path.join(home, ".agents", "skills"));
  assert.equal(defaultSkillsDir("claude", home), path.join(home, ".claude", "skills"));
  assert.throws(() => defaultSkillsDir("cursor", home), /Unknown --target/);
});

test("skill management refuses a linked target", (t) => {
  const options = workspace(t);
  fs.mkdirSync(options.skillsDir);
  const dest = path.join(options.skillsDir, "jev-cu-win");
  try {
    fs.symlinkSync(options.repoDir, dest, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (!["EPERM", "EACCES"].includes(error.code)) throw error;
    t.skip("Host does not permit creating the test link");
    return;
  }
  for (const mode of ["update", "uninstall"]) assert.throws(() => installSkill({ ...options, mode }), /linked/);
  assert.equal(fs.existsSync(path.join(options.repoDir, "LICENSE")), true);
});
