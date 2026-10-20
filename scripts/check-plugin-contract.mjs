#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import process from "node:process";

const pluginDir = resolve(process.argv[2] || process.cwd());
const rootDir = resolve(dirname(new URL(import.meta.url).pathname), "..");
const failures = [];
const warnings = [];
const read = path => readFileSync(path, "utf8");
const fail = message => failures.push(message);
const pass = message => console.log(`[PASS] ${message}`);

const packagePath = resolve(pluginDir, "package.json");
if (!existsSync(packagePath)) {
  fail(`缺少 package.json: ${packagePath}`);
} else {
  const pkg = JSON.parse(read(packagePath));
  if (!pkg.name) fail("package.json 缺少插件 name");
  const clientPath = pkg.exports?.["./client"]
    ? resolve(pluginDir, pkg.exports["./client"])
    : resolve(pluginDir, "client/client.js");
  if (!existsSync(clientPath)) {
    fail(`缺少 client entry: ${clientPath}`);
  } else {
    const client = read(clientPath);
    // 0.1.7 takes over the browsing cell through the slot registry: the entry's
    // own lifetime is the plugin's lifetime, so reversibility means (a) every
    // side effect runs inside `ctx.effect`, and (b) each of those effects hands
    // back a disposer.
    const registersSlot = /slots\.register\s*\(/.test(client);
    const usesEffects = /ctx\.effect\s*\(/.test(client);
    if (!registersSlot) fail("client 未通过 slots.register 注册 slot（接管范围不可静态确认）");
    if (!usesEffects) fail("client 未注册 ctx.effect 生命周期");
    if (!/return\s*\(\)\s*=>/.test(client)) fail("client 未从副作用返回 disposer");
    if (!/data-dsh-session-manager/.test(client)) {
      warnings.push("未能静态确认插件自有的样式/DOM 带 marker，请人工复核");
    }
    if (!/remove\(\)/.test(client)) warnings.push("未能静态确认自建 DOM 在 disposer 中移除，请人工复核");
    if (/localStorage|sessionStorage/.test(client) && !/dsh-plugin:[^"'`]*\$\{?pkg|dsh-plugin:[^"'`]*${/.test(client)) {
      warnings.push("client 使用了 Web Storage；请确认它只保存插件私有偏好，并采用 dsh-plugin:<id>: 命名空间");
    }
    pass(`client lifecycle: ${clientPath}`);
  }
  if (!pkg.scripts?.test) fail("package.json 未提供 npm test");
  pass(`package: ${pkg.name || packagePath}`);
}

const readmePath = resolve(pluginDir, "README.md");
if (!existsSync(readmePath) || !read(readmePath).includes("PLUGIN-CONTRACT.md")) fail("README 未引用 PLUGIN-CONTRACT.md");
else pass("README 引用插件契约");

const contractPath = resolve(pluginDir, "PLUGIN-CONTRACT.md");
if (!existsSync(contractPath)) fail("缺少仓库内 PLUGIN-CONTRACT.md（自包含契约）");
else pass("插件契约随仓库自包含");

const testDir = resolve(pluginDir, "test");
if (!existsSync(testDir)) fail("缺少 test/ 验收目录");
else {
  const { readdirSync } = await import("node:fs");
  const testFiles = readdirSync(testDir)
    .filter(name => name.endsWith(".test.js"))
    .map(name => resolve(testDir, name));
  if (testFiles.length === 0) fail("test/ 下未找到可执行验收文件");
  const testText = testFiles.map(read).join("\n");
  if (!/cleanup|dispose|reversib|移除/i.test(testText)) fail("测试未覆盖 cleanup / 可逆性");
  if (!/host service|host identit|宿主状态|无副作用|no.side.effect|unchanged|baseline/i.test(testText)) {
    fail("测试未覆盖宿主状态不变/无副作用断言");
  } else pass("测试覆盖 cleanup 与宿主状态不变");
}

if (warnings.length) for (const warning of warnings) console.warn(`[WARN] ${warning}`);
if (failures.length) {
  for (const failure of failures) console.error(`[FAIL] ${failure}`);
  process.exitCode = 1;
} else {
  pass(`contract root: ${rootDir}`);
}
