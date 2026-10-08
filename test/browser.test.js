import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

let browser;
before(async () => {
  // Separate temporary browser profile: never attach to the user's live tabs.
  browser = await chromium.launch({ headless: true, channel: process.env.DSM_BROWSER_CHANNEL || "chrome" });
});
after(async () => { await browser?.close(); });

const nativeRow = (id) => `<div class="nativeWrapper" data-native="${id}"><div data-row-key="session:${id}" role="treeitem">Native ${id}<button aria-label="置顶会话">pin</button></div></div>`;
const nativeRows = (ids) => ids.map(nativeRow).join("");
const group = (key, rows, nested = "") => `<div class="fixture_groupSection" data-group="${key}"><button data-row-key="workspace:${key}" aria-expanded="true">Workspace ${key}</button>${nested}${rows}</div>`;

async function mount(t, { nested = false, direct = false, expanded = true, sessionIds = ["a"], pinnedSessionIds = [], archivedSessionIds = [], statuses = {}, withUiSession = true, titles = {}, sectionLabel = "工作区", prepare } = {}) {
  const page = await browser.newPage();
  t.after(() => page.close());
  page.setDefaultTimeout(2000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const main = direct ? '<div data-row-key="session:a" role="treeitem">Native a</div>' : nativeRows(sessionIds);
  const child = nested ? `<div role="group">${group("child", nativeRow("b"))}</div>` : "";
  await page.setContent(`<style>body{font:14px sans-serif} [data-slot]{width:320px} button{min-height:28px}</style><div data-slot="sidebar.workspaces"><div class="fixture_sectionHeader"><span class="fixture_sectionLabel">${sectionLabel}</span></div><div role="tree">${group("w", main, child)}</div></div><aside><button aria-label="置顶会话" id="outside-pin">Outside pin</button></aside>`);
  await page.evaluate(({ nested, expanded, sessionIds, pinnedSessionIds, archivedSessionIds, statuses, withUiSession, titles }) => {
    function store(value) {
      const listeners = new Set();
      return { getSnapshot: () => value, subscribe: f => { listeners.add(f); return () => listeners.delete(f); }, set: next => { value = next; for (const f of listeners) f(); }, listeners };
    }
    const ids = [...new Set([...sessionIds, ...(nested ? ["b"] : [])])];
    const byId = Object.fromEntries(ids.map((id, index) => [id, {
      id, displayTitle: titles[id] || (id === "a" ? "Alpha" : id === "b" ? "Beta" : `Session ${id}`),
      origin: "user", cwd: `/workspace/${id}`, updatedAt: Date.now() - index * 1000,
      retainedBy: id === "a" ? { mainView: 1 } : {},
    }]));
    const list = store({ phase: "ready", ids, byId });
    const workspaceItems = [{ workspaceId: "w", path: "/workspace/demo", sessionIds }, ...(nested ? [{ workspaceId: "child", path: "/workspace/demo/child", sessionIds: ["b"] }] : [])];
    const workspaces = store({ phase: "ready", items: workspaceItems, pinnedSessionIds, archivedSessionIds });
    const selection = store({ sessionId: "a" });
    const status = store(new Map(Object.entries(statuses)));
    const calls = [];
    const intervals = new Set();
    const disposals = [];
    const uiWorkspace = { selection };
    for (const name of ["openSession", "pinSession", "unpinSession", "forkSession", "archiveSession", "unarchiveSession"]) {
      uiWorkspace[name] = async (...args) => {
        calls.push([name, ...args]);
        if (name === "pinSession") workspaces.set({ ...workspaces.getSnapshot(), pinnedSessionIds: [...new Set([...workspaces.getSnapshot().pinnedSessionIds, args[0]])] });
        if (name === "unpinSession") workspaces.set({ ...workspaces.getSnapshot(), pinnedSessionIds: workspaces.getSnapshot().pinnedSessionIds.filter(id => id !== args[0]) });
        if (name === "forkSession") return "child-id";
      };
    }
    const services = {
      sessions: { list, using: async (id, options, fn) => fn({ binding: { session: { rename: async title => { calls.push(["rename", id, title, options]); return { ok: true }; } } } }) },
      workspaces: { list: workspaces }, uiWorkspace,
      ...(withUiSession ? { uiSession: { sessionStatus: status } } : {}),
      timer: { interval: f => { intervals.add(f); return () => intervals.delete(f); } },
    };
    window.fixture = {
      services, list, workspaces, selection, status, calls,
      baseline: () => JSON.parse(JSON.stringify({
        list: list.getSnapshot(), workspaces: workspaces.getSnapshot(), selection: selection.getSnapshot(),
        status: [...status.getSnapshot().entries()],
      })),
      tick: () => { for (const f of intervals) f(); },
      setPinned: pinned => workspaces.set({ ...workspaces.getSnapshot(), pinnedSessionIds: pinned }),
      setStatus: next => status.set(new Map(Object.entries(next))),
      cleanup: () => { for (const f of disposals.splice(0).reverse()) f(); },
      disposals, intervals,
    };
    document.querySelector('[data-row-key="workspace:w"]').setAttribute("aria-expanded", String(expanded));
    window.__ModuleLoader__ = { load: ({ factory }) => { window.fixture.plugin = factory(); window.fixture.plugin.apply({ get: name => services[name], effect: fn => disposals.push(fn()) }); } };
  }, { nested, expanded, sessionIds, pinnedSessionIds, archivedSessionIds, statuses, withUiSession, titles });
  if (prepare) await prepare(page);
  await page.addScriptTag({ path: fileURLToPath(new URL("../client/client.js", import.meta.url)) });
  t.after(() => assert.deepEqual(errors, [], "no uncaught browser errors"));
  return page;
}

// Mirror WorkspaceBrowser's 5-idle-row limit and native overflow click state.
// The shared-tail variant also exercises a row/control wrapper boundary.
async function mountPaginated(t, { sharedTail = false, nested = false, ungrouped = false, pinnedSessionIds = [] } = {}) {
  const rootIds = Array.from({ length: 12 }, (_, i) => i === 0 ? "a" : `page-${i}`);
  const groups = { w: rootIds };
  if (nested) groups.child = Array.from({ length: 7 }, (_, i) => i === 0 ? "b" : `child-${i}`);
  if (ungrouped) groups[""] = Array.from({ length: 6 }, (_, i) => `loose-${i}`);
  return mount(t, {
    sessionIds: rootIds, nested, pinnedSessionIds,
    prepare: page => page.evaluate(({ groups, sharedTail }) => {
      const list = fixture.list.getSnapshot();
      const byId = { ...list.byId };
      for (const [key, ids] of Object.entries(groups)) {
        for (const id of ids) byId[id] ??= { id, displayTitle: id, cwd: `/workspace/${key}`, updatedAt: Date.now(), retainedBy: {} };
      }
      fixture.list.set({ ...list, ids: Object.keys(byId), byId });
      fixture.workspaces.set({ ...fixture.workspaces.getSnapshot(), items: Object.entries(groups)
        .filter(([key]) => key !== "").map(([workspaceId, sessionIds]) => ({ workspaceId, path: `/workspace/${workspaceId}`, sessionIds })) });
      fixture.pagination = {};
      fixture.paginationCalls = [];
      for (const [key, ids] of Object.entries(groups)) {
        let section = document.querySelector(`[data-group="${key}"]`);
        if (!section) {
          section = document.createElement("div");
          section.className = "fixture_groupSection"; section.dataset.group = key;
          const header = document.createElement("button");
          header.dataset.rowKey = `workspace:${key}`; header.textContent = "未分组";
          header.setAttribute("aria-expanded", "true"); section.append(header);
          document.querySelector('[role="tree"]').append(section);
        }
        for (const child of [...section.children]) if (child.matches(".nativeWrapper")) child.remove();
        const header = section.querySelector(`[data-row-key="workspace:${key}"]`);
        const content = document.createElement("div");
        content.dataset.nativePage = key; section.append(content);
        const control = document.createElement("button");
        control.type = "button"; control.dataset.rowKey = `overflow:${key}`;
        control.className = "fixture_sessionOverflowButton";
        let limit = 5;
        let expanded = true;
        function renderPage() {
          content.replaceChildren();
          if (!expanded) return;
          const visible = ids.slice(0, limit);
          const hidden = ids.length - visible.length;
          for (const [index, id] of visible.entries()) {
            const wrapper = document.createElement("div");
            wrapper.className = "nativeWrapper"; wrapper.dataset.native = id;
            const row = document.createElement("div");
            row.dataset.rowKey = `session:${id}`; row.setAttribute("role", "treeitem"); row.textContent = `Native ${id}`;
            const pin = document.createElement("button");
            pin.setAttribute("aria-label", "置顶会话"); pin.textContent = "pin"; row.append(pin); wrapper.append(row);
            content.append(wrapper);
            if (sharedTail && index === visible.length - 1) wrapper.append(control);
          }
          if (!sharedTail) content.append(control);
          control.setAttribute("aria-expanded", String(hidden === 0));
          control.textContent = hidden === 0 ? "收起" : `展开其余 ${hidden} 个会话`;
        }
        control.addEventListener("click", () => {
          fixture.paginationCalls.push(key);
          const hidden = Math.max(0, ids.length - limit);
          limit = hidden === 0 ? 5 : hidden <= 5 ? Infinity : limit + 5;
          renderPage();
        });
        header.addEventListener("click", () => {
          expanded = !expanded;
          if (!expanded) limit = 5;
          header.setAttribute("aria-expanded", String(expanded));
          renderPage();
        });
        fixture.pagination[key] = { control, content, render: renderPage };
        renderPage();
      }
    }, { groups, sharedTail }),
  });
}

const row = (page, id = "a") => page.locator(`[data-dsm-session-id="${id}"]`);
async function openMenu(page, id = "a") {
  await row(page, id).hover();
  await row(page, id).getByRole("button", { name: "会话操作" }).click();
}
async function settle(page) { await page.waitForTimeout(20); }

test("repeated renders preserve visible rows without sharing native row markers", async t => {
  const page = await mount(t);
  assert.equal(await row(page).isVisible(), true);
  await page.evaluate(() => { for (let i = 0; i < 12; i++) fixture.tick(); });
  assert.equal(await row(page).isVisible(), true);
  assert.equal(await page.locator('.dsm-session-holder.dsm-native-hidden').count(), 0);
  assert.equal(await row(page).getAttribute("data-row-key"), null);
});

test("nested workspace sessions never leak into their parent projection", async t => {
  const page = await mount(t, { nested: true });
  await page.evaluate(() => fixture.tick());
  assert.equal(await row(page, "a").count(), 1);
  assert.equal(await row(page, "b").count(), 1);
  assert.equal(await row(page, "b").isVisible(), true);
});

test("direct native rows are projected and outside pin controls remain unchanged", async t => {
  const page = await mount(t, { direct: true });
  assert.equal(await row(page).isVisible(), true);
  assert.equal(await page.locator("#outside-pin").isVisible(), true);
});

test("workspace header exposes the host absolute directory path on hover", async t => {
  const page = await mount(t);
  const header = page.locator('[data-row-key="workspace:w"]');
  assert.equal(await header.getAttribute("title"), "/workspace/demo");
  assert.equal(await page.locator(".dsm-pinned-section").count(), 0);
});

test("project header stays below pins without renaming or wrapping native workspaces", async t => {
  const page = await mount(t, { nested: true, pinnedSessionIds: ["a"] });
  const baseline = await page.evaluate(() => fixture.baseline());
  assert.equal(await page.locator(".dsm-project-header").textContent(), "项目会话");
  assert.equal(await page.locator(".fixture_sectionLabel").textContent(), "工作区");
  assert.equal(await page.locator(".dsm-pinned-section + .dsm-project-header + [data-group='w']").count(), 1);
  const sameNodes = await page.evaluate(() => {
    const header = document.querySelector(".dsm-project-header");
    const group = document.querySelector("[data-group='w']");
    for (let i = 0; i < 12; i++) fixture.tick();
    fixture.setPinned([]); fixture.tick();
    fixture.setPinned(["a"]); fixture.tick();
    return header === document.querySelector(".dsm-project-header") && group === document.querySelector("[data-group='w']");
  });
  assert.equal(sameNodes, true);
  assert.equal(await page.locator(".dsm-project-header").count(), 1);
  assert.equal(await page.locator(".fixture_groupSection .dsm-project-header").count(), 0);
  assert.equal(await page.locator(".dsm-pinned-section + .dsm-project-header").count(), 1);
  await page.locator(".dsm-pinned-header").click();
  assert.equal(await page.locator(".dsm-pinned-holder").isVisible(), false);
  assert.equal(await page.locator(".dsm-project-header").isVisible(), true);
  assert.deepEqual(await page.evaluate(() => fixture.baseline()), baseline);
});

test("keeps the top-level workspace label and restores a host label changed by the plugin", async t => {
  const page = await mount(t, { sectionLabel: "会话" });
  assert.equal(await page.locator(".fixture_sectionLabel").textContent(), "工作区");
  await page.evaluate(() => fixture.cleanup());
  assert.equal(await page.locator(".fixture_sectionLabel").textContent(), "会话");
  assert.equal(await page.locator(".dsm-project-header").count(), 0);
});

test("collapses duplicate project headers to one owned section", async t => {
  const page = await mount(t, { pinnedSessionIds: ["a"] });
  await page.locator(".dsm-project-header").evaluate(node => node.parentElement.appendChild(node.cloneNode(true)));
  await page.evaluate(() => fixture.tick());
  assert.equal(await page.locator(".dsm-project-header").count(), 1);
  assert.equal(await page.locator(".dsm-pinned-section + .dsm-project-header + [data-group='w']").count(), 1);
});

test("project header is removed without groups and restored after tree replacement", async t => {
  const page = await mount(t);
  const markup = await page.locator('[role="tree"]').innerHTML();
  await page.locator('[role="tree"]').evaluate(tree => { tree.replaceChildren(); fixture.tick(); });
  assert.equal(await page.locator(".dsm-project-header").count(), 0);
  await page.locator('[role="tree"]').evaluate((tree, html) => {
    const replacement = document.createElement("div");
    replacement.setAttribute("role", "tree");
    replacement.innerHTML = html;
    replacement.querySelectorAll("[data-dsm-owned]").forEach(node => node.remove());
    tree.replaceWith(replacement);
    fixture.tick();
  }, markup);
  assert.equal(await page.locator(".dsm-project-header + [data-group='w']").count(), 1);
  assert.equal(await row(page).isVisible(), true);
});

test("native pagination reveals further pages and collapses without changing host records", async t => {
  const page = await mountPaginated(t, { pinnedSessionIds: ["a"] });
  const baseline = await page.evaluate(() => fixture.baseline());
  const ordinary = page.locator("[data-group='w'] > .dsm-session-holder > .dsm-session-row");
  const more = page.getByRole("button", { name: "展开其余 7 个会话", exact: true });
  assert.equal(await more.isVisible(), true);
  assert.equal(await ordinary.count(), 4);
  await more.click();
  await page.waitForFunction(() => document.querySelectorAll("[data-group='w'] > .dsm-session-holder > .dsm-session-row").length === 9);
  const next = page.getByRole("button", { name: "展开其余 2 个会话", exact: true });
  assert.equal(await next.isVisible(), true);
  await next.focus(); await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll("[data-group='w'] > .dsm-session-holder > .dsm-session-row").length === 11);
  const collapse = page.getByRole("button", { name: "收起", exact: true });
  assert.equal(await collapse.getAttribute("aria-expanded"), "true");
  await collapse.focus(); await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelectorAll("[data-group='w'] > .dsm-session-holder > .dsm-session-row").length === 4);
  assert.equal(await more.isVisible(), true);
  assert.equal(await row(page, "a").count(), 1);
  assert.equal(await page.locator(".dsm-pinned-holder [data-dsm-session-id='a']").count(), 1);
  assert.deepEqual(await page.evaluate(() => fixture.paginationCalls), ["w", "w", "w"]);
  assert.deepEqual(await page.evaluate(() => fixture.calls), []);
  assert.deepEqual(await page.evaluate(() => fixture.baseline()), baseline);
});

