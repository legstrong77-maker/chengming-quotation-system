(function () {
  "use strict";

  const STORAGE_KEY = "chengming.quotation.v1";
  const ARCHIVE_KEY = "chengming.quotation.archive.v1";
  const SEQUENCE_KEY = "chengming.quotation.sequence.v1";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const todayIso = () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  };

  function nextQuoteNumber() {
    const today = todayIso().replaceAll("-", "");
    let sequence = 1;
    try {
      const stored = JSON.parse(localStorage.getItem(SEQUENCE_KEY) || "{}");
      sequence = stored.date === today ? Number(stored.value || 0) + 1 : 1;
      localStorage.setItem(SEQUENCE_KEY, JSON.stringify({ date: today, value: sequence }));
    } catch (_) {}
    return `CM-${today}-${String(sequence).padStart(3, "0")}`;
  }

  const createItem = (overrides = {}) => ({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    name: "",
    description: "",
    unit: "式",
    quantity: 1,
    unitPrice: 0,
    ...overrides
  });

  function createBlankQuote() {
    return {
      quoteNo: nextQuoteNumber(),
      quoteDate: todayIso(),
      validDays: 30,
      salesperson: "莊子揚",
      customerName: "",
      customerTaxId: "",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      customerAddress: "",
      taxMode: "external",
      paymentTerms: "驗收完成並收到發票後 30 日內付款",
      notes: "本報價單有效期限為報價日起 30 日。\n工作範圍如有增減，雙方應另以書面確認費用與時程。\n款項請匯入澄明企業社指定帳戶。",
      items: [createItem({ name: "系統建置與技術服務", description: "需求整理、系統開發、測試、安裝部署及上線支援", quantity: 1, unitPrice: 65000 })],
      updatedAt: new Date().toISOString()
    };
  }

  let state = loadDraft() || createBlankQuote();
  let saveTimer = null;

  function loadDraft() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || !Array.isArray(parsed.items)) return null;
      parsed.items = parsed.items.map(item => createItem(item));
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function getArchive() {
    try {
      const archive = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || "[]");
      return Array.isArray(archive) ? archive : [];
    } catch (_) {
      return [];
    }
  }

  function setArchive(archive) {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
  }

  function formatMoney(value) {
    return `NT$${Math.round(Number(value) || 0).toLocaleString("zh-TW")}`;
  }

  function formatRocDate(iso) {
    if (!iso) return "—";
    const [year, month, day] = iso.split("-").map(Number);
    if (!year) return iso;
    return `民國 ${year - 1911} 年 ${month} 月 ${day} 日`;
  }

  function expiryDate() {
    if (!state.quoteDate) return "";
    const date = new Date(`${state.quoteDate}T00:00:00`);
    date.setDate(date.getDate() + Math.max(0, Number(state.validDays || 0)));
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function calculateTotals() {
    const itemTotal = state.items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0);
    if (state.taxMode === "included") {
      const subtotal = Math.round(itemTotal / 1.05);
      return { subtotal, tax: itemTotal - subtotal, total: itemTotal };
    }
    if (state.taxMode === "exempt") return { subtotal: itemTotal, tax: 0, total: itemTotal };
    const tax = Math.round(itemTotal * 0.05);
    return { subtotal: itemTotal, tax, total: itemTotal + tax };
  }

  const digits = ["零", "壹", "貳", "參", "肆", "伍", "陸", "柒", "捌", "玖"];
  const smallUnits = ["", "拾", "佰", "仟"];
  const bigUnits = ["", "萬", "億", "兆"];

  function sectionToChinese(section) {
    let result = "";
    let zeroPending = false;
    for (let i = 3; i >= 0; i--) {
      const divisor = 10 ** i;
      const digit = Math.floor(section / divisor) % 10;
      if (digit === 0) {
        if (result) zeroPending = true;
      } else {
        if (zeroPending) result += "零";
        result += digits[digit] + smallUnits[i];
        zeroPending = false;
      }
    }
    return result;
  }

  function amountToChinese(value) {
    let amount = Math.max(0, Math.round(Number(value) || 0));
    if (amount === 0) return "零元整";
    const sections = [];
    while (amount > 0) {
      sections.push(amount % 10000);
      amount = Math.floor(amount / 10000);
    }
    let result = "";
    let zeroBetween = false;
    for (let i = sections.length - 1; i >= 0; i--) {
      const section = sections[i];
      if (section === 0) {
        if (result) zeroBetween = true;
        continue;
      }
      if (result && (zeroBetween || section < 1000)) result += "零";
      result += sectionToChinese(section) + bigUnits[i];
      zeroBetween = false;
    }
    return result + "元整";
  }

  function setText(id, value, fallback = "—") {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value || fallback);
  }

  function renderForm() {
    $$('[data-field]').forEach(input => {
      const key = input.dataset.field;
      input.value = state[key] ?? "";
    });
    renderItemsEditor();
  }

  function renderItemsEditor() {
    const container = $("#itemsEditor");
    container.innerHTML = "";
    state.items.forEach((item, index) => {
      const card = document.createElement("div");
      card.className = "item-card";
      card.dataset.itemId = item.id;
      card.innerHTML = `
        <div class="item-card-top">
          <span class="item-order">${String(index + 1).padStart(2, "0")}</span>
          <label class="mini-field"><span>品名</span><input class="item-input" data-item-field="name" value="${escapeHtml(item.name)}" placeholder="服務或商品名稱"></label>
          <label class="mini-field"><span>單位</span><input class="item-input" data-item-field="unit" value="${escapeHtml(item.unit)}"></label>
          <label class="mini-field"><span>數量</span><input class="item-input" data-item-field="quantity" type="number" min="0" step="0.01" value="${item.quantity}"></label>
          <label class="mini-field"><span>未稅單價</span><input class="item-input" data-item-field="unitPrice" type="number" min="0" step="1" value="${item.unitPrice}"></label>
          <button class="item-remove" type="button" aria-label="刪除此品項" title="刪除此品項">×</button>
        </div>
        <label class="mini-field item-description"><span>規格／工作內容說明</span><input class="item-input" data-item-field="description" value="${escapeHtml(item.description)}" placeholder="選填；可說明規格、範圍或交付內容"></label>
      `;
      container.appendChild(card);
    });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  function renderPreview() {
    setText("previewCustomer", state.customerName, "請填寫客戶名稱");
    setText("previewCustomerTaxId", state.customerTaxId);
    setText("previewContact", [state.contactName, state.contactEmail].filter(Boolean).join("／"));
    setText("previewPhone", state.contactPhone);
    setText("previewAddress", state.customerAddress);
    setText("previewQuoteNo", state.quoteNo);
    setText("previewQuoteDate", formatRocDate(state.quoteDate));
    setText("previewExpiry", formatRocDate(expiryDate()));
    setText("previewSalesperson", state.salesperson);
    setText("previewPaymentTerms", state.paymentTerms, "依雙方約定");
    setText("previewFooterNo", state.quoteNo);

    const itemsBody = $("#previewItems");
    itemsBody.innerHTML = "";
    const items = state.items.length ? state.items : [createItem()];
    items.forEach((item, index) => {
      const row = document.createElement("tr");
      const amount = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
      row.innerHTML = `
        <td>${index + 1}</td>
        <td><span class="item-name-print">${escapeHtml(item.name || "未命名品項")}</span>${item.description ? `<span class="item-desc-print">${escapeHtml(item.description)}</span>` : ""}</td>
        <td>${escapeHtml(item.unit || "—")}</td>
        <td>${Number(item.quantity || 0).toLocaleString("zh-TW")}</td>
        <td>${formatMoney(item.unitPrice)}</td>
        <td>${formatMoney(amount)}</td>
      `;
      itemsBody.appendChild(row);
    });

    const totals = calculateTotals();
    setText("previewSubtotal", formatMoney(totals.subtotal));
    setText("previewTax", formatMoney(totals.tax));
    setText("previewTotal", formatMoney(totals.total));
    setText("previewAmountWords", amountToChinese(totals.total));

    const taxRow = $("#taxRow");
    const taxLabel = $("dt", taxRow);
    taxRow.style.display = "flex";
    if (state.taxMode === "included") taxLabel.textContent = "內含營業稅 5%";
    else if (state.taxMode === "exempt") taxLabel.textContent = "營業稅（免稅）";
    else taxLabel.textContent = "營業稅 5%";

    const notes = $("#previewNotes");
    notes.innerHTML = "";
    String(state.notes || "").split(/\n+/).map(line => line.trim()).filter(Boolean).forEach(line => {
      const item = document.createElement("li");
      item.textContent = line;
      notes.appendChild(item);
    });
    if (!notes.children.length) notes.innerHTML = "<li>本報價內容以雙方確認為準。</li>";

    const safeTitle = [state.quoteNo, state.customerName, "報價單"].filter(Boolean).join("_");
    document.title = safeTitle || "澄明企業社_報價單";
  }

  function markChanged() {
    state.updatedAt = new Date().toISOString();
    renderPreview();
    $("#saveStatus").textContent = "尚未儲存的變更";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      $("#saveStatus").textContent = `已自動儲存於本機 · ${new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}`;
    }, 500);
  }

  function saveToArchive() {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const archive = getArchive();
    const snapshot = JSON.parse(JSON.stringify(state));
    const existingIndex = archive.findIndex(item => item.quoteNo === state.quoteNo);
    if (existingIndex >= 0) archive.splice(existingIndex, 1);
    archive.unshift(snapshot);
    setArchive(archive.slice(0, 100));
    $("#saveStatus").textContent = "草稿已儲存至歷史報價";
    renderHistory();
    showToast("報價草稿已儲存");
  }

  function renderHistory() {
    const container = $("#historyList");
    const archive = getArchive();
    if (!archive.length) {
      container.innerHTML = '<div class="history-empty">尚無已儲存的報價單</div>';
      return;
    }
    container.innerHTML = "";
    archive.forEach((quote, index) => {
      const totals = calculateSnapshotTotals(quote);
      const row = document.createElement("div");
      row.className = "history-item";
      row.innerHTML = `
        <div><strong>${escapeHtml(quote.quoteNo || "未編號")} · ${escapeHtml(quote.customerName || "未填客戶")}</strong><span>${formatMoney(totals.total)}　${formatRocDate(quote.quoteDate)}</span></div>
        <div class="history-actions"><button type="button" data-load-index="${index}">載入</button><button type="button" data-delete-index="${index}">刪除</button></div>
      `;
      container.appendChild(row);
    });
  }

  function calculateSnapshotTotals(quote) {
    const previous = state;
    state = quote;
    const totals = calculateTotals();
    state = previous;
    return totals;
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function newQuote() {
    if ((state.customerName || state.items.some(item => item.name)) && !confirm("要建立新的報價單嗎？目前內容仍保存在本機草稿中。")) return;
    state = createBlankQuote();
    renderForm();
    renderPreview();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    showToast("已建立新報價單");
  }

  function validateBeforePrint() {
    if (!state.customerName.trim()) {
      const input = $('[data-field="customerName"]');
      input.focus();
      input.scrollIntoView({ behavior: "smooth", block: "center" });
      showToast("請先填寫客戶名稱");
      return false;
    }
    if (!state.items.length || state.items.some(item => !item.name.trim())) {
      showToast("請確認每個報價品項都有名稱");
      return false;
    }
    return true;
  }

  function exportData() {
    const payload = { version: 1, exportedAt: new Date().toISOString(), current: state, archive: getArchive() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `澄明企業社_報價資料備份_${todayIso()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("資料備份已下載");
  }

  async function importData(file) {
    try {
      const payload = JSON.parse(await file.text());
      if (!payload.current || !Array.isArray(payload.current.items) || !Array.isArray(payload.archive)) throw new Error("格式不符");
      state = payload.current;
      state.items = state.items.map(item => createItem(item));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setArchive(payload.archive);
      renderForm();
      renderPreview();
      renderHistory();
      showToast("備份資料已匯入");
    } catch (_) {
      showToast("無法匯入：備份檔格式不正確");
    }
  }

  function bindEvents() {
    document.addEventListener("input", event => {
      const field = event.target.closest("[data-field]");
      if (field) {
        const key = field.dataset.field;
        state[key] = field.type === "number" ? Number(field.value) : field.value;
        markChanged();
        return;
      }
      const itemField = event.target.closest("[data-item-field]");
      if (itemField) {
        const card = itemField.closest(".item-card");
        const item = state.items.find(entry => entry.id === card.dataset.itemId);
        if (!item) return;
        const key = itemField.dataset.itemField;
        item[key] = itemField.type === "number" ? Number(itemField.value) : itemField.value;
        markChanged();
      }
    });

    document.addEventListener("change", event => {
      const field = event.target.closest("[data-field]");
      if (field) {
        state[field.dataset.field] = field.type === "number" ? Number(field.value) : field.value;
        markChanged();
      }
    });

    $("#itemsEditor").addEventListener("click", event => {
      const remove = event.target.closest(".item-remove");
      if (!remove) return;
      const card = remove.closest(".item-card");
      if (state.items.length === 1) {
        showToast("報價單至少需要一個品項");
        return;
      }
      state.items = state.items.filter(item => item.id !== card.dataset.itemId);
      renderItemsEditor();
      markChanged();
    });

    $("#addItemBtn").addEventListener("click", () => {
      state.items.push(createItem());
      renderItemsEditor();
      markChanged();
      const last = $(".item-card:last-child input", $("#itemsEditor"));
      if (last) last.focus();
    });

    $("#newQuoteBtn").addEventListener("click", newQuote);
    $("#saveQuoteBtn").addEventListener("click", saveToArchive);
    $("#printQuoteBtn").addEventListener("click", () => {
      if (!validateBeforePrint()) return;
      saveToArchive();
      setTimeout(() => window.print(), 80);
    });
    $("#exportBtn").addEventListener("click", exportData);
    $("#importInput").addEventListener("change", event => {
      const file = event.target.files && event.target.files[0];
      if (file) importData(file);
      event.target.value = "";
    });

    $("#historyList").addEventListener("click", event => {
      const loadButton = event.target.closest("[data-load-index]");
      const deleteButton = event.target.closest("[data-delete-index]");
      const archive = getArchive();
      if (loadButton) {
        const quote = archive[Number(loadButton.dataset.loadIndex)];
        if (!quote) return;
        state = JSON.parse(JSON.stringify(quote));
        state.items = state.items.map(item => createItem(item));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        renderForm();
        renderPreview();
        showToast("已載入歷史報價");
      }
      if (deleteButton) {
        const index = Number(deleteButton.dataset.deleteIndex);
        if (!confirm("確定要刪除這份歷史報價嗎？")) return;
        archive.splice(index, 1);
        setArchive(archive);
        renderHistory();
        showToast("歷史報價已刪除");
      }
    });
  }

  renderForm();
  renderPreview();
  renderHistory();
  bindEvents();
  $("#saveStatus").textContent = state.updatedAt ? `已載入本機草稿 · ${new Date(state.updatedAt).toLocaleDateString("zh-TW")}` : "所有資料僅儲存在這台裝置";
})();
