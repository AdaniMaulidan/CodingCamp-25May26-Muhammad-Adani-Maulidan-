/**
 * Expense & Budget Visualizer — script.js
 * =========================================
 * Features:
 *  1.  Add / delete / clear transactions
 *  2.  Form validation (all fields, positive amounts ≥ $0.01, trimmed input)
 *  3.  Auto-calculate balance, income, expenses
 *  4.  Persist all state to localStorage (transactions, categories, theme, sort)
 *  5.  Doughnut chart via Chart.js (expenses by category, auto-updates)
 *  6.  Dark / Light mode toggle (persisted, chart updates on toggle)
 *  7.  Custom categories (add/remove, persisted, reflected in dropdown + chart)
 *  8.  Sort transactions (date desc/asc, amount desc/asc, category A-Z, persisted)
 *
 * Architecture:
 *  - Single source of truth: `state` object
 *  - Every mutation calls persist() then the relevant render function(s)
 *  - renderAll() is the master refresh — balance + list + chart in one pass
 *
 * Fixes applied vs previous version:
 *  - Duplicate category options: static HTML options removed; JS owns the select entirely
 *  - Sort order now persisted to localStorage
 *  - Amount validation now enforces ≥ 0.01 (matches HTML min attribute)
 *  - Chart borderColor updated on theme toggle (was only updating backgroundColor)
 *  - expenseChart.update() called without invalid 'active' mode argument
 *  - Balance negative state uses CSS class instead of hardcoded inline colour
 *  - window.confirm() replaced with inline confirm bar (non-blocking, styleable)
 *  - Dead code removed (unreachable default sort branch)
 */

'use strict';

/* ============================================================
   1. STATE
   ============================================================ */

const state = {
  transactions:     [],      // { id, name, amount, category, type, date }
  customCategories: [],      // { name, color, emoji }
  theme:            'light', // 'light' | 'dark'
  sortOrder:        'date-desc',
};

/* ============================================================
   2. STORAGE KEYS
   ============================================================ */

const KEYS = {
  transactions:     'ebv_transactions',
  customCategories: 'ebv_custom_categories',
  theme:            'ebv_theme',
  sortOrder:        'ebv_sort_order',
};

/* ============================================================
   3. BUILT-IN CATEGORY CONFIG
   ============================================================ */

/**
 * Default categories — emoji, chart colour, CSS class.
 * Custom categories are merged in at runtime via getCategories().
 */
const BUILTIN_CATEGORIES = {
  Food:      { emoji: '🍔', color: '#f97316', cssClass: 'cat-food' },
  Transport: { emoji: '🚗', color: '#3b82f6', cssClass: 'cat-transport' },
  Fun:       { emoji: '🎉', color: '#a855f7', cssClass: 'cat-fun' },
};

const FALLBACK_CATEGORY = { emoji: '💳', color: '#6c63ff', cssClass: 'cat-default' };

/**
 * Merge built-in and custom categories into one lookup map.
 * Called fresh each time so custom additions are always reflected.
 * @returns {Object}
 */
function getCategories() {
  const map = { ...BUILTIN_CATEGORIES };
  state.customCategories.forEach((c) => {
    map[c.name] = { emoji: '🏷️', color: c.color, cssClass: 'cat-custom' };
  });
  return map;
}

/**
 * Look up config for a single category name.
 * @param {string} name
 * @returns {{ emoji: string, color: string, cssClass: string }}
 */
function getCategoryConfig(name) {
  return getCategories()[name] || FALLBACK_CATEGORY;
}

/* ============================================================
   4. DOM REFERENCES
   ============================================================ */

const themeToggleBtn = document.getElementById('themeToggle');
const themeIcon      = document.getElementById('themeIcon');

const form           = document.getElementById('transactionForm');
const itemNameInput  = document.getElementById('itemName');
const amountInput    = document.getElementById('amount');
const categorySelect = document.getElementById('category');
const typeHidden     = document.getElementById('transactionType');
const typeButtons    = document.querySelectorAll('.type-btn');

const totalBalanceEl = document.getElementById('totalBalance');
const totalIncomeEl  = document.getElementById('totalIncome');
const totalExpenseEl = document.getElementById('totalExpense');

