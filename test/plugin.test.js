import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const code = readFileSync(new URL("../client/client.js", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("package declares the independent local session manager", () => {
  assert.equal(pkg.name, "@pianner/dsh-session-manager");
  assert.equal(pkg.exports["./client"], "./client/client.js");
  assert.equal(pkg.dsh.client.platform, "web");
});

test("scope is limited to left workspace session rows", () => {
  assert.match(code, /sidebar\.workspaces/);
  assert.doesNotMatch(code, /sidebar-right|dsh-better-sidebar/);
});

test("manager supplies Codex-style session actions", () => {
  for (const label of ["固定会话", "取消固定", "重命名", "分叉会话", "归档会话", "复制 Session ID", "复制工作目录", "置顶会话", "正在执行", "未读"]) assert.ok(code.includes(label), label);
  for (const method of ["pinSession", "unpinSession", "forkSession", "archiveSession", "unarchiveSession", "openSession"]) assert.ok(code.includes(method), method);
  assert.match(code, /uiSession/);
  assert.match(code, /sessionStatus/);
  assert.match(code, /renderPinned/);
  assert.match(code, /sessions\.using/);
  assert.match(code, /reference\.binding\.session\.rename/);
});

test("menu typography follows session-row scale", () => {
  assert.match(code, /\.dsm-menu\{[^}]*font-size:13px/);
  assert.match(code, /\.dsm-menu-item\{[^}]*line-height:18px/);
});

test("workspace paths use host projection and restore native title", () => {
  assert.match(code, /workspacePath/);
  assert.match(code, /workspaceTitles/);
  assert.match(code, /getAttribute\("title"\)/);
  assert.match(code, /restoreWorkspaceTitle/);
});

test("session layout keeps the workspace hierarchy and reserves a stable time column", () => {
  assert.match(code, /nativeSectionLabel/);
  assert.match(code, /normalizeWorkspaceSectionLabel/);
  assert.match(code, /restoreWorkspaceSectionLabel/);
  assert.match(code, /工作区/);
  assert.match(code, /dsm-project-header/);
  assert.match(code, /项目会话/);
  assert.match(code, /text-overflow:ellipsis/);
  assert.match(code, /font-variant-numeric:tabular-nums/);
});

test("native rows are hidden and restored without claiming plugin markers", () => {
  assert.match(code, /workspaceState\.phase !== "ready"/);
  assert.match(code, /hasLiveNativePage/);
  assert.doesNotMatch(code, /archiveOnlyHint|ordinaryVisible|membershipOnly\.slice/);
  assert.match(code, /restoreNativePinButtons/);
  assert.match(code, /workspaceMembers/);
  assert.match(code, /NATIVE_OVERFLOW/);
  assert.match(code, /restoreStaleNativeWrappers/);
  assert.match(code, /origin !== "subagent"/);
  assert.match(code, /!byId\[id\]\.blank/);
  assert.match(code, /dsm-native-hidden/);
  assert.match(code, /state\.hidden/);
  assert.match(code, /function restoreNative/);
  assert.match(code, /function nativeEntries/);
  assert.match(code, /dsm-session-holder/);
  assert.match(code, /data-dsm-owned/);
  assert.doesNotMatch(code, /row\.dataset\.rowKey/);
  assert.match(code, /menuPointerDown/);
  assert.match(code, /menu\.contains\(event\.target\)/);
});
