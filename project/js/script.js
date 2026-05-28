/**
 * Expense & Budget Visualizer — script.js
 * =========================================
 * Features:
 *  1. Add transactions (with full validation)
 *  2. Render scrollable transaction list
 *  3. Delete individual transactions
 *  4. Clear all transactions
 *  5. Auto-calculate total balance / income / expenses
 *  6. Persist state to localStorage
 *  7. Render live doughnut chart via Chart.js (by category)
 *
 * Architecture:
 *  - Single source of truth: `transactions` array
 *  - Every state change calls saveToStorage() + renderAll()
 *  - renderAll() updates balance, list, and chart in one pass
 */

'use strict';

/* ============================================================
   1. APP STATE
   ============================================================ */

/** Master list of transaction objects loaded from / saved to localStorage */
let transactions = [];

/* ============================================================
   2. CONSTANTS
   ============================================================ */

/** localStorage key */
const STORAGE_KEY = 'ebv_transactions';

/**
 * Category metadata: emoji icon, chart color, CSS class.
 * Add new entries here to support additional categories.
 */
const CATEGORY_CONFIG = {
  Food:      { emoji: '🍔', color: '#f97316', cssClass: 'cat-food' },
  Transport: { emoji: '🚗', color: '#3b82f6', cssClass: 'cat-transport' },
  Fun:       { emoji: '🎉', color: '#a855f7', cssClass: 'cat-fun' },
};

/** Used when a transaction's category isn't in CATEGORY_CONFIG */
const DEFAULT_CATEGORY = { emoji: '💳', color: '#6c63ff', cssClass: 'cat-default' };

/* ============================================================
   3. DOM REFERENCES
   ============================================================ */

// Form elements
const form           = document.getElementById('transactionForm');
const itemNameInput  = document.getElementById('itemName');
const amountInput    = document.getElementById('amount');
const categorySelect = document.getElementById('category');
const typeHidden     = document.getElementById('transactionType');
const typeButtons    = document.querySelectorAll('.type-btn');

// Balance display
const totalBalanceEl = document.getElementById('totalBalance');
const totalIncomeEl  = document.getElementById('totalIncome');
const totalExpenseEl = document.getElementById('totalExpense');

// Transaction list
const transactionList = document.getElementById('transactionList');
const emptyState      = document.getElementById('emptyState');
const clearAllBtn     = document.getElementById('clearAllBtn');

// Chart elements
const chartPlaceholder = document.getElementById('chartPlaceholder');
const chartWrapper     = document.getElementById('chartWrapper');
const chartCanvas      = document.getElementById('expenseChart');
const chartLegend      = document.getElementById('chartLegend');

/* ============================================================
   4. CHART INSTANCE
   ============================================================ */

/**
 * Holds the active Chart.js instance.
 * Must be destroyed before creating a new one to avoid canvas reuse errors.
 */
let expenseChart = null;

/* ============================================================
   5. UTILITY FUNCTIONS
   ============================================================ */

/**
 * Format a number as a USD currency string.
 * Always returns a positive formatted value — sign is added by the caller.
 * @param {number} value - Absolute (positive) number
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
 * Format an ISO date string to a short human-readable date.
 * @param {string} isoString
 * @returns {string} e.g. "May 28"
 */
function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Generate a unique transaction ID using timestamp + random suffix.
 * Collision probability is negligible for a client-side app.
 * @returns {string}
 */