const transactionList = document.getElementById('transactionList');
const emptyState      = document.getElementById('emptyState');
const clearAllBtn     = document.getElementById('clearAllBtn');
const sortSelect      = document.getElementById('sortSelect');

const confirmBar = document.getElementById('confirmBar');
const confirmYes = document.getElementById('confirmYes');
const confirmNo  = document.getElementById('confirmNo');

const chartPlaceholder = document.getElementById('chartPlaceholder');
const chartWrapper     = document.getElementById('chartWrapper');
const chartCanvas      = document.getElementById('expenseChart');
const chartLegend      = document.getElementById('chartLegend');

const newCategoryName  = document.getElementById('newCategoryName');
const newCategoryColor = document.getElementById('newCategoryColor');
const addCategoryBtn   = document.getElementById('addCategoryBtn');
const categoryChips    = document.getElementById('categoryChips');
const categoryNameErr  = document.getElementById('categoryNameError');

/* ============================================================
   5. CHART INSTANCE
   ============================================================ */

/** Active Chart.js instance. Destroyed before recreating to avoid canvas errors. */
let expenseChart = null;

/* ============================================================
   6. UTILITY FUNCTIONS
   ============================================================ */

/**
 * Format a number as USD currency. Always returns a positive value.
 * The caller is responsible for prepending a sign where needed.
 * @param {number} value
 * @returns {string} e.g. "$1,234.56"
 */
function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(Math.abs(value));
}

/**
 * Format an ISO date string to a short readable date.
 * @param {string} iso
 * @returns {string} e.g. "May 28"
 */
function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Generate a unique transaction ID.
 * @returns {string}
 */