test("pagination stays available when a native control shares the last session wrapper", async t => {
  const page = await mountPaginated(t, { sharedTail: true });
  const more = page.getByRole("button", { name: "展开其余 7 个会话", exact: true });
  assert.equal(await more.count(), 1, "the more-sessions entry must not disappear with the hidden native row");
  assert.equal(await more.isVisible(), true);
  await more.click();
  await page.waitForFunction(() => document.querySelectorAll("[data-group='w'] > .dsm-session-holder > .dsm-session-row").length === 10);
  assert.equal(await page.getByRole("button", { name: "展开其余 2 个会话", exact: true }).isVisible(), true);
});

test("pagination remains scoped to nested and ungrouped workspaces", async t => {
  const page = await mountPaginated(t, { nested: true, ungrouped: true, sharedTail: true });
  await page.getByRole("button", { name: "展开其余 2 个会话", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-group='child'] > .dsm-session-holder > .dsm-session-row").length === 7);
  assert.equal(await page.locator("[data-group='w'] > .dsm-session-holder > .dsm-session-row").count(), 5);
  assert.equal(await page.locator("[data-group=''] > .dsm-session-holder > .dsm-session-row").count(), 5);
  await page.getByRole("button", { name: "展开其余 1 个会话", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-group=''] > .dsm-session-holder > .dsm-session-row").length === 6);
  assert.deepEqual(await page.evaluate(() => fixture.paginationCalls), ["child", ""]);
  assert.equal(await row(page, "b").count(), 1);
});

test("pagination follows native control availability and workspace folding", async t => {
  const page = await mountPaginated(t);
  const more = page.getByRole("button", { name: "展开其余 7 个会话", exact: true });
  await page.evaluate(() => { fixture.pagination.w.control.disabled = true; fixture.tick(); });
  assert.equal(await more.isDisabled(), true);
  await page.evaluate(() => { fixture.pagination.w.control.disabled = false; fixture.tick(); });
  assert.equal(await more.isEnabled(), true);
  await page.locator('[data-row-key="workspace:w"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-row-key="overflow:w"]') && !document.querySelector(".dsm-overflow"));
  await page.locator('[data-row-key="workspace:w"]').click();
  await more.waitFor({ state: "visible" });
  await page.evaluate(() => { fixture.pagination.w.control.remove(); fixture.tick(); });
  assert.equal(await more.count(), 0, "do not invent a pager without the host control");
  assert.deepEqual(await page.evaluate(() => fixture.paginationCalls), []);
});

test("pagination cleanup restores native controls and keeps host snapshots unchanged", async t => {
  const page = await mountPaginated(t, { sharedTail: true });
  const baseline = await page.evaluate(() => fixture.baseline());
  await page.evaluate(() => { for (let i = 0; i < 8; i++) fixture.tick(); fixture.cleanup(); });
  assert.equal(await page.locator('[data-dsm-owned]').count(), 0);
  assert.equal(await page.locator('[data-row-key="overflow:w"]').isVisible(), true);
  assert.equal(await page.locator('[data-native="a"] button[aria-label="置顶会话"]').isVisible(), true);
  assert.deepEqual(await page.evaluate(() => fixture.baseline()), baseline);
  await page.getByRole("button", { name: "展开其余 7 个会话", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "展开其余 2 个会话", exact: true }).isVisible(), true);
  assert.deepEqual(await page.evaluate(() => fixture.calls), []);
});

