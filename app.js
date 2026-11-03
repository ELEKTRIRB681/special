(() => {
  "use strict";

  const STORAGE = {
    settings: "twoThunderDashboardSettings",
    mock: "twoThunderDashboardMock",
    session: "twoThunderDashboardSession"
  };
  const DEFAULT_SETTINGS = {
    projectUrl: "",
    anonKey: "",
    configFunction: "twothunder-config",
    adminFunction: "twothunder-admin"
  };
  const ROLE_OPTIONS = ["owner", "co_owner", "admin", "user"];
  const $ = id => document.getElementById(id);
  const state = {
    settings: { ...DEFAULT_SETTINGS },
    mock: true,
    session: null,
    users: []
  };

  function showNotice(message, kind = "success") {
    const notice = $("notice");
    notice.textContent = message;
    notice.dataset.kind = kind;
    notice.hidden = false;
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(() => { notice.hidden = true; }, 6500);
  }

  function setConnection(stateName, label) {
    $("connection-indicator").dataset.state = stateName;
    $("connection-label").textContent = label;
  }

  function setBusy(button, busy, busyText = "Зачекайте…") {
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyText;
    } else if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
    button.disabled = busy;
  }

  function validProjectUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password &&
        url.hostname.endsWith(".supabase.co");
    } catch {
      return false;
    }
  }

  function validFunctionName(value) {
    return /^[a-z0-9_-]+$/i.test(value);
  }

  function functionsUrl(functionName) {
    return `${state.settings.projectUrl.replace(/\/+$/, "")}/functions/v1/${functionName}`;
  }

  function renderConnectionForm() {
    $("project-url").value = state.settings.projectUrl;
    $("anon-key").value = state.settings.anonKey;
    $("config-function").value = state.settings.configFunction;
    $("admin-function").value = state.settings.adminFunction;
  }

  function loadSavedSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE.settings) || "{}");
      state.settings = { ...DEFAULT_SETTINGS, ...saved };
      state.mock = localStorage.getItem(STORAGE.mock) !== "false";
      const session = JSON.parse(sessionStorage.getItem(STORAGE.session) || "null");
      if (session?.access_token && session?.expires_at > Date.now()) state.session = session;
    } catch (error) {
      console.warn("[twoThunder dashboard] Could not restore local settings.", error);
    }
    renderConnectionForm();
    renderMockMode();
    renderAuthState();
  }

  function renderMockMode() {
    $("mock-mode").setAttribute("aria-pressed", String(state.mock));
    $("mock-mode-state").textContent = state.mock ? "On" : "Off";
    if (state.mock) setConnection("mock", "Local mock");
    else if (state.session) setConnection("connected", "Supabase connected");
    else setConnection("error", "Not connected");
  }

  function renderAuthState() {
    const signedIn = Boolean(state.session?.access_token);
    $("auth-state").textContent = signedIn
      ? `Авторизовано: ${state.session.user?.email || "admin"}`
      : "Не авторизовано";
    $("sign-in").hidden = signedIn;
    $("sign-out").hidden = !signedIn;
  }

  function saveSettingsLocally() {
    state.settings.projectUrl = $("project-url").value.trim().replace(/\/+$/, "");
    state.settings.anonKey = $("anon-key").value.trim();
    state.settings.configFunction = $("config-function").value.trim();
    state.settings.adminFunction = $("admin-function").value.trim();
    if (!validProjectUrl(state.settings.projectUrl)) {
      throw new Error("Вкажіть коректний HTTPS URL Supabase-проєкту.");
    }
    if (!state.settings.anonKey) throw new Error("Вкажіть публічний anon / publishable key.");
    if (!validFunctionName(state.settings.configFunction) ||
        !validFunctionName(state.settings.adminFunction)) {
      throw new Error("Назви Edge Functions можуть містити лише літери, цифри, дефіс і підкреслення.");
    }
    localStorage.setItem(STORAGE.settings, JSON.stringify(state.settings));
    renderConnectionForm();
    return state.settings;
  }

  function authHeaders() {
    if (!state.settings.anonKey) throw new Error("Спочатку налаштуйте Supabase connection.");
    const headers = {
      apikey: state.settings.anonKey,
      "Content-Type": "application/json",
      Accept: "application/json"
    };
    if (state.session?.access_token) {
      headers.Authorization = `Bearer ${state.session.access_token}`;
    } else {
      headers.Authorization = `Bearer ${state.settings.anonKey}`;
    }
    return headers;
  }

  async function parseResponse(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = body.msg || body.message || body.error_description || body.error;
      throw new Error(typeof error === "string" ? error : `HTTP ${response.status}`);
    }
    return body;
  }

  async function refreshSessionIfNeeded() {
    if (state.session.expires_at - Date.now() > 90_000) return;
    if (!state.session.refresh_token) {
      state.session = null;
      sessionStorage.removeItem(STORAGE.session);
      renderAuthState();
      throw new Error("Сесія завершилася. Увійдіть знову.");
    }
    const response = await fetch(
      `${state.settings.projectUrl}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: { apikey: state.settings.anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: state.session.refresh_token }),
        cache: "no-store",
        credentials: "omit"
      }
    );
    const refreshed = await parseResponse(response);
    state.session = {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || state.session.refresh_token,
      expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
      user: refreshed.user || state.session.user
    };
    sessionStorage.setItem(STORAGE.session, JSON.stringify(state.session));
    renderAuthState();
  }

  async function adminRequest(action, data = {}) {
    if (state.mock) return mockAdminRequest(action, data);
    if (!state.session?.access_token) throw new Error("Увійдіть через Supabase Auth перед роботою з admin API.");
    await refreshSessionIfNeeded();
    const response = await fetch(functionsUrl(state.settings.adminFunction), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ action, ...data }),
      cache: "no-store",
      credentials: "omit"
    });
    return parseResponse(response);
  }

  async function mockAdminRequest(action, data) {
    await new Promise(resolve => setTimeout(resolve, 180));
    if (action === "get_dashboard_state") {
      return { users: state.users };
    }
    if (action === "list_users") return { users: state.users };
    if (action === "set_user_access") {
      const users = state.users;
      const index = users.findIndex(user => user.nickname === data.nickname);
      if (index < 0) throw new Error("Користувача не знайдено.");
      users[index] = { ...users[index], role: data.role, banned: data.banned };
      state.users = users;
      return { ok: true, user: users[index] };
    }
    throw new Error(`Unknown mock action: ${action}`);
  }

  function safeText(value) {
    return String(value ?? "");
  }

  function renderUsers(users) {
    state.users = Array.isArray(users) ? users : [];
    const body = $("users-body");
    body.replaceChildren();
    $("empty-users").hidden = state.users.length > 0;
    for (const user of state.users) {
      const row = document.createElement("tr");
      const nickname = document.createElement("td");
      nickname.textContent = safeText(user.nickname);
      const roleCell = document.createElement("td");
      const role = document.createElement("select");
      role.className = "role-select";
      role.setAttribute("aria-label", `Роль користувача ${safeText(user.nickname)}`);
      for (const name of ROLE_OPTIONS) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        option.selected = user.role === name;
        role.append(option);
      }
      role.addEventListener("change", () => updateUser(user, role.value, Boolean(user.banned)));
      roleCell.append(role);
      const statusCell = document.createElement("td");
      const status = document.createElement("span");
      status.className = `status-pill${user.banned ? " banned" : ""}`;
      status.textContent = user.banned ? "Заблокований" : "Активний";
      statusCell.append(status);
      const activity = document.createElement("td");
      activity.textContent = safeText(user.lastSeen || user.last_seen || "—");
      const actionCell = document.createElement("td");
      const action = document.createElement("button");
      action.type = "button";
      action.className = `action-button${user.banned ? " unban" : ""}`;
      action.textContent = user.banned ? "Розблокувати" : "Заблокувати";
      action.addEventListener("click", () => updateUser(user, user.role, !user.banned));
      actionCell.append(action);
      row.append(nickname, roleCell, statusCell, activity, actionCell);
      body.append(row);
    }
  }

  async function updateUser(user, role, banned) {
    if (!ROLE_OPTIONS.includes(role)) return;
    if (user.role === "owner" && (banned || role !== "owner")) {
      showNotice("Зміна або блокування owner має бути окремо дозволена серверною політикою.", "error");
      await refreshUsers();
      return;
    }
    try {
      await adminRequest("set_user_access", { nickname: user.nickname, role, banned });
      showNotice(`Доступ оновлено для ${user.nickname}.`);
      await refreshUsers();
    } catch (error) {
      showNotice(`Не вдалося змінити доступ: ${error.message}`, "error");
      await refreshUsers();
    }
  }

  async function refreshUsers() {
    const result = await adminRequest("list_users");
    renderUsers(result.users);
  }

  async function signIn() {
    const settings = saveSettingsLocally();
    const email = $("auth-email").value.trim();
    const password = $("auth-password").value;
    if (!email || !password) throw new Error("Введіть email і пароль Supabase Auth.");
    const response = await fetch(`${settings.projectUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: settings.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
      credentials: "omit"
    });
    const result = await parseResponse(response);
    state.session = {
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_at: Date.now() + Number(result.expires_in || 3600) * 1000,
      user: result.user
    };
    sessionStorage.setItem(STORAGE.session, JSON.stringify(state.session));
    $("auth-password").value = "";
    renderAuthState();
    renderMockMode();
    showNotice("Вхід виконано. Переконайтеся, що Edge Function перевіряє JWT та серверну роль.");
  }

  async function validateBackend() {
    saveSettingsLocally();
    const response = await fetch(functionsUrl(state.settings.configFunction), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ action: "health" }),
      cache: "no-store",
      credentials: "omit"
    });
    await parseResponse(response);
    setConnection("connected", "Supabase reachable");
    showNotice("Backend доступний. Перед production перевірте авторизацію та RLS/ролі Edge Function.");
  }

  async function loadDashboard() {
    const result = await adminRequest("get_dashboard_state");
    renderUsers(result.users);
  }

  function downloadExtensionConfig() {
    const settings = saveSettingsLocally();
    const config = {
      functionUrl: functionsUrl(settings.configFunction),
      anonKey: settings.anonKey
    };
    const source = `globalThis.TWO_THUNDER_CONFIG = Object.freeze(${JSON.stringify(config, null, 2)});\n`;
    const blob = new Blob([source], { type: "text/javascript;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "config.js";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    showNotice("config.js завантажено. Публічний anon key не є service-role secret.");
  }

  function bindEvents() {
    $("mock-mode").addEventListener("click", async () => {
      state.mock = !state.mock;
      localStorage.setItem(STORAGE.mock, String(state.mock));
      if (!state.mock && !state.session?.access_token) {
        state.mock = true;
        localStorage.setItem(STORAGE.mock, "true");
        showNotice("Для віддаленого режиму спочатку увійдіть через Supabase Auth.", "info");
      }
      renderMockMode();
      if (state.mock) {
        try { await loadDashboard(); }
        catch (error) { showNotice(`Не вдалося завантажити mock users: ${error.message}`, "error"); }
      } else {
        try { await loadDashboard(); }
        catch (error) { showNotice(`Backend недоступний: ${error.message}`, "error"); }
      }
    });
    $("save-connection").addEventListener("click", () => {
      try {
        saveSettingsLocally();
        showNotice("Параметри підключення збережено у цьому браузері.");
      } catch (error) { showNotice(error.message, "error"); }
    });
    $("test-connection").addEventListener("click", async event => {
      setBusy(event.currentTarget, true);
      try { await validateBackend(); }
      catch (error) { setConnection("error", "Connection failed"); showNotice(`Помилка backend: ${error.message}`, "error"); }
      finally { setBusy(event.currentTarget, false); }
    });
    $("sign-in").addEventListener("click", async event => {
      setBusy(event.currentTarget, true);
      try { await signIn(); }
      catch (error) { showNotice(`Помилка входу: ${error.message}`, "error"); }
      finally { setBusy(event.currentTarget, false); }
    });
    $("sign-out").addEventListener("click", () => {
      state.session = null;
      sessionStorage.removeItem(STORAGE.session);
      renderAuthState();
      renderMockMode();
      showNotice("Сесію завершено.", "info");
    });
    $("refresh-users").addEventListener("click", async event => {
      setBusy(event.currentTarget, true);
      try { await refreshUsers(); showNotice("Список користувачів оновлено."); }
      catch (error) { showNotice(`Не вдалося завантажити користувачів: ${error.message}`, "error"); }
      finally { setBusy(event.currentTarget, false); }
    });
    $("download-extension-config").addEventListener("click", () => {
      try { downloadExtensionConfig(); }
      catch (error) { showNotice(error.message, "error"); }
    });
    document.querySelectorAll(".side-link").forEach(link => {
      link.addEventListener("click", () => {
        document.querySelectorAll(".side-link").forEach(item => item.classList.remove("active"));
        link.classList.add("active");
      });
    });
  }

  function start() {
    loadSavedSettings();
    bindEvents();
    if (state.mock) renderUsers([]);
  }

  start();
})();