function generateId() {
  return `txn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Escape HTML special characters to prevent XSS when injecting into innerHTML.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, (ch) => map[ch]);
}

/* ============================================================
   7. PERSISTENCE
   ============================================================ */

/**
 * Save all state slices to localStorage.
 * Wrapped in try/catch — localStorage may be unavailable in private browsing.
 */
function persist() {
  try {
    localStorage.setItem(KEYS.transactions,     JSON.stringify(state.transactions));
    localStorage.setItem(KEYS.customCategories, JSON.stringify(state.customCategories));
    localStorage.setItem(KEYS.theme,            state.theme);
    localStorage.setItem(KEYS.sortOrder,        state.sortOrder); // FIX: was not persisted
  } catch (err) {
    console.warn('[EBV] localStorage write failed:', err);
  }
}

/**
 * Load all state slices from localStorage on app init.
 * Falls back to safe defaults on any parse error.
 */
function loadFromStorage() {
  try {
    const txRaw    = localStorage.getItem(KEYS.transactions);
    const catRaw   = localStorage.getItem(KEYS.customCategories);
    const theme    = localStorage.getItem(KEYS.theme);
    const sortOrder = localStorage.getItem(KEYS.sortOrder);

    state.transactions     = txRaw  ? JSON.parse(txRaw)  : [];
    state.customCategories = catRaw ? JSON.parse(catRaw) : [];
    state.theme            = theme === 'dark' ? 'dark' : 'light';
    state.sortOrder        = sortOrder || 'date-desc'; // FIX: restore persisted sort
  } catch (err) {
    console.warn('[EBV] localStorage read failed:', err);
    state.transactions     = [];
    state.customCategories = [];
    state.theme            = 'light';
    state.sortOrder        = 'date-desc';
  }
}

/* ============================================================
   8. THEME — DARK / LIGHT MODE
   ============================================================ */

/** Apply the current theme to <html> and update the toggle button label/icon. */
function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  const isDark = state.theme === 'dark';
  themeIcon.textContent = isDark ? '☀️' : '🌙';
  themeToggleBtn.setAttribute(
    'aria-label',
    isDark ? 'Switch to light mode' : 'Switch to dark mode'
  );
}

/**
 * Toggle theme, persist, apply, and update chart colours.
 * FIX: now also updates chart borderColor (was only updating tooltip/backgroundColor).
 */
function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  persist();
  applyTheme();

  if (expenseChart) {
    const borderCol = state.theme === 'dark' ? '#1a1a2e' : '#ffffff';
    const textCol   = state.theme === 'dark' ? '#e2e8f0' : '#1e1e2e';

    expenseChart.data.datasets[0].borderColor          = borderCol; // FIX: was missing
    expenseChart.options.plugins.tooltip.bodyColor     = textCol;
    expenseChart.update(); // FIX: removed invalid 'active' mode argument
  }
}

themeToggleBtn.addEventListener('click', toggleTheme);

/* ============================================================
   9. CUSTOM CATEGORIES
   ============================================================ */

/**
 * Rebuild the category <select> from scratch.
 * FIX: HTML no longer has static <option> tags — JS owns the select entirely,
 * preventing duplicate options on init.
 * Restores the previously selected value if it still exists.
 */
function renderCategorySelect() {
  const current = categorySelect.value;

  categorySelect.innerHTML = '<option value="" disabled>Select a category</option>';

  // Built-in options
  Object.entries(BUILTIN_CATEGORIES).forEach(([name, cfg]) => {
    const opt = document.createElement('option');
    opt.value       = name;
    opt.textContent = `${cfg.emoji} ${name}`;
    categorySelect.appendChild(opt);
  });

  // Custom options
  state.customCategories.forEach((c) => {
    const opt = document.createElement('option');
    opt.value       = c.name;
    opt.textContent = `🏷️ ${c.name}`;
    categorySelect.appendChild(opt);
  });

  // Restore selection if it still exists in the rebuilt list
  const stillExists = [...categorySelect.options].some((o) => o.value === current);
  if (current && stillExists) {
    categorySelect.value = current;
  }
}

/**
 * Render custom category chips below the add form.
 * Each chip has a colour dot and a remove button.
 */
function renderCategoryChips() {
  if (state.customCategories.length === 0) {
    categoryChips.innerHTML =
      '<p style="font-size:0.75rem;color:var(--color-text-muted)">No custom categories yet.</p>';
    return;
  }

  categoryChips.innerHTML = state.customCategories
    .map((c) => `
      <span
        class="category-chip"
        style="background:${c.color}22; border-color:${c.color}55; color:${c.color};"
      >
        <span class="category-chip-dot" style="background:${c.color};"></span>
        ${escapeHTML(c.name)}
        <button
          class="category-chip-remove"
          data-name="${escapeHTML(c.name)}"
          aria-label="Remove category ${escapeHTML(c.name)}"
          title="Remove"
        >✕</button>
      </span>
    `)
    .join('');
}

/**
 * Add a new custom category after validation.
 * Validates: non-empty, not a duplicate (case-insensitive).
 */
function addCustomCategory() {
  const name  = newCategoryName.value.trim();
  const color = newCategoryColor.value;

  if (!name) {
    categoryNameErr.textContent = 'Please enter a category name.';
    newCategoryName.classList.add('is-invalid');
    newCategoryName.focus();
    return;
  }

  const allNames = [
    ...Object.keys(BUILTIN_CATEGORIES),
    ...state.customCategories.map((c) => c.name),
  ].map((n) => n.toLowerCase());

  if (allNames.includes(name.toLowerCase())) {
    categoryNameErr.textContent = `"${name}" already exists.`;
    newCategoryName.classList.add('is-invalid');
    newCategoryName.focus();
    return;
  }

  categoryNameErr.textContent = '';
  newCategoryName.classList.remove('is-invalid');

  state.customCategories.push({ name, color, emoji: '🏷️' });
  persist();

  renderCategorySelect();
  renderCategoryChips();
  renderChart(); // chart may need the new colour

  newCategoryName.value  = '';
  newCategoryColor.value = '#10b981';
  newCategoryName.focus();
}

/**
 * Remove a custom category by name.
 * Existing transactions that used it keep their data but fall back to default styling.
 * @param {string} name
 */
function removeCustomCategory(name) {
  state.customCategories = state.customCategories.filter((c) => c.name !== name);
  persist();
  renderCategorySelect();
  renderCategoryChips();
  renderChart();
}

addCategoryBtn.addEventListener('click', addCustomCategory);

newCategoryName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addCustomCategory(); }
});

// Event delegation for chip remove buttons
categoryChips.addEventListener('click', (e) => {
  const btn = e.target.closest('.category-chip-remove');
  if (btn) removeCustomCategory(btn.dataset.name);
});

/* ============================================================
   10. FORM — TYPE TOGGLE
   ============================================================ */

typeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    typeButtons.forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    typeHidden.value = btn.dataset.type;
  });
});

/* ============================================================
   11. FORM — VALIDATION
   ============================================================ */

/**
 * Validate a text/select field.
 * @param {HTMLElement} input
 * @param {HTMLElement} errorEl
 * @param {string} message
 * @returns {boolean}
 */
function validateField(input, errorEl, message) {
  const isValid = input.value.trim() !== '' && input.validity.valid;
  input.classList.toggle('is-invalid', !isValid);
  errorEl.textContent = isValid ? '' : message;
  return isValid;
}

/**
 * Validate the amount field.
 * FIX: now enforces val >= 0.01 to match the HTML min="0.01" attribute.
 * @returns {boolean}
 */
function validateAmount() {
  const errorEl = document.getElementById('amountError');
  const raw     = amountInput.value.trim();
  const val     = parseFloat(raw);
  const isValid = raw !== '' && !isNaN(val) && val >= 0.01;

  amountInput.classList.toggle('is-invalid', !isValid);
  errorEl.textContent = isValid ? '' : 'Enter a valid amount of at least $0.01.';
  return isValid;
}

/**
 * Run all validators simultaneously (no short-circuit — all errors shown at once).
 * @returns {boolean}
 */
function validateForm() {
  const nameOk = validateField(
    itemNameInput,
    document.getElementById('itemNameError'),
    'Item name is required.'
  );
  const amountOk   = validateAmount();
  const categoryOk = validateField(
    categorySelect,
    document.getElementById('categoryError'),
    'Please select a category.'
  );
  return nameOk && amountOk && categoryOk;
}

/** Clear all validation error states from the form. */
function clearValidation() {
  [itemNameInput, amountInput, categorySelect].forEach((el) => el.classList.remove('is-invalid'));
  ['itemNameError', 'amountError', 'categoryError'].forEach((id) => {
    document.getElementById(id).textContent = '';
  });
}

/** Reset the type toggle back to the default (Expense). */
function resetTypeToggle() {
  typeButtons.forEach((b) => {
    b.classList.remove('active');
    b.setAttribute('aria-pressed', 'false');
  });
  const expBtn = document.getElementById('typeExpense');
  expBtn.classList.add('active');
  expBtn.setAttribute('aria-pressed', 'true');
  typeHidden.value = 'expense';
}

/* ============================================================
   12. FORM — SUBMISSION
   ============================================================ */

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!validateForm()) return;

  const transaction = {
    id:       generateId(),
    name:     itemNameInput.value.trim(),
    amount:   parseFloat(parseFloat(amountInput.value).toFixed(2)),
    category: categorySelect.value,
    type:     typeHidden.value,  // 'expense' | 'income'
    date:     new Date().toISOString(),
  };

  state.transactions.unshift(transaction); // newest first
  persist();
  renderAll();

  form.reset();
  clearValidation();
  resetTypeToggle();

  // Rebuild select after reset so custom options are preserved
  renderCategorySelect();

  itemNameInput.focus();
});

/* ============================================================
   13. DELETE TRANSACTION
   ============================================================ */

/**
 * Remove a transaction by ID, persist, and re-render.
 * @param {string} id
 */
function deleteTransaction(id) {
  state.transactions = state.transactions.filter((t) => t.id !== id);
  persist();
  renderAll();
}

// Event delegation — one listener handles all delete buttons in the list
transactionList.addEventListener('click', (e) => {
  const btn = e.target.closest('.transaction-delete');
  if (btn && btn.dataset.id) deleteTransaction(btn.dataset.id);
});

/* ============================================================
   14. CLEAR ALL — INLINE CONFIRM BAR
   FIX: replaced window.confirm() with a non-blocking inline confirm bar.
   window.confirm() blocks the UI thread and cannot be styled.
   ============================================================ */

/** Show the inline confirm bar and hide the Clear All button. */
function showConfirmBar() {
  confirmBar.hidden = false;
  clearAllBtn.hidden = true;
  confirmYes.focus();
}

/** Hide the confirm bar and restore the Clear All button. */
function hideConfirmBar() {
  confirmBar.hidden = true;
  clearAllBtn.hidden = false;
}

clearAllBtn.addEventListener('click', showConfirmBar);

confirmYes.addEventListener('click', () => {
  state.transactions = [];
  persist();
  hideConfirmBar();
  renderAll();
});

confirmNo.addEventListener('click', hideConfirmBar);

/* ============================================================
   15. SORT
   ============================================================ */

/**
 * Return a sorted copy of the transactions array.
 * Does NOT mutate the original array.
 * FIX: removed unreachable default branch (dead code).
 * @returns {Array}
 */
function getSortedTransactions() {
  const list = [...state.transactions];

  switch (state.sortOrder) {
    case 'date-asc':
      return list.sort((a, b) => new Date(a.date) - new Date(b.date));
    case 'date-desc':
      return list.sort((a, b) => new Date(b.date) - new Date(a.date));
    case 'amount-asc':
      return list.sort((a, b) => a.amount - b.amount);
    case 'amount-desc':
      return list.sort((a, b) => b.amount - a.amount);
    case 'category-asc':
      return list.sort((a, b) => a.category.localeCompare(b.category));
  }

  return list; // fallback (should never reach here with valid sortOrder values)
}

// Persist sort order and re-render list on dropdown change
sortSelect.addEventListener('change', () => {
  state.sortOrder = sortSelect.value;
  persist(); // FIX: sort order is now persisted
  renderTransactionList();
});

/* ============================================================
   16. BALANCE CALCULATION & RENDER
   ============================================================ */

/**
 * Sum income and expense totals from all transactions.
 * @returns {{ income: number, expense: number, balance: number }}
 */
function calculateTotals() {
  return state.transactions.reduce(
    (acc, t) => {
      if (t.type === 'income') acc.income  += t.amount;
      else                     acc.expense += t.amount;
      acc.balance = acc.income - acc.expense;
      return acc;
    },
    { income: 0, expense: 0, balance: 0 }
  );
}

/**
 * Update the balance card DOM.
 * FIX: uses CSS class 'is-negative' instead of hardcoded inline colour,
 * so the colour respects the design token system.
 */
function renderBalance() {
  const { income, expense, balance } = calculateTotals();
  const sign = balance < 0 ? '-' : '';

  totalBalanceEl.textContent = `${sign}${formatCurrency(balance)}`;
  totalIncomeEl.textContent  = formatCurrency(income);
  totalExpenseEl.textContent = formatCurrency(expense);

  // Toggle CSS class for negative balance colour
  totalBalanceEl.classList.toggle('is-negative', balance < 0);
}

/* ============================================================
   17. TRANSACTION LIST RENDER
   ============================================================ */

/** Rebuild the transaction list from sorted state. */
function renderTransactionList() {
  const hasItems = state.transactions.length > 0;

  emptyState.hidden      = hasItems;
  transactionList.hidden = !hasItems;
  clearAllBtn.disabled   = !hasItems;

  // Hide confirm bar if list becomes empty
  if (!hasItems) {
    hideConfirmBar();
    transactionList.innerHTML = '';
    return;
  }

  // Single DOM write with all sorted items
  transactionList.innerHTML = getSortedTransactions()
    .map(buildTransactionHTML)
    .join('');
}

/**
 * Build the HTML string for a single transaction list item.
 * All user-supplied strings are escaped to prevent XSS.
 * @param {Object} t - Transaction object
 * @returns {string}
 */
function buildTransactionHTML(t) {
  const cfg      = getCategoryConfig(t.category);
  const sign     = t.type === 'income' ? '+' : '-';
  const amtClass = t.type === 'income' ? 'is-income' : 'is-expense';
  const safeName = escapeHTML(t.name);
  const safeCat  = escapeHTML(t.category);

  return `
    <li class="transaction-item" data-id="${t.id}">
      <div class="transaction-icon ${cfg.cssClass}" aria-hidden="true">${cfg.emoji}</div>
      <div class="transaction-details">
        <p class="transaction-name" title="${safeName}">${safeName}</p>
        <div class="transaction-meta">
          <span class="category-badge ${cfg.cssClass}">${safeCat}</span>
          <span class="transaction-date">${formatDate(t.date)}</span>
        </div>
      </div>
      <span class="transaction-amount ${amtClass}" aria-label="${t.type}: ${formatCurrency(t.amount)}">
        ${sign}${formatCurrency(t.amount)}
      </span>
      <button
        class="transaction-delete"
        data-id="${t.id}"
        aria-label="Delete transaction: ${safeName}"
        title="Delete"
      >✕</button>
    </li>
  `;
}

/* ============================================================
   18. CHART RENDER (Chart.js doughnut)
   ============================================================ */

/**
 * Aggregate expense totals by category.
 * Income transactions are intentionally excluded from the chart.
 * @returns {{ labels: string[], data: number[], colors: string[] }}
 */
function getChartData() {
  const totals = {};

  state.transactions
    .filter((t) => t.type === 'expense')
    .forEach((t) => {
      totals[t.category] = (totals[t.category] || 0) + t.amount;
    });

  const labels = Object.keys(totals);
  const data   = Object.values(totals);
  const colors = labels.map((label) => getCategoryConfig(label).color);

  return { labels, data, colors };
}

/**
 * Create or update the Chart.js doughnut chart.
 *
 * Strategy:
 *  - No expense data → destroy chart (if any), show placeholder.
 *  - Chart exists → update data in-place (no flicker, no canvas reuse error).
 *  - No chart yet → create a fresh instance.
 *
 * FIX: expenseChart.update() called without invalid 'active' argument.
 * FIX: borderColor now updated on theme change via toggleTheme().
 */
function renderChart() {
  const { labels, data, colors } = getChartData();
  const hasData = data.length > 0;

  chartPlaceholder.hidden = hasData;
  chartWrapper.hidden     = !hasData;

  if (!hasData) {
    if (expenseChart) { expenseChart.destroy(); expenseChart = null; }
    chartLegend.innerHTML = '';
    return;
  }

  const borderCol = state.theme === 'dark' ? '#1a1a2e' : '#ffffff';
  const textCol   = state.theme === 'dark' ? '#e2e8f0' : '#1e1e2e';

  if (expenseChart) {
    // Update existing chart in-place
    expenseChart.data.labels                      = labels;
    expenseChart.data.datasets[0].data            = data;
    expenseChart.data.datasets[0].backgroundColor = colors;
    expenseChart.data.datasets[0].borderColor     = borderCol;
    expenseChart.options.plugins.tooltip.bodyColor = textCol;
    expenseChart.update(); // FIX: no invalid mode argument
  } else {
    // Create new chart instance
    expenseChart = new Chart(chartCanvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderColor: borderCol,
          borderWidth: 3,
          hoverOffset: 10,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '62%',
        animation: { animateRotate: true, duration: 500 },
        plugins: {
          legend: { display: false }, // custom legend rendered below
          tooltip: {
            bodyColor: textCol,
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct   = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
                return ` ${ctx.label}: ${formatCurrency(ctx.parsed)} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  renderChartLegend(labels, colors, data);
}

