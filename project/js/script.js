/**
 * Expense & Budget Visualizer — script.js
 * =========================================
 * Features:
 *  1.  Add / delete / clear transactions
 *  2.  Form validation (all fields, positive amounts, trimmed input)
 *  3.  Auto-calculate balance, income, expenses
 *  4.  Persist transactions to localStorage
 *  5.  Doughnut chart via Chart.js (expenses by category)
 *  6.  Dark / Light mode toggle (persisted)
 *  7.  Custom categories (add, remove, persisted, reflected in chart)
 *  8.  Sort transactions (date desc/asc, amount desc/asc, category A-Z)
 *
 * Architecture:
 *  - Single source of truth: `state` object
 *  - Every mutation calls persist() then renderAll()
 *  - renderAll() updates balance, list, and chart in one pass
 */

'use strict';

/* ============================================================
   1. STATE
   ============================================================ */

const state = {
  transactions:       [],   // { id, name, amount, category, type, date }
  customCategories:   [],   // { name, color, emoji }
  theme:              'light',
  sortOrder:          'date-desc',
};

/* ============================================================
   2. STORAGE KEYS
   ============================================================ */

const KEYS = {
  transactions:     'ebv_transactions',
  customCategories: 'ebv_custom_categories',
  theme:            'ebv_theme',
};

/* ============================================================
   3. BUILT-IN CATEGORY CONFIG
   ============================================================ */

/**
 * Default categories with emoji, chart colour, and CSS class.
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
 * @returns {Object} Combined category config keyed by name
 */
function getCategories() {
  const map = { ...BUILTIN_CATEGORIES };
  state.customCategories.forEach((c) => {
    map[c.name] = { emoji: c.emoji || '🏷️', color: c.color, cssClass: 'cat-custom' };
  });
  return map;
}

/**
 * Look up config for a single category name.
 * @param {string} name
 * @returns {{ emoji, color, cssClass }}
 */
function getCategoryConfig(name) {
  return getCategories()[name] || FALLBACK_CATEGORY;
}

/* ============================================================
   4. DOM REFERENCES
   ============================================================ */

// Header
const themeToggleBtn = document.getElementById('themeToggle');
const themeIcon      = document.getElementById('themeIcon');

// Form
const form           = document.getElementById('transactionForm');
const itemNameInput  = document.getElementById('itemName');
const amountInput    = document.getElementById('amount');
const categorySelect = document.getElementById('category');
const typeHidden     = document.getElementById('transactionType');
const typeButtons    = document.querySelectorAll('.type-btn');

// Balance
const totalBalanceEl = document.getElementById('totalBalance');
const totalIncomeEl  = document.getElementById('totalIncome');
const totalExpenseEl = document.getElementById('totalExpense');

// Transaction list
const transactionList = document.getElementById('transactionList');
const emptyState      = document.getElementById('emptyState');
const clearAllBtn     = document.getElementById('clearAllBtn');
const sortSelect      = document.getElementById('sortSelect');

// Chart
const chartPlaceholder = document.getElementById('chartPlaceholder');
const chartWrapper     = document.getElementById('chartWrapper');
const chartCanvas      = document.getElementById('expenseChart');
const chartLegend      = document.getElementById('chartLegend');

// Custom categories
const newCategoryName  = document.getElementById('newCategoryName');
const newCategoryColor = document.getElementById('newCategoryColor');
const addCategoryBtn   = document.getElementById('addCategoryBtn');
const categoryChips    = document.getElementById('categoryChips');
const categoryNameErr  = document.getElementById('categoryNameError');

/* ============================================================
   5. CHART INSTANCE
   ============================================================ */

/** Active Chart.js instance — must be destroyed before recreating */
let expenseChart = null;

/* ============================================================
   6. UTILITY FUNCTIONS
   ============================================================ */

/**
 * Format a number as USD. Always positive — caller adds sign.
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
 * Format an ISO date string to "May 28" style.
 * @param {string} iso
 * @returns {string}
 */
function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Generate a unique ID: timestamp + random suffix.
 * @returns {string}
 */