function generateId() {
  return `txn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Escape HTML special characters to prevent XSS when injecting user input into innerHTML.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, (ch) => map[ch]);
}

/**
 * Look up category metadata by name.
 * @param {string} category
 * @returns {{ emoji: string, color: string, cssClass: string }}
 */
function getCategoryConfig(category) {
  return CATEGORY_CONFIG[category] || DEFAULT_CATEGORY;
}

/* ============================================================
   6. LOCALSTORAGE PERSISTENCE
   ============================================================ */

/** Save the current transactions array to localStorage. */
function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  } catch (err) {
    // localStorage may be unavailable in private browsing or when storage is full
    console.warn('[EBV] Could not save to localStorage:', err);
  }
}

/**
 * Load transactions from localStorage into the in-memory array.
 * Called once on app init. Falls back to empty array on any error.
 */
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    transactions = raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn('[EBV] Could not load from localStorage:', err);
    transactions = [];
  }
}

/* ============================================================
   7. FORM — TYPE TOGGLE (Expense / Income)
   ============================================================ */

/**
 * Wire up the Expense / Income toggle buttons.
 * Clicking a button marks it active, updates aria-pressed,
 * and syncs the hidden input that the form submission reads.
 */
typeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    // Deactivate all buttons
    typeButtons.forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });

    // Activate the clicked button
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');

    // Keep hidden input in sync
    typeHidden.value = btn.dataset.type; // 'expense' | 'income'
  });
});

/* ============================================================
   8. FORM — VALIDATION
   ============================================================ */

/**
 * Validate a single form field.
 * Adds/removes the `is-invalid` class and sets the error message.
 *
 * @param {HTMLInputElement|HTMLSelectElement} input - Field to validate
 * @param {HTMLElement} errorEl - Element that displays the error text
 * @param {string} message - Error message shown when invalid
 * @returns {boolean} true if the field is valid
 */
function validateField(input, errorEl, message) {
  // Treat empty string and whitespace-only as invalid
  const isEmpty = input.value.trim() === '';
  const isValid = !isEmpty && input.validity.valid;

  if (isValid) {
    input.classList.remove('is-invalid');
    errorEl.textContent = '';
  } else {
    input.classList.add('is-invalid');
    errorEl.textContent = message;
  }

  return isValid;
}

/**
 * Validate the amount field specifically.
 * Must be a number greater than zero.
 *
 * @returns {boolean}
 */
function validateAmount() {
  const errorEl = document.getElementById('amountError');
  const value   = parseFloat(amountInput.value);
  const isValid = amountInput.value.trim() !== '' && !isNaN(value) && value > 0;

  if (isValid) {
    amountInput.classList.remove('is-invalid');
    errorEl.textContent = '';
  } else {
    amountInput.classList.add('is-invalid');
    errorEl.textContent = 'Please enter a valid amount greater than $0.';
  }

  return isValid;
}

/**
 * Run validation on all form fields.
 * @returns {boolean} true only if every field passes
 */
function validateForm() {
  // Run all validators — don't short-circuit so all errors show at once
  const nameOk     = validateField(itemNameInput, document.getElementById('itemNameError'), 'Please enter an item name.');
  const amountOk   = validateAmount();
  const categoryOk = validateField(categorySelect, document.getElementById('categoryError'), 'Please select a category.');

  return nameOk && amountOk && categoryOk;
}

/** Remove all validation error indicators from the form. */
function clearValidation() {
  [itemNameInput, amountInput, categorySelect].forEach((el) => {
    el.classList.remove('is-invalid');
  });
  ['itemNameError', 'amountError', 'categoryError'].forEach((id) => {
    document.getElementById(id).textContent = '';
  });
}

/** Reset the type toggle UI back to the default (Expense). */
function resetTypeToggle() {
  typeButtons.forEach((b) => {
    b.classList.remove('active');
    b.setAttribute('aria-pressed', 'false');
  });
  const expenseBtn = document.getElementById('typeExpense');
  expenseBtn.classList.add('active');
  expenseBtn.setAttribute('aria-pressed', 'true');
  typeHidden.value = 'expense';
}

/* ============================================================
   9. FORM — SUBMISSION (Add Transaction)
   ============================================================ */

form.addEventListener('submit', (e) => {
  e.preventDefault();

  // Stop if any field is invalid
  if (!validateForm()) return;

  // Build the transaction object
  const transaction = {
    id:       generateId(),
    name:     itemNameInput.value.trim(),
    amount:   parseFloat(parseFloat(amountInput.value).toFixed(2)), // normalise to 2dp
    category: categorySelect.value,
    type:     typeHidden.value,  // 'expense' | 'income'
    date:     new Date().toISOString(),
  };

  // Prepend so newest appears at the top of the list
  transactions.unshift(transaction);

  // Persist immediately
  saveToStorage();

  // Refresh all UI sections
  renderAll();

  // Reset form to a clean state
  form.reset();
  clearValidation();
  resetTypeToggle();

  // Return focus to the first field for fast consecutive entry
  itemNameInput.focus();
});

/* ============================================================
   10. DELETE TRANSACTION
   ============================================================ */

/**
 * Remove a transaction by its ID.
 * Immediately persists and re-renders the full UI.
 *
 * @param {string} id - Transaction ID to remove
 */
function deleteTransaction(id) {
  transactions = transactions.filter((t) => t.id !== id);
  saveToStorage();
  renderAll();
}

/* ============================================================
   11. CLEAR ALL TRANSACTIONS
   ============================================================ */

clearAllBtn.addEventListener('click', () => {
  // Confirm before wiping all data — this is a destructive action
  if (!window.confirm('Delete all transactions? This cannot be undone.')) return;

  transactions = [];
  saveToStorage();
  renderAll();
});

/* ============================================================
   12. BALANCE CALCULATION & RENDER
   ============================================================ */

/**
 * Sum income and expense totals from the transactions array.
 * @returns {{ income: number, expense: number, balance: number }}
 */
function calculateTotals() {
  return transactions.reduce(
    (acc, t) => {
      if (t.type === 'income') {
        acc.income += t.amount;
      } else {
        acc.expense += t.amount;
      }
      acc.balance = acc.income - acc.expense;
      return acc;
    },
    { income: 0, expense: 0, balance: 0 }
  );
}

/**
 * Update the balance card DOM elements with current totals.
 * Balance turns red when negative.
 */
function renderBalance() {
  const { income, expense, balance } = calculateTotals();

  // formatCurrency always returns a positive value; we prepend sign manually
  const balanceSign = balance < 0 ? '-' : '';
  totalBalanceEl.textContent = `${balanceSign}${formatCurrency(balance)}`;
  totalIncomeEl.textContent  = formatCurrency(income);
  totalExpenseEl.textContent = formatCurrency(expense);

  // Visual cue: red tint when in the red
  totalBalanceEl.style.color = balance < 0 ? '#fca5a5' : '#ffffff';
}

/* ============================================================
   13. TRANSACTION LIST RENDER
   ============================================================ */

/**
 * Rebuild the transaction list in the DOM.
 * Toggles between the empty-state message and the scrollable list.
 * Uses event delegation via a single listener on the parent <ul>
 * to avoid attaching N listeners for N delete buttons.
 */
function renderTransactionList() {
  const hasItems = transactions.length > 0;

  // Show/hide empty state and list
  emptyState.hidden      = hasItems;
  transactionList.hidden = !hasItems;
  clearAllBtn.disabled   = !hasItems;

  if (!hasItems) {
    transactionList.innerHTML = '';
    return;
  }

  // Build all list items as a single HTML string — one DOM write
  transactionList.innerHTML = transactions
    .map((t) => buildTransactionHTML(t))
    .join('');
}

/**
 * Generate the HTML markup for a single transaction list item.
 * All user-supplied strings are escaped to prevent XSS.
 *
 * @param {Object} t - Transaction object
 * @returns {string} HTML string for a <li> element
 */
function buildTransactionHTML(t) {
  const cfg      = getCategoryConfig(t.category);
  const sign     = t.type === 'income' ? '+' : '-';
  const amtClass = t.type === 'income' ? 'is-income' : 'is-expense';
  const dateStr  = formatDate(t.date);
  const safeName = escapeHTML(t.name);
  const safeCat  = escapeHTML(t.category);

  return `
    <li class="transaction-item" data-id="${t.id}">
      <div class="transaction-icon ${cfg.cssClass}" aria-hidden="true">
        ${cfg.emoji}
      </div>
      <div class="transaction-details">
        <p class="transaction-name" title="${safeName}">${safeName}</p>
        <div class="transaction-meta">
          <span class="category-badge ${cfg.cssClass}">${safeCat}</span>
          <span class="transaction-date">${dateStr}</span>
        </div>
      </div>
      <span class="transaction-amount ${amtClass}" aria-label="${t.type}: ${formatCurrency(t.amount)}">
        ${sign}${formatCurrency(t.amount)}
      </span>
      <button
        class="transaction-delete"
        data-id="${t.id}"
        aria-label="Delete ${safeName}"
        title="Delete"
      >✕</button>
    </li>
  `;
}

/**
 * Event delegation: one listener on the <ul> handles all delete clicks.
 * Much more efficient than attaching a listener per item.
 */
transactionList.addEventListener('click', (e) => {
  const deleteBtn = e.target.closest('.transaction-delete');
  if (!deleteBtn) return; // click was not on a delete button

  const id = deleteBtn.dataset.id;
  if (id) deleteTransaction(id);
});

/* ============================================================
   14. CHART RENDER (Chart.js doughnut)
   ============================================================ */

/**
 * Aggregate expense totals grouped by category.
 * Income transactions are excluded from the chart.
 *
 * @returns {{ labels: string[], data: number[], colors: string[] }}
 */
function getChartData() {
  const totals = {};

  transactions
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
 *  - If no expense data → destroy chart (if any) and show placeholder.
 *  - If chart already exists → update its data in-place (no flicker).
 *  - If chart doesn't exist yet → create a fresh instance.
 */
function renderChart() {
  const { labels, data, colors } = getChartData();
  const hasData = data.length > 0;

  // Toggle placeholder vs chart wrapper visibility
  chartPlaceholder.hidden = hasData;
  chartWrapper.hidden     = !hasData;

  if (!hasData) {
    // Safely destroy the chart instance so the canvas can be reused later
    if (expenseChart) {
      expenseChart.destroy();
      expenseChart = null;
    }
    chartLegend.innerHTML = '';
    return;
  }

  if (expenseChart) {
    // ── UPDATE existing chart (avoids destroy/recreate flicker) ──
    expenseChart.data.labels                      = labels;
    expenseChart.data.datasets[0].data            = data;
    expenseChart.data.datasets[0].backgroundColor = colors;
    expenseChart.update('active'); // 'active' mode animates the update
  } else {
    // ── CREATE new chart instance ──
    expenseChart = new Chart(chartCanvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderColor: '#ffffff',
          borderWidth: 3,
          hoverOffset: 10,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '62%',
        animation: {
          animateRotate: true,
          duration: 500,
        },
        plugins: {
          // Disable built-in legend — we render a custom one below the chart
          legend: { display: false },
          tooltip: {
            callbacks: {
              /**
               * Custom tooltip: show category, formatted amount, and percentage.
               * e.g. " Food: $45.00 (38%)"
               */
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

  // Always refresh the custom legend after data changes
  renderChartLegend(labels, colors, data);
}

/**
 * Render a custom legend below the doughnut chart.
 * Shows a colour dot, category name, and percentage share.
 *
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
          <span class="legend-dot" style="background: ${colors[i]};" aria-hidden="true"></span>
          <span>${escapeHTML(label)} <strong>${pct}%</strong></span>
        </div>
      `;
    })
    .join('');
}

/* ============================================================
   15. MASTER RENDER FUNCTION
   ============================================================ */

/**
 * Re-render every UI section from the current state.
 * This is the single entry point for all UI updates —
 * call it after any change to the `transactions` array.
 */
function renderAll() {
  renderBalance();
  renderTransactionList();
  renderChart();
}

/* ============================================================
   16. INITIALISATION
   ============================================================ */

/**
 * Bootstrap the app:
 *  1. Load any persisted transactions from localStorage
 *  2. Render the initial UI state
 */
function init() {
  loadFromStorage();
  renderAll();
}

init();