/**
 * Render a custom legend below the doughnut chart.
 * @param {string[]} labels
 * @param {string[]} colors
 * @param {number[]} data
 */
function renderChartLegend(labels, colors, data) {
  const total = data.reduce((a, b) => a + b, 0);

  chartLegend.innerHTML = labels
    .map((label, i) => {
      const pct = total > 0 ? ((data[i] / total) * 100).toFixed(0) : 0;
      return `
        <div class="legend-item">
          <span class="legend-dot" style="background:${colors[i]};" aria-hidden="true"></span>
          <span>${escapeHTML(label)} <strong>${pct}%</strong></span>
        </div>
      `;
    })
    .join('');
}

/* ============================================================
   19. MASTER RENDER
   ============================================================ */

/**
 * Re-render all data-driven UI sections from current state.
 * Call this after any mutation to state.transactions.
 */
function renderAll() {
  renderBalance();
  renderTransactionList();
  renderChart();
}

/* ============================================================
   20. INITIALISATION
   ============================================================ */

function init() {
  // 1. Restore all persisted state
  loadFromStorage();

  // 2. Apply saved theme to <html>
  applyTheme();

  // 3. Sync sort dropdown to persisted sort order
  sortSelect.value = state.sortOrder;

  // 4. Build category select (JS owns this entirely — no static HTML options)
  renderCategorySelect();

  // 5. Render custom category chips
  renderCategoryChips();

  // 6. Render all data-driven sections
  renderAll();
}

init();