function generateId() {
  return `txn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, (ch) => map[ch]);
}

/* ============================================================
   7. PERSISTENCE (localStorage)
   ============================================================ */

/** Save all persisted state slices to localStorage. */
function persist() {
  try {
    localStorage.setItem(KEYS.transactions,     JSON.stringify(state.transactions));
    localStorage.setItem(KEYS.customCategories, JSON.stringify(state.customCategories));
    localStorage.setItem(KEYS.theme,            state.theme);
  } catch (err) {
    console.warn('[EBV] localStorage write failed:', err);
  }
}

/** Load all persisted state slices from localStorage. */
function loadFromStorage() {
  try {
    const txRaw  = localStorage.getItem(KEYS.transactions);
    const catRaw = localStorage.getItem(KEYS.customCategories);
    const theme  = localStorage.getItem(KEYS.theme);

    state.transactions     = txRaw  ? JSON.parse(txRaw)  : [];
    state.customCategories = catRaw ? JSON.parse(catRaw) : [];
    state.theme            = theme === 'dark' ? 'dark' : 'light';
  } catch (err) {
    console.warn('[EBV] localStorage read failed:', err);
    state.transactions     = [];
    state.customCategories = [];
    state.theme            = 'light';
  }
}

/* ============================================================
   8. THEME — DARK / LIGHT MODE
   ============================================================ */

/** Apply the current theme to the <html> element and update the toggle button. */
function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  const isDark = state.theme === 'dark';
  themeIcon.textContent = isDark ? '☀️' : '🌙';
  themeToggleBtn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
}

/** Toggle between dark and light, persist, and apply. */
function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  persist();
  applyTheme();

  // Chart colours need to update when theme changes
  if (expenseChart) {
    expenseChart.options.plugins.tooltip.bodyColor =
      state.theme === 'dark' ? '#e2e8f0' : '#1e1e2e';
    expenseChart.update();
  }
}

themeToggleBtn.addEventListener('click', toggleTheme);

/* ============================================================
   9. CUSTOM CATEGORIES
   ============================================================ */

/**
 * Rebuild the category <select> options from built-ins + custom categories.
 * Preserves the currently selected value if it still exists.
 */
function renderCategorySelect() {
  const current = categorySelect.value;

  // Clear all options except the placeholder
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

  // Restore selection if still valid
  if (current && [...categorySelect.options].some((o) => o.value === current)) {
    categorySelect.value = current;
  }
}

/**
 * Render the custom-category chips below the add form.
 * Each chip has a remove button.
 */
function renderCategoryChips() {
  if (state.customCategories.length === 0) {
    categoryChips.innerHTML = '<p style="font-size:0.75rem;color:var(--color-text-muted)">No custom categories yet.</p>';
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
 * Add a new custom category.
 * Validates: non-empty name, not a duplicate of built-in or existing custom.
 */
function addCustomCategory() {
  const name  = newCategoryName.value.trim();
  const color = newCategoryColor.value;

  // Validate name
  if (!name) {
    categoryNameErr.textContent = 'Please enter a category name.';
    newCategoryName.classList.add('is-invalid');
    newCategoryName.focus();
    return;
  }

  // Check for duplicates (case-insensitive)
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

  // Clear error
  categoryNameErr.textContent = '';
  newCategoryName.classList.remove('is-invalid');

  // Add to state
  state.customCategories.push({ name, color, emoji: '🏷️' });
  persist();

  // Update UI
  renderCategorySelect();
  renderCategoryChips();
  renderChart(); // chart may need new colour

  // Reset inputs
  newCategoryName.value = '';
  newCategoryColor.value = '#10b981';
  newCategoryName.focus();
}

/**
 * Remove a custom category by name.
 * Transactions that used it keep their data — they just fall back to default styling.
 * @param {string} name
 */
function removeCustomCategory(name) {
  state.customCategories = state.customCategories.filter((c) => c.name !== name);
  persist();
  renderCategorySelect();
  renderCategoryChips();
  renderChart();
}

// Add button click
addCategoryBtn.addEventListener('click', addCustomCategory);

// Enter key in name input
newCategoryName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addCustomCategory(); }
});

// Remove chip via event delegation
categoryChips.addEventListener('click', (e) => {
  const btn = e.target.closest('.category-chip-remove');
  if (!btn) return;
  removeCustomCategory(btn.dataset.name);
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
 * Validate a text/select field. Shows error if empty or browser-invalid.
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
 * Validate the amount field: must be a positive number.
 * @returns {boolean}
 */
function validateAmount() {
  const errorEl = document.getElementById('amountError');
  const raw     = amountInput.value.trim();
  const val     = parseFloat(raw);
  const isValid = raw !== '' && !isNaN(val) && val > 0;

  amountInput.classList.toggle('is-invalid', !isValid);
  errorEl.textContent = isValid ? '' : 'Enter a valid amount greater than $0.';
  return isValid;
}

/**
 * Run all field validators. All errors shown simultaneously.
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

/** Clear all validation states. */
function clearValidation() {
  [itemNameInput, amountInput, categorySelect].forEach((el) => el.classList.remove('is-invalid'));
  ['itemNameError', 'amountError', 'categoryError'].forEach((id) => {
    document.getElementById(id).textContent = '';
  });
}

/** Reset type toggle to default (Expense). */
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
    type:     typeHidden.value,   // 'expense' | 'income'
    date:     new Date().toISOString(),
  };

  state.transactions.unshift(transaction);
  persist();
  renderAll();

  form.reset();
  clearValidation();
  resetTypeToggle();
  itemNameInput.focus();
});

/* ============================================================
   13. DELETE / CLEAR TRANSACTIONS
   ============================================================ */

/**
 * Remove a transaction by ID, persist, re-render.
 * @param {string} id
 */
function deleteTransaction(id) {
  state.transactions = state.transactions.filter((t) => t.id !== id);
  persist();
  renderAll();
}

// Event delegation — one listener handles all delete buttons
transactionList.addEventListener('click', (e) => {
  const btn = e.target.closest('.transaction-delete');
  if (btn && btn.dataset.id) deleteTransaction(btn.dataset.id);
});

// Clear all
clearAllBtn.addEventListener('click', () => {
  if (!window.confirm('Delete all transactions? This cannot be undone.')) return;
  state.transactions = [];
  persist();
  renderAll();
});

/* ============================================================
   14. SORT
   ============================================================ */

/**
 * Return a sorted copy of the transactions array based on state.sortOrder.
 * Does NOT mutate the original array.
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

    default:
      return list;
  }
}

// Update sort order and re-render list when dropdown changes
sortSelect.addEventListener('change', () => {
  state.sortOrder = sortSelect.value;
  renderTransactionList();
});

/* ============================================================
   15. BALANCE CALCULATION & RENDER
   ============================================================ */

/**
 * Sum income and expense totals.
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

/** Update the balance card DOM. */
function renderBalance() {
  const { income, expense, balance } = calculateTotals();
  const sign = balance < 0 ? '-' : '';

  totalBalanceEl.textContent = `${sign}${formatCurrency(balance)}`;
  totalIncomeEl.textContent  = formatCurrency(income);
  totalExpenseEl.textContent = formatCurrency(expense);

  // Red tint when negative
  totalBalanceEl.style.color = balance < 0 ? '#fca5a5' : '#ffffff';
}

/* ============================================================
   16. TRANSACTION LIST RENDER
   ============================================================ */

/** Rebuild the transaction list from sorted state. */
function renderTransactionList() {
  const hasItems = state.transactions.length > 0;

  emptyState.hidden      = hasItems;
  transactionList.hidden = !hasItems;
  clearAllBtn.disabled   = !hasItems;

  if (!hasItems) {
    transactionList.innerHTML = '';
    return;
  }

  // One DOM write with sorted items
  transactionList.innerHTML = getSortedTransactions()
    .map(buildTransactionHTML)
    .join('');
}

/**
 * Build HTML for a single transaction list item.
 * @param {Object} t
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
   17. CHART RENDER (Chart.js doughnut)
   ============================================================ */

/**
 * Aggregate expense totals by category (income excluded).
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
 * - No data → destroy chart, show placeholder.
 * - Chart exists → update in-place (no flicker).
 * - No chart yet → create fresh instance.
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

  // Determine text colour based on current theme
  const textColor = state.theme === 'dark' ? '#e2e8f0' : '#1e1e2e';

  if (expenseChart) {
    // Update existing chart data in-place
    expenseChart.data.labels                      = labels;
    expenseChart.data.datasets[0].data            = data;
    expenseChart.data.datasets[0].backgroundColor = colors;
    expenseChart.options.plugins.tooltip.bodyColor = textColor;
    expenseChart.update('active');
  } else {
    // Create new chart instance
    expenseChart = new Chart(chartCanvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderColor: state.theme === 'dark' ? '#1a1a2e' : '#ffffff',
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
            bodyColor: textColor,
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
 * Render a custom legend below the chart.
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
   18. MASTER RENDER
   ============================================================ */

/**
 * Re-render all UI sections from current state.
 * Call after every state mutation.
 */
function renderAll() {
  renderBalance();
  renderTransactionList();
  renderChart();
}

/* ============================================================
   19. INITIALISATION
   ============================================================ */

function init() {
  // 1. Restore persisted state
  loadFromStorage();

  // 2. Apply saved theme
  applyTheme();

  // 3. Sync sort dropdown to state (default is 'date-desc')
  sortSelect.value = state.sortOrder;

  // 4. Populate category select with built-ins + custom
  renderCategorySelect();

  // 5. Render custom category chips
  renderCategoryChips();

  // 6. Render all data-driven UI
  renderAll();
}

init();
