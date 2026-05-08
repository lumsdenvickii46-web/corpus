
(function () {
  const state = {
    users: [],
    transactions: [],
    loans: [],
    selectedUserId: null,
    filteredUsers: [],
  };

  const flashNode = document.getElementById("admin-flash");
  const createUserPanel = document.getElementById("create-user-panel");
  const createUserForm = document.getElementById("create-user-form");
  const editUserForm = document.getElementById("edit-user-form");
  const createTransactionForm = document.getElementById("create-transaction-form");
  const userListNode = document.getElementById("admin-user-list");
  const userSearchInput = document.getElementById("user-search");
  const userDetailEmpty = document.getElementById("user-detail-empty");
  const userDetailContent = document.getElementById("user-detail-content");
  const userTransactionsList = document.getElementById("user-transactions-list");
  const userLoansList = document.getElementById("user-loans-list");
  const tabButtons = Array.from(document.querySelectorAll(".admin-tab"));
  const tabPanels = Array.from(document.querySelectorAll(".admin-tab-panel"));

  bindAccountNumberField(createUserForm.querySelector("[name='account_number']"));
  bindAccountNumberField(editUserForm.querySelector("[name='account_number']"));
  bindEvents();
  load();

  function bindEvents() {
    document.getElementById("show-create-user").addEventListener("click", () => {
      createUserPanel.classList.remove("is-hidden");
      createUserForm.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    document.getElementById("hide-create-user").addEventListener("click", () => {
      createUserPanel.classList.add("is-hidden");
    });

    document.getElementById("refresh-admin").addEventListener("click", () => load(false));

    userSearchInput.addEventListener("input", () => {
      renderUserList(userSearchInput.value);
    });

    document.getElementById("read-user-action").addEventListener("click", () => {
      setActiveTab("profile");
      editUserForm.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    document.getElementById("edit-user-action").addEventListener("click", () => {
      setActiveTab("profile");
      editUserForm.querySelector("[name='first_name']").focus();
    });

    document.getElementById("delete-user-action").addEventListener("click", async () => {
      const user = getSelectedUser();
      if (!user) return;
      const confirmed = window.confirm(`Delete ${user.display_name} (${user.account_number})? This will remove the user and related records.`);
      if (!confirmed) return;

      const form = new URLSearchParams();
      form.set("id", String(user.id));
      const response = await postUrlEncoded("/api/admin/users/delete", form);
      if (response.error) return showMessage(response.error, true);
      showMessage("User deleted successfully");
      state.selectedUserId = null;
      await load(false);
    });

    createUserForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const accountNumberField = event.currentTarget.querySelector("[name='account_number']");
      if (!validateAccountNumberField(accountNumberField)) return;
      const response = await postForm("/api/admin/users/create", new FormData(event.currentTarget));
      if (response.error) return showMessage(response.error, true);
      showMessage("User created successfully");
      event.currentTarget.reset();
      createUserPanel.classList.add("is-hidden");
      const createdUserId = Number(response.userId || 0);
      await load(false, createdUserId || null);
    });

    editUserForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const accountNumberField = event.currentTarget.querySelector("[name='account_number']");
      if (!validateAccountNumberField(accountNumberField)) return;
      const response = await postForm("/api/admin/users/update", new FormData(event.currentTarget));
      if (response.error) return showMessage(response.error, true);
      showMessage("User updated");
      await load(false, Number(editUserForm.querySelector("[name='id']").value || 0));
    });

    createTransactionForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const response = await postForm("/api/admin/transactions/create", new FormData(event.currentTarget));
      if (response.error) return showMessage(response.error, true);
      showMessage("Transaction created successfully");
      const user = getSelectedUser();
      populateTransactionForm(user);
      await load(false, user ? user.id : null);
      setActiveTab("transactions");
    });

    tabButtons.forEach((button) => {
      button.addEventListener("click", () => setActiveTab(button.dataset.tab));
    });
  }

  async function load(showLoading = true, nextUserId = null) {
    if (showLoading) {
      userListNode.innerHTML = '<div class="admin-empty-state">Loading users...</div>';
    }

    const response = await fetch("/api/admin-data", { credentials: "same-origin" });
    if (response.status === 401) {
      window.location.href = "/admin-backoffice/login.html?error=Please+sign+in+as+admin";
      return;
    }

    const data = await response.json();
    state.users = (data.users || []).map((user) => ({
      ...user,
      display_name: user.display_name || `${user.first_name || ""} ${user.last_name || ""}`.trim(),
    }));
    state.transactions = (data.transactions || []).map((item) => ({ ...item, amount: Number(item.amount || 0) }));
    state.loans = data.loans || [];

    renderMetrics();

    const preferredSelection = nextUserId || state.selectedUserId || (state.users[0] && state.users[0].id);
    state.selectedUserId = state.users.some((user) => user.id === preferredSelection) ? preferredSelection : null;

    renderUserList(userSearchInput.value);
    renderSelectedUser();
  }

  function renderMetrics() {
    const completedVolume = state.transactions
      .filter((item) => String(item.status || "").toLowerCase() === "completed")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);

    document.getElementById("metric-users").textContent = String(state.users.length);
    document.getElementById("metric-transactions").textContent = String(state.transactions.length);
    document.getElementById("metric-volume").textContent = formatMoney(completedVolume, "USD");
  }

  function renderUserList(searchText) {
    const query = String(searchText || "").trim().toLowerCase();
    state.filteredUsers = state.users.filter((user) => {
      if (!query) return true;
      return [user.display_name, user.account_number, user.username, user.email].join(" ").toLowerCase().includes(query);
    });

    if (!state.filteredUsers.length) {
      userListNode.innerHTML = '<div class="admin-empty-state">No users match your search.</div>';
      return;
    }

    userListNode.innerHTML = state.filteredUsers.map((user) => {
      const summary = summarizeUser(user.id);
      const activeClass = user.id === state.selectedUserId ? " is-active" : "";
      return `
        <button class="admin-user-card${activeClass}" type="button" data-user-id="${user.id}">
          <div class="admin-user-card-top">
            <div class="admin-user-identity">
              <span class="admin-user-avatar${user.profile_image ? " has-image" : ""}" style="${user.profile_image ? `background-image:url(&quot;${escapeAttr(user.profile_image)}&quot;)` : ""}">${user.profile_image ? "" : initials(user.display_name)}</span>
              <div>
                <strong>${escapeHtml(user.display_name)}</strong>
                <span>${escapeHtml(user.account_number)}</span>
              </div>
            </div>
            <span class="admin-user-currency">${escapeHtml(user.preferred_currency || "USD")}</span>
          </div>
          <div class="admin-user-card-meta">
            <span>${escapeHtml(user.username || "")}</span>
            <span>${escapeHtml(user.email || "")}</span>
          </div>
          <div class="admin-user-card-stats">
            <span>${summary.transactionCount} txns</span>
            <span>${formatMoney(summary.balance, user.preferred_currency || "USD")}</span>
          </div>
        </button>
      `;
    }).join("");

    userListNode.querySelectorAll("[data-user-id]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedUserId = Number(button.dataset.userId || 0);
        renderUserList(userSearchInput.value);
        renderSelectedUser();
      });
    });
  }

  function renderSelectedUser() {
    const user = getSelectedUser();
    if (!user) {
      userDetailEmpty.classList.remove("is-hidden");
      userDetailContent.classList.add("is-hidden");
      return;
    }

    userDetailEmpty.classList.add("is-hidden");
    userDetailContent.classList.remove("is-hidden");

    const summary = summarizeUser(user.id);
    document.getElementById("detail-user-name").textContent = user.display_name;
    document.getElementById("detail-user-account").textContent = `${user.account_number} · ${user.username}`;
    document.getElementById("detail-user-balance").textContent = formatMoney(summary.balance, user.preferred_currency || "USD");
    document.getElementById("detail-user-transaction-count").textContent = String(summary.transactionCount);
    document.getElementById("detail-user-currency").textContent = user.preferred_currency || "USD";
    document.getElementById("detail-user-email").textContent = user.email || "No email";
    document.getElementById("detail-user-created-at").textContent = `Created ${formatDate(user.created_at)}`;

    fillUserForm(user);
    populateTransactionForm(user);
    renderUserTransactions(user);
    renderUserLoans(user);
  }

  function fillUserForm(user) {
    editUserForm.querySelector("[name='id']").value = user.id || "";
    editUserForm.querySelectorAll("[name]").forEach((field) => {
      if (field.name === "id" || field.name === "password") return;
      field.value = user[field.name] || "";
    });
    editUserForm.querySelector("[name='password']").value = "";
  }

  function populateTransactionForm(user) {
    createTransactionForm.reset();
    createTransactionForm.querySelector("[name='user_id']").value = user ? String(user.id) : "";
    createTransactionForm.querySelector("[name='created_at']").value = toDateTimeLocal(new Date());
    createTransactionForm.querySelector("[name='currency_code']").value = (user && user.preferred_currency) || "USD";
    createTransactionForm.querySelector("[name='category']").value = "manual_entry";
  }

  function renderUserTransactions(user) {
    const userTransactions = state.transactions.filter((item) => Number(item.user_id) === Number(user.id));
    if (!userTransactions.length) {
      userTransactionsList.innerHTML = '<div class="admin-empty-state">No transactions for this user yet.</div>';
      return;
    }

    userTransactionsList.innerHTML = userTransactions.map((item) => `
      <form class="admin-record-card" data-transaction-id="${item.id}">
        <div class="admin-record-head">
          <div>
            <strong>${escapeHtml(item.reference_id || `TX${item.id}`)}</strong>
            <span>${formatDate(item.created_at)} · ${escapeHtml(item.category || "manual_entry")}</span>
          </div>
          <span class="admin-record-amount ${item.amount < 0 ? "negative" : "positive"}">${formatMoney(item.amount, item.currency_code || user.preferred_currency || "USD")}</span>
        </div>
        <div class="admin-record-grid">
          <input class="input" data-field="reference_id" value="${escapeAttr(item.reference_id || "")}" placeholder="Reference">
          <input class="input" data-field="category" value="${escapeAttr(item.category || "")}" placeholder="Category">
          <select class="select" data-field="type"><option ${selected(item.type, "credit")}>credit</option><option ${selected(item.type, "debit")}>debit</option></select>
          <select class="select" data-field="status"><option ${selected(item.status, "Pending")}>Pending</option><option ${selected(item.status, "Completed")}>Completed</option><option ${selected(item.status, "Failed")}>Failed</option></select>
          <select class="select" data-field="currency_code"><option ${selected(item.currency_code, "USD")}>USD</option><option ${selected(item.currency_code, "EUR")}>EUR</option><option ${selected(item.currency_code, "GBP")}>GBP</option><option ${selected(item.currency_code, "NGN")}>NGN</option><option ${selected(item.currency_code, "AUD")}>AUD</option><option ${selected(item.currency_code, "NZD")}>NZD</option></select>
          <input class="input" type="number" step="0.01" data-field="amount" value="${escapeAttr(Math.abs(Number(item.amount || 0)))}" placeholder="Amount">
          <input class="input admin-record-description" data-field="description" value="${escapeAttr(item.description || "")}" placeholder="Description">
        </div>
        <div class="admin-record-actions">
          <button class="btn btn-primary" type="button" data-save-transaction="${item.id}">Save</button>
        </div>
      </form>
    `).join("");

    userTransactionsList.querySelectorAll("[data-save-transaction]").forEach((button) => {
      button.addEventListener("click", async () => {
        const card = button.closest(".admin-record-card");
        const form = new URLSearchParams();
        form.set("id", button.dataset.saveTransaction);
        const type = card.querySelector("[data-field='type']").value;
        card.querySelectorAll("[data-field]").forEach((field) => {
          if (field.dataset.field === "amount") {
            const raw = Math.abs(Number(field.value || 0));
            form.set("amount", String(type === "debit" ? -raw : raw));
            return;
          }
          form.set(field.dataset.field, field.value);
        });
        const response = await postUrlEncoded("/api/admin/transactions/update", form);
        if (response.error) return showMessage(response.error, true);
        showMessage("Transaction updated");
        await load(false, user.id);
        setActiveTab("transactions");
      });
    });
  }

  function renderUserLoans(user) {
    const userLoans = state.loans.filter((loan) => Number(loan.user_id) === Number(user.id));
    if (!userLoans.length) {
      userLoansList.innerHTML = '<div class="admin-empty-state">No loan requests for this user.</div>';
      return;
    }

    userLoansList.innerHTML = userLoans.map((loan) => `
      <form class="admin-loan-card" data-loan-id="${loan.id}">
        <div class="admin-record-head">
          <div>
            <strong>${formatMoney(loan.amount, user.preferred_currency || "USD")}</strong>
            <span>${escapeHtml(loan.duration || "No duration")} · ${formatDate(loan.created_at)}</span>
          </div>
          <span class="category-badge loan">${escapeHtml(loan.status || "Pending")}</span>
        </div>
        <p>${escapeHtml(loan.reason || "")}</p>
        <div class="admin-record-actions">
          <select class="select" data-field="status"><option ${selected(loan.status, "Pending")}>Pending</option><option ${selected(loan.status, "Approved")}>Approved</option><option ${selected(loan.status, "Rejected")}>Rejected</option><option ${selected(loan.status, "Due")}>Due</option></select>
          <button class="btn btn-primary" type="button" data-save-loan="${loan.id}">Save Loan</button>
        </div>
      </form>
    `).join("");

    userLoansList.querySelectorAll("[data-save-loan]").forEach((button) => {
      button.addEventListener("click", async () => {
        const card = button.closest(".admin-loan-card");
        const form = new URLSearchParams();
        form.set("id", button.dataset.saveLoan);
        form.set("status", card.querySelector("[data-field='status']").value);
        const response = await postUrlEncoded("/api/admin/loans/update", form);
        if (response.error) return showMessage(response.error, true);
        showMessage("Loan request updated");
        await load(false, user.id);
        setActiveTab("loans");
      });
    });
  }

  function summarizeUser(userId) {
    const userTransactions = state.transactions.filter((item) => Number(item.user_id) === Number(userId));
    return {
      balance: userTransactions
        .filter((item) => String(item.status || "").toLowerCase() === "completed")
        .reduce((sum, item) => sum + Number(item.amount || 0), 0),
      transactionCount: userTransactions.length,
    };
  }

  function getSelectedUser() {
    return state.users.find((user) => Number(user.id) === Number(state.selectedUserId)) || null;
  }

  function setActiveTab(tabName) {
    tabButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tab === tabName);
    });
    tabPanels.forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.panel === tabName);
    });
  }

  async function postForm(url, formData) {
    const response = await fetch(url, { method: "POST", body: formData, credentials: "same-origin" });
    return response.json();
  }

  async function postUrlEncoded(url, form) {
    const response = await fetch(url, { method: "POST", body: form, credentials: "same-origin" });
    return response.json();
  }

  function showMessage(message, isError) {
    flashNode.innerHTML = `<div class="message ${isError ? "error" : "success"}">${escapeHtml(message)}</div>`;
  }

  function bindAccountNumberField(field) {
    if (!field) return;
    field.addEventListener("input", () => {
      field.value = String(field.value || "").replace(/\D/g, "").slice(0, 10);
      field.setCustomValidity("");
    });
  }

  function validateAccountNumberField(field) {
    if (!field) return true;
    const value = String(field.value || "").trim();
    if (/^\d{1,10}$/.test(value)) {
      field.setCustomValidity("");
      return true;
    }
    field.setCustomValidity("Account number must be up to 10 digits.");
    field.reportValidity();
    return false;
  }

  function selected(value, expected) {
    return String(value || "").toUpperCase() === String(expected || "").toUpperCase() ? "selected" : "";
  }

  function initials(name) {
    return String(name || "User")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "U";
  }

  function formatMoney(amount, currencyCode) {
    const value = Number(amount || 0);
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode || "USD", minimumFractionDigits: 2 }).format(value);
    } catch (error) {
      return `${currencyCode || "USD"} ${value.toFixed(2)}`;
    }
  }

  function formatDate(value) {
    if (!value) return "Unknown date";
    const parsed = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString();
  }

  function toDateTimeLocal(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();