test("host membership projection shows sessions migrated into a workspace even when native rows are stale or partial", async t => {
  const migrated = ["m1", "m2", "m3", "m4", "m5", "m6"];
  const page = await mount(t, {
    sessionIds: ["a", "b"],
    prepare: page => page.evaluate(migrated => {
      const list = fixture.list.getSnapshot();
      const byId = { ...list.byId };
      for (const id of migrated) byId[id] = { id, displayTitle: `Migrated ${id}`, cwd: `/workspace/gk`, updatedAt: Date.now(), retainedBy: {} };
      fixture.list.set({ ...list, ids: [...list.ids, ...migrated], byId });
      fixture.workspaces.set({ ...fixture.workspaces.getSnapshot(), items: [
        { workspaceId: "w", path: "/workspace/w", sessionIds: ["a"] },
        { workspaceId: "gk", path: "/workspace/gk", sessionIds: migrated },
      ] });
      const group = document.createElement("div");
      group.className = "fixture_groupSection"; group.dataset.group = "gk";
      const header = document.createElement("button");
      header.dataset.rowKey = "workspace:gk"; header.setAttribute("aria-expanded", "true"); header.textContent = "gk-workspace";
      group.append(header);
      const stale = document.createElement("div"); stale.className = "nativeWrapper"; stale.dataset.native = "m1";
      const staleRow = document.createElement("div"); staleRow.dataset.rowKey = "session:m1"; staleRow.setAttribute("role", "treeitem"); staleRow.textContent = "Native stale m1";
      stale.append(staleRow); group.append(stale);
      document.querySelector('[role="tree"]').append(group);
    }, migrated),
  });
  await page.waitForFunction(() => document.querySelectorAll("[data-group='gk'] > .dsm-session-holder > .dsm-session-row").length === 6);
  assert.equal(await page.locator("[data-group='gk'] > .dsm-session-holder > .dsm-session-row").count(), migrated.length);
  assert.deepEqual(await page.locator("[data-group='gk'] > .dsm-session-holder > .dsm-session-row").evaluateAll(nodes => nodes.map(node => node.dataset.dsmSessionId)), migrated);
  assert.equal(await page.locator("[data-group='w'] > .dsm-session-holder > .dsm-session-row").count(), 1);
  assert.equal(await page.locator('[data-native="m1"]').isVisible(), false);
});

