(() => {
  "use strict";

  const STORAGE = {
    settings: "twoThunderDashboardSettings",
    mock: "twoThunderDashboardMock"
  };
  const DEFAULT_SETTINGS = {
    projectUrl: "",
    anonKey: "",
    configFunction: "twothunder-config"
  };
  const $ = id => document.getElementById(id);
  const state = {
    settings: { ...DEFAULT_SETTINGS },
    mock: true,
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

  function profilesUrl() {
    return `${state.settings.projectUrl.replace(/\/+$/, "")}/rest/v1/profiles?select=*`;
  }

  function renderConnectionForm() {
    const projectUrlInput = $("project-url");
    const anonKeyInput = $("anon-key");
    const configFunctionInput = $("config-function");
    if (projectUrlInput) projectUrlInput.value = state.settings.projectUrl;
    if (anonKeyInput) anonKeyInput.value = state.settings.anonKey;
    if (configFunctionInput) configFunctionInput.value = state.settings.configFunction;
  }

  function loadSavedSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE.settings) || "{}");
      state.settings = { ...DEFAULT_SETTINGS, ...saved };
      state.mock = localStorage.getItem(STORAGE.mock) !== "false";
    } catch (error) {
      console.warn("[twoThunder dashboard] Could not restore local settings.", error);
    }
    renderConnectionForm();
    renderMockMode();
  }

  function renderMockMode() {
    $("mock-mode").setAttribute("aria-pressed", String(state.mock));
    $("mock-mode-state").textContent = state.mock ? "On" : "Off";
    if (state.mock) setConnection("mock", "Local mock");
    else setConnection("connected", "Direct REST");
  }

  function saveSettingsLocally() {
    state.settings.projectUrl = $("project-url").value.trim().replace(/\/+$/, "");
    state.settings.anonKey = $("anon-key").value.trim();
    state.settings.configFunction = $("config-function").value.trim();
    if (!validProjectUrl(state.settings.projectUrl)) {
      throw new Error("Вкажіть коректний HTTPS URL Supabase-проєкту.");
    }
    if (!state.settings.anonKey) {
      throw new Error("Вкажіть публічний anon / publishable key.");
    }
    if (!validFunctionName(state.settings.configFunction)) {
      throw new Error("Назва config function може містити лише літери, цифри, дефіс і підкреслення.");
    }
    localStorage.setItem(STORAGE.settings, JSON.stringify(state.settings));
    renderConnectionForm();
    return state.settings;
  }

  async function parseResponse(response) {
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = body?.message || body?.details || body?.hint || body?.error;
      throw new Error(typeof detail === "string" ? detail : `HTTP ${response.status}`);
    }
    return body;
  }

  async function fetchProfiles() {
    if (!validProjectUrl(state.settings.projectUrl) || !state.settings.anonKey) {
      throw new Error("Вкажіть і збережіть Supabase Project URL та Publishable Key.");
    }
    const response = await fetch(profilesUrl(), {
      method: "GET",
      headers: {
        apikey: state.settings.anonKey,
        Authorization: `Bearer ${state.settings.anonKey}`,
        Accept: "application/json"
      },
      cache: "no-store",
      credentials: "omit"
    });
    const profiles = await parseResponse(response);
    if (!Array.isArray(profiles)) {
      throw new Error("Supabase REST API повернув неочікуваний формат profiles.");
    }
    setConnection("connected", "Direct REST");
    renderUsers(profiles);
    return profiles;
  }

  async function updateProfileRole(nickname, role) {
    if (!validProjectUrl(state.settings.projectUrl) || !state.settings.anonKey) {
      throw new Error("Вкажіть і збережіть Supabase Project URL та Publishable Key.");
    }
    if (!["owner", "co_owner", "admin", "user"].includes(role)) {
      throw new Error("Вказано невідому роль.");
    }

    const url = new URL(profilesUrl());
    url.searchParams.set("nickname", `eq.${nickname}`);
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: state.settings.anonKey,
        Authorization: `Bearer ${state.settings.anonKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({ role }),
      cache: "no-store",
      credentials: "omit"
    });
    const updatedProfiles = await parseResponse(response);
    if (!Array.isArray(updatedProfiles) || updatedProfiles.length === 0) {
      throw new Error("Профіль не оновлено. Перевірте нікнейм та Supabase RLS-політики.");
    }
  }

  function renderUsers(profiles) {
    state.users = Array.isArray(profiles) ? profiles : [];
    const body = $("users-body");
    body.replaceChildren();
    $("empty-users").hidden = state.users.length > 0;

    for (const profile of state.users) {
      const row = document.createElement("tr");
      const nickname = document.createElement("td");
      nickname.textContent = String(profile.nickname ?? profile.user_nickname ?? "—");

      const role = document.createElement("td");
      const currentRole = String(profile.role ?? "user").toLowerCase();
      const roleSelect = document.createElement("select");
      roleSelect.className = "role-select";
      roleSelect.setAttribute("aria-label", `Роль користувача ${nickname.textContent}`);
      for (const roleName of ["owner", "co_owner", "admin", "user"]) {
        const option = document.createElement("option");
        option.value = roleName;
        option.textContent = roleName;
        option.selected = roleName === currentRole;
        roleSelect.appendChild(option);
      }
      roleSelect.dataset.nickname = String(profile.nickname ?? profile.user_nickname ?? "");
      roleSelect.dataset.currentRole = ["owner", "co_owner", "admin", "user"].includes(currentRole)
        ? currentRole
        : "user";
      if (!["owner", "co_owner", "admin", "user"].includes(currentRole)) {
        roleSelect.value = "user";
      }
      role.appendChild(roleSelect);

      const banned = profile.is_banned === true || profile.banned === true;
      const statusCell = document.createElement("td");
      const status = document.createElement("span");
      status.className = `status-pill${banned ? " banned" : ""}`;
      status.textContent = banned ? "Заблокований" : "Активний";
      statusCell.append(status);

      const activity = document.createElement("td");
      activity.textContent = String(profile.last_seen ?? profile.lastSeen ?? "—");
      row.append(nickname, role, statusCell, activity);
      body.append(row);
    }
  }

  async function handleRoleChange(event) {
    const select = event.target.closest(".role-select");
    if (!select) return;

    const nickname = select.dataset.nickname;
    const previousRole = select.dataset.currentRole || "user";
    const newRole = select.value;
    if (!nickname) {
      select.value = previousRole;
      showNotice("Не вдалося змінити роль: у профілю відсутній нікнейм.", "error");
      return;
    }
    if (newRole === previousRole) return;

    select.disabled = true;
    try {
      await updateProfileRole(nickname, newRole);
      select.dataset.currentRole = newRole;
      showNotice(`Роль користувача ${nickname} змінено на ${newRole}.`);
      try {
        await fetchProfiles();
      } catch (error) {
        showNotice(`Роль оновлено, але список не вдалося перезавантажити: ${error.message}`, "error");
      }
    } catch (error) {
      select.value = previousRole;
      showNotice(`Не вдалося оновити роль ${nickname}: ${error.message}`, "error");
    } finally {
      select.disabled = false;
    }
  }

  async function refreshProfiles() {
    if (state.mock) {
      renderUsers([]);
      return;
    }
    await fetchProfiles();
  }

  async function validateBackend() {
    saveSettingsLocally();
    const profiles = await fetchProfiles();
    showNotice(`REST-з'єднання працює. Отримано профілів: ${profiles.length}.`);
  }

  function downloadExtensionConfig() {
    const settings = saveSettingsLocally();
    const config = {
      functionUrl: `${settings.projectUrl}/functions/v1/${settings.configFunction}`,
      anonKey: settings.anonKey
    };
    const source = `globalThis.TWO_THUNDER_CONFIG = Object.freeze(${JSON.stringify(config, null, 2)});\n`;
    const blob = new Blob([source], { type: "text/javascript;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "config.js";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    showNotice("config.js завантажено. У ньому лише публічні bootstrap-значення.");
  }

  async function setMockMode(enabled) {
    if (!enabled) {
      try {
        saveSettingsLocally();
      } catch (error) {
        state.mock = true;
        localStorage.setItem(STORAGE.mock, "true");
        renderMockMode();
        showNotice(`${error.message} Заповніть поля підключення та повторіть.`, "error");
        $("connection").scrollIntoView({ behavior: "smooth", block: "start" });
        $("project-url").focus();
        return;
      }
    }

    state.mock = enabled;
    localStorage.setItem(STORAGE.mock, String(enabled));
    renderMockMode();
    if (enabled) {
      renderUsers([]);
      showNotice("Увімкнено локальний mock mode.", "info");
      return;
    }

    try {
      const profiles = await fetchProfiles();
      showNotice(`Supabase REST: отримано профілів ${profiles.length}.`);
    } catch (error) {
      setConnection("error", "REST error");
      renderUsers([]);
      showNotice(`Не вдалося завантажити public.profiles: ${error.message}`, "error");
    }
  }

  function bindEvents() {
    $("users-body").addEventListener("change", event => {
      void handleRoleChange(event);
    });
    $("mock-mode").addEventListener("click", () => {
      void setMockMode(!state.mock);
    });
    $("save-connection").addEventListener("click", () => {
      try {
        saveSettingsLocally();
        showNotice("Параметри підключення збережено локально.");
      } catch (error) {
        showNotice(error.message, "error");
      }
    });
    $("test-connection").addEventListener("click", async event => {
      setBusy(event.currentTarget, true);
      try {
        saveSettingsLocally();
        const profiles = await fetchProfiles();
        showNotice(`REST-з'єднання працює. Отримано профілів: ${profiles.length}.`);
      } catch (error) {
        setConnection("error", "REST error");
        showNotice(`Помилка REST API: ${error.message}`, "error");
      } finally {
        setBusy(event.currentTarget, false);
      }
    });
    $("refresh-users").addEventListener("click", async event => {
      setBusy(event.currentTarget, true);
      try {
        await refreshProfiles();
        if (state.mock) showNotice("Mock mode: список користувачів порожній.", "info");
        else showNotice(`Завантажено профілів: ${state.users.length}.`);
      } catch (error) {
        setConnection("error", "REST error");
        showNotice(`Не вдалося оновити profiles: ${error.message}`, "error");
      } finally {
        setBusy(event.currentTarget, false);
      }
    });
    $("download-extension-config").addEventListener("click", () => {
      try {
        downloadExtensionConfig();
      } catch (error) {
        showNotice(error.message, "error");
      }
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
    renderUsers([]);
  }

  start();
})();
