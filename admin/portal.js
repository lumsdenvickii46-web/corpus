(function () {
  const page = document.body.dataset.page;
  const flashNode = document.getElementById("flash-message");
  const params = new URLSearchParams(window.location.search);
  let currentCurrency = "USD";
  const TRANSFER_PAGES = new Set(["wire-transfer", "dom-transfer"]);
  const transferStorageKey = TRANSFER_PAGES.has(page) ? `portal-transfer:${page}` : "";
  let portalTransactions = [];
  const ICONS = {
    dashboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h5v-5h4v5h5v-9.5"/></svg>',
    deposit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
    wire: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7"/><path d="M9 7h8v8"/><path d="M4 20h16"/></svg>',
    domestic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h13"/><path d="m13 3 4 4-4 4"/><path d="M20 17H7"/><path d="m11 13-4 4 4 4"/></svg>',
    loan: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10h.01"/><path d="M17 14h.01"/><path d="M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/></svg>',
    transactions: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>',
    profile: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>',
    bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 21h4"/><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/></svg>',
    card: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18"/><path d="M7 15h4"/></svg>',
  };

  renderFlash(params.get("error"), params.get("success"));
  hydrateNavigationIcons();

  fetch("/api/portal-data", { credentials: "same-origin" })
    .then((response) => {
      if (response.status === 401) {
        window.location.href = "/auth/login.html?error=Please+sign+in+first";
        return null;
      }
      return response.json();
    })
    .then((data) => {
      if (!data) return;
      currentCurrency = data.user.preferredCurrency || "USD";
      hydrateShell(data);
      if (page === "dashboard") renderDashboard(data);
      if (page === "loan") renderLoan(data);
      if (page === "transaction") renderTransactions(data.transactions);
      if (page === "profile") renderProfile(data);
      renderQuickTransferOptions(data.quickTransferTargets || []);
      attachTransferFlow();
    })
    .catch(() => renderFlash("Unable to load portal data."));

  function hydrateShell(data) {
    const initials = `${data.user.firstName[0] || ""}${data.user.lastName[0] || ""}`.toUpperCase() || "CB";
    hydrateAvatars(initials, data.user.profileImage);
    setText("sidebar-name", data.user.fullName);
    setText("sidebar-type", "Checking");
    setText("top-name", "American Express Platinum");
    setText("top-balance", formatMoney(data.summary.availableBalance));
    setText("top-ending", data.user.accountNumber.slice(-4));
    attachProfileLinks();
  }

  function renderDashboard(data) {
    setText("account-balance", formatMoney(data.summary.availableBalance));
    setText("loan-amount", formatMoney(data.summary.loanAmount));
    setText("recent-transaction-count", String(data.summary.transactionCount));
    renderRecentTransactions(data.recentTransactions);
    renderChart(data.chart.labels, data.chart.values);
  }

  function renderLoan(data) {
    setText("loan-amount", formatMoney(data.summary.loanAmount));
    if (data.loans && data.loans.length) {
      setText("loan-latest", `${data.loans[0].status} | ${data.loans[0].duration} | ${formatMoney(data.loans[0].amount)}`);
    }
  }

  function renderTransactions(transactions) {
    portalTransactions = Array.isArray(transactions) ? transactions : [];
    const body = document.getElementById("transactions-table-body");
    if (!body) return;
    if (!portalTransactions.length) {
      body.innerHTML = '<tr><td colspan="6">No transactions found.</td></tr>';
      return;
    }
    body.innerHTML = portalTransactions.map((item) => `
      <tr class="clickable-transaction" data-transaction-id="${item.id}">
        <td>${item.id}</td>
        <td>${escapeHtml(item.reference_id)}</td>
        <td class="amount ${item.amount >= 0 ? "amount-positive" : "amount-negative"}">${formatSignedMoney(item.amount, item.currency_code)}</td>
        <td>${escapeHtml(String(item.type).toUpperCase())}</td>
        <td><span class="status-pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
        <td>${escapeHtml(item.created_at)}</td>
      </tr>
    `).join("");
    attachTransactionDetailTriggers();
  }

  function renderProfile(data) {
    setText("profile-name", data.user.fullName);
    setText("profile-account", data.user.accountNumber);
    setText("profile-email", data.user.email);
    setText("profile-phone", data.user.phone);
    setValue("first_name", data.user.firstName);
    setValue("last_name", data.user.lastName);
    setValue("email", data.user.email);
    setValue("phone", data.user.phone);
    setValue("country", data.user.country);
    setValue("state", data.user.state);
    setValue("occupation", data.user.occupation);
    setValue("address", data.user.address);
    setValue("profile_image", data.user.profileImage || "");
  }

  function hydrateAvatars(initials, imageUrl) {
    document.querySelectorAll("[data-avatar]").forEach((node) => {
      node.textContent = initials;
      node.classList.remove("has-image");
      node.style.backgroundImage = "";
      if (imageUrl) {
        node.textContent = "";
        node.classList.add("has-image");
        node.style.backgroundImage = `url("${String(imageUrl).replaceAll('"', "%22")}")`;
      }
    });
  }

  function hydrateNavigationIcons() {
    document.querySelectorAll(".portal-nav a").forEach((link) => {
      const label = (link.textContent || "").trim().toLowerCase();
      const glyph = link.querySelector(".nav-glyph");
      if (!glyph) return;
      if (label.includes("dashboard")) glyph.innerHTML = ICONS.dashboard;
      if (label.includes("deposit")) glyph.innerHTML = ICONS.deposit;
      if (label.includes("wire")) glyph.innerHTML = ICONS.wire;
      if (label.includes("domestic")) glyph.innerHTML = ICONS.domestic;
      if (label.includes("loan")) glyph.innerHTML = ICONS.loan;
      if (label.includes("transaction")) glyph.innerHTML = ICONS.transactions;
      if (label.includes("profile")) glyph.innerHTML = ICONS.profile;
    });

    const sidebarIcons = document.querySelectorAll(".sidebar-icon");
    if (sidebarIcons[0]) sidebarIcons[0].innerHTML = ICONS.bell;
    if (sidebarIcons[1]) sidebarIcons[1].innerHTML = ICONS.card;
  }

  function attachProfileLinks() {
    document.querySelectorAll(".portal-topbar-right [data-avatar], .portal-profile-card").forEach((node) => {
      node.setAttribute("role", "link");
      node.setAttribute("tabindex", "0");
      node.classList.add("profile-link-trigger");
      node.addEventListener("click", () => {
        window.location.href = "/profile";
      });
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          window.location.href = "/profile";
        }
      });
    });
  }

  function renderRecentTransactions(transactions) {
    const body = document.getElementById("recent-transactions-body");
    if (!body) return;
    if (!transactions.length) {
      body.innerHTML = '<tr><td colspan="5">No recent transactions.</td></tr>';
      return;
    }
    body.innerHTML = transactions.map((item) => `
      <tr>
        <td><span class="status-pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
        <td>${escapeHtml(item.reference_id)}</td>
        <td>${relativeDate(item.created_at)}</td>
        <td><span class="category-badge ${escapeHtml(item.category)}">${escapeHtml(String(item.category).replaceAll("_", " "))}</span></td>
        <td class="amount ${item.amount >= 0 ? "amount-positive" : "amount-negative"}">${formatSignedMoney(item.amount, item.currency_code)}</td>
      </tr>
    `).join("");
  }

  function renderQuickTransferOptions(options) {
    document.querySelectorAll("[data-transfer-target]").forEach((select) => {
      select.innerHTML = options.map((item) => `<option>${escapeHtml(item)}</option>`).join("");
    });
  }

  function attachTransferFlow() {
    const transferForm = document.querySelector("[data-transfer-form]");
    const confirmModal = document.getElementById("transfer-confirm-modal");
    const otpModal = document.getElementById("transfer-otp-modal");
    if (!transferForm || !confirmModal || !otpModal) return;

    const confirmBody = document.getElementById("transfer-confirm-body");
    const proceedButton = document.getElementById("transfer-proceed-button");
    const otpInput = document.getElementById("otp_code");
    const hiddenOtp = transferForm.querySelector('input[name="otp_code"]');
    const otpForm = otpModal.querySelector("form");
    const otpSubmitButton = otpForm.querySelector('button[type="submit"]');
    const transferState = params.get("transfer_state");
    const shouldResumeTransfer = params.get("resume_transfer") === "1";
    const transferSuccess = params.get("success");
    const confirmSpinner = createSpinnerRow("Preparing OTP verification...");
    const otpSpinner = createSpinnerRow("Submitting transfer request...");
    const transferNote = document.createElement("div");
    transferNote.className = "transfer-flow-note";
    transferNote.textContent = "Invalid OTP. Stay on this page to retry, or cancel to review your transfer details again.";
    const resultModal = ensureTransferResultModal();

    confirmModal.querySelector(".form-actions").append(confirmSpinner);
    otpForm.append(otpSpinner);
    otpForm.insertBefore(transferNote, otpForm.firstChild);

    transferForm.addEventListener("submit", (event) => {
      event.preventDefault();
      hiddenOtp.value = "";
      otpInput.value = "";
      setButtonLoading(proceedButton, false);
      setButtonLoading(otpSubmitButton, false);
      toggleSpinner(confirmSpinner, false);
      toggleSpinner(otpSpinner, false);
      toggleTransferNote(transferNote, false);
      const data = new FormData(transferForm);
      const rows = [
        ["Bank Name", data.get("bank_name") || ""],
        ["Beneficiary Account Name", data.get("beneficiary_name") || ""],
        ["Beneficiary Account No", data.get("account_number") || ""],
        ["Amount", formatMoney(data.get("amount") || 0, data.get("currency_code") || currentCurrency)],
        ["Account Type", data.get("account_type") || ""],
      ];
      confirmBody.innerHTML = rows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(String(value))}</td></tr>`).join("");
      confirmModal.classList.add("is-open");
    });

    confirmModal.querySelectorAll("[data-close-modal]").forEach((node) => {
      node.addEventListener("click", () => confirmModal.classList.remove("is-open"));
    });
    otpModal.querySelectorAll("[data-close-modal]").forEach((node) => {
      node.addEventListener("click", () => {
        otpModal.classList.remove("is-open");
        if (transferState === "invalid_otp" || shouldResumeTransfer) {
          confirmModal.classList.add("is-open");
        }
      });
    });
    proceedButton.addEventListener("click", () => {
      setButtonLoading(proceedButton, true);
      toggleSpinner(confirmSpinner, true);
      window.setTimeout(() => {
        toggleSpinner(confirmSpinner, false);
        setButtonLoading(proceedButton, false);
        confirmModal.classList.remove("is-open");
        otpModal.classList.add("is-open");
        otpInput.focus();
      }, 4000);
    });
    otpForm.addEventListener("submit", (event) => {
      event.preventDefault();
      hiddenOtp.value = otpInput.value.trim();
      persistTransferState(transferForm, otpInput.value.trim());
      setButtonLoading(otpSubmitButton, true);
      toggleSpinner(otpSpinner, true);
      transferForm.submit();
    });

    if (transferSuccess) {
      clearTransferState();
    } else {
      restoreTransferState(transferForm, otpInput);
    }
    if (transferState === "invalid_otp" || shouldResumeTransfer) {
      toggleTransferNote(transferNote, true);
      otpModal.classList.add("is-open");
      otpInput.focus();
    } else if (transferSuccess && (transferState === "pending_transfer" || transferState === "transfer_completed")) {
      openTransferResultModal(resultModal, transferState, transferSuccess);
    }

    function persistTransferState(formNode, otpValue) {
      if (!transferStorageKey) return;
      const payload = {};
      new FormData(formNode).forEach((value, key) => {
        payload[key] = value;
      });
      payload.otp_code = otpValue || "";
      window.sessionStorage.setItem(transferStorageKey, JSON.stringify(payload));
    }

    function restoreTransferState(formNode, otpNode) {
      if (!transferStorageKey) return;
      const raw = window.sessionStorage.getItem(transferStorageKey);
      if (!raw) return;
      try {
        const payload = JSON.parse(raw);
        formNode.querySelectorAll("[name]").forEach((field) => {
          if (field.name === "otp_code") return;
          if (!(field.name in payload)) return;
          field.value = payload[field.name];
        });
        if (payload.otp_code) {
          otpNode.value = payload.otp_code;
        }
      } catch (error) {
        window.sessionStorage.removeItem(transferStorageKey);
      }
    }

    function clearTransferState() {
      if (!transferStorageKey) return;
      window.sessionStorage.removeItem(transferStorageKey);
    }
  }

  function createSpinnerRow(text) {
    const row = document.createElement("div");
    row.className = "transfer-spinner-row";
    row.innerHTML = `<span class="transfer-spinner" aria-hidden="true"></span><span>${escapeHtml(text)}</span>`;
    return row;
  }

  function toggleSpinner(node, isVisible) {
    if (node) node.classList.toggle("is-visible", Boolean(isVisible));
  }

  function toggleTransferNote(node, isVisible) {
    if (node) node.classList.toggle("is-visible", Boolean(isVisible));
  }

  function setButtonLoading(button, isLoading) {
    if (!button) return;
    button.classList.toggle("is-loading", Boolean(isLoading));
    button.disabled = Boolean(isLoading);
  }

  function ensureTransferResultModal() {
    let modal = document.getElementById("transfer-result-modal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.className = "transfer-modal-overlay";
    modal.id = "transfer-result-modal";
    modal.innerHTML = `
      <div class="transfer-modal-card">
        <button class="transfer-modal-close" type="button" data-close-transfer-result>Cancel</button>
        <h2 id="transfer-result-title">Transfer Update</h2>
        <p id="transfer-result-message">Your transfer has been processed.</p>
        <div class="transfer-result-state" id="transfer-result-state"></div>
        <div class="transfer-result-actions">
          <button class="btn btn-outline" type="button" data-close-transfer-result>Cancel</button>
          <button class="btn btn-primary" type="button" id="transfer-result-dashboard">Back to Dashboard</button>
        </div>
      </div>
    `;
    document.body.append(modal);

    modal.querySelectorAll("[data-close-transfer-result]").forEach((node) => {
      node.addEventListener("click", () => {
        window.location.href = "/dashboard";
      });
    });
    modal.querySelector("#transfer-result-dashboard").addEventListener("click", () => {
      window.location.href = "/dashboard";
    });
    return modal;
  }

  function openTransferResultModal(modal, transferState, successMessage) {
    if (!modal) return;
    const titleNode = modal.querySelector("#transfer-result-title");
    const messageNode = modal.querySelector("#transfer-result-message");
    const stateNode = modal.querySelector("#transfer-result-state");
    const isCompleted = transferState === "transfer_completed";
    titleNode.textContent = isCompleted ? "Transfer Completed" : "Transfer Pending";
    messageNode.textContent = successMessage || (isCompleted ? "Your transfer has been completed successfully." : "Your transfer is pending and will be updated shortly.");
    stateNode.innerHTML = `<span class="status-pill ${statusClass(isCompleted ? "Completed" : "Pending")}">${escapeHtml(isCompleted ? "Completed" : "Pending")}</span>`;
    modal.classList.add("is-open");
  }

  function attachTransactionDetailTriggers() {
    const modal = document.getElementById("transaction-detail-modal");
    const detailBody = document.getElementById("transaction-detail-body");
    const detailStatus = document.getElementById("transaction-detail-status");
    const detailSummary = document.getElementById("transaction-detail-summary");
    if (!modal || !detailBody || !detailStatus || !detailSummary) return;

    modal.querySelectorAll("[data-close-transaction-modal]").forEach((node) => {
      node.addEventListener("click", () => modal.classList.remove("is-open"));
    });

    document.querySelectorAll("[data-transaction-id]").forEach((row) => {
      row.addEventListener("click", () => {
        const transactionId = Number(row.dataset.transactionId || 0);
        const item = portalTransactions.find((entry) => Number(entry.id) === transactionId);
        if (!item) return;
        const metadata = item.metadata || {};
        const rows = [
          ["Reference", item.reference_id],
          ["Category", String(item.category || "").replaceAll("_", " ")],
          ["Type", String(item.type || "").toUpperCase()],
          ["Amount", formatSignedMoney(item.amount, item.currency_code)],
          ["Created At", item.created_at],
          ["Description", item.description || ""],
        ];

        if (metadata.beneficiaryName) rows.push(["Beneficiary Name", metadata.beneficiaryName]);
        if (metadata.bankName) rows.push(["Bank Name", metadata.bankName]);
        if (metadata.accountNumber) rows.push(["Account Number", metadata.accountNumber]);
        if (metadata.accountType) rows.push(["Account Type", metadata.accountType]);
        if (metadata.country) rows.push(["Country", metadata.country]);
        if (metadata.swiftCode) rows.push(["Swift Code", metadata.swiftCode]);
        if (metadata.routingNumber) rows.push(["Routing Number", metadata.routingNumber]);
        if (metadata.narration) rows.push(["Narration", metadata.narration]);

        detailSummary.textContent = buildTransactionSummary(item);
        detailStatus.innerHTML = `<span class="status-pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span>`;
        detailBody.innerHTML = rows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(String(value || "-"))}</td></tr>`).join("");
        modal.classList.add("is-open");
      });
    });
  }

  function buildTransactionSummary(item) {
    const status = String(item.status || "").toLowerCase();
    if (status === "completed") {
      return "This transfer was completed successfully. The receipt below reflects the final transfer details.";
    }
    if (status === "pending") {
      return "This transfer is still pending. You can reopen this receipt anytime to check the latest status.";
    }
    if (status === "failed") {
      return "This transaction did not complete successfully. Review the receipt details below for context.";
    }
    return "This receipt shows the current state of the transaction and its latest transfer details.";
  }

  function renderChart(labels, values) {
    const canvas = document.getElementById("history-chart");
    if (!canvas) return;
    const context = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(640, Math.floor(rect.width * 2));
    canvas.height = 300;
    context.scale(2, 2);
    const width = canvas.width / 2;
    const height = canvas.height / 2;
    const padding = { left: 36, right: 18, top: 18, bottom: 32 };
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#ebf0f8";
    for (let i = 0; i < 4; i += 1) {
      const y = padding.top + (chartHeight / 3) * i;
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(width - padding.right, y);
      context.stroke();
    }

    context.beginPath();
    values.forEach((value, index) => {
      const x = padding.left + (chartWidth / Math.max(values.length - 1, 1)) * index;
      const ratio = (value - min) / Math.max(max - min, 1);
      const y = padding.top + chartHeight - ratio * chartHeight;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = "#2b63de";
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = "#2b63de";
    values.forEach((value, index) => {
      const x = padding.left + (chartWidth / Math.max(values.length - 1, 1)) * index;
      const ratio = (value - min) / Math.max(max - min, 1);
      const y = padding.top + chartHeight - ratio * chartHeight;
      context.beginPath();
      context.arc(x, y, 3.2, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.fillStyle = "#fff";
      context.arc(x, y, 1.5, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#2b63de";
    });
    context.fillStyle = "#9aa6b7";
    context.font = "12px HK Grotesk";
    labels.forEach((label, index) => {
      const x = padding.left + (chartWidth / Math.max(labels.length - 1, 1)) * index;
      context.fillText(label, x - 10, height - 8);
    });
  }

  function renderFlash(error, success) {
    if (!flashNode) return;
    if (error) {
      flashNode.innerHTML = `<div class="message error">${escapeHtml(error)}</div>`;
      return;
    }
    if (success) {
      flashNode.innerHTML = `<div class="message success">${escapeHtml(success)}</div>`;
    }
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function setValue(id, value) {
    const node = document.getElementById(id);
    if (node) node.value = value || "";
  }

  function formatMoney(value, currency = currentCurrency) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(Number(value || 0));
  }

  function formatSignedMoney(value, currency = currentCurrency) {
    const amount = formatMoney(Math.abs(Number(value || 0)), currency);
    return Number(value) >= 0 ? `+ ${amount}` : `- ${amount}`;
  }

  function statusClass(value) {
    const normalized = String(value || "").toLowerCase();
    if (normalized === "completed") return "completed";
    if (normalized === "failed") return "failed";
    return "";
  }

  function relativeDate(value) {
    const then = new Date(String(value).replace(" ", "T"));
    const diffDays = Math.max(0, Math.floor((Date.now() - then.getTime()) / 86400000));
    if (diffDays === 0) return "today";
    if (diffDays === 1) return "1 day ago";
    if (diffDays < 30) return `${diffDays} days ago`;
    const months = Math.round(diffDays / 30);
    return `about ${months} month${months > 1 ? "s" : ""} ago`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