test("migrated sessions move projection between workspace groups without duplication", async t => {
  const page = await mount(t, { sessionIds: ["a", "b"] });
  await page.evaluate(() => {
    const list = fixture.list.getSnapshot();
    const moved = { ...list.byId.b, displayTitle: "Moved Beta" };
    fixture.list.set({ ...list, byId: { ...list.byId, b: moved } });
    fixture.workspaces.set({ ...fixture.workspaces.getSnapshot(), items: [{ workspaceId: "w", path: "/workspace/w", sessionIds: ["a"] }, { workspaceId: "gk", path: "/workspace/gk", sessionIds: ["b"] }] });
    const group = document.createElement("div"); group.className = "fixture_groupSection"; group.dataset.group = "gk";
    const header = document.createElement("button"); header.dataset.rowKey = "workspace:gk"; header.setAttribute("aria-expanded", "true"); group.append(header);
    document.querySelector('[role="tree"]').append(group);
  });
  await page.waitForFunction(() => document.querySelectorAll("[data-group='gk'] > .dsm-session-holder > .dsm-session-row").length === 1);
  assert.equal(await page.locator("[data-group='w'] > .dsm-session-holder [data-dsm-session-id='b']").count(), 0);
  assert.equal(await page.locator("[data-group='gk'] > .dsm-session-holder [data-dsm-session-id='b']").count(), 1);
  assert.equal(await page.locator("[data-dsm-session-id='b']").count(), 1);
});
test("all-archived native pages conservatively suppress live membership-only rows", async t => {
  // The injected services do not expose WorkspaceBrowser's archivedFilter store;
  // the plugin therefore tests only the observable all-archived DOM heuristic.
  const page = await mount(t, {
    sessionIds: ["a", "b"], archivedSessionIds: ["a"],
    prepare: page => page.evaluate(() => document.querySelector('[data-native="b"]').remove()),
  });
  assert.deepEqual(await page.locator("[data-group='w'] > .dsm-session-holder > .dsm-session-row").evaluateAll(nodes => nodes.map(node => node.dataset.dsmSessionId)), ["a"]);
  assert.equal(await row(page, "b").count(), 0);
});

