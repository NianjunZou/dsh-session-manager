/*!
 * dsh-session-manager — Codex-style left session manager for DSH.
 * A reversible, left-workspace UI overlay: it projects host state and calls host
 * services only, and never becomes a second source of truth for DSH session data.
 * Scope: the left workspace session area only. See PLUGIN-CONTRACT.md. License: MIT.
 */
window.__ModuleLoader__.load({
  id: "@pianner/dsh-session-manager",
  factory: () => {
    const inject = ["sessions", "workspaces", "timer", "uiWorkspace", "uiSession"];
    const SLOT = '[data-slot="sidebar.workspaces"]';
    const GROUP = '[class*="groupSection"]';
    const NATIVE_ROW = '[data-row-key^="session:"]';
    const NATIVE_OVERFLOW = '[data-row-key^="overflow:"]';
    const OWNED = '[data-dsm-owned]';
    // Single table for every user-facing literal. Values are byte-identical to
    // the inlined literals they replace, so the rendered UI does not change.
    const STRINGS = {
      workspaceSectionNative: "会话",
      workspaceSectionLabel: "工作区",
      projectSessions: "项目会话",
      pinnedSectionTitle: "置顶会话",
      statusAwaitingApproval: "等待批准",
      statusAwaitingPlanReview: "等待计划确认",
      statusAwaitingAnswer: "等待回答",
      statusRunning: "正在执行",
      statusDoneUnread: "已完成，未读",
      statusIdle: "空闲",
      unreadMark: "未读",
      pinnedTitle: "已固定",
      actionPin: "固定会话",
      actionUnpin: "取消固定",
      actionRename: "重命名",
      actionFork: "分叉会话",
      actionArchive: "归档会话",
      actionUnarchive: "取消归档",
      actionCopySessionId: "复制 Session ID",
      actionCopyWorkingDirectory: "复制工作目录",
      moreLabel: "会话操作",
      moreGlyph: "⋯",
      sectionChevron: "▾",
      rowAriaSeparator: "，",
      dialogRenameTitle: "重命名会话",
      dialogNameLabel: "会话名称",
      dialogCancel: "取消",
      dialogSave: "保存",
      dialogClose: "关闭",
      noticeSessionActive: "会话仍在运行，请先停止活动再归档。",
      noticeActionFailed: "会话操作失败：",
      errorServiceMissing: "宿主未提供 ",
      errorClipboardWrite: "无法写入剪贴板",
      errorRenameServiceMissing: "宿主未提供会话重命名服务",
      errorRenameFailed: "重命名失败",
      errorWorkingDirectoryMissing: "宿主未提供会话工作目录",
      timeJustNow: "刚刚",
      timeMinutes: " 分钟",
      timeHours: " 小时",
      timeDays: " 天",
      timeWeeks: " 周",
      timeMonths: " 月",
      timeYears: " 年",
      nativePinLabels: ["置顶会话", "取消置顶", "Pin", "Unpin", "Pin session", "Unpin session"],
    };
    const PIN_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 17v5M8 2h8v4h-1v5l4 4v2H5v-2l4-4V6H8z"/></svg>';
    const css = `
      .dsm-session-holder{display:flex;flex-direction:column;min-width:0}
      .dsm-pinned-section{display:flex;flex-direction:column;min-width:0;margin-bottom:8px}
      .dsm-project-header{display:flex;align-items:center;box-sizing:border-box;min-height:32px;margin:0 0 4px;padding:0 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.22));color:var(--dsw-alias-label-secondary,inherit);font-size:13px;font-weight:600;line-height:18px}
       .dsm-pinned-header{display:flex;align-items:center;gap:6px;min-height:32px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;text-align:left;cursor:pointer}
       .dsm-pinned-header:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
       .dsm-pinned-label{min-width:0;flex:1;font-size:13px;font-weight:600}.dsm-pinned-count{color:var(--dsw-alias-label-tertiary,#888);font-size:12px}
       .dsm-pinned-chevron{font-size:12px;transition:transform .12s ease}.dsm-pinned-header[aria-expanded="false"] .dsm-pinned-chevron{transform:rotate(-90deg)}
       .dsm-pinned-holder{display:flex;flex-direction:column;min-width:0}.dsm-pinned-holder[hidden]{display:none}
      .dsm-session-row{display:flex;align-items:center;gap:6px;box-sizing:border-box;min-width:0;width:100%;min-height:32px;padding:0 8px 0 calc(8px + var(--dsh-workspace-indent,0px));border-radius:8px;color:var(--dsw-alias-label-primary,inherit);cursor:pointer}
      .dsm-session-holder>.dsm-session-row{padding-left:calc(8px + var(--dsh-workspace-indent,0px) + var(--dsm-workspace-indent,14px))}
       .dsm-session-row:hover,.dsm-current{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
      .dsm-title{display:block;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
      .dsm-archived{opacity:.6}.dsm-dot{width:7px;height:7px;border-radius:50%;background:transparent;box-shadow:none;flex:none}
      .dsm-dot-running{background:var(--dsw-alias-blue,#5b9cff)}.dsm-dot-pending{background:var(--dsw-alias-orange,#e0a33b)}.dsm-dot-done{background:var(--dsw-alias-green,#59b37b)}
       .dsm-status-label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
       .dsm-unread .dsm-title{font-weight:700}.dsm-unread .dsm-dot{box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-green,#59b37b) 22%,transparent)}
      .dsm-unread-mark{display:inline-flex;flex:none;white-space:nowrap;align-items:center;padding:1px 4px;border-radius:4px;color:var(--dsw-alias-green,#59b37b);font-size:10px;font-weight:600}.dsm-unread-mark[hidden]{display:none}
      .dsm-time{display:block;flex:0 0 4.5em;width:4.5em;white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#888);font-size:11px}.dsm-pin{display:inline-flex;flex:none}.dsm-pin[hidden]{display:none}
      .dsm-more{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:24px;min-height:24px;height:24px;opacity:0;pointer-events:none;flex:0 0 24px;border:0;background:transparent;color:inherit;border-radius:5px;padding:0;cursor:pointer}
      .dsm-session-row:hover .dsm-more,.dsm-session-row:focus-within .dsm-more{opacity:1;pointer-events:auto}
      .dsm-session-row:focus-visible,.dsm-more:focus-visible{outline:2px solid var(--dsw-alias-focus-ring,#6aa7ff);outline-offset:-2px}
      .dsm-native-hidden{display:none!important}
      .dsm-menu{position:fixed;z-index:2147483647;min-width:180px;padding:4px;color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-2,#292929);border:1px solid var(--dsw-alias-border-l1,#666);border-radius:10px;box-shadow:0 10px 30px #0003;font-family:inherit;font-size:13px;line-height:18px}
      .dsm-menu-item{display:flex;width:100%;box-sizing:border-box;min-height:30px;align-items:center;border:0;background:transparent;color:inherit;font:inherit;line-height:18px;text-align:left;padding:6px 10px;border-radius:6px;cursor:pointer}
      .dsm-menu-item:hover,.dsm-menu-item:focus-visible{background:var(--dsw-alias-interactive-bg-hover,#ffffff18);outline:none}
      .dsm-dialog{color:var(--dsw-alias-label-primary,#eee);background:var(--dsw-alias-bg-layer-2,#292929);border:1px solid #777;border-radius:12px;padding:20px;width:min(380px,80vw)}
      .dsm-dialog::backdrop{background:#0006}.dsm-dialog form{display:grid;gap:12px}.dsm-dialog input{box-sizing:border-box;width:100%;font:inherit;padding:8px;color:inherit;background:transparent;border:1px solid #888;border-radius:6px}
      .dsm-dialog-actions{display:flex;justify-content:flex-end;gap:8px}.dsm-dialog-actions button{font:inherit;padding:6px 14px;cursor:pointer}
      .dsm-notice{margin:8px;padding:8px;font-size:12px;border:1px solid #e49b48;border-radius:6px;color:var(--dsw-alias-label-primary,inherit)}
    `;
    const state = {
      disposed: false, rendering: false, renderQueued: false, renderTimer: null,
      observer: null, timer: null, subscriptions: [], style: null,
      hidden: new Map(), holders: new Set(), hiddenPins: new Map(), rows: new Map(), pinnedSection: null, pinnedExpanded: true, workspaceTitles: new Map(), projectHeader: null, nativeSectionLabel: null,
      menu: null, menuAnchor: null,
      menuSession: null, menuPointerDown: null, menuKeydown: null, dialog: null, notice: null,
    };
    let sessions, workspaces, uiWorkspace, uiSession;
    const observation = { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-expanded", "aria-selected", "data-row-key"] };

    function owned(tag, className) {
      const node = document.createElement(tag);
      node.dataset.dsmOwned = "1";
      node.className = className;
      return node;
    }
    function snapshot(store) { return store?.getSnapshot?.() ?? store?.get?.(); }
    function sessionSnapshot() { return snapshot(sessions?.list); }
    function workspaceSnapshot() { return snapshot(workspaces?.list); }
    function statusSnapshot() { return snapshot(uiSession?.sessionStatus) || new Map(); }
    function statusOf(id, summary) {
      const status = statusSnapshot().get(id) || {};
      const pending = typeof status.pendingInteraction === "string" ? status.pendingInteraction : status.pendingInteraction?.kind;
      return {
        running: status.running === true || status.running === undefined && summary?.running === true,
        pending,
        unread: status.completionUnread === true,
      };
    }
    function statusLabel(status) {
      if (status.pending === "approval") return STRINGS.statusAwaitingApproval;
      if (status.pending === "plan-review") return STRINGS.statusAwaitingPlanReview;
      if (status.pending === "question") return STRINGS.statusAwaitingAnswer;
      if (status.running) return STRINGS.statusRunning;
      if (status.unread) return STRINGS.statusDoneUnread;
      return STRINGS.statusIdle;
    }
    function currentId() {
      const selection = snapshot(uiWorkspace?.selection);
      if (selection && "sessionId" in selection) return selection.sessionId;
      return Object.values(sessionSnapshot()?.byId || {}).find(s => (s.retainedBy?.mainView || 0) > 0)?.id;
    }
    function titleOf(summary, id) { return String(summary?.displayTitle || summary?.title || id); }
    function isArchived(id) { return (workspaceSnapshot()?.archivedSessionIds || []).includes(id); }
    function isPinned(id) { return (workspaceSnapshot()?.pinnedSessionIds || []).includes(id); }
    function workspacePath(id) {
      const workspace = (workspaceSnapshot()?.items || []).find(item => String(item.workspaceId) === String(id));
      const path = workspace?.path ?? workspace?.cwd;
      return typeof path === "string" && path.length > 0 ? path : null;
    }
    function restoreWorkspaceTitle(header) {
      const previous = state.workspaceTitles.get(header);
      if (!previous) return;
      if (previous.had) header.setAttribute("title", previous.value);
      else header.removeAttribute("title");
      state.workspaceTitles.delete(header);
    }
    function decorateWorkspacePaths(tree) {
      for (const section of tree.querySelectorAll(GROUP)) {
        const header = ownNodes(section, '[data-row-key^="workspace:"]')[0];
        if (!header) continue;
        const key = String(header.getAttribute("data-row-key") || "").slice("workspace:".length);
        const path = workspacePath(key);
        if (!path) { restoreWorkspaceTitle(header); continue; }
        if (!state.workspaceTitles.has(header)) state.workspaceTitles.set(header, { had: header.hasAttribute("title"), value: header.getAttribute("title") || "" });
        if (header.getAttribute("title") !== path) header.setAttribute("title", path);
      }
    }
    function normalizeWorkspaceSectionLabel() {
      const slot = document.querySelector(SLOT);
      const label = [...(slot?.querySelectorAll('[class*="sectionLabel"], [data-section-label]') || [])]
        .find(node => String(node.textContent || "").trim() === STRINGS.workspaceSectionNative);
      if (!label) return;
      if (!state.nativeSectionLabel || state.nativeSectionLabel.node !== label) {
        state.nativeSectionLabel = { node: label, html: label.innerHTML, pluginHtml: STRINGS.workspaceSectionLabel };
      }
      if (String(label.textContent || "").trim() !== STRINGS.workspaceSectionLabel) label.textContent = STRINGS.workspaceSectionLabel;
    }
    function restoreWorkspaceSectionLabel() {
      const previous = state.nativeSectionLabel;
      if (!previous) return;
      if (previous.node.isConnected && previous.node.innerHTML === previous.pluginHtml) previous.node.innerHTML = previous.html;
      state.nativeSectionLabel = null;
    }
    function renderProjectHeader(tree) {
      const firstGroup = tree?.querySelector(`:scope > ${GROUP}`);
      const existing = tree ? [...tree.children].filter(node => node.matches(".dsm-project-header[data-dsm-owned]")) : [];
      if (!firstGroup) {
        for (const node of existing) node.remove();
        if (state.projectHeader?.parentElement) state.projectHeader.remove();
        state.projectHeader = null;
        return;
      }
      let header = state.projectHeader?.parentElement === tree ? state.projectHeader : existing.shift();
      if (state.projectHeader && state.projectHeader !== header && state.projectHeader.isConnected) state.projectHeader.remove();
      for (const duplicate of existing) duplicate.remove();
      if (!header) {
        header = owned("div", "dsm-project-header");
        header.setAttribute("role", "heading");
        header.setAttribute("aria-level", "2");
        header.textContent = STRINGS.projectSessions;
      }
      state.projectHeader = header;
      if (header.parentElement !== tree || header.nextElementSibling !== firstGroup) tree.insertBefore(header, firstGroup);
    }
    function activePinnedIds(byId) {
      const archived = new Set(workspaceSnapshot()?.archivedSessionIds || []);
      const seen = new Set();
      return (workspaceSnapshot()?.pinnedSessionIds || []).filter(id => {
        if (seen.has(id) || !byId[id] || archived.has(id)) return false;
        seen.add(id); return true;
      });
    }
    function ownNodes(section, selector) {
      return [...section.querySelectorAll(selector)].filter(node => !node.closest(OWNED) && node.closest(GROUP) === section);
    }
    function nativeEntries(section) {
      return ownNodes(section, NATIVE_ROW).map(row => {
        let wrapper = row;
        while (wrapper.parentElement && wrapper.parentElement !== section) {
          const parent = wrapper.parentElement;
          // A wrapper may contain one session AND the native more/collapse control.
          // Only hide session-only wrappers; the host keeps pagination and its click state.
          if (parent.matches(GROUP) || parent.closest(OWNED) || parent.querySelector('[data-row-key^="workspace:"]') || parent.querySelector(NATIVE_OVERFLOW) || parent.querySelectorAll(NATIVE_ROW).length > 1) break;
          wrapper = parent;
        }
        return { id: row.getAttribute("data-row-key").slice("session:".length), row, wrapper };
      });
    }
    function hideNative(wrapper) {
      if (!state.hidden.has(wrapper)) state.hidden.set(wrapper, { display: wrapper.style.getPropertyValue("display"), priority: wrapper.style.getPropertyPriority("display") });
      wrapper.classList.add("dsm-native-hidden");
    }
    function restoreNative(wrapper) {
      const previous = state.hidden.get(wrapper);
      if (!previous) return;
      wrapper.classList.remove("dsm-native-hidden");
      if (previous.display) wrapper.style.setProperty("display", previous.display, previous.priority);
      else wrapper.style.removeProperty("display");
      state.hidden.delete(wrapper);
    }
    function hideNativePinButtons() {
      const slot = document.querySelector(SLOT);
      if (!slot) return;
      for (const button of slot.querySelectorAll("button[aria-label]")) {
        if (button.closest(OWNED)) continue;
        const label = String(button.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
        if (!STRINGS.nativePinLabels.includes(label)) continue;
        if (!state.hiddenPins.has(button)) state.hiddenPins.set(button, { display: button.style.getPropertyValue("display"), priority: button.style.getPropertyPriority("display") });
        button.classList.add("dsm-native-hidden");
      }
    }
    function restoreNativePinButtons() {
      for (const [button, previous] of state.hiddenPins) {
        if (!button.isConnected) continue;
        button.classList.remove("dsm-native-hidden");
        if (previous.display) button.style.setProperty("display", previous.display, previous.priority);
        else button.style.removeProperty("display");
      }
      state.hiddenPins.clear();
    }
    function reportError(error) {
      if (state.disposed) return;
      console.warn("[dsh-session-manager] action failed", error);
      state.notice?.remove();
      const notice = owned("div", "dsm-notice");
      notice.setAttribute("role", "alert");
      const active = error?.rpcError?.code === "workspace/session-active";
      notice.textContent = active ? STRINGS.noticeSessionActive : `${STRINGS.noticeActionFailed}${error?.message || String(error)}`;
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.textContent = STRINGS.dialogClose;
      dismiss.addEventListener("click", () => { notice.remove(); if (state.notice === notice) state.notice = null; });
      notice.appendChild(dismiss);
      (document.querySelector(SLOT) || document.body).appendChild(notice);
      state.notice = notice;
    }
    async function call(task) {
      try { await task(); return true; }
      catch (error) { reportError(error); return false; }
    }
    async function service(name, ...args) {
      if (typeof uiWorkspace?.[name] !== "function") throw new Error(`${STRINGS.errorServiceMissing}${name}`);
      const result = await uiWorkspace[name](...args);
      if (result?.ok === false) throw new Error(result.error?.message || `${name} failed`);
      return result;
    }
    async function copyText(text) {
      if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(text); return; } catch { /* fall back without reading clipboard */ }
      }
      const area = owned("textarea", "dsm-copy");
      area.value = text;
      area.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(area);
      area.select();
      try { if (!document.execCommand("copy")) throw new Error(STRINGS.errorClipboardWrite); }
      finally { area.remove(); }
    }
    function closeDialog() { state.dialog?.remove(); state.dialog = null; }
    function requestRename(id) {
      closeDialog();
      const dialog = owned("dialog", "dsm-dialog");
      dialog.setAttribute("aria-label", STRINGS.dialogRenameTitle);
      const form = document.createElement("form");
      const label = document.createElement("label");
      label.textContent = STRINGS.dialogNameLabel;
      const input = document.createElement("input");
      input.value = titleOf(sessionSnapshot()?.byId?.[id], id);
      input.required = true;
      label.appendChild(input);
      const actions = document.createElement("div");
      actions.className = "dsm-dialog-actions";
      const cancel = document.createElement("button");
      cancel.type = "button"; cancel.textContent = STRINGS.dialogCancel;
      cancel.addEventListener("click", closeDialog);
      const save = document.createElement("button");
      save.type = "submit"; save.textContent = STRINGS.dialogSave;
      actions.append(cancel, save);
      form.append(label, actions);
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const title = input.value.trim();
        if (!title || save.disabled) return;
        save.disabled = true;
        const ok = await call(async () => {
          if (typeof sessions?.using !== "function") throw new Error(STRINGS.errorRenameServiceMissing);
          const result = await sessions.using(id, { source: "workspaceOperation" }, reference => reference.binding.session.rename(title));
          if (result?.ok === false) throw new Error(result.error?.message || STRINGS.errorRenameFailed);
        });
        if (ok && state.dialog === dialog) closeDialog();
        save.disabled = false;
      });
      dialog.addEventListener("cancel", event => { event.preventDefault(); closeDialog(); });
      dialog.appendChild(form);
      document.body.appendChild(dialog);
      state.dialog = dialog;
      dialog.showModal();
      input.select();
    }
    function runAction(id, kind) {
      if (kind === "rename") { requestRename(id); return; }
      void call(async () => {
        if (kind === "copy") { await copyText(id); return; }
        if (kind === "copyCwd") {
          const cwd = sessionSnapshot()?.byId?.[id]?.cwd;
          if (!cwd) throw new Error(STRINGS.errorWorkingDirectoryMissing);
          await copyText(cwd); return;
        }
        const methods = { pin: "pinSession", unpin: "unpinSession", fork: "forkSession", archive: "archiveSession", unarchive: "unarchiveSession" };
        await service(methods[kind], id);
      });
    }
    function closeMenu(focus = false) {
      if (state.menuPointerDown) document.removeEventListener("pointerdown", state.menuPointerDown, true);
      if (state.menuKeydown) document.removeEventListener("keydown", state.menuKeydown, true);
      const anchor = state.menuAnchor;
      state.menu?.remove();
      state.menu = state.menuAnchor = state.menuSession = state.menuPointerDown = state.menuKeydown = null;
      if (focus && anchor?.isConnected) anchor.focus();
    }
    function menuFor(id, anchor) {
      closeMenu();
      const menu = owned("div", "dsm-menu");
      menu.setAttribute("role", "menu");
      state.menu = menu; state.menuAnchor = anchor; state.menuSession = id;
      const items = [
        [isPinned(id) ? STRINGS.actionUnpin : STRINGS.actionPin, isPinned(id) ? "unpin" : "pin"],
        [STRINGS.actionRename, "rename"], [STRINGS.actionFork, "fork"],
        [isArchived(id) ? STRINGS.actionUnarchive : STRINGS.actionArchive, isArchived(id) ? "unarchive" : "archive"],
        [STRINGS.actionCopySessionId, "copy"],
         ...(sessionSnapshot()?.byId?.[id]?.cwd ? [[STRINGS.actionCopyWorkingDirectory, "copyCwd"]] : []),
      ];
      for (const [label, kind] of items) {
        const button = document.createElement("button");
        button.type = "button"; button.className = "dsm-menu-item";
        button.setAttribute("role", "menuitem"); button.textContent = label;
        button.addEventListener("click", event => { event.stopPropagation(); closeMenu(true); runAction(id, kind); });
        menu.appendChild(button);
      }
      document.body.appendChild(menu);
      const rect = anchor.getBoundingClientRect();
      const size = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(window.innerWidth - size.width - 8, rect.right - size.width))}px`;
      menu.style.top = `${Math.max(8, Math.min(window.innerHeight - size.height - 8, rect.bottom + 4))}px`;
      state.menuPointerDown = event => { if (!menu.contains(event.target) && !anchor.contains(event.target)) closeMenu(); };
      state.menuKeydown = event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(true); return; }
        if (event.key === "Tab") { closeMenu(true); return; }
        const buttons = [...menu.querySelectorAll("button")];
        const index = buttons.indexOf(document.activeElement);
        const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); event.stopPropagation(); buttons[next].focus(); }
      };
      document.addEventListener("pointerdown", state.menuPointerDown, true);
      document.addEventListener("keydown", state.menuKeydown, true);
      menu.firstElementChild.focus();
    }
    function relativeTime(ts) {
      if (!Number.isFinite(ts) || ts <= 0) return "";
      const minutes = Math.max(0, Math.floor((Date.now() - ts) / 60000));
      if (minutes < 1) return STRINGS.timeJustNow;
      if (minutes < 60) return `${minutes}${STRINGS.timeMinutes}`;
      if (minutes < 1440) return `${Math.floor(minutes / 60)}${STRINGS.timeHours}`;
      const days = Math.floor(minutes / 1440);
      if (days < 7) return `${days}${STRINGS.timeDays}`;
      if (days < 30) return `${Math.floor(days / 7)}${STRINGS.timeWeeks}`;
      if (days < 365) return `${Math.floor(days / 30)}${STRINGS.timeMonths}`;
      return `${Math.floor(days / 365)}${STRINGS.timeYears}`;
    }
    function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
    function makeRow(id) {
      const row = owned("div", "dsm-session-row");
      // Deliberately do not reuse data-row-key: it belongs to the native tree.
      row.dataset.dsmSessionId = id;
      state.rows.set(id, row);
      row.setAttribute("role", "treeitem"); row.tabIndex = 0;
      for (const name of ["dot", "title", "unread", "pin", "time"]) {
        const span = document.createElement("span"); span.className = `dsm-${name}`;
        if (name === "pin") span.innerHTML = PIN_SVG;
        if (name === "unread") { span.textContent = STRINGS.unreadMark; span.className = "dsm-unread-mark"; span.hidden = true; }
        if (name === "dot") span.setAttribute("aria-hidden", "true");
        row.appendChild(span);
      }
      const status = document.createElement("span");
      status.className = "dsm-status-label";
      row.appendChild(status);
      const more = document.createElement("button");
      more.type = "button"; more.className = "dsm-more"; more.textContent = STRINGS.moreGlyph;
      more.setAttribute("aria-label", STRINGS.moreLabel); more.setAttribute("aria-haspopup", "menu");
      more.addEventListener("click", event => { event.stopPropagation(); menuFor(id, more); });
      row.appendChild(more);
      row.addEventListener("click", event => { event.stopPropagation(); void call(() => service("openSession", id)); });
      row.addEventListener("keydown", event => {
        if (event.target !== row) return;
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); void call(() => service("openSession", id)); }
      });
      return row;
    }
    function updateRow(row, id, summary) {
      const current = id === currentId();
      const status = statusOf(id, summary);
      const primary = status.pending ? "pending" : status.running ? "running" : status.unread ? "done" : "idle";
      row.classList.toggle("dsm-current", current); row.classList.toggle("dsm-archived", isArchived(id)); row.classList.toggle("dsm-unread", status.unread);
      row.dataset.dsmStatus = primary;
      row.setAttribute("aria-selected", String(current));
      row.setAttribute("aria-label", `${titleOf(summary, id)}${STRINGS.rowAriaSeparator}${statusLabel(status)}`);
      const title = row.querySelector(".dsm-title");
      const fullTitle = titleOf(summary, id);
      setText(title, fullTitle);
      if (title.title !== fullTitle) title.title = fullTitle;
      setText(row.querySelector(".dsm-time"), relativeTime(Number(summary.updatedAt)));
      const dot = row.querySelector(".dsm-dot");
      dot.classList.toggle("dsm-dot-running", primary === "running");
      dot.classList.toggle("dsm-dot-pending", primary === "pending");
      dot.classList.toggle("dsm-dot-done", primary === "done");
      const unread = row.querySelector(".dsm-unread-mark");
      unread.hidden = !status.unread;
      const statusNode = row.querySelector(".dsm-status-label");
      setText(statusNode, statusLabel(status));
      const pin = row.querySelector(".dsm-pin");
      pin.hidden = !isPinned(id); pin.title = STRINGS.pinnedTitle;
    }
    function makePinnedSection(tree) {
      let section = tree.querySelector(":scope > .dsm-pinned-section");
      if (section) return section;
      section = owned("section", "dsm-pinned-section");
      const header = owned("button", "dsm-pinned-header");
      header.type = "button";
      header.setAttribute("aria-controls", "dsm-pinned-holder");
      const label = document.createElement("span"); label.className = "dsm-pinned-label"; label.textContent = STRINGS.pinnedSectionTitle;
      const count = document.createElement("span"); count.className = "dsm-pinned-count";
      const chevron = document.createElement("span"); chevron.className = "dsm-pinned-chevron"; chevron.textContent = STRINGS.sectionChevron;
      header.append(label, count, chevron);
      const holder = owned("div", "dsm-pinned-holder"); holder.id = "dsm-pinned-holder";
      header.addEventListener("click", () => {
        state.pinnedExpanded = !state.pinnedExpanded;
        holder.hidden = !state.pinnedExpanded;
        header.setAttribute("aria-expanded", String(state.pinnedExpanded));
      });
      section.append(header, holder);
      const firstGroup = tree.querySelector(`:scope > ${GROUP}`);
      if (firstGroup) tree.insertBefore(section, firstGroup); else tree.appendChild(section);
      state.pinnedSection = section;
      return section;
    }
    function renderPinned(tree, byId) {
      const pinnedIds = activePinnedIds(byId);
      let section = tree.querySelector(":scope > .dsm-pinned-section");
      if (!pinnedIds.length) {
        section?.remove();
        state.pinnedSection = null;
        return;
      }
      section = makePinnedSection(tree);
      const header = section.querySelector(":scope > .dsm-pinned-header");
      const holder = section.querySelector(":scope > .dsm-pinned-holder");
      const count = header.querySelector(".dsm-pinned-count");
      count.textContent = String(pinnedIds.length);
      header.setAttribute("aria-expanded", String(state.pinnedExpanded));
      holder.hidden = !state.pinnedExpanded;
      const previous = new Map([...holder.children].map(row => [row.dataset.dsmSessionId, row]));
      const seen = new Set();
      for (const [index, id] of pinnedIds.entries()) {
        const row = previous.get(id) || state.rows.get(id) || makeRow(id);
        updateRow(row, id, byId[id]);
        if (holder.children[index] !== row) holder.insertBefore(row, holder.children[index] || null);
        seen.add(id);
      }
      for (const [id, row] of previous) if (!seen.has(id)) row.remove();
    }
    function restoreStaleNativeWrappers(section, entries) {
      const liveWrappers = new Set(entries.map(entry => entry.wrapper));
      for (const node of state.hidden.keys()) {
        if (node.closest(GROUP) === section && !liveWrappers.has(node)) restoreNative(node);
      }
    }
    function workspaceMembers(section, byId, entries, expanded) {
      const workspaceState = workspaceSnapshot();
      if (!workspaceState || !Array.isArray(workspaceState.items) || workspaceState.phase !== "ready" || ["loading", "error"].includes(workspaceState.state)) return null;
      const header = ownNodes(section, '[data-row-key^="workspace:"]')[0];
      if (!header) return null;
      const key = header.getAttribute("data-row-key").slice("workspace:".length);
      const workspace = workspaceState.items.find(item => String(item.workspaceId) === key);
      const accounted = new Set(workspaceState.items.flatMap(item => item.sessionIds || []));
      const sessionIds = workspace?.sessionIds ?? (key === "" ? (sessionSnapshot()?.ids || []).filter(id => !accounted.has(id)) : null);
      if (!sessionIds) return null;
      if (!expanded) return { targets: [] };
      const members = new Set(sessionIds);
      const current = currentId();
      const eligible = id => byId[id] && byId[id].origin !== "subagent" && (!byId[id].blank || id === current);
      const targets = entries.filter(({ id }) => members.has(id) && eligible(id));
      const overflow = ownNodes(section, NATIVE_OVERFLOW)[0];
      // The host owns visible pages, including blanks/pins and running children.
      // Never guess page capacity from a count of materialized native rows.
      if (overflow && overflow.getAttribute("aria-expanded") !== "true") return { targets };
      // A live native row is positive evidence for a live view. An empty or
      // all-archived tree does not reveal the browser-local archive filter.
      const tree = section.closest('[role="tree"]');
      const hasLiveNativePage = [...(tree?.querySelectorAll(NATIVE_ROW) || [])].some(node => {
        if (node.closest(OWNED)) return false;
        const group = node.closest(GROUP);
        const groupHeader = group && ownNodes(group, '[data-row-key^="workspace:"]')[0];
        const id = node.getAttribute("data-row-key").slice("session:".length);
        return groupHeader?.getAttribute("aria-expanded") === "true" && eligible(id) && !isArchived(id);
      });
      if (!hasLiveNativePage) return { targets };
      const included = new Set(targets.map(entry => entry.id));
      // Preserve materialized updated/manual order. Membership-only ordinary
      // rows follow host membership order until native ordering catches up.
      for (const id of members) {
        if (!included.has(id) && eligible(id) && !isArchived(id) && !(isPinned(id) && !isArchived(id))) {
          targets.push({ id });
          included.add(id);
        }
      }
      return { targets };
    }
    function renderSection(section, byId) {
      const header = ownNodes(section, '[data-row-key^="workspace:"]')[0];
      if (!header) return; // Fail open when the host DOM contract changes.
      const entries = nativeEntries(section);
      restoreStaleNativeWrappers(section, entries);
      let holder = [...section.children].find(node => node.classList.contains("dsm-session-holder"));
      if (!holder) { holder = owned("div", "dsm-session-holder"); section.appendChild(holder); state.holders.add(holder); }
      const expanded = header.getAttribute("aria-expanded") !== "false";
      holder.style.display = expanded ? "" : "none";
      // Keep native pagination and filtering authoritative, while projecting every
      // host-owned member that belongs to the currently visible page.
      const overflow = ownNodes(section, NATIVE_OVERFLOW)[0];
      let anchor = overflow;
      while (anchor?.parentElement && anchor.parentElement !== section) anchor = anchor.parentElement;
      if (anchor && anchor !== holder && holder.nextElementSibling !== anchor) section.insertBefore(holder, anchor);
      const previous = new Map([...holder.children].map(row => [row.dataset.dsmSessionId, row]));
      const seen = new Set();
      const projection = workspaceMembers(section, byId, entries, expanded);
      const targets = (projection?.targets ?? entries.map(entry => ({ id: entry.id, wrapper: entry.wrapper })))
        .filter(({ id }) => !(isPinned(id) && !isArchived(id)));
      const targetIds = new Set(targets.map(entry => entry.id));
      for (const { id, wrapper } of entries) {
        if (!byId[id]) { restoreNative(wrapper); continue; }
        if (!targetIds.has(id)) hideNative(wrapper);
      }
      let index = 0;
      for (const { id, wrapper } of targets) {
        if (!byId[id]) {
          if (wrapper) restoreNative(wrapper);
          continue;
        }
        const row = previous.get(id) || state.rows.get(id) || makeRow(id);
        updateRow(row, id, byId[id]);
        if (holder.children[index] !== row) holder.insertBefore(row, holder.children[index] || null);
        index++;
        if (wrapper) hideNative(wrapper);
        seen.add(id);
      }
      // No indefinitely retained 'last frame': removed/filtered/moved sessions disappear.
      for (const [id, row] of previous) if (!seen.has(id)) row.remove();
    }
    function render() {
      if (state.disposed || state.rendering) return;
      const tree = document.querySelector(`${SLOT} [role="tree"]`);
      normalizeWorkspaceSectionLabel();
      state.rendering = true;
      state.observer?.disconnect();
      try {
        for (const node of state.hidden.keys()) {
          // A staged host commit may append a pagination control to a wrapper we hid earlier.
          if (!node.isConnected || !node.closest(SLOT) || node.matches(NATIVE_OVERFLOW) || node.querySelector(NATIVE_OVERFLOW)) restoreNative(node);
        }
        for (const holder of state.holders) if (!holder.isConnected || !holder.closest(SLOT)) { holder.remove(); state.holders.delete(holder); }
        const byId = sessionSnapshot()?.byId;
        if (tree && byId) {
          decorateWorkspacePaths(tree);
          renderPinned(tree, byId);
          for (const section of tree.querySelectorAll(GROUP)) renderSection(section, byId);
        }
        renderProjectHeader(tree);
        hideNativePinButtons();
        if (state.menu && (!state.menuAnchor?.isConnected || !state.menuAnchor.getClientRects().length || !byId?.[state.menuSession])) closeMenu();
      } finally {
        state.rendering = false;
        if (!state.disposed) state.observer?.observe(document.body, observation);
      }
    }
    function requestRender() {
      if (state.disposed || state.renderQueued) return;
      state.renderQueued = true;
      state.renderTimer = window.setTimeout(() => { state.renderQueued = false; state.renderTimer = null; render(); }, 0);
    }
    function observerCallback(records) {
      if (state.disposed) return;
      const relevant = records.some(record => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (target?.closest(OWNED)) return false;
        if (target?.closest(SLOT)) return true;
        return [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches(SLOT) || node.querySelector(SLOT)));
      });
      if (relevant) requestRender();
    }
    function cleanup() {
      if (state.disposed) return;
      state.disposed = true;
      state.observer?.disconnect(); state.timer?.();
      if (state.renderTimer !== null) window.clearTimeout(state.renderTimer);
      for (const unsubscribe of state.subscriptions.splice(0)) unsubscribe();
      closeMenu(); closeDialog(); state.notice?.remove();
      for (const node of state.hidden.keys()) restoreNative(node);
      restoreNativePinButtons();
      restoreWorkspaceSectionLabel();
      for (const header of state.workspaceTitles.keys()) restoreWorkspaceTitle(header);
      for (const holder of state.holders) holder.remove();
      state.projectHeader?.remove(); state.projectHeader = null;
      state.holders.clear(); state.rows.clear(); state.pinnedSection?.remove(); state.pinnedSection = null; state.style?.remove();
    }
    function apply(ctx) {
      const get = name => typeof ctx.get === "function" ? ctx.get(name) : ctx[name];
      sessions = get("sessions"); workspaces = get("workspaces"); uiWorkspace = get("uiWorkspace"); uiSession = get("uiSession");
      if (!sessions?.list || !workspaces?.list || !uiWorkspace || !uiSession?.sessionStatus) { console.warn("[dsh-session-manager] required services unavailable; native UI retained"); return; }
      state.disposed = false;
      state.style = owned("style", ""); state.style.dataset.dsmCss = "1"; state.style.textContent = css;
      document.head.appendChild(state.style);
      for (const store of [sessions.list, workspaces.list, uiWorkspace.selection, uiSession.sessionStatus]) {
        const unsubscribe = store?.subscribe?.(requestRender);
        if (typeof unsubscribe === "function") state.subscriptions.push(unsubscribe);
      }
      state.observer = new MutationObserver(observerCallback);
      render();
      const timer = get("timer");
      if (typeof timer?.interval === "function") state.timer = timer.interval(render, 900);
      else { const id = window.setInterval(render, 900); state.timer = () => window.clearInterval(id); }
      ctx.effect?.(() => cleanup);
    }
    return { inject, apply };
  },
});
