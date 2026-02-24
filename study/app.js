(() => {
  "use strict";

  /* =========================================================
     STUDYSPACE v2.4 — Accounts + Upcoming + Calendar↔Todo + Drag Reorder
     + WRITE MODE (type answer like Quizlet)
     + IMAGE SUPPORT (Q or A can be text or image)
     - Accounts (local-only): username + PIN
     - Upcoming section on Home (next 7 days + due todos + calendar)
     - To-dos: assign a date (dueDate) + auto-link into calendar
     - To-dos: drag to reorder (persists)
========================================================= */

  /* =========================================================
     STORAGE KEYS (accounts + per-user namespaces)
  ========================================================= */
  const ACC_KEY = "studyspace_accounts_v1";         // { accounts:[{id,username,pinHash,createdAt}], currentId }
  const NS_PREFIX = "studyspace_v2_user_";          // + userId + "__" + suffix

  // per-user suffixes
  const SUF_DB = "db";
  const SUF_SETTINGS = "settings";
  const SUF_CAL = "calendar";
  const SUF_TODO = "todo";

  const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  function saveJSON(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  // Tiny hash for PIN (NOT secure; just keeps it from being plain text)
  function hashPIN(pin) {
    const s = String(pin || "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  /* =========================================================
     DOM HELPERS
  ========================================================= */
  const $ = (s) => document.querySelector(s);

  function el(tag, props = {}, children = []) {
    const n = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") n[k.toLowerCase()] = v;
      else n.setAttribute(k, v);
    });
    children.forEach(c => n.appendChild(c));
    return n;
  }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function nowISODate() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function fmtDateTime(ts) {
    return new Date(ts).toLocaleString();
  }

  function escapeHTML(s) {
    return (s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function percent(n, d) {
    if (!d) return 0;
    return Math.round((n / d) * 100);
  }

  function normalizeName(s) { return (s || "").trim().toLowerCase(); }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Spaced repetition order: weighted BUT still covers all terms once before repeating
  function weightedOrderByMiss(terms) {
    const items = terms.map(t => {
      const seen = t.stats?.seen || 0;
      const wrong = t.stats?.wrong || 0;
      const missPct = seen ? (wrong / seen) * 100 : 0;
      const w = 1 + wrong * 2 + missPct / 10;
      return { id: t.id, w: Math.max(1, w) };
    });
    const keyed = items.map(x => ({ id: x.id, k: Math.pow(Math.random(), 1 / x.w) }));
    keyed.sort((a, b) => b.k - a.k);
    return keyed.map(x => x.id);
  }

  function normAnswerText(s) {
    return (s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[“”‘’]/g, "'")
      .replace(/[.,!?;:()\[\]{}"]/g, "");
  }

  /* =========================================================
     ACCOUNTS
  ========================================================= */
  let accountsState = loadJSON(ACC_KEY, { accounts: [], currentId: null });

  function saveAccountsState() {
    saveJSON(ACC_KEY, accountsState);
  }

  function getCurrentUser() {
    const id = accountsState.currentId;
    if (!id) return null;
    return accountsState.accounts.find(a => a.id === id) || null;
  }

  function nsKey(userId, suffix) {
    return `${NS_PREFIX}${userId}__${suffix}`;
  }

  // Login UI (created dynamically so your HTML doesn't need edits)
  let loginModal = null;
  let loginUserInput = null;
  let loginPinInput = null;
  let loginMode = "login"; // 'login' | 'create'
  let loginMsg = null;

  function ensureLoginModal() {
    if (loginModal) return;

    loginMsg = el("div", { class: "hint", text: "" });

    loginUserInput = el("input", { class: "input", placeholder: "Username..." });
    loginPinInput = el("input", { class: "input", placeholder: "PIN (numbers ok)", type: "password" });

    const title = el("h3", { text: "Login" });
    const switchBtn = el("button", {
      class: "btn",
      text: "Create account",
      onclick: () => {
        loginMode = (loginMode === "login") ? "create" : "login";
        title.textContent = loginMode === "login" ? "Login" : "Create account";
        switchBtn.textContent = loginMode === "login" ? "Create account" : "Back to login";
        submitBtn.textContent = loginMode === "login" ? "Login" : "Create";
        loginMsg.textContent = "";
        loginUserInput.value = "";
        loginPinInput.value = "";
        loginUserInput.focus();
      }
    });

    const submitBtn = el("button", {
      class: "btn primary",
      text: "Login",
      onclick: () => {
        const user = (loginUserInput.value || "").trim();
        const pin = (loginPinInput.value || "").trim();

        if (!user || !pin) {
          loginMsg.textContent = "Enter a username + PIN.";
          return;
        }

        if (loginMode === "create") {
          if (accountsState.accounts.some(a => normalizeName(a.username) === normalizeName(user))) {
            loginMsg.textContent = "That username already exists.";
            return;
          }
          const acc = { id: uid(), username: user, pinHash: hashPIN(pin), createdAt: Date.now() };
          accountsState.accounts.push(acc);
          accountsState.currentId = acc.id;
          saveAccountsState();
          hideLogin();
          bootUser(acc.id);
          return;
        }

        // login
        const acc = accountsState.accounts.find(a => normalizeName(a.username) === normalizeName(user));
        if (!acc) {
          loginMsg.textContent = "No account with that username.";
          return;
        }
        if (acc.pinHash !== hashPIN(pin)) {
          loginMsg.textContent = "Wrong PIN.";
          return;
        }
        accountsState.currentId = acc.id;
        saveAccountsState();
        hideLogin();
        bootUser(acc.id);
      }
    });

    const row = el("div", { class: "row" }, [submitBtn, switchBtn]);

    const card = el("div", { class: "modalCard" }, [
      el("div", { class: "cardHead" }, [title]),
      el("div", { class: "muted", text: "Accounts are stored only on this browser/device." }),
      loginUserInput,
      loginPinInput,
      row,
      loginMsg
    ]);

    loginModal = el("div", { class: "modal" }, [card]);
    document.body.appendChild(loginModal);

    loginModal.addEventListener("click", (e) => {
  // If you ever want to allow click-outside-to-close later:
  // if (e.target === loginModal) hideLogin();

  // For now: do nothing (don’t block)
});

    loginPinInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitBtn.click();
    });
  }

  function showLogin() {
    ensureLoginModal();
    loginModal.classList.remove("hidden");
    loginUserInput.focus();
  }
  function hideLogin() {
    if (!loginModal) return;
    loginModal.classList.add("hidden");
  }

  function addLogoutButton() {
    const topActions = document.querySelector(".topActions");
    if (!topActions) return;

    if ($("#logoutBtn")) return;

    const who = getCurrentUser();
    const btn = el("button", {
      class: "btn",
      id: "logoutBtn",
      text: who ? `Logout (${who.username})` : "Logout",
      onclick: () => {
        accountsState.currentId = null;
        saveAccountsState();
        location.reload();
      }
    });
    topActions.insertBefore(btn, topActions.firstChild);
  }

  /* =========================================================
     USER DATA (loaded after login)
  ========================================================= */
  let USER_ID = null;

  let db = null;
  let settings = null;
  let calendar = null;
  let todos = null;

  function persistAll() {
    if (!USER_ID) return;
    saveJSON(nsKey(USER_ID, SUF_DB), db);
    saveJSON(nsKey(USER_ID, SUF_SETTINGS), settings);
    saveJSON(nsKey(USER_ID, SUF_CAL), calendar);
    saveJSON(nsKey(USER_ID, SUF_TODO), todos);
  }

  function loadUserState(userId) {
    USER_ID = userId;

    db = loadJSON(nsKey(USER_ID, SUF_DB), { studies: [] });

    settings = loadJSON(nsKey(USER_ID, SUF_SETTINGS), {
      theme: "dark",
      accent: "#6aa6ff",
      colors: {
         
        globalText: "",
        globalMuted: "",
        gimkitText: "",
        testText: "",
        flashText: "",
        matchText: "",
        termsText: "",
        statsText: "",
        writeText: ""
      
    }
    });

    // Calendar: { events: { "YYYY-MM-DD": { items:[{id,text,createdAt,updatedAt, type, link}] } }, dismissed: {date:true} }
    calendar = loadJSON(nsKey(USER_ID, SUF_CAL), { events: {}, dismissed: {} });

    // To-do: { items:[{id,text,createdAt,done,deleting,deleteAt, order, dueDate}] }
    todos = loadJSON(nsKey(USER_ID, SUF_TODO), { items: [] });
  }

  /* =========================================================
     DOM (existing IDs from your HTML)
  ========================================================= */
  const viewHome = $("#viewHome");
  const viewStudy = $("#viewStudy");

  const studiesList = $("#studiesList");
  const studySearch = $("#studySearch");
  const clearSearchBtn = $("#clearSearchBtn");

  const homeBtn = $("#homeBtn");
  const backToHomeLink = $("#backToHomeLink");

  const createStudyBtn = $("#createStudyBtn");
  const createStudyModal = $("#createStudyModal");
  const newStudyName = $("#newStudyName");
  const confirmCreateStudyBtn = $("#confirmCreateStudyBtn");
  const closeCreateStudyBtn = $("#closeCreateStudyBtn");
  const cancelCreateStudyBtn = $("#cancelCreateStudyBtn");

  const exportAllBtn = $("#exportAllBtn");
  const exportStudyBtn = $("#exportStudyBtn");
  const importBtn = $("#importBtn");

  const importModal = $("#importModal");
  const importText = $("#importText");
  const closeImportBtn = $("#closeImportBtn");
  const cancelImportBtn = $("#cancelImportBtn");
  const confirmImportBtn = $("#confirmImportBtn");

  const studyTitle = $("#studyTitle");
  const studyMeta = $("#studyMeta");
  const renameStudyBtn = $("#renameStudyBtn");
  const deleteStudyBtn = $("#deleteStudyBtn");
  const favoritesOnlyToggle = $("#favoritesOnlyToggle");

  const tabs = [...document.querySelectorAll(".tab")];
  const panels = {
    terms: $("#tab_terms"),
    flashcards: $("#tab_flashcards"),
    gimkit: $("#tab_gimkit"),
    match: $("#tab_match"),
    test: $("#tab_test"),
    stats: $("#tab_stats")
  };

  // Terms
  const termQ = $("#termQ");
  const termA = $("#termA");
  const saveTermBtn = $("#saveTermBtn");
  const cancelEditTermBtn = $("#cancelEditTermBtn");
  const termsList = $("#termsList");
  const termSearch = $("#termSearch");
  const clearTermSearchBtn = $("#clearTermSearchBtn");

  // Bulk
  const bulkInput = $("#bulkInput");
  const bulkImportBtn = $("#bulkImportBtn");
  const bulkClearBtn = $("#bulkClearBtn");

  // Flashcards
  const flashCard = $("#flashCard");
  const flashInner = $("#flashInner");
  const fcQ = $("#fcQ");
  const fcA = $("#fcA");
  const fcCounter = $("#fcCounter");
  const fcPrevBtn = $("#fcPrevBtn");
  const fcNextBtn = $("#fcNextBtn");
  const fcRestartBtn = $("#fcRestartBtn");

  // Gimkit
  const gkPrompt = $("#gkPrompt");
  const gkCounter = $("#gkCounter");
  const gkChoices = $("#gkChoices");
  const gkFeedback = $("#gkFeedback");
  const gkNextBtn = $("#gkNextBtn");
  const gkRestartBtn = $("#gkRestartBtn");

  // Match
  const matchQs = $("#matchQs");
  const matchAs = $("#matchAs");
  const matchStatus = $("#matchStatus");
  const matchRestartBtn = $("#matchRestartBtn");

  // Test
  const testCount = $("#testCount");
  const startTestBtn = $("#startTestBtn");
  const resetTestBtn = $("#resetTestBtn");
  const testArea = $("#testArea");
  const submitTestBtn = $("#submitTestBtn");
  const testResults = $("#testResults");
  const testHistory = $("#testHistory");

  // Stats
  const mostMissed = $("#mostMissed");
  const studyStatsSummary = $("#studyStatsSummary");

  // Settings
  const settingsModal = $("#settingsModal");
  const openSettingsBtn = $("#openSettingsBtn");
  const closeSettingsBtn = $("#closeSettingsBtn");
  const toggleThemeBtn = $("#toggleThemeBtn");
  const accentPicker = $("#accentPicker");

  const colorArea = $("#colorArea");
  const colorValue = $("#colorValue");
  const applyColorBtn = $("#applyColorBtn");
  const clearColorBtn = $("#clearColorBtn");

  // Calendar
  const calendarWrap = $("#calendarWrap");
  const dayModal = $("#dayModal");
  const dayModalTitle = $("#dayModalTitle");
  const closeDayModalBtn = $("#closeDayModalBtn");
  const closeDayModalBtn2 = $("#closeDayModalBtn2");
  const dayEventsList = $("#dayEventsList");
  const eventText = $("#eventText");
  const saveEventBtn = $("#saveEventBtn");
  const deleteEventBtn = $("#deleteEventBtn");

  const notifyModal = $("#notifyModal");
  const notifyText = $("#notifyText");
  const closeNotifyBtn = $("#closeNotifyBtn");
  const dismissNotifyBtn = $("#dismissNotifyBtn");
  const editNotifyBtn = $("#editNotifyBtn");

  // To-do
  const todoInput = $("#todoInput");
  const addTodoBtn = $("#addTodoBtn");
  const todoList = $("#todoList");

  // Home time
  const nowTime = $("#nowTime");
  const todayReminders = $("#todayReminders");

  /* =========================================================
     UPCOMING (created dynamically under Today box)
  ========================================================= */
  let upcomingBox = null;
  let upcomingList = null;

  function ensureUpcomingUI() {
    if (upcomingBox) return;

    const todayContainer = todayReminders?.parentElement;
    if (!todayContainer) return;

    upcomingList = el("div", { class: "todayReminders", id: "upcomingList", text: "—" });
    upcomingBox = el("div", { class: "todayBox", style: "margin-top:12px;" }, [
      el("div", { class: "muted", text: "Upcoming (next 7 days)" }),
      upcomingList
    ]);

    const nowBar = todayContainer.closest(".nowBar");
    if (nowBar) nowBar.appendChild(upcomingBox);
  }

  /* =========================================================
     STATE
  ========================================================= */
  let currentStudyId = null;
  let currentTab = "terms";
  let editingTermId = null;
  let favoritesOnly = false;

  // Flashcards
  let fcOrder = [];
  let fcIndex = 0;

  // Gimkit
  let gkOrder = [];
  let gkIndex = 0;
  let gkLocked = false;
  let gkLastTermId = null;

  // Match
  let matchState = null;

  // Test
  let activeTest = null;

  // Write mode
  let writeState = null; // {order:[], index:0, correct:0, wrong:0, locked:false, lastId:null}

  // Calendar
  let calMonth = 0; // Jan 2026 = 0
  let selectedDayKey = null;
  let pendingNotifyKey = null;
  let editingEventId = null;

  // Day modal can show: calendar events + due todos
  let editingLinkedTodoId = null;

  /* =========================================================
     SETTINGS APPLY
  ========================================================= */
  function applySettings() {
    document.documentElement.setAttribute("data-theme", settings.theme);
    document.documentElement.style.setProperty("--accent", settings.accent);

    const c = settings.colors || {};
    document.documentElement.style.setProperty("--user-text", c.globalText || "");
    document.documentElement.style.setProperty("--user-muted", c.globalMuted || "");
    document.documentElement.style.setProperty("--user-gk-text", c.gimkitText || "");
    document.documentElement.style.setProperty("--user-test-text", c.testText || "");
    document.documentElement.style.setProperty("--user-fc-text", c.flashText || "");
    document.documentElement.style.setProperty("--user-match-text", c.matchText || "");
    document.documentElement.style.setProperty("--user-terms-text", c.termsText || "");
    document.documentElement.style.setProperty("--user-stats-text", c.statsText || "");
    document.documentElement.style.setProperty("--user-write-text", c.writeText || "");

    if (accentPicker) accentPicker.value = settings.accent;
    refreshColorPicker();
  }

  function refreshColorPicker() {
    const key = colorArea?.value;
    if (!key) return;
    const c = settings.colors || (settings.colors = {});
    colorValue.value = c[key] || "#ffffff";
  }

  /* =========================================================
     STUDY HELPERS + TERM MODEL (TEXT OR IMAGE)
  ========================================================= */
  function getStudy(id) {
    return db.studies.find(s => s.id === id) || null;
  }

  function ensureTermStats(t) {
    if (!t.stats) t.stats = { seen: 0, wrong: 0 };
    if (typeof t.stats.seen !== "number") t.stats.seen = 0;
    if (typeof t.stats.wrong !== "number") t.stats.wrong = 0;

    // Ensure types
    if (!t.qType) t.qType = "text";
    if (!t.aType) t.aType = "text";
    if (!t.qImg) t.qImg = "";
    if (!t.aImg) t.aImg = "";
    return t;
  }

  function studyTerms(study) {
    const terms = (study?.terms || [])
      .filter(t => {
        const hasQ = (t.qType === "img") ? !!(t.qImg || "").trim() : !!(t.q || "").trim();
        const hasA = (t.aType === "img") ? !!(t.aImg || "").trim() : !!(t.a || "").trim();
        return hasQ && hasA;
      })
      .map(ensureTermStats);

    if (!favoritesOnly) return terms;
    return terms.filter(t => !!t.fav);
  }

  function renderTermSide(which, term) {
    // which: "q" | "a"
    const type = which === "q" ? term.qType : term.aType;
    const text = which === "q" ? term.q : term.a;
    const img = which === "q" ? term.qImg : term.aImg;

    if (type === "img" && img) {
      const wrap = document.createElement("div");
      const im = document.createElement("img");
      im.src = img;
      im.alt = which;
      im.style.maxWidth = "100%";
      im.style.maxHeight = "220px";
      im.style.borderRadius = "12px";
      im.style.display = "block";
      wrap.appendChild(im);
      return wrap;
    }

    const span = document.createElement("span");
    span.textContent = text || "—";
    return span;
  }

  async function fileToDataURL(file) {
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  /* =========================================================
     WRITE TAB (auto-create UI)
  ========================================================= */
  let writeTabBtn = null;
  let writePanel = null;

  let writePrompt = null;
  let writeCounter = null;
  let writeInput = null;
  let writeSubmit = null;
  let writeNext = null;
  let writeRestart = null;
  let writeFeedback = null;
  let writeSelfBtns = null;

  function ensureWriteTab() {
    if (writeTabBtn && writePanel) return;

    // Find a place to insert a tab button (same parent as existing tabs)
    const tabBar = tabs[0]?.parentElement;
    if (!tabBar) return;

    // Create tab button
    writeTabBtn = document.createElement("button");
    writeTabBtn.className = "tab";
    writeTabBtn.dataset.tab = "write";
    writeTabBtn.textContent = "Write";
    writeTabBtn.onclick = () => switchTab("write");
    tabBar.appendChild(writeTabBtn);

    // Create panel
    writePanel = document.createElement("div");
    writePanel.id = "tab_write";
    writePanel.className = "panel hidden";

    writePrompt = el("div", { class: "big", id: "writePrompt", text: "—" });
    writeCounter = el("div", { class: "muted", id: "writeCounter", text: "0 / 0" });

    writeInput = el("input", { class: "input", id: "writeInput", placeholder: "Type your answer..." });

    writeSubmit = el("button", { class: "btn primary", id: "writeSubmit", text: "Check" });
    writeNext = el("button", { class: "btn", id: "writeNext", text: "Next" });
    writeRestart = el("button", { class: "btn", id: "writeRestart", text: "Restart" });

    writeFeedback = el("div", { class: "todayReminders", id: "writeFeedback", text: "" });

    // If answer is an image, user must self-mark correct/incorrect
    const selfGood = el("button", { class: "btn primary", text: "I was correct" });
    const selfBad = el("button", { class: "btn danger", text: "I was wrong" });
    writeSelfBtns = el("div", { class: "row hidden", id: "writeSelfBtns" }, [selfGood, selfBad]);

    selfGood.onclick = () => writeSelfMark(true);
    selfBad.onclick = () => writeSelfMark(false);

    const row = el("div", { class: "row" }, [writeSubmit, writeNext, writeRestart]);

    writePanel.appendChild(writeCounter);
    writePanel.appendChild(writePrompt);
    writePanel.appendChild(writeInput);
    writePanel.appendChild(row);
    writePanel.appendChild(writeFeedback);
    writePanel.appendChild(writeSelfBtns);

    // attach to the study view near the other panels
    const anyPanel = panels.terms || panels.flashcards || panels.gimkit || panels.match || panels.test || panels.stats;
    const panelParent = anyPanel?.parentElement;
    if (panelParent) panelParent.appendChild(writePanel);

    // register in panels object so switchTab can hide/show
    panels.write = writePanel;

    // input enter = check
    writeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") writeSubmit.click();
    });

    writeSubmit.onclick = () => writeCheck();
    writeNext.onclick = () => writeNextQ();
    writeRestart.onclick = () => prepareWrite(true);
  }

  function prepareWrite(forceRestart) {
    ensureWriteTab();

    const s = getStudy(currentStudyId);
    if (!s) return;

    const terms = studyTerms(s);
    if (!terms.length) {
      if (writePrompt) writePrompt.textContent = "No terms yet.";
      if (writeCounter) writeCounter.textContent = "0 / 0";
      if (writeFeedback) writeFeedback.textContent = "Add terms in Terms tab.";
      if (writeSelfBtns) writeSelfBtns.classList.add("hidden");
      return;
    }

    if (forceRestart || !writeState) {
      writeState = {
        order: weightedOrderByMiss(terms),
        index: 0,
        correct: 0,
        wrong: 0,
        locked: false,
        lastId: null
      };
    } else {
      const newIds = terms.map(t => t.id);
      writeState.order = writeState.order.filter(id => newIds.includes(id));
      if (!writeState.order.length) writeState.order = weightedOrderByMiss(terms);
      writeState.index = clamp(writeState.index, 0, writeState.order.length - 1);
      writeState.locked = false;
    }

    writeRender();
  }

  function writeRender() {
    const s = getStudy(currentStudyId);
    if (!s || !writeState) return;

    const terms = studyTerms(s);
    if (!terms.length) return;

    if (writeState.index >= writeState.order.length) {
      writeState.order = weightedOrderByMiss(terms);
      writeState.index = 0;
    }

    const id = writeState.order[writeState.index];
    writeState.lastId = id;

    const t = (s.terms || []).find(x => x.id === id);
    if (!t) {
      writeState.index++;
      return writeRender();
    }

    if (writeCounter) {
      writeCounter.textContent = `${writeState.index + 1} / ${writeState.order.length} • correct ${writeState.correct} • wrong ${writeState.wrong}`;
    }

    // Prompt shows the QUESTION (text or image)
    if (writePrompt) {
      writePrompt.innerHTML = "";
      writePrompt.appendChild(renderTermSide("q", t));
    }

    if (writeInput) {
      writeInput.value = "";
      writeInput.disabled = false;
      writeInput.placeholder = (t.aType === "img") ? "Answer is an image — click Check then self-mark" : "Type your answer...";
      writeInput.style.display = (t.aType === "img") ? "none" : "";
    }

    if (writeFeedback) writeFeedback.textContent = "";
    if (writeSelfBtns) writeSelfBtns.classList.add("hidden");

    writeState.locked = false;
  }

  function writeCheck() {
    const s = getStudy(currentStudyId);
    if (!s || !writeState) return;
    if (writeState.locked) return;

    const t = (s.terms || []).find(x => x.id === writeState.lastId);
    if (!t) return;

    ensureTermStats(t);

    // Always count as seen when user checks
    t.stats.seen += 1;

    // If correct answer is an IMAGE: show it + self mark
    if (t.aType === "img") {
      writeState.locked = true;

      if (writeFeedback) {
        writeFeedback.innerHTML = `<div class="muted">Correct answer:</div>`;
        const wrap = document.createElement("div");
        wrap.style.marginTop = "8px";
        wrap.appendChild(renderTermSide("a", t));
        writeFeedback.appendChild(wrap);
      }
      if (writeSelfBtns) writeSelfBtns.classList.remove("hidden");

      s.updatedAt = Date.now();
      persistAll();
      renderStats();
      return;
    }

    const your = normAnswerText(writeInput?.value || "");
    const corr = normAnswerText(t.a || "");
    const ok = your === corr && corr.length > 0;

    if (!ok) t.stats.wrong += 1;

    writeState.locked = true;
    if (writeInput) writeInput.disabled = true;

    if (writeFeedback) {
      writeFeedback.innerHTML = ok
        ? `✅ Correct`
        : `❌ Wrong\nCorrect: ${escapeHTML(t.a || "—")}`;
    }

    if (ok) writeState.correct += 1;
    else writeState.wrong += 1;

    s.updatedAt = Date.now();
    persistAll();
    renderStats();
  }

  function writeSelfMark(wasCorrect) {
    const s = getStudy(currentStudyId);
    if (!s || !writeState) return;
    const t = (s.terms || []).find(x => x.id === writeState.lastId);
    if (!t) return;

    ensureTermStats(t);

    if (!wasCorrect) t.stats.wrong += 1;

    if (writeFeedback) {
      writeFeedback.innerHTML += wasCorrect ? "\n✅ Marked correct." : "\n❌ Marked wrong.";
    }

    if (wasCorrect) writeState.correct += 1;
    else writeState.wrong += 1;

    if (writeSelfBtns) writeSelfBtns.classList.add("hidden");

    s.updatedAt = Date.now();
    persistAll();
    renderStats();
  }

  function writeNextQ() {
    if (!writeState) return;
    writeState.index += 1;
    writeRender();
  }

  /* =========================================================
     HOME: CLOCK + TODAY + UPCOMING
  ========================================================= */
  function renderNow() {
    const d = new Date();
    if (nowTime) {
      nowTime.textContent = d.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit"
      });
    }

    const key = nowISODate();

    const calItems = (calendar.events[key]?.items || []).slice();
    const dueTodos = (todos.items || []).filter(t => t.dueDate === key);

    const todayLines = [];
    calItems.forEach((x) => todayLines.push(`${todayLines.length + 1}. ${x.text}`));
    dueTodos.forEach(t => todayLines.push(`${todayLines.length + 1}. 🧾 ${t.text}`));

    if (todayReminders) {
      if (!todayLines.length) todayReminders.textContent = "No reminders today.";
      else todayReminders.textContent = todayLines.join("\n");
    }

    renderUpcoming();
  }

  function addDaysISO(baseISO, add) {
    const [y, m, d] = baseISO.split("-").map(Number);
    const dt = new Date(y, (m - 1), d);
    dt.setDate(dt.getDate() + add);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  function renderUpcoming() {
    ensureUpcomingUI();
    if (!upcomingList) return;

    const today = nowISODate();
    const lines = [];

    for (let i = 0; i < 7; i++) {
      const dayKey = addDaysISO(today, i);
      const calItems = (calendar.events[dayKey]?.items || []).slice();
      const dueTodos = (todos.items || []).filter(t => t.dueDate === dayKey);

      if (!calItems.length && !dueTodos.length) continue;

      const pretty = new Date(dayKey + "T00:00:00").toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric"
      });

      lines.push(`${pretty}:`);
      calItems.forEach(e => lines.push(`  • ${e.text}`));
      dueTodos.forEach(t => lines.push(`  • 🧾 ${t.text}${t.done ? " (done)" : ""}`));
      lines.push("");
    }

    upcomingList.textContent = lines.length ? lines.join("\n").trim() : "Nothing scheduled in the next 7 days.";
  }

  /* =========================================================
     NAV / VIEWS
  ========================================================= */
  function showHome() {
    currentStudyId = null;
    viewStudy?.classList.add("hidden");
    viewHome?.classList.remove("hidden");
    renderStudies();
    renderCalendar();
    renderTodos();
    renderNow();
  }

  function openStudy(studyId) {
    const s = getStudy(studyId);
    if (!s) return;

    currentStudyId = studyId;
    viewHome?.classList.add("hidden");
    viewStudy?.classList.remove("hidden");

    if (favoritesOnlyToggle) favoritesOnlyToggle.checked = favoritesOnly;
    if (studyTitle) studyTitle.textContent = s.name;
    if (studyMeta) {
      studyMeta.textContent =
        `${(s.terms?.length || 0)} terms • updated ${new Date(s.updatedAt || s.createdAt).toLocaleDateString()}`;
    }

    ensureWriteTab();

    switchTab(currentTab);
    renderTerms();
    prepareFlashcards(true);
    prepareGimkit(true);
    prepareMatch(true);
    prepareWrite(true);
    renderTestHistory();
    renderStats();
  }

  function switchTab(tabName) {
    currentTab = tabName;

    // update tab active
    [...tabs, ...(writeTabBtn ? [writeTabBtn] : [])].forEach(t =>
      t.classList.toggle("active", t.dataset.tab === tabName)
    );

    Object.entries(panels).forEach(([k, elx]) => elx?.classList.toggle("hidden", k !== tabName));

    if (tabName === "terms") renderTerms();
    if (tabName === "flashcards") prepareFlashcards(false);
    if (tabName === "gimkit") prepareGimkit(false);
    if (tabName === "match") prepareMatch(false);
    if (tabName === "write") prepareWrite(false);
    if (tabName === "test") renderTestHistory();
    if (tabName === "stats") renderStats();
  }

  /* =========================================================
     STUDIES LIST
  ========================================================= */
  function renderStudies() {
    const q = (studySearch?.value || "").trim().toLowerCase();
    const items = (db.studies || [])
      .slice()
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
      .filter(s => !q || (s.name || "").toLowerCase().includes(q));

    if (!studiesList) return;
    studiesList.innerHTML = "";

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.innerHTML = `No studies yet. Click <b>Create</b> to make one.`;
      studiesList.appendChild(empty);
      return;
    }

    items.forEach(s => {
      const row = document.createElement("div");
      row.className = "studyItem";

      const left = document.createElement("div");
      left.style.flex = "1";

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = s.name;

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent =
        `${(s.terms || []).length} terms • ${(s.tests || []).length} tests • updated ${new Date(s.updatedAt || s.createdAt).toLocaleDateString()}`;

      left.appendChild(name);
      left.appendChild(meta);

      const right = document.createElement("div");
      right.className = "right";

      const openBtn = document.createElement("button");
      openBtn.className = "btn primary";
      openBtn.textContent = "Open";
      openBtn.onclick = () => openStudy(s.id);

      const delBtn = document.createElement("button");
      delBtn.className = "btn danger";
      delBtn.textContent = "Delete";
      delBtn.onclick = () => {
        if (!confirm(`Delete "${s.name}"? This cannot be undone.`)) return;
        db.studies = db.studies.filter(x => x.id !== s.id);
        persistAll();
        renderStudies();
      };

      right.appendChild(openBtn);
      right.appendChild(delBtn);

      row.appendChild(left);
      row.appendChild(right);
      studiesList.appendChild(row);
    });
  }

  function createStudy(name) {
    const nm = (name || "").trim();
    if (!nm) return alert("Give your study a name.");

    const s = {
      id: uid(),
      name: nm,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      terms: [],
      tests: []
    };
    db.studies.push(s);
    persistAll();
    renderStudies();
    openStudy(s.id);
  }

  /* =========================================================
     TERMS CRUD + BULK IMPORT + IMAGE UPLOAD UI (AUTO)
  ========================================================= */
  let termQType = "text";
  let termAType = "text";
  let termQImg = "";
  let termAImg = "";
  let termImgUIReady = false;

  function ensureTermImageUI() {
    if (termImgUIReady) return;
    if (!termQ || !termA) return;

    const wrap = termA.parentElement; // usually same area
    if (!wrap) return;

    const qRow = el("div", { class: "row", style: "gap:8px; align-items:center; margin-top:8px;" }, [
      el("div", { class: "pill", text: "Question type:" }),
    ]);

    const qTypeSel = el("select", { class: "input", style: "max-width:160px;" }, []);
    qTypeSel.appendChild(el("option", { value: "text", text: "Text" }));
    qTypeSel.appendChild(el("option", { value: "img", text: "Image" }));
    qTypeSel.value = "text";

    const qFile = el("input", { type: "file", accept: "image/*", class: "input", style: "max-width:260px;" });
    const qPrev = el("div", { class: "muted", text: "" });

    qRow.appendChild(qTypeSel);
    qRow.appendChild(qFile);
    qRow.appendChild(qPrev);

    const aRow = el("div", { class: "row", style: "gap:8px; align-items:center; margin-top:8px;" }, [
      el("div", { class: "pill", text: "Answer type:" }),
    ]);

    const aTypeSel = el("select", { class: "input", style: "max-width:160px;" }, []);
    aTypeSel.appendChild(el("option", { value: "text", text: "Text" }));
    aTypeSel.appendChild(el("option", { value: "img", text: "Image" }));
    aTypeSel.value = "text";

    const aFile = el("input", { type: "file", accept: "image/*", class: "input", style: "max-width:260px;" });
    const aPrev = el("div", { class: "muted", text: "" });

    aRow.appendChild(aTypeSel);
    aRow.appendChild(aFile);
    aRow.appendChild(aPrev);

    // Insert after answer input
    wrap.appendChild(qRow);
    wrap.appendChild(aRow);

    function refreshVisibility() {
      termQType = qTypeSel.value;
      termAType = aTypeSel.value;

      termQ.style.display = (termQType === "img") ? "none" : "";
      termA.style.display = (termAType === "img") ? "none" : "";

      qFile.style.display = (termQType === "img") ? "" : "none";
      aFile.style.display = (termAType === "img") ? "" : "none";

      qPrev.textContent = (termQType === "img" && termQImg) ? "✅ image selected" : "";
      aPrev.textContent = (termAType === "img" && termAImg) ? "✅ image selected" : "";
    }

    qTypeSel.onchange = () => {
      if (qTypeSel.value === "text") termQImg = "";
      refreshVisibility();
    };
    aTypeSel.onchange = () => {
      if (aTypeSel.value === "text") termAImg = "";
      refreshVisibility();
    };

    qFile.onchange = async () => {
      const f = qFile.files?.[0];
      if (!f) return;
      termQImg = await fileToDataURL(f);
      refreshVisibility();
    };

    aFile.onchange = async () => {
      const f = aFile.files?.[0];
      if (!f) return;
      termAImg = await fileToDataURL(f);
      refreshVisibility();
    };

    // expose for edit fills
    ensureTermImageUI._set = (t) => {
      termQType = t?.qType || "text";
      termAType = t?.aType || "text";
      termQImg = t?.qImg || "";
      termAImg = t?.aImg || "";
      qTypeSel.value = termQType;
      aTypeSel.value = termAType;
      qFile.value = "";
      aFile.value = "";
      refreshVisibility();
    };

    ensureTermImageUI._clear = () => {
      termQType = "text";
      termAType = "text";
      termQImg = "";
      termAImg = "";
      qTypeSel.value = "text";
      aTypeSel.value = "text";
      qFile.value = "";
      aFile.value = "";
      refreshVisibility();
    };

    refreshVisibility();
    termImgUIReady = true;
  }

  function renderTerms() {
    ensureTermImageUI();

    const s = getStudy(currentStudyId);
    if (!s || !termsList) return;

    const q = (termSearch?.value || "").trim().toLowerCase();
    const terms = (s.terms || []).slice();

    const filtered = terms.filter(t => {
const qTxt = (t.q || "").toLowerCase();
const aTxt = (t.a || "").toLowerCase();
const qHit = (t.qType === "img") ? "[image]".includes(q) : qTxt.includes(q);
const aHit = (t.aType === "img") ? "[image]".includes(q) : aTxt.includes(q);
return !q || qHit || aHit;    });

    termsList.innerHTML = "";

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "No terms found. Add one or use Bulk Import.";
      termsList.appendChild(empty);
      return;
    }

    filtered.forEach(t => {
      ensureTermStats(t);

      const wrap = document.createElement("div");
      wrap.className = "termRow";

      const top = document.createElement("div");
      top.className = "termTop";

      const qEl = document.createElement("div");
      qEl.className = "termQ";
      qEl.innerHTML = "";
      qEl.appendChild(renderTermSide("q", t));

      const actions = document.createElement("div");
      actions.className = "termActions";

      const favBtn = document.createElement("button");
      favBtn.className = "iconBtn";
      favBtn.title = t.fav ? "Unfavorite" : "Favorite";
      favBtn.textContent = t.fav ? "★" : "☆";
      favBtn.onclick = () => {
        t.fav = !t.fav;
        s.updatedAt = Date.now();
        persistAll();
        renderTerms();
      };

      const editBtn = document.createElement("button");
      editBtn.className = "iconBtn";
      editBtn.title = "Edit";
      editBtn.textContent = "✎";
      editBtn.onclick = () => {
        editingTermId = t.id;
        if (termQ) termQ.value = t.q || "";
        if (termA) termA.value = t.a || "";
        if (saveTermBtn) saveTermBtn.textContent = "Save changes";
        if (cancelEditTermBtn) cancelEditTermBtn.disabled = false;
        ensureTermImageUI();
        if (ensureTermImageUI._set) ensureTermImageUI._set(t);
        termQ?.focus();
      };

      const delBtn = document.createElement("button");
      delBtn.className = "iconBtn";
      delBtn.title = "Delete";
      delBtn.textContent = "🗑";
      delBtn.onclick = () => {
        if (!confirm("Delete this term?")) return;
        s.terms = s.terms.filter(x => x.id !== t.id);
        s.updatedAt = Date.now();
        persistAll();
        renderTerms();
        prepareFlashcards(true);
        prepareGimkit(true);
        prepareMatch(true);
        prepareWrite(true);
        renderStats();
      };

      actions.appendChild(favBtn);
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      top.appendChild(qEl);
      top.appendChild(actions);

      const aEl = document.createElement("div");
      aEl.className = "termA";
      aEl.innerHTML = "";
      aEl.appendChild(renderTermSide("a", t));

      const st = document.createElement("div");
      st.className = "muted";
      st.style.marginTop = "8px";
      const missPct = percent(t.stats.wrong, t.stats.seen);
      st.textContent = `Missed: ${t.stats.wrong}/${t.stats.seen} (${missPct}%)`;

      wrap.appendChild(top);
      wrap.appendChild(aEl);
      wrap.appendChild(st);

      termsList.appendChild(wrap);
    });

    if (studyMeta) {
      studyMeta.textContent =
        `${(s.terms?.length || 0)} terms • updated ${new Date(s.updatedAt || s.createdAt).toLocaleDateString()}`;
    }
  }

  function saveTerm() {
    ensureTermImageUI();

    const s = getStudy(currentStudyId);
    if (!s) return;

    const qTxt = (termQ?.value || "").trim();
    const aTxt = (termA?.value || "").trim();

    const qOk = (termQType === "img") ? !!termQImg : !!qTxt;
    const aOk = (termAType === "img") ? !!termAImg : !!aTxt;

    if (!qOk || !aOk) return alert("Please enter both question and answer (text or image).");

    if (editingTermId) {
      const t = s.terms.find(x => x.id === editingTermId);
      if (t) {
        t.qType = termQType;
        t.aType = termAType;
        t.q = (termQType === "text") ? qTxt : "";
        t.a = (termAType === "text") ? aTxt : "";
        t.qImg = (termQType === "img") ? termQImg : "";
        t.aImg = (termAType === "img") ? termAImg : "";
      }
      editingTermId = null;
    } else {
      s.terms.push({
        id: uid(),
        fav: false,
        stats: { seen: 0, wrong: 0 },
        qType: termQType,
        aType: termAType,
        q: (termQType === "text") ? qTxt : "",
        a: (termAType === "text") ? aTxt : "",
        qImg: (termQType === "img") ? termQImg : "",
        aImg: (termAType === "img") ? termAImg : ""
      });
    }

    s.updatedAt = Date.now();
    persistAll();

    if (termQ) termQ.value = "";
    if (termA) termA.value = "";
    if (saveTermBtn) saveTermBtn.textContent = "Add term";
    if (cancelEditTermBtn) cancelEditTermBtn.disabled = true;
    if (ensureTermImageUI._clear) ensureTermImageUI._clear();

    renderTerms();
    prepareFlashcards(true);
    prepareGimkit(true);
    prepareMatch(true);
    prepareWrite(true);
    renderStats();
  }

  function cancelEdit() {
    editingTermId = null;
    if (termQ) termQ.value = "";
    if (termA) termA.value = "";
    if (saveTermBtn) saveTermBtn.textContent = "Add term";
    if (cancelEditTermBtn) cancelEditTermBtn.disabled = true;
    ensureTermImageUI();
    if (ensureTermImageUI._clear) ensureTermImageUI._clear();
  }

  // Bulk parser: Question/Answer (first slash) = TEXT ONLY
  function parseLineToQA(line) {
    const raw = line.trim();
    if (!raw) return null;

    const slashIndex = raw.indexOf("/");
    if (slashIndex > 0 && slashIndex < raw.length - 1) {
      const q = raw.slice(0, slashIndex).trim();
      const a = raw.slice(slashIndex + 1).trim();
      if (q && a) return { q, a };
    }
    return null;
  }

  function bulkImport() {
    const s = getStudy(currentStudyId);
    if (!s) return;

    const text = (bulkInput?.value || "").trim();
    if (!text) return alert("Paste some lines first.");

    const lines = text.split("\n");
    let added = 0;
    let skipped = 0;

    lines.forEach(line => {
      const qa = parseLineToQA(line);
      if (!qa) { skipped++; return; }
      s.terms.push({
        id: uid(),
        qType: "text",
        aType: "text",
        q: qa.q,
        a: qa.a,
        qImg: "",
        aImg: "",
        fav: false,
        stats: { seen: 0, wrong: 0 }
      });
      added++;
    });

    s.updatedAt = Date.now();
    persistAll();

    renderTerms();
    prepareFlashcards(true);
    prepareGimkit(true);
    prepareMatch(true);
    prepareWrite(true);
    renderStats();

    alert(`Imported ${added} term(s). Skipped ${skipped} line(s).`);
  }

  /* =========================================================
     FLASHCARDS (supports image Q/A)
  ========================================================= */
  function prepareFlashcards(forceRestart) {
    const s = getStudy(currentStudyId);
    if (!s) return;

    const terms = studyTerms(s);
    if (!terms.length) {
      if (fcQ) fcQ.textContent = "No terms yet.";
      if (fcA) fcA.textContent = "Add terms in the Terms tab.";
      if (fcCounter) fcCounter.textContent = "0 / 0";
      return;
    }

    if (forceRestart || !fcOrder.length) {
      fcOrder = weightedOrderByMiss(terms);
      fcIndex = 0;
      flashInner?.classList.remove("flipped");
    } else {
      const newIds = terms.map(t => t.id);
      const stillValid = fcOrder.filter(id => newIds.includes(id));
      fcOrder = stillValid.length ? stillValid : weightedOrderByMiss(terms);
      fcIndex = clamp(fcIndex, 0, fcOrder.length - 1);
      flashInner?.classList.remove("flipped");
    }

    renderFlashcard();
  }

  function renderFlashcard() {
    const s = getStudy(currentStudyId);
    if (!s) return;

    const id = fcOrder[fcIndex];
    const t = (s.terms || []).find(x => x.id === id);
    if (!t) return prepareFlashcards(true);
    ensureTermStats(t);

    if (fcQ) {
      fcQ.innerHTML = "";
      fcQ.appendChild(renderTermSide("q", t));
    }
    if (fcA) {
      fcA.innerHTML = "";
      fcA.appendChild(renderTermSide("a", t));
    }
    if (fcCounter) fcCounter.textContent = `${fcIndex + 1} / ${fcOrder.length}`;
  }

  /* =========================================================
     GIMKIT (supports image answers in choices)
  ========================================================= */
  function prepareGimkit(forceRestart) {
    const s = getStudy(currentStudyId);
    if (!s) return;

    const terms = studyTerms(s);

    if (!terms.length) {
      if (gkPrompt) gkPrompt.textContent = "No terms yet.";
      if (gkChoices) gkChoices.innerHTML = "";
      if (gkCounter) gkCounter.textContent = "0 / 0";
      gkFeedback?.classList.add("hidden");
      gkNextBtn?.classList.add("hidden");
      return;
    }

    if (forceRestart || !gkOrder.length) {
      gkOrder = weightedOrderByMiss(terms);
      gkIndex = 0;
    } else {
      const newIds = terms.map(t => t.id);
      const filtered = gkOrder.filter(id => newIds.includes(id));
      gkOrder = filtered.length ? filtered : weightedOrderByMiss(terms);
      gkIndex = clamp(gkIndex, 0, gkOrder.length - 1);
    }

    gkLocked = false;
    gkFeedback?.classList.add("hidden");
    gkNextBtn?.classList.add("hidden");
    renderGimkitQuestion();
  }

  function renderGimkitQuestion() {
    const s = getStudy(currentStudyId);
    if (!s) return;

    const terms = studyTerms(s);
    if (!terms.length) return;

    if (gkIndex >= gkOrder.length) {
      gkOrder = weightedOrderByMiss(terms);
      gkIndex = 0;
    }

    const termId = gkOrder[gkIndex];
    gkLastTermId = termId;

    const t = (s.terms || []).find(x => x.id === termId);
    if (!t) { gkIndex++; return renderGimkitQuestion(); }
    ensureTermStats(t);

    if (gkPrompt) {
      gkPrompt.innerHTML = "";
      gkPrompt.appendChild(renderTermSide("q", t));
    }
    if (gkCounter) gkCounter.textContent = `${gkIndex + 1} / ${gkOrder.length}`;

    // Build wrong choices from other terms' answers (keep type)
    const pool = terms
      .filter(x => x.id !== termId)
      .map(x => ({ aType: x.aType, a: x.a, aImg: x.aImg }))
      .filter(x => (x.aType === "img" ? !!x.aImg : !!x.a));

    const wrongs = shuffle(pool).slice(0, 3);

    const correctChoice = { aType: t.aType, a: t.a, aImg: t.aImg, _correct: true };
    const choices = shuffle([correctChoice, ...wrongs.map(w => ({ ...w, _correct: false }))]);

    while (choices.length < 4) choices.push({ aType: "text", a: "—", aImg: "", _correct: false });
    const finalChoices = choices.slice(0, 4);

    if (gkChoices) gkChoices.innerHTML = "";
    gkLocked = false;
    gkFeedback?.classList.add("hidden");
    gkNextBtn?.classList.add("hidden");

    finalChoices.forEach(choice => {
      const btn = document.createElement("button");
      btn.className = "choice";
      btn.dataset.correct = choice._correct ? "1" : "0";
      btn.innerHTML = "";

      if (choice.aType === "img" && choice.aImg) {
        const im = document.createElement("img");
        im.src = choice.aImg;
        im.alt = "choice";
        im.style.maxHeight = "90px";
        im.style.maxWidth = "100%";
        im.style.borderRadius = "10px";
        btn.appendChild(im);
      } else {
        btn.textContent = choice.a || "—";
      }

      btn.onclick = () => onGimkitPick(btn, choice);
      gkChoices?.appendChild(btn);
    });
  }

  function isSameChoice(choice, correctTerm) {
    if (correctTerm.aType === "img") return choice.aType === "img" && choice.aImg && choice.aImg === correctTerm.aImg;
    return choice.aType === "text" && (choice.a || "") === (correctTerm.a || "");
  }

  function onGimkitPick(btn, choice) {
    if (gkLocked) return;

    const s = getStudy(currentStudyId);
    if (!s) return;

    const term = (s.terms || []).find(t => t.id === gkLastTermId);
    if (!term) return;

    ensureTermStats(term);
    term.stats.seen += 1;

    const isCorrect = isSameChoice(choice, term);
    if (!isCorrect) term.stats.wrong += 1;

    gkLocked = true;

    [...(gkChoices?.querySelectorAll(".choice") || [])].forEach(b => {
      const wasCorrect = b.dataset.correct === "1";
      if (wasCorrect) b.classList.add("correct");
      if (b === btn && !isCorrect) b.classList.add("wrong");
      b.disabled = true;
    });

    gkFeedback?.classList.remove("hidden");
    if (gkFeedback) gkFeedback.textContent = isCorrect ? "Correct." : "Wrong. (Correct choice highlighted)";
    gkNextBtn?.classList.remove("hidden");

    s.updatedAt = Date.now();
    persistAll();
    renderStats();
  }

  function gimkitNext() {
    gkIndex += 1;
    gkLocked = false;
    renderGimkitQuestion();
  }

  /* =========================================================
     MATCH MODE (supports image answers + image questions)
  ========================================================= */
  function prepareMatch(forceRestart) {
    const s = getStudy(currentStudyId);
    if (!s) return;

    const terms = studyTerms(s);
    if (!terms.length) {
      if (matchQs) matchQs.innerHTML = "";
      if (matchAs) matchAs.innerHTML = "";
      if (matchStatus) matchStatus.textContent = "Add terms first.";
      return;
    }

    if (forceRestart || !matchState) {
      const round = shuffle(terms).slice(0, Math.min(10, terms.length));
      const answers = shuffle(round.map(t => ({
        id: t.id,
        aType: t.aType,
        a: t.a,
        aImg: t.aImg
      })));
      matchState = { round, answers, solved: new Set(), attempts: 0 };
    }

    renderMatch();
  }

  function renderMatch() {
    const s = getStudy(currentStudyId);
    if (!s || !matchState) return;

    if (matchQs) matchQs.innerHTML = "";
    if (matchAs) matchAs.innerHTML = "";

    // Questions (droppable)
    matchState.round.forEach(t => {
      const card = document.createElement("div");
      card.className = "matchCard";

      const q = document.createElement("div");
      q.style.fontWeight = "950";
      q.innerHTML = "";
      q.appendChild(renderTermSide("q", t));

      const drop = document.createElement("div");
      drop.className = "matchDrop";
      drop.dataset.termId = t.id;
      drop.textContent = matchState.solved.has(t.id) ? "✅ Matched" : "Drop answer here";

      drop.ondragover = (e) => e.preventDefault();
      drop.ondrop = (e) => {
        e.preventDefault();
        const ansId = e.dataTransfer.getData("text/termId");
        handleMatchDrop(t.id, ansId, drop);
      };

      card.appendChild(q);
      card.appendChild(drop);
      matchQs?.appendChild(card);
    });

    // Answers (draggable)
    matchState.answers.forEach(x => {
      if (matchState.solved.has(x.id)) return;

      const a = document.createElement("div");
      a.className = "matchCard dragAns";
      a.draggable = true;
      a.ondragstart = (e) => e.dataTransfer.setData("text/termId", x.id);

      a.innerHTML = "";
      if (x.aType === "img" && x.aImg) {
        const img = document.createElement("img");
        img.className = "matchImg";
        img.src = x.aImg;
        img.alt = "answer";
        img.style.maxWidth = "140px";
        img.style.maxHeight = "90px";
        img.style.borderRadius = "10px";
        a.appendChild(img);
      } else {
        a.textContent = x.a || "—";
      }

      matchAs?.appendChild(a);
    });

    const total = matchState.round.length;
    const done = matchState.solved.size;
    if (matchStatus) matchStatus.textContent = `Matched ${done}/${total}. Attempts: ${matchState.attempts}`;
  }

  function handleMatchDrop(questionTermId, answerTermId, dropEl) {
    const s = getStudy(currentStudyId);
    if (!s || !matchState) return;

    matchState.attempts++;

    const correct = (questionTermId === answerTermId);

    const term = (s.terms || []).find(t => t.id === questionTermId);
    if (term) {
      ensureTermStats(term);
      term.stats.seen += 1;
      if (!correct) term.stats.wrong += 1;
    }

    if (correct) {
      matchState.solved.add(questionTermId);
      dropEl.classList.add("matchGood");
    } else {
      dropEl.classList.add("matchBad");
      setTimeout(() => dropEl.classList.remove("matchBad"), 450);
    }

    s.updatedAt = Date.now();
    persistAll();
    renderStats();

    if (matchState.solved.size === matchState.round.length) {
      if (matchStatus) matchStatus.textContent = `Round complete! Attempts: ${matchState.attempts}. Hit Restart for a new round.`;
    }

    renderMatch();
  }

  /* =========================================================
     TEST MODE (supports image answers via self-check)
  ========================================================= */
  function resetTestUI() {
    activeTest = null;
    testArea?.classList.add("hidden");
    submitTestBtn?.classList.add("hidden");
    testResults?.classList.add("hidden");
    if (testResults) testResults.innerHTML = "";
    if (testArea) testArea.innerHTML = "";
  }

  function startTest() {
    const s = getStudy(currentStudyId);
    if (!s) return;

    const terms = studyTerms(s);
    if (!terms.length) return alert("No terms available. Add terms first.");

    let n = parseInt(testCount?.value || "10", 10);
    if (Number.isNaN(n)) n = 1;
    n = clamp(n, 1, terms.length);
    if (testCount) testCount.value = String(n);

    const ids = shuffle(terms.map(t => t.id)).slice(0, n);
    activeTest = { ids, answers: new Map(), selfMarks: new Map() };

    if (testArea) testArea.innerHTML = "";

    ids.forEach((id, idx) => {
      const term = (s.terms || []).find(t => t.id === id);
      if (!term) return;
      ensureTermStats(term);

      const wrap = document.createElement("div");
      wrap.className = "testQ";

      const qText = document.createElement("div");
      qText.className = "qText";
      qText.textContent = `${idx + 1}. `;

      const qContent = document.createElement("div");
      qContent.style.marginTop = "6px";
      qContent.appendChild(renderTermSide("q", term));

      wrap.appendChild(qText);
      wrap.appendChild(qContent);

      if (term.aType === "img") {
        const hint = document.createElement("div");
        hint.className = "muted";
        hint.style.marginTop = "8px";
        hint.textContent = "Answer is an image — you'll self-mark after submit.";
        wrap.appendChild(hint);
      } else {
        const input = document.createElement("input");
        input.className = "input";
        input.placeholder = "Type your answer...";
        input.oninput = () => activeTest.answers.set(id, input.value);
        wrap.appendChild(input);
      }

      testArea?.appendChild(wrap);
    });

    testArea?.classList.remove("hidden");
    submitTestBtn?.classList.remove("hidden");
    testResults?.classList.add("hidden");
    if (testResults) testResults.innerHTML = "";
  }

  function submitTest() {
    const s = getStudy(currentStudyId);
    if (!s || !activeTest) return;

    const results = [];
    let correctCount = 0;

    activeTest.ids.forEach(id => {
      const term = (s.terms || []).find(t => t.id === id);
      if (!term) return;

      ensureTermStats(term);
      term.stats.seen += 1;

      if (term.aType === "img") {
        // default unknown until self mark
        results.push({ termId: id, your: "(self-check)", correctType: "img", correctImg: term.aImg, ok: null });
        return;
      }

      const your = (activeTest.answers.get(id) || "").trim();
      const corr = (term.a || "").trim();
      const ok = normAnswerText(your) === normAnswerText(corr);

      if (!ok) term.stats.wrong += 1;
      if (ok) correctCount++;

      results.push({ termId: id, your, correctType: "text", correct: corr, ok });
    });

    // If any image answers exist, we show self-check buttons inside results
    const hasSelf = results.some(r => r.ok === null);

    s.tests = s.tests || [];
    s.tests.unshift({
      id: uid(),
      date: Date.now(),
      total: results.length,
      correct: correctCount, // will update after self check if any
      wrongIds: results.filter(r => r.ok === false).map(r => r.termId),
      results
    });

    s.updatedAt = Date.now();
    persistAll();

    testResults?.classList.remove("hidden");
    submitTestBtn?.classList.add("hidden");

    renderTestResultCard(s.tests[0], hasSelf);
    renderTestHistory();
    renderStats();
  }

  function renderTestResultCard(testObj, hasSelf) {
    const s = getStudy(currentStudyId);
    if (!s || !testResults) return;

    const total = testObj.total;
    const knownCorrect = testObj.results.filter(r => r.ok === true).length;
    const knownWrong = testObj.results.filter(r => r.ok === false).length;
    const unknown = testObj.results.filter(r => r.ok === null).length;

    let html = `<div class="pill">Score so far: ${knownCorrect}/${total} (${percent(knownCorrect, total)}%)</div>`;
    if (unknown) {
      html += `<div class="muted" style="margin-top:8px;">Self-check needed: ${unknown} image answer(s)</div>`;
    }

    html += `<div class="list" style="margin-top:10px;">`;

    testObj.results.forEach((r, i) => {
      const term = (s.terms || []).find(t => t.id === r.termId);

      if (r.ok === null) {
        html += `
          <div class="studyItem">
            <div style="flex:1">
              <div class="name">${escapeHTML((i + 1) + ". " + (term?.q || "?"))}</div>
              <div class="meta">Correct answer (image):</div>
              <div style="margin-top:8px;">
                ${term?.aImg ? `<img src="${term.aImg}" style="max-width:180px; max-height:120px; border-radius:10px;" />` : "—"}
              </div>
              <div class="row" style="margin-top:10px; gap:8px;">
                <button class="btn primary" data-self="good" data-term="${r.termId}">I was correct</button>
                <button class="btn danger" data-self="bad" data-term="${r.termId}">I was wrong</button>
              </div>
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="studyItem">
            <div style="flex:1">
              <div class="name">${escapeHTML((i + 1) + ". " + (term?.q || "?"))}</div>
              <div class="meta">
                Your answer: <b>${escapeHTML(r.your || "—")}</b> •
                Correct: <b>${escapeHTML(r.correct || "—")}</b> •
                ${r.ok ? "✅" : "❌"}
              </div>
            </div>
          </div>
        `;
      }
    });

    html += `</div>`;
    testResults.innerHTML = html;

    if (hasSelf) {
      [...testResults.querySelectorAll("button[data-self]")].forEach(btn => {
        btn.addEventListener("click", () => {
          const termId = btn.getAttribute("data-term");
          const good = btn.getAttribute("data-self") === "good";
          selfMarkTestImage(termId, good);
        });
      });
    }
  }

  function selfMarkTestImage(termId, wasCorrect) {
    const s = getStudy(currentStudyId);
    if (!s) return;
    const last = (s.tests || [])[0];
    if (!last) return;

    const r = last.results.find(x => x.termId === termId);
    if (!r || r.ok !== null) return;

    const term = (s.terms || []).find(t => t.id === termId);
    if (!term) return;

    ensureTermStats(term);
    if (!wasCorrect) term.stats.wrong += 1;

    r.ok = wasCorrect;

    // recompute test correct
    last.correct = last.results.filter(x => x.ok === true).length;
    last.wrongIds = last.results.filter(x => x.ok === false).map(x => x.termId);

    s.updatedAt = Date.now();
    persistAll();

    renderTestResultCard(last, last.results.some(x => x.ok === null));
    renderTestHistory();
    renderStats();
  }

  function renderTestHistory() {
    const s = getStudy(currentStudyId);
    if (!s || !testHistory) return;

    const tests = (s.tests || []).slice(0, 20);
    testHistory.innerHTML = "";

    if (!tests.length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "No tests yet. Start one to save results here.";
      testHistory.appendChild(empty);
      return;
    }

    tests.forEach(t => {
      const row = document.createElement("div");
      row.className = "studyItem";

      const left = document.createElement("div");
      left.style.flex = "1";

      const scorePct = percent(t.correct, t.total);

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = `${t.correct}/${t.total} (${scorePct}%)`;

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `Taken: ${fmtDateTime(t.date)} • Missed: ${t.total - t.correct}`;

      left.appendChild(name);
      left.appendChild(meta);

      const right = document.createElement("div");
      right.className = "right";

      const viewBtn = document.createElement("button");
      viewBtn.className = "btn";
      viewBtn.textContent = "View";
      viewBtn.onclick = () => {
        testResults?.classList.remove("hidden");
        submitTestBtn?.classList.add("hidden");
        renderTestResultCard(t, t.results?.some(r => r.ok === null));
      };

      const delBtn = document.createElement("button");
      delBtn.className = "btn danger";
      delBtn.textContent = "Delete";
      delBtn.onclick = () => {
        if (!confirm("Delete this test record?")) return;
        s.tests = (s.tests || []).filter(x => x.id !== t.id);
        s.updatedAt = Date.now();
        persistAll();
        renderTestHistory();
      };

      right.appendChild(viewBtn);
      right.appendChild(delBtn);

      row.appendChild(left);
      row.appendChild(right);
      testHistory.appendChild(row);
    });
  }

  /* =========================================================
     STATS
  ========================================================= */
  function renderStats() {
    const s = getStudy(currentStudyId);
    if (!s || !mostMissed || !studyStatsSummary) return;

    const terms = (s.terms || []).map(ensureTermStats);
    const sorted = terms
      .slice()
      .sort((a, b) => {
        const ap = percent(a.stats.wrong, a.stats.seen);
        const bp = percent(b.stats.wrong, b.stats.seen);
        if (bp !== ap) return bp - ap;
        return (b.stats.wrong - a.stats.wrong);
      })
      .slice(0, 12);

    mostMissed.innerHTML = "";
    if (!sorted.length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "No stats yet. Do Gimkit / Match / Write / Tests to generate stats.";
      mostMissed.appendChild(empty);
    } else {
      sorted.forEach(t => {
        const row = document.createElement("div");
        row.className = "studyItem";

        const left = document.createElement("div");
        left.style.flex = "1";

        const name = document.createElement("div");
        name.className = "name";
        name.textContent = (t.qType === "text" ? t.q : "[Image Question]");

        const missPct = percent(t.stats.wrong, t.stats.seen);
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = `Missed: ${t.stats.wrong}/${t.stats.seen} (${missPct}%)`;

        left.appendChild(name);
        left.appendChild(meta);

        const right = document.createElement("div");
        right.className = "right";
        const fav = document.createElement("div");
        fav.className = "pill";
        fav.textContent = t.fav ? "★ Favorite" : "☆ Not favorite";
        right.appendChild(fav);

        row.appendChild(left);
        row.appendChild(right);

        mostMissed.appendChild(row);
      });
    }

    const totalTerms = (s.terms || []).length;
    const favCount = (s.terms || []).filter(t => t.fav).length;
    const totalSeen = (s.terms || []).reduce((acc, t) => acc + (t.stats?.seen || 0), 0);
    const totalWrong = (s.terms || []).reduce((acc, t) => acc + (t.stats?.wrong || 0), 0);
    const missPctTotal = percent(totalWrong, totalSeen);

    const tests = s.tests || [];
    const lastTest = tests[0] || null;

    studyStatsSummary.innerHTML = "";
    const boxes = [
      { big: String(totalTerms), small: "Total terms" },
      { big: String(favCount), small: "Favorites" },
      { big: `${missPctTotal}%`, small: "Overall miss %" },
      { big: String(tests.length), small: "Tests taken" }
    ];
    boxes.forEach(b => {
      const box = document.createElement("div");
      box.className = "statBox";
      box.innerHTML = `<div class="big">${b.big}</div><div class="small">${b.small}</div>`;
      studyStatsSummary.appendChild(box);
    });

    if (lastTest) {
      const scorePct = percent(lastTest.correct, lastTest.total);
      const extra = document.createElement("div");
      extra.className = "statBox";
      extra.style.gridColumn = "1 / -1";
      extra.innerHTML = `<div class="big">Last test: ${scorePct}%</div><div class="small">${fmtDateTime(lastTest.date)}</div>`;
      studyStatsSummary.appendChild(extra);
    }
  }

  /* =========================================================
     STUDY ACTIONS
  ========================================================= */
  function renameStudy() {
    const s = getStudy(currentStudyId);
    if (!s) return;
    const nm = prompt("New study name:", s.name);
    if (nm == null) return;
    const name = nm.trim();
    if (!name) return;
    s.name = name;
    s.updatedAt = Date.now();
    persistAll();
    if (studyTitle) studyTitle.textContent = s.name;
    renderStudies();
  }

  function deleteCurrentStudy() {
    const s = getStudy(currentStudyId);
    if (!s) return;
    if (!confirm(`Delete "${s.name}"? This cannot be undone.`)) return;
    db.studies = db.studies.filter(x => x.id !== s.id);
    persistAll();
    showHome();
  }

  /* =========================================================
     IMPORT / EXPORT JSON + SAME-NAME MERGE/REPLACE
  ========================================================= */
  function downloadJSON(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function openImportModal() {
    importModal?.classList.remove("hidden");
    if (importText) importText.value = "";
    importText?.focus();
  }
  function closeImportModal() {
    importModal?.classList.add("hidden");
  }

  function dedupeKey(q, a) {
    return `${normalizeName(q)}||${normalizeName(a)}`;
  }

  function mergeStudyInto(existing, incoming) {
    existing.terms = existing.terms || [];
    existing.tests = existing.tests || [];

    // Dedup by (q,a) ONLY for text terms; images are treated as unique
    const have = new Set(existing.terms
      .filter(t => (t.qType || "text") === "text" && (t.aType || "text") === "text")
      .map(t => dedupeKey(t.q, t.a)));

    (incoming.terms || []).forEach(t => {
      const qt = t.qType || "text";
      const at = t.aType || "text";

      if (qt === "text" && at === "text") {
        const k = dedupeKey(t.q, t.a);
        if (have.has(k)) return;
        have.add(k);
      }

      existing.terms.push({
        id: uid(),
        qType: qt,
        aType: at,
        q: (t.q || "").trim(),
        a: (t.a || "").trim(),
        qImg: t.qImg || "",
        aImg: t.aImg || "",
        fav: !!t.fav,
        stats: t.stats ? { seen: +t.stats.seen || 0, wrong: +t.stats.wrong || 0 } : { seen: 0, wrong: 0 }
      });
    });

    (incoming.tests || []).forEach(t => {
      existing.tests.unshift({
        id: uid(),
        date: t.date || Date.now(),
        total: t.total || 0,
        correct: t.correct || 0,
        wrongIds: [],
        results: t.results || []
      });
    });

    existing.updatedAt = Date.now();
  }

  function cleanIncomingStudy(study) {
    return {
      id: uid(),
      name: (study.name || "Imported Study").trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      terms: (study.terms || []).map(t => ({
        id: uid(),
        qType: t.qType || "text",
        aType: t.aType || "text",
        q: (t.q || "").trim(),
        a: (t.a || "").trim(),
        qImg: t.qImg || "",
        aImg: t.aImg || "",
        fav: !!t.fav,
        stats: t.stats ? { seen: +t.stats.seen || 0, wrong: +t.stats.wrong || 0 } : { seen: 0, wrong: 0 }
      })),
      tests: (study.tests || []).map(t => ({
        id: uid(),
        date: t.date || Date.now(),
        total: t.total || 0,
        correct: t.correct || 0,
        wrongIds: [],
        results: t.results || []
      }))
    };
  }

  function importJSONPayload(payload) {
    const incomingStudies =
      payload?.db?.studies ? payload.db.studies :
      payload?.study ? [payload.study] :
      payload?.studies ? payload.studies :
      null;

    if (!incomingStudies || !Array.isArray(incomingStudies) || !incomingStudies.length) {
      alert("No studies found in that JSON.");
      return;
    }

    let imported = 0;

    incomingStudies.forEach(raw => {
      const incoming = cleanIncomingStudy(raw);
      const existing = db.studies.find(s => normalizeName(s.name) === normalizeName(incoming.name));

      if (!existing) {
        db.studies.push(incoming);
        imported++;
        return;
      }

      const merge = confirm(
        `A study named "${existing.name}" already exists.\n\nOK = Merge into existing\nCancel = Replace (delete old)`
      );

      if (merge) {
        mergeStudyInto(existing, incoming);
        imported++;
      } else {
        const sure = confirm(`Replace will delete the old "${existing.name}" and import the new one. Continue?`);
        if (!sure) return;
        db.studies = db.studies.filter(s => s.id !== existing.id);
        db.studies.push(incoming);
        imported++;
      }
    });

    persistAll();
    renderStudies();
    alert(`Imported ${imported} study(s).`);
  }

  /* =========================================================
     CALENDAR (Jan 2026 -> Jan 2027) + due todo dots
  ========================================================= */
  const CAL_START = { y: 2026, m: 0 };
  const CAL_MONTHS = 13;

  function monthKeyFromIndex(idx) {
    const base = new Date(CAL_START.y, CAL_START.m, 1);
    base.setMonth(base.getMonth() + idx);
    return { y: base.getFullYear(), m: base.getMonth() };
  }

  function dateKey(y, m, d) {
    const mm = String(m + 1).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }

  function ensureDay(key) {
    if (!calendar.events[key]) calendar.events[key] = { items: [] };
    if (!Array.isArray(calendar.events[key].items)) calendar.events[key].items = [];
    return calendar.events[key];
  }

  function ensureTodoOrder() {
    todos.items = todos.items || [];
    let max = -1;
    todos.items.forEach(t => { if (typeof t.order === "number") max = Math.max(max, t.order); });
    todos.items.forEach(t => {
      if (typeof t.order !== "number") {
        max += 1;
        t.order = max;
      }
    });
  }

  function getTodosDueOn(dayKey) {
    return (todos.items || []).filter(t => t.dueDate === dayKey);
  }

  function renderCalendar() {
    if (!calendarWrap) return;

    calMonth = clamp(calMonth, 0, CAL_MONTHS - 1);
    const { y, m } = monthKeyFromIndex(calMonth);

    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const startDow = first.getDay();
    const daysInMonth = last.getDate();

    const today = new Date();
    const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

    const wrap = document.createElement("div");
    wrap.className = "calendar";

    const head = document.createElement("div");
    head.className = "calHead";

    const title = document.createElement("div");
    title.className = "calTitle";
    title.textContent = `${first.toLocaleString(undefined, { month: "long" })} ${y}`;

    const nav = document.createElement("div");
    nav.className = "calNav";

    const prev = document.createElement("button");
    prev.className = "btn";
    prev.textContent = "←";
    prev.disabled = calMonth === 0;
    prev.onclick = () => { calMonth--; renderCalendar(); };

    const next = document.createElement("button");
    next.className = "btn";
    next.textContent = "→";
    next.disabled = calMonth === CAL_MONTHS - 1;
    next.onclick = () => { calMonth++; renderCalendar(); };

    nav.appendChild(prev);
    nav.appendChild(next);

    head.appendChild(title);
    head.appendChild(nav);

    const grid = document.createElement("div");
    grid.className = "calGrid";

    const dows = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    dows.forEach(d => {
      const elx = document.createElement("div");
      elx.className = "dow";
      elx.textContent = d;
      grid.appendChild(elx);
    });

    for (let i = 0; i < startDow; i++) {
      const blank = document.createElement("div");
      blank.style.opacity = "0";
      grid.appendChild(blank);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const key = dateKey(y, m, d);
      const dayBtn = document.createElement("button");
      dayBtn.className = "day";
      if (key === todayKey) dayBtn.classList.add("today");

      const num = document.createElement("div");
      num.className = "num";
      num.textContent = d;
      dayBtn.appendChild(num);

      const items = calendar.events[key]?.items || [];
      const dueTodos = getTodosDueOn(key);

      if (items.length || dueTodos.length) {
        const dot = document.createElement("div");
        dot.className = "dot";
        dayBtn.appendChild(dot);
      }

      dayBtn.onclick = () => openDayModal(key);
      grid.appendChild(dayBtn);
    }

    wrap.appendChild(head);
    wrap.appendChild(grid);

    calendarWrap.innerHTML = "";
    calendarWrap.appendChild(wrap);
  }

  function openDayModal(key) {
    selectedDayKey = key;
    editingEventId = null;
    editingLinkedTodoId = null;

    if (dayModalTitle) dayModalTitle.textContent = key;

    ensureDay(key);
    if (eventText) eventText.value = "";
    if (saveEventBtn) saveEventBtn.textContent = "Add";
    if (deleteEventBtn) deleteEventBtn.disabled = true;

    renderDayEventsList();
    dayModal?.classList.remove("hidden");
    eventText?.focus();
  }

  function renderDayEventsList() {
    if (!selectedDayKey || !dayEventsList) return;

    const day = ensureDay(selectedDayKey);
    const items = (day.items || []).slice();
    const dueTodos = getTodosDueOn(selectedDayKey);

    dayEventsList.innerHTML = "";

    if (!items.length && !dueTodos.length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "No reminders or to-dos for this day yet.";
      dayEventsList.appendChild(empty);
      return;
    }

    if (dueTodos.length) {
      const head = document.createElement("div");
      head.className = "muted";
      head.style.margin = "6px 0";
      head.textContent = "To-dos due:";
      dayEventsList.appendChild(head);

      dueTodos
        .slice()
        .sort((a, b) => (a.done === b.done ? a.order - b.order : (a.done ? 1 : -1)))
        .forEach(t => {
          const row = document.createElement("div");
          row.className = "studyItem";

          const left = document.createElement("div");
          left.style.flex = "1";

          const name = document.createElement("div");
          name.className = "name";
          name.textContent = `🧾 ${t.text}`;

          const meta = document.createElement("div");
          meta.className = "meta";
          meta.textContent = t.done ? "Status: done" : "Status: not done";

          left.appendChild(name);
          left.appendChild(meta);

          const right = document.createElement("div");
          right.className = "right";

          const toggleBtn = document.createElement("button");
          toggleBtn.className = "btn";
          toggleBtn.textContent = t.done ? "Mark not done" : "Mark done";
          toggleBtn.onclick = () => {
            toggleTodo(t.id, !t.done);
            renderDayEventsList();
            renderNow();
            renderCalendar();
          };

          const editBtn = document.createElement("button");
          editBtn.className = "btn";
          editBtn.textContent = "Edit";
          editBtn.onclick = () => {
            editingLinkedTodoId = t.id;
            if (eventText) eventText.value = t.text;
            if (saveEventBtn) saveEventBtn.textContent = "Save To-do";
            if (deleteEventBtn) {
              deleteEventBtn.disabled = false;
              deleteEventBtn.textContent = "Delete To-do";
            }
          };

          right.appendChild(toggleBtn);
          right.appendChild(editBtn);

          row.appendChild(left);
          row.appendChild(right);
          dayEventsList.appendChild(row);
        });

      dayEventsList.appendChild(document.createElement("hr")).className = "sep";
    }

    if (items.length) {
      const head2 = document.createElement("div");
      head2.className = "muted";
      head2.style.margin = "6px 0";
      head2.textContent = "Reminders:";
      dayEventsList.appendChild(head2);
    }

    items
      .slice()
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
      .forEach(ev => {
        const row = document.createElement("div");
        row.className = "studyItem";

        const left = document.createElement("div");
        left.style.flex = "1";

        const name = document.createElement("div");
        name.className = "name";
        name.textContent = ev.text;

        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = `Updated: ${fmtDateTime(ev.updatedAt || ev.createdAt)}`;

        left.appendChild(name);
        left.appendChild(meta);

        const right = document.createElement("div");
        right.className = "right";

        const editBtn = document.createElement("button");
        editBtn.className = "btn";
        editBtn.textContent = "Edit";
        editBtn.onclick = () => {
          editingEventId = ev.id;
          editingLinkedTodoId = null;
          if (eventText) eventText.value = ev.text;
          if (saveEventBtn) saveEventBtn.textContent = "Save";
          if (deleteEventBtn) {
            deleteEventBtn.disabled = false;
            deleteEventBtn.textContent = "Delete reminder";
          }
        };

        const delBtn = document.createElement("button");
        delBtn.className = "btn danger";
        delBtn.textContent = "Delete";
        delBtn.onclick = () => {
          if (!confirm("Delete this reminder?")) return;
          day.items = day.items.filter(x => x.id !== ev.id);
          if (!day.items.length) delete calendar.events[selectedDayKey];
          delete calendar.dismissed[selectedDayKey];
          persistAll();
          renderDayEventsList();
          renderCalendar();
          renderNow();
        };

        right.appendChild(editBtn);
        right.appendChild(delBtn);

        row.appendChild(left);
        row.appendChild(right);

        dayEventsList.appendChild(row);
      });
  }

  function closeDayModal() {
    dayModal?.classList.add("hidden");
    selectedDayKey = null;
    editingEventId = null;
    editingLinkedTodoId = null;
    if (saveEventBtn) saveEventBtn.textContent = "Add";
    if (deleteEventBtn) {
      deleteEventBtn.disabled = true;
      deleteEventBtn.textContent = "Delete edit";
    }
    if (eventText) eventText.value = "";
  }

  function saveEvent() {
    if (!selectedDayKey) return;
    const txt = (eventText?.value || "").trim();
    if (!txt) return alert("Type something first.");

    if (editingLinkedTodoId) {
      const item = todos.items.find(x => x.id === editingLinkedTodoId);
      if (item) item.text = txt;
      persistAll();
      editingLinkedTodoId = null;
      if (eventText) eventText.value = "";
      if (saveEventBtn) saveEventBtn.textContent = "Add";
      if (deleteEventBtn) {
        deleteEventBtn.disabled = true;
        deleteEventBtn.textContent = "Delete edit";
      }
      renderTodos();
      renderDayEventsList();
      renderCalendar();
      renderNow();
      return;
    }

    const day = ensureDay(selectedDayKey);

    if (editingEventId) {
      const ev = day.items.find(x => x.id === editingEventId);
      if (ev) {
        ev.text = txt;
        ev.updatedAt = Date.now();
      }
    } else {
      day.items.push({ id: uid(), text: txt, createdAt: Date.now(), updatedAt: Date.now(), type: "reminder" });
    }

    delete calendar.dismissed[selectedDayKey];
    persistAll();

    editingEventId = null;
    if (eventText) eventText.value = "";
    if (saveEventBtn) saveEventBtn.textContent = "Add";
    if (deleteEventBtn) {
      deleteEventBtn.disabled = true;
      deleteEventBtn.textContent = "Delete edit";
    }

    renderDayEventsList();
    renderCalendar();
    renderNow();
  }

  function deleteEvent() {
    if (!selectedDayKey) return;

    if (editingLinkedTodoId) {
      const item = todos.items.find(x => x.id === editingLinkedTodoId);
      if (!item) return;
      if (!confirm("Delete this to-do?")) return;

      item.dueDate = null;
      removeLinkedCalendarTodo(item.id);

      todos.items = todos.items.filter(x => x.id !== editingLinkedTodoId);
      persistAll();

      editingLinkedTodoId = null;
      if (eventText) eventText.value = "";
      if (saveEventBtn) saveEventBtn.textContent = "Add";
      if (deleteEventBtn) {
        deleteEventBtn.disabled = true;
        deleteEventBtn.textContent = "Delete edit";
      }

      renderTodos();
      renderDayEventsList();
      renderCalendar();
      renderNow();
      return;
    }

    if (!editingEventId) return;

    const day = ensureDay(selectedDayKey);
    const ev = day.items.find(x => x.id === editingEventId);
    if (!ev) return;

    if (!confirm("Delete this reminder?")) return;

    day.items = day.items.filter(x => x.id !== editingEventId);
    if (!day.items.length) delete calendar.events[selectedDayKey];
    delete calendar.dismissed[selectedDayKey];

    persistAll();
    editingEventId = null;
    if (eventText) eventText.value = "";
    if (saveEventBtn) saveEventBtn.textContent = "Add";
    if (deleteEventBtn) {
      deleteEventBtn.disabled = true;
      deleteEventBtn.textContent = "Delete edit";
    }

    renderDayEventsList();
    renderCalendar();
    renderNow();
  }

  function checkTodayNotification() {
    const key = nowISODate();
    const items = calendar.events[key]?.items || [];
    const dueTodos = getTodosDueOn(key);
    const alreadyDismissed = !!calendar.dismissed[key];

    if ((items.length || dueTodos.length) && !alreadyDismissed) {
      pendingNotifyKey = key;
      const lines = [];
      items.forEach((x) => lines.push(`${lines.length + 1}. ${x.text}`));
      dueTodos.forEach(t => lines.push(`${lines.length + 1}. 🧾 ${t.text}`));
      if (notifyText) notifyText.textContent = lines.join("\n");
      notifyModal?.classList.remove("hidden");
    }
  }

  function dismissNotify() {
    if (pendingNotifyKey) {
      calendar.dismissed[pendingNotifyKey] = true;
      persistAll();
    }
    notifyModal?.classList.add("hidden");
  }

  function editNotify() {
    if (!pendingNotifyKey) return;
    notifyModal?.classList.add("hidden");
    openDayModal(pendingNotifyKey);
  }

  /* =========================================================
     TODO LIST: drag reorder + due date links to calendar
  ========================================================= */
  function countdownText(deleteAt) {
    const ms = deleteAt - Date.now();
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${s}s`;
  }

  function addTodo() {
    const txt = (todoInput?.value || "").trim();
    if (!txt) return;

    ensureTodoOrder();

    let max = -1;
    todos.items.forEach(t => { if (typeof t.order === "number") max = Math.max(max, t.order); });

    todos.items.push({
      id: uid(),
      text: txt,
      createdAt: Date.now(),
      done: false,
      deleting: false,
      deleteAt: null,
      order: max + 1,
      dueDate: null
    });

    if (todoInput) todoInput.value = "";
    persistAll();
    renderTodos();
    renderNow();
    renderCalendar();
  }

  function toggleTodo(id, done) {
    const item = todos.items.find(x => x.id === id);
    if (!item) return;
    item.done = done;

    if (done) {
      item.deleting = true;
      item.deleteAt = Date.now() + 12000;
    } else {
      item.deleting = false;
      item.deleteAt = null;
    }

    persistAll();
    renderTodos();
    renderNow();
  }

  function startDeleteTodo(id) {
    const item = todos.items.find(x => x.id === id);
    if (!item) return;
    item.deleting = true;
    item.deleteAt = Date.now() + 6000;
    persistAll();
    renderTodos();
  }

  function removeLinkedCalendarTodo(todoId) {
    Object.keys(calendar.events || {}).forEach(dayKey => {
      const day = calendar.events[dayKey];
      if (!day?.items) return;
      const before = day.items.length;
      day.items = day.items.filter(ev => !(ev.type === "todo" && ev.link?.todoId === todoId));
      if (day.items.length !== before) {
        if (!day.items.length) delete calendar.events[dayKey];
      }
    });
  }

  function upsertLinkedCalendarTodo(todo) {
    removeLinkedCalendarTodo(todo.id);
    if (!todo.dueDate) return;

    const day = ensureDay(todo.dueDate);
    day.items.push({
      id: uid(),
      text: `🧾 To-do: ${todo.text}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      type: "todo",
      link: { todoId: todo.id }
    });
  }

  function setTodoDueDate(todoId, dueDate) {
    const item = todos.items.find(x => x.id === todoId);
    if (!item) return;
    item.dueDate = dueDate || null;

    upsertLinkedCalendarTodo(item);

    persistAll();
    renderTodos();
    renderNow();
    renderCalendar();
  }

  let dragTodoId = null;

  function renderTodos() {
    if (!todoList) return;

    ensureTodoOrder();
    todoList.innerHTML = "";

    if (!todos.items.length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "No to-dos yet.";
      todoList.appendChild(empty);
      return;
    }

    const list = todos.items.slice().sort((a, b) => (a.order - b.order));

    list.forEach(item => {
      const row = document.createElement("div");
      row.className = "todoItem";
      row.draggable = true;
      row.dataset.todoId = item.id;

      row.ondragstart = () => {
        dragTodoId = item.id;
        row.style.opacity = "0.6";
      };
      row.ondragend = () => {
        dragTodoId = null;
        row.style.opacity = "";
      };
      row.ondragover = (e) => {
        e.preventDefault();
        row.classList.add("matchGood");
      };
      row.ondragleave = () => row.classList.remove("matchGood");
      row.ondrop = (e) => {
        e.preventDefault();
        row.classList.remove("matchGood");
        const targetId = row.dataset.todoId;
        if (!dragTodoId || dragTodoId === targetId) return;
        reorderTodos(dragTodoId, targetId);
      };

      const left = document.createElement("div");
      left.className = "todoLeft";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!item.done;
      cb.onchange = () => toggleTodo(item.id, cb.checked);

      const handle = document.createElement("div");
      handle.className = "pill";
      handle.style.cursor = "grab";
      handle.style.userSelect = "none";
      handle.textContent = "⋮⋮";

      const textWrap = document.createElement("div");

      const txt = document.createElement("div");
      txt.className = "todoText";
      txt.textContent = item.text;

      const meta = document.createElement("div");
      meta.className = "todoMeta";

      const due = item.dueDate
        ? `Due: ${new Date(item.dueDate + "T00:00:00").toLocaleDateString()}`
        : "No due date";

      meta.textContent = item.deleting
        ? `Deleting soon... (${due})`
        : `Added: ${new Date(item.createdAt).toLocaleString()} • ${due}`;

      textWrap.appendChild(txt);
      textWrap.appendChild(meta);

      left.appendChild(cb);
      left.appendChild(handle);
      left.appendChild(textWrap);

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.alignItems = "center";
      right.style.gap = "8px";

      const date = document.createElement("input");
      date.type = "date";
      date.className = "input";
      date.style.maxWidth = "160px";
      date.value = item.dueDate || "";
      date.onchange = () => setTodoDueDate(item.id, date.value || null);

      right.appendChild(date);

      if (item.deleting && item.deleteAt) {
        const cd = document.createElement("div");
        cd.className = "todoCountdown";
        cd.textContent = countdownText(item.deleteAt);
        right.appendChild(cd);
      } else {
        const del = document.createElement("button");
        del.className = "btn danger";
        del.textContent = "Delete";
        del.onclick = () => startDeleteTodo(item.id);
        right.appendChild(del);
      }

      row.appendChild(left);
      row.appendChild(right);
      todoList.appendChild(row);
    });
  }

  function reorderTodos(dragId, targetId) {
    ensureTodoOrder();

    const list = todos.items.slice().sort((a, b) => a.order - b.order);
    const fromIndex = list.findIndex(x => x.id === dragId);
    const toIndex = list.findIndex(x => x.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);

    list.forEach((t, i) => { t.order = i; });

    const map = new Map(list.map(x => [x.id, x]));
    todos.items = todos.items.map(t => map.get(t.id) || t);

    persistAll();
    renderTodos();
  }

  function tickTodos() {
  const now = Date.now();
  let changed = false;

  // Only delete when timer expires
  const deletingNow = (todos.items || []).filter(item =>
    item.deleting && item.deleteAt && now >= item.deleteAt
  );

  if (deletingNow.length) {
    deletingNow.forEach(t => removeLinkedCalendarTodo(t.id));
    todos.items = todos.items.filter(item => !(item.deleting && item.deleteAt && now >= item.deleteAt));
    changed = true;
    persistAll();
  }

  // Update countdown text in-place (NO full re-render)
  // This is super cheap compared to rebuilding the whole list/calendar.
  document.querySelectorAll(".todoItem .todoCountdown").forEach(cd => {
    const row = cd.closest(".todoItem");
    const id = row?.dataset?.todoId;
    const item = (todos.items || []).find(t => t.id === id);
    if (item?.deleteAt) cd.textContent = countdownText(item.deleteAt);
  });

  // Only re-render heavy stuff when something actually changed
  if (changed) {
    if (!viewHome?.classList.contains("hidden")) {
      renderTodos();
      renderCalendar();
      renderNow();
    }
  }
}

  /* =========================================================
     UI WIRING
  ========================================================= */
  function wireUI() {
    homeBtn && (homeBtn.onclick = showHome);
    backToHomeLink && (backToHomeLink.onclick = (e) => { e.preventDefault(); showHome(); });

    createStudyBtn && (createStudyBtn.onclick = () => {
      createStudyModal?.classList.remove("hidden");
      if (newStudyName) newStudyName.value = "";
      newStudyName?.focus();
    });
    closeCreateStudyBtn && (closeCreateStudyBtn.onclick = () => createStudyModal?.classList.add("hidden"));
    cancelCreateStudyBtn && (cancelCreateStudyBtn.onclick = () => createStudyModal?.classList.add("hidden"));
    confirmCreateStudyBtn && (confirmCreateStudyBtn.onclick = () => {
      createStudyModal?.classList.add("hidden");
      createStudy(newStudyName?.value || "");
    });
    newStudyName?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") confirmCreateStudyBtn?.click();
    });

    studySearch && (studySearch.oninput = renderStudies);
    clearSearchBtn && (clearSearchBtn.onclick = () => { if (studySearch) studySearch.value = ""; renderStudies(); });

    tabs.forEach(t => t.onclick = () => switchTab(t.dataset.tab));

    favoritesOnlyToggle && (favoritesOnlyToggle.onchange = () => {
      favoritesOnly = favoritesOnlyToggle.checked;
      persistAll();
      prepareFlashcards(true);
      prepareGimkit(true);
      prepareMatch(true);
      prepareWrite(true);
      resetTestUI();
      renderTerms();
      renderStats();
    });

    saveTermBtn && (saveTermBtn.onclick = saveTerm);
    cancelEditTermBtn && (cancelEditTermBtn.onclick = cancelEdit);
    termSearch && (termSearch.oninput = renderTerms);
    clearTermSearchBtn && (clearTermSearchBtn.onclick = () => { if (termSearch) termSearch.value = ""; renderTerms(); });

    bulkImportBtn && (bulkImportBtn.onclick = bulkImport);
    bulkClearBtn && (bulkClearBtn.onclick = () => { if (bulkInput) bulkInput.value = ""; });

    flashCard && (flashCard.onclick = () => flashInner?.classList.toggle("flipped"));
    fcPrevBtn && (fcPrevBtn.onclick = () => {
      if (!fcOrder.length) return;
      fcIndex = (fcIndex - 1 + fcOrder.length) % fcOrder.length;
      flashInner?.classList.remove("flipped");
      renderFlashcard();
    });
    fcNextBtn && (fcNextBtn.onclick = () => {
      if (!fcOrder.length) return;
      fcIndex = (fcIndex + 1) % fcOrder.length;
      flashInner?.classList.remove("flipped");
      renderFlashcard();
    });
    fcRestartBtn && (fcRestartBtn.onclick = () => prepareFlashcards(true));

    gkNextBtn && (gkNextBtn.onclick = gimkitNext);
    gkRestartBtn && (gkRestartBtn.onclick = () => prepareGimkit(true));

    matchRestartBtn && (matchRestartBtn.onclick = () => prepareMatch(true));

    startTestBtn && (startTestBtn.onclick = startTest);
    resetTestBtn && (resetTestBtn.onclick = resetTestUI);
    submitTestBtn && (submitTestBtn.onclick = submitTest);

    testCount?.addEventListener("input", () => {
      const s = getStudy(currentStudyId);
      if (!s) return;
      const max = studyTerms(s).length || 1;
      testCount.max = String(max);
      const n = clamp(parseInt(testCount.value || "1", 10) || 1, 1, max);
      testCount.value = String(n);
    });

    renameStudyBtn && (renameStudyBtn.onclick = renameStudy);
    deleteStudyBtn && (deleteStudyBtn.onclick = deleteCurrentStudy);

    openSettingsBtn && (openSettingsBtn.onclick = () => settingsModal?.classList.remove("hidden"));
    closeSettingsBtn && (closeSettingsBtn.onclick = () => settingsModal?.classList.add("hidden"));
    toggleThemeBtn && (toggleThemeBtn.onclick = () => {
      settings.theme = settings.theme === "dark" ? "light" : "dark";
      persistAll();
      applySettings();
    });
    accentPicker && (accentPicker.oninput = () => {
      settings.accent = accentPicker.value;
      persistAll();
      applySettings();
    });

    colorArea && (colorArea.onchange = refreshColorPicker);

    applyColorBtn && (applyColorBtn.onclick = () => {
      const key = colorArea.value;
      settings.colors = settings.colors || {};
      settings.colors[key] = colorValue.value;
      persistAll();
      applySettings();
    });

    clearColorBtn && (clearColorBtn.onclick = () => {
      const key = colorArea.value;
      settings.colors = settings.colors || {};
      settings.colors[key] = "";
      persistAll();
      applySettings();
      refreshColorPicker();
    });

    settingsModal?.addEventListener("click", (e) => {
      if (e.target === settingsModal) settingsModal.classList.add("hidden");
    });
    createStudyModal?.addEventListener("click", (e) => {
      if (e.target === createStudyModal) createStudyModal.classList.add("hidden");
    });
    importModal?.addEventListener("click", (e) => {
      if (e.target === importModal) closeImportModal();
    });
    dayModal?.addEventListener("click", (e) => {
      if (e.target === dayModal) closeDayModal();
    });
    notifyModal?.addEventListener("click", (e) => {
      if (e.target === notifyModal) dismissNotify();
    });

    closeDayModalBtn && (closeDayModalBtn.onclick = closeDayModal);
    closeDayModalBtn2 && (closeDayModalBtn2.onclick = closeDayModal);
    saveEventBtn && (saveEventBtn.onclick = saveEvent);
    deleteEventBtn && (deleteEventBtn.onclick = deleteEvent);

    dismissNotifyBtn && (dismissNotifyBtn.onclick = dismissNotify);
    editNotifyBtn && (editNotifyBtn.onclick = editNotify);
    closeNotifyBtn && (closeNotifyBtn.onclick = dismissNotify);

    addTodoBtn && (addTodoBtn.onclick = addTodo);
    todoInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") addTodo(); });

    exportAllBtn && (exportAllBtn.onclick = () => downloadJSON("studies-export.json", { version: 2, exportedAt: Date.now(), db }));
    exportStudyBtn && (exportStudyBtn.onclick = () => {
      const s = getStudy(currentStudyId);
      if (!s) return;
      downloadJSON(`${s.name.replaceAll(" ", "_")}-export.json`, { version: 2, exportedAt: Date.now(), study: s });
    });

    importBtn && (importBtn.onclick = openImportModal);
    closeImportBtn && (closeImportBtn.onclick = closeImportModal);
    cancelImportBtn && (cancelImportBtn.onclick = closeImportModal);

    confirmImportBtn && (confirmImportBtn.onclick = () => {
      let payload;
      try {
        payload = JSON.parse(importText.value);
      } catch {
        return alert("That JSON is invalid.");
      }
      importJSONPayload(payload);
      closeImportModal();
    });

    window.addEventListener("keydown", (e) => {
      if (viewStudy?.classList.contains("hidden")) return;

      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (currentTab === "flashcards") {
        if (e.key === "ArrowLeft") { e.preventDefault(); fcPrevBtn?.click(); }
        if (e.key === "ArrowRight") { e.preventDefault(); fcNextBtn?.click(); }
        if (e.key === " ") { e.preventDefault(); flashCard?.click(); }
      }

      if (currentTab === "gimkit") {
        const n = ["1","2","3","4"].indexOf(e.key);
        if (n !== -1) {
          e.preventDefault();
          const btns = [...(gkChoices?.querySelectorAll(".choice") || [])];
          if (btns[n]) btns[n].click();
        }
        if (e.key === "Enter" && gkNextBtn && !gkNextBtn.classList.contains("hidden")) {
          e.preventDefault();
          gkNextBtn.click();
        }
      }

      if (currentTab === "write") {
        if (e.key === "Enter" && writeSubmit) {
          e.preventDefault();
          writeSubmit.click();
        }
      }
    });
  }

  /* =========================================================
     MIGRATION
  ========================================================= */
  function migrateUserData() {
    if (!db || !Array.isArray(db.studies)) db = { studies: [] };
    db.studies.forEach(s => {
      if (!Array.isArray(s.terms)) s.terms = [];
      if (!Array.isArray(s.tests)) s.tests = [];
      s.terms.forEach(ensureTermStats);
      if (!s.createdAt) s.createdAt = Date.now();
      if (!s.updatedAt) s.updatedAt = s.createdAt;
    });

    if (!calendar || typeof calendar !== "object") calendar = { events: {}, dismissed: {} };
    if (!calendar.events) calendar.events = {};
    if (!calendar.dismissed) calendar.dismissed = {};
    Object.keys(calendar.events).forEach(k => ensureDay(k));

    if (!todos || typeof todos !== "object") todos = { items: [] };
    if (!Array.isArray(todos.items)) todos.items = [];
    ensureTodoOrder();

    // rebuild linked todo events
    Object.keys(calendar.events).forEach(dayKey => {
      const day = calendar.events[dayKey];
      if (!day?.items) return;
      day.items = day.items.filter(ev => ev.type !== "todo");
      if (!day.items.length) delete calendar.events[dayKey];
    });
    todos.items.forEach(t => {
      if (t.dueDate) upsertLinkedCalendarTodo(t);
    });
  }

  function bootUser(userId) {
    loadUserState(userId);
    migrateUserData();
    persistAll();
    applySettings();
    addLogoutButton();
    wireUI();

    showHome();
    checkTodayNotification();

    setInterval(tickTodos, 250);   // just updates countdowns + performs deletions
setInterval(renderNow, 1000);  // clock + today/upcoming text
  }

  function init() {
    const u = getCurrentUser();
    if (!u) {
      showLogin();
      return;
    }
    hideLogin();
    bootUser(u.id);
  }

  init();
})();