test("pagination with an all-pinned first page does not leak additional idle members", async t => {
  const page = await mountPaginated(t, { pinnedSessionIds: ["a", "page-1", "page-2", "page-3", "page-4"] });
  assert.equal(await page.locator("[data-group='w'] > .dsm-session-holder > .dsm-session-row").count(), 0);
  assert.equal(await page.locator(".dsm-pinned-holder > .dsm-session-row").count(), 5);
  await page.getByRole("button", { name: "展开其余 7 个会话", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-group='w'] > .dsm-session-holder > .dsm-session-row").length === 5);
});

test("pending workspace snapshots keep active pinned rows out of workspace fallback projection", async t => {
  const page = await mount(t, { sessionIds: ["a", "b"], pinnedSessionIds: ["a"] });
  await page.evaluate(() => {
    const snapshot = fixture.workspaces.getSnapshot();
    fixture.workspaces.set({ ...snapshot, phase: "pending", state: "loading" });
    fixture.tick();
  });
  assert.equal(await page.locator("[data-group='w'] > .dsm-session-holder [data-dsm-session-id='a']").count(), 0);
  assert.equal(await page.locator(".dsm-pinned-holder [data-dsm-session-id='a']").count(), 1);
  assert.equal(await page.locator("[data-group='w'] > .dsm-session-holder [data-dsm-session-id='b']").count(), 1);
});

test("moving a session to an earlier workspace keeps its row through source cleanup", async t => {
  const page = await mount(t, { sessionIds: ["a", "b"] });
  const result = await page.evaluate(() => {
    const tree = document.querySelector('[role="tree"]');
    const source = document.querySelector('[data-group="w"]');
    const destination = document.createElement("div");
    destination.className = "fixture_groupSection"; destination.dataset.group = "gk";
    destination.innerHTML = '<button data-row-key="workspace:gk" aria-expanded="true">gk-workspace</button>';
    tree.insertBefore(destination, source);
    const original = document.querySelector('[data-dsm-session-id="b"]');
    fixture.workspaces.set({ ...fixture.workspaces.getSnapshot(), items: [
      { workspaceId: "gk", path: "/workspace/gk", sessionIds: ["b"] },
      { workspaceId: "w", path: "/workspace/w", sessionIds: ["a"] },
    ] });
    fixture.tick();
    return { same: destination.querySelector('[data-dsm-session-id="b"]') === original, count: document.querySelectorAll('[data-dsm-session-id="b"]').length };
  });
  assert.deepEqual(result, { same: true, count: 1 });
  await row(page, "b").click();
  assert.deepEqual(await page.evaluate(() => fixture.calls), [["openSession", "b"]]);
});

test("collapsed pagination preserves exact native ids, order and pending visibility", async t => {
  const page = await mountPaginated(t);
  await page.evaluate(() => {
    // Pending by itself does not bypass the native idle quota in this DSH ref.
    fixture.setStatus({ "page-11": { pendingInteraction: { kind: "question" } } });
    const content = fixture.pagination.w.content;
    const first = content.querySelector('[data-native="a"]');
    content.insertBefore(content.querySelector('[data-native="page-4"]'), first);
    // A partial native commit is not permission to invent replacement page ids.
    content.querySelector('[data-native="page-3"]').remove();
    fixture.tick();
  });
  assert.deepEqual(await page.locator("[data-group='w'] > .dsm-session-holder > .dsm-session-row").evaluateAll(nodes => nodes.map(node => node.dataset.dsmSessionId)), ["page-4", "a", "page-1", "page-2"]);
  assert.equal(await row(page, "page-11").count(), 0);
  await page.getByRole("button", { name: "展开其余 7 个会话", exact: true }).click();
  await page.getByRole("button", { name: "展开其余 2 个会话", exact: true }).click();
  await row(page, "page-11").waitFor({ state: "visible" });
});

test("empty and all-archived trees defer backfill until a live native view arrives", async t => {
  const page = await mount(t, { sessionIds: ["a", "b"], archivedSessionIds: ["a"], prepare: page => page.evaluate(() => {
    document.querySelectorAll('.nativeWrapper').forEach(node => node.remove());
  }) });
  assert.equal(await page.locator('.dsm-session-row').count(), 0);
  await page.evaluate(html => {
    document.querySelector('[data-group="w"]').insertAdjacentHTML("beforeend", html);
    fixture.tick();
  }, nativeRow("a"));
  assert.equal(await row(page, "b").count(), 0);
  await page.evaluate(html => {
    const third = { id: "c", displayTitle: "Live", cwd: "/workspace/c", updatedAt: Date.now() };
    fixture.list.set({ ...fixture.list.getSnapshot(), byId: { ...fixture.list.getSnapshot().byId, c: third } });
    const ws = fixture.workspaces.getSnapshot();
    fixture.workspaces.set({ ...ws, items: [{ ...ws.items[0], sessionIds: ["a", "b", "c"] }] });
    document.querySelector('[data-group="w"]').insertAdjacentHTML("beforeend", html);
    fixture.tick();
  }, nativeRow("c"));
  assert.equal(await row(page, "b").isVisible(), true);
  assert.equal(await row(page, "a").isVisible(), true);
});

test("backfill respects old cwd, summary availability, blank/subagent exclusions and native order", async t => {
  const page = await mount(t, { sessionIds: ["a", "b", "missing", "blank", "child", "archive"], archivedSessionIds: ["archive"], prepare: page => page.evaluate(() => {
    const list = fixture.list.getSnapshot();
    delete list.byId.missing;
    list.byId.blank.blank = true;
    list.byId.child.origin = "subagent";
    list.byId.b.cwd = "/old-workspace/b";
    document.querySelectorAll('.nativeWrapper').forEach(node => { if (node.dataset.native !== "a") node.remove(); });
  }) });
  assert.deepEqual(await page.locator('.dsm-session-row').evaluateAll(nodes => nodes.map(node => node.dataset.dsmSessionId)), ["a", "b"]);
  await page.evaluate(html => {
    document.querySelector('[data-group="w"]').insertAdjacentHTML("afterbegin", html);
    fixture.tick();
  }, nativeRow("b"));
  assert.deepEqual(await page.locator('.dsm-session-row').evaluateAll(nodes => nodes.map(node => node.dataset.dsmSessionId)), ["b", "a"]);
  await page.evaluate(() => {
    const list = fixture.list.getSnapshot();
    fixture.list.set({ ...list, byId: { ...list.byId, missing: { id: "missing", displayTitle: "Late summary", updatedAt: Date.now() } } });
    fixture.tick();
  });
  assert.equal(await row(page, "missing").isVisible(), true);
});

test("late native overflow inside an already hidden wrapper is restored with its action", async t => {
  const page = await mount(t);
  await page.evaluate(() => {
    const wrapper = document.querySelector('[data-native="a"]');
    const more = document.createElement("button");
    more.dataset.rowKey = "overflow:w"; more.textContent = "展开其余 1 个会话";
    more.setAttribute("aria-expanded", "false");
    fixture.moreClicks = 0;
    more.addEventListener("click", () => { fixture.moreClicks++; });
    wrapper.append(more);
    fixture.tick();
  });
  await page.getByRole("button", { name: "展开其余 1 个会话", exact: true }).click();
  assert.equal(await page.evaluate(() => fixture.moreClicks), 1);
  assert.equal(await page.locator('[data-row-key="session:a"]').isVisible(), false);
  await page.evaluate(() => fixture.cleanup());
  assert.equal(await page.locator('.dsm-native-hidden').count(), 0);
});

test("single-line titles yield to a fixed right-aligned time column at narrow and wide widths", async t => {
  const page = await mount(t, {
    sessionIds: ["a", "b", "c"], pinnedSessionIds: ["a"],
    titles: { a: "很长的会话标题".repeat(20), b: "LongUnbrokenSessionTitle".repeat(10), c: "Short" },
    statuses: { a: { completionUnread: true }, b: { running: true } },
  });
  const geometry = () => page.locator(".dsm-session-row").evaluateAll(nodes => nodes.map(node => {
    const title = node.querySelector(".dsm-title");
    const time = node.querySelector(".dsm-time");
    const more = node.querySelector(".dsm-more");
    const r = node.getBoundingClientRect(), t = title.getBoundingClientRect(), d = time.getBoundingClientRect(), m = more.getBoundingClientRect();
    return {
      id: node.dataset.dsmSessionId, rowWidth: r.width, rowHeight: r.height, rowRight: r.right,
      titleLeft: t.left, titleRight: t.right, titleWidth: t.width, clipped: title.scrollWidth > title.clientWidth,
      titleAlign: getComputedStyle(title).textAlign, whiteSpace: getComputedStyle(title).whiteSpace,
      overflow: getComputedStyle(title).overflow, ellipsis: getComputedStyle(title).textOverflow,
      timeRight: d.right, timeLeft: d.left, timeWidth: d.width, timeAlign: getComputedStyle(time).textAlign,
      timeFits: time.scrollWidth <= time.clientWidth + 1, moreWidth: m.width, moreRight: m.right,
    };
  }));
  for (const width of [240, 320, 500]) {
    await page.locator('[data-slot="sidebar.workspaces"]').evaluate((node, width) => { node.style.width = `${width}px`; }, width);
    const before = await geometry();
    for (const item of before) {
      assert.equal(item.rowWidth, width);
      assert.equal(item.rowHeight, 32);
      assert.equal(item.titleAlign, "left");
      assert.equal(item.whiteSpace, "nowrap");
      assert.equal(item.overflow, "hidden");
      assert.equal(item.ellipsis, "ellipsis");
      assert.equal(item.timeAlign, "right");
      assert.ok(Math.abs(item.timeWidth - 49.5) < 1);
      assert.ok(Math.abs(item.timeRight - before[0].timeRight) < 1);
      assert.ok(Math.abs(item.titleLeft - before[0].titleLeft) < 1);
      assert.ok(item.titleWidth > 0 && item.titleRight < item.timeLeft);
      assert.ok(item.timeFits && item.moreRight <= item.rowRight);
      assert.equal(item.moreWidth, 24);
      if (item.id !== "c") assert.equal(item.clipped, true);
    }
    await row(page, "a").hover();
    assert.deepEqual(await geometry(), before, "showing the menu button must not shift title or time");
  }
  const rightBefore = (await geometry())[0].timeRight;
  await page.evaluate(() => { fixture.setPinned([]); fixture.setStatus({}); fixture.tick(); });
  assert.ok((await geometry()).every(item => Math.abs(item.timeRight - rightBefore) < 1));
  const title = row(page, "a").locator(".dsm-title");
  assert.equal(await title.getAttribute("title"), await title.textContent());
  assert.ok((await row(page, "a").getAttribute("aria-label")).startsWith(await title.textContent()));
});

test("relative time covers minute hour day week month year boundaries and invalid input", async t => {
  const page = await mount(t);
  await page.clock.setFixedTime(new Date("2026-10-06T12:00:00Z"));
  const cases = [
    [0, "刚刚"], [1, "1 分钟"], [59, "59 分钟"], [60, "1 小时"], [1439, "23 小时"],
    [1440, "1 天"], [10079, "6 天"], [10080, "1 周"], [14 * 1440, "2 周"],
    [29 * 1440, "4 周"], [30 * 1440, "1 月"], [90 * 1440, "3 月"],
    [364 * 1440, "12 月"], [365 * 1440, "1 年"], [730 * 1440, "2 年"],
  ];
  const labels = await page.evaluate(cases => {
    const show = value => {
      const list = fixture.list.getSnapshot();
      fixture.list.set({ ...list, byId: { ...list.byId, a: { ...list.byId.a, updatedAt: value } } });
      fixture.tick();
      return document.querySelector(".dsm-time").textContent;
    };
    return [
      ...cases.map(([minutes]) => show(Date.now() - minutes * 60000)),
      ...[undefined, null, 0, -1, "invalid", Infinity].map(show),
      show(Date.now() + 60000),
    ];
  }, cases);
  assert.deepEqual(labels, [...cases.map(([, text]) => text), "", "", "", "", "", "", "刚刚"]);
});

test("pointerdown inside menu allows its click to invoke pin service", async t => {
  const page = await mount(t);
  await openMenu(page);
  await page.getByRole("menuitem", { name: "固定会话", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => fixture.calls), [["pinSession", "a"]]);
});

test("pinned sessions move to a dedicated section and unpin restores workspace membership", async t => {
  const page = await mount(t, { sessionIds: ["a", "b"], pinnedSessionIds: ["b"] });
  assert.equal(await page.locator(".dsm-pinned-section").count(), 1);
  assert.equal(await page.locator(".dsm-pinned-count").textContent(), "1");
  assert.equal(await page.locator(".dsm-pinned-holder [data-dsm-session-id='b']").count(), 1);
  assert.equal(await page.locator(".dsm-session-holder [data-dsm-session-id='b']").count(), 0);
  assert.equal(await page.locator(".dsm-session-holder [data-dsm-session-id='a']").count(), 1);
  await page.evaluate(() => fixture.setPinned([]));
  await settle(page);
  assert.equal(await page.locator(".dsm-pinned-section").count(), 0);
  assert.equal(await page.locator(".dsm-session-holder [data-dsm-session-id='b']").count(), 1);
  assert.equal(await page.locator(".dsm-session-holder [data-dsm-session-id='b']").isVisible(), true);
});

test("pinned section follows host order and remains visible when workspace is collapsed", async t => {
  const page = await mount(t, { sessionIds: ["a", "b"], pinnedSessionIds: ["b", "a"], expanded: false });
  assert.deepEqual(await page.locator(".dsm-pinned-holder [data-dsm-session-id]").evaluateAll(nodes => nodes.map(node => node.dataset.dsmSessionId)), ["b", "a"]);
  assert.equal(await page.locator(".dsm-pinned-holder").isVisible(), true);
  assert.equal(await page.locator(".dsm-session-holder").isVisible(), false);
});

test("running, pending interaction, and completion unread have distinct precedence and markers", async t => {
  const page = await mount(t, {
    sessionIds: ["a", "b"],
    statuses: {
      a: { running: true, pendingInteraction: { kind: "question" }, completionUnread: true },
      b: { running: false, completionUnread: true },
    },
  });
  assert.equal(await row(page, "a").getAttribute("data-dsm-status"), "pending");
  assert.equal(await row(page, "a").locator(".dsm-dot-pending").count(), 1);
  assert.equal(await row(page, "b").getAttribute("data-dsm-status"), "done");
  assert.equal(await row(page, "b").locator(".dsm-unread-mark").isVisible(), true);
  const identity = await page.evaluate(() => {
    const target = document.querySelector('[data-dsm-session-id="b"]');
    const button = target.querySelector(".dsm-more");
    button.focus();
    fixture.setStatus({ a: { running: true }, b: { running: true, completionUnread: false } });
    fixture.tick();
    return { same: document.querySelector('[data-dsm-session-id="b"]') === target, focused: document.activeElement === button, status: target.dataset.dsmStatus };
  });
  assert.deepEqual(identity, { same: true, focused: true, status: "running" });
});

test("copy working directory uses the host summary without writing host state", async t => {
  const page = await mount(t);
  await openMenu(page);
  assert.equal(await page.getByRole("menuitem", { name: "复制工作目录", exact: true }).count(), 1);
});

test("missing uiSession fails open and leaves native UI untouched", async t => {
  const page = await mount(t, { withUiSession: false });
  assert.equal(await row(page).count(), 0);
  assert.equal(await page.locator('[data-native="a"]').isVisible(), true);
  assert.equal(await page.locator('style[data-dsm-css]').count(), 0);
});

test("cleanup restores native display and removes plugin DOM and subscriptions", async t => {
  const page = await mount(t, { sessionIds: ["a", "b"], pinnedSessionIds: ["b"] });
  const baseline = await page.evaluate(() => fixture.baseline());
  await page.evaluate(() => fixture.cleanup());
  assert.equal(await page.locator('[data-dsm-owned]').count(), 0);
  assert.equal(await page.locator('[data-native="a"] button[aria-label="置顶会话"]').isVisible(), true);
  assert.equal(await page.locator('[data-native="b"] button[aria-label="置顶会话"]').isVisible(), true);
  assert.equal(await page.locator('.fixture_sectionLabel').textContent(), "工作区");
  assert.equal(await row(page, "a").count(), 0);
  assert.equal(await row(page, "b").count(), 0);
  assert.equal(await page.locator('[data-native="a"]').isVisible(), true);
     assert.equal(await page.locator('[data-native="b"]').isVisible(), true);
   assert.equal(await page.locator('[data-row-key="workspace:w"]').getAttribute("title"), null);
  assert.equal(await page.locator('style[data-dsm-css]').count(), 0);
  assert.deepEqual(await page.evaluate(() => [fixture.intervals.size, fixture.list.listeners.size, fixture.workspaces.listeners.size, fixture.status.listeners.size]), [0, 0, 0, 0]);
  assert.deepEqual(await page.evaluate(() => fixture.baseline()), baseline);
  await page.evaluate(() => fixture.tick());
  assert.equal(await row(page).count(), 0);
});
