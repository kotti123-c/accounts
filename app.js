// SSCB Accounting System - Firebase Version
// ==========================================

// Firebase configuration is loaded from firebase-config.js
// (loaded before this file in index.html).

// Initialize Firebase
console.log('[DEBUG] app.js started');
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
console.log('[DEBUG] firebase initialized:', firebase.apps.length > 0);
const db = firebase.firestore();
const auth = firebase.auth();
const analytics = firebase.analytics();

// Error Handler
window.onerror = function (msg, url, lineNo, columnNo, error) {
    console.error(error);
    if (typeof showToast === 'function') {
        showToast(error.message || msg, 'error');
    }
    return false;
};

// Surface unhandled promise rejections (e.g. failed Firestore writes)
window.addEventListener('unhandledrejection', function (event) {
    const reason = event.reason;
    const message = (reason && (reason.message || reason.code)) || 'Unknown error';
    console.error(reason);
    if (typeof showToast === 'function') {
        showToast('Error: ' + message, 'error');
    }
});

// ==========================================
// TOAST NOTIFICATIONS
// ==========================================

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = '✅';
    if (type === 'warning') icon = '⚠️';
    if (type === 'error') icon = '🗑️';

    toast.innerHTML = `<i>${icon}</i><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// ==========================================
// STATE MANAGEMENT
// ==========================================

let currentModule = 'home';
let currentMonth = new Date();
let analysisMonth = new Date();

// Cache
let salesCache = [];
let lorryCache = [];
let expensesCache = [];
let bricksCache = [];
let driversCache = [];
let lorryProductsCache = [];
let lorryDriversCache = [];
let lorryPlacesCache = [];
let categoriesCache = [];

// Dashboard 2 related caches
let expenses2Cache = [];
let categories2Cache = [];
let transportWagesCache = [];
let transportEmployeesCache = [];

// ==========================================
// UTILITY HELPERS
// ==========================================

function getDriverFactorMap() {
    const map = {};
    bricksCache.forEach(b => {
        map[b.name] = parseFloat(b.driver_factor) || 0;
    });
    return map;
}

function getNoSalaryDriversSet() {
    const set = new Set();
    driversCache.forEach(d => {
        if (d.no_salary) set.add(d.name);
    });
    return set;
}

function calculateDriverSalaryForSales(salesArr) {
    const factorMap = getDriverFactorMap();
    const noSalary = getNoSalaryDriversSet();
    return salesArr.reduce((sum, s) => {
        if (noSalary.has(s.driver)) return sum;
        const factor = factorMap[s.brick_type] || 0;
        if (!factor || factor <= 0) return sum;
        return sum + ((s.quantity || 0) / factor);
    }, 0);
}

// ==========================================
// LAST ACCOUNTS CHECKED (DASHBOARD 1)
// ==========================================

const LAST_CHECKED_DOC_ID = 'last_checked';
let __lastCheckedStoredValue = '';

async function loadLastChecked() {
    const display = document.getElementById('dash-last-checked-display');
    if (!display) return;
    try {
        const doc = await db.collection('settings').doc(LAST_CHECKED_DOC_ID).get();
        if (doc.exists && doc.data().date) {
            display.value = doc.data().date;
            __lastCheckedStoredValue = doc.data().date;
        } else {
            display.value = '';
            __lastCheckedStoredValue = '';
        }
    } catch (err) {
        console.error('loadLastChecked error', err);
        display.value = '';
        __lastCheckedStoredValue = '';
    }
}

// Reverts the input on cancel; saves on confirm.
window.onLastCheckedDateChange = function (inputEl) {
    if (!inputEl) return;
    const newValue = inputEl.value;
    if (newValue === __lastCheckedStoredValue) return;
    const revert = () => { inputEl.value = __lastCheckedStoredValue; };
    if (!confirm(`Set Last Accounts Checked to ${formatDate(newValue)}?`)) {
        revert();
        return;
    }
    saveLastChecked(newValue, inputEl, revert);
};

async function saveLastChecked(value, inputEl, revert) {
    try {
        await db.collection('settings').doc(LAST_CHECKED_DOC_ID).set({
            date: value,
            updated_at: firebase.firestore.FieldValue.serverTimestamp()
        });
        __lastCheckedStoredValue = value;
        if (inputEl) inputEl.value = value;
        showToast(`Last checked set to ${formatDate(value)}`, 'success');
    } catch (err) {
        console.error('saveLastChecked error', err);
        if (revert) revert();
        showToast('Failed to save: ' + (err.message || err), 'error');
    }
}

window.confirmFixLastChecked = function () {
    const inputEl = document.getElementById('dash-last-checked-display');
    if (!inputEl) return;
    if (!inputEl.value) {
        showToast('Pick a date first', 'warning');
        return;
    }
    onLastCheckedDateChange(inputEl);
};

window.resetLastChecked = async function () {
    if (!confirm('Clear the "Last Accounts Checked" date?')) return;
    try {
        await db.collection('settings').doc(LAST_CHECKED_DOC_ID).delete();
        const display = document.getElementById('dash-last-checked-display');
        if (display) display.value = '';
        __lastCheckedStoredValue = '';
        showToast('Last checked date cleared', 'warning');
    } catch (err) {
        console.error('resetLastChecked error', err);
        showToast('Failed to clear: ' + (err.message || err), 'error');
    }
};

// Current manage modal state
let manageType = '';

// Filter state is now handled by activeFilter object in the filter section

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    // Auth Listener
    auth.onAuthStateChanged((user) => {
        if (user) {
            showApp();
        } else {
            document.getElementById('auth-section').classList.remove('hidden');
            document.getElementById('app-container').classList.add('hidden');
        }
    });

    setupEventListeners();
    console.log('[DEBUG] DOM ready, listeners attached');
});

function setupEventListeners() {
    // Login form
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;

        try {
            await auth.signInWithEmailAndPassword(email, password);
            // onAuthStateChanged will handle the UI switch
        } catch (error) {
            const errorEl = document.getElementById('login-error');
            errorEl.textContent = error.message;
            errorEl.classList.remove('hidden');
        }
    });

    // Signup form
    document.getElementById('signup-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        const confirm = document.getElementById('signup-confirm').value;

        const errorEl = document.getElementById('signup-error');
        errorEl.classList.add('hidden');

        if (password !== confirm) {
            errorEl.textContent = 'Passwords do not match';
            errorEl.classList.remove('hidden');
            return;
        }

        try {
            await auth.createUserWithEmailAndPassword(email, password);
            // onAuthStateChanged will handle the UI switch
        } catch (error) {
            errorEl.textContent = error.message;
            errorEl.classList.remove('hidden');
        }
    });

    // Sales form
    document.getElementById('sales-form').addEventListener('submit', saveSalesEntry);
    document.getElementById('sales-quantity').addEventListener('input', calcSalesTotal);
    document.getElementById('sales-rate').addEventListener('input', calcSalesTotal);
    document.getElementById('sales-transport-rate').addEventListener('input', calcSalesTotal);

    // Stock adjustment form
    document.getElementById('stock-adjustment-form').addEventListener('submit', saveStockAdjustment);

    // Lorry form
    document.getElementById('lorry-form').addEventListener('submit', saveLorryEntry);
    document.getElementById('lorry-sold').addEventListener('input', calcLorryProfit);
    document.getElementById('lorry-weight').addEventListener('input', calcLorryBrought);
    document.getElementById('lorry-per-ton').addEventListener('input', calcLorryBrought);
    document.getElementById('lorry-brought').addEventListener('input', () => {
        document.getElementById('lorry-per-ton').value = '';
        calcLorryProfit();
    });

    // Expenses form
    document.getElementById('expenses-form').addEventListener('submit', saveExpensesEntry);

    // Production form
    document.getElementById('production-form').addEventListener('submit', saveProductionEntry);
}

async function showApp() {
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');

    await loadMasterData();
    initGlobalDateRange();
    loadLastChecked();
    switchModule('home');
}

async function logout() {
    await auth.signOut();
    location.reload();
}

window.showSignupView = function () {
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('signup-view').classList.remove('hidden');
    document.getElementById('login-error').classList.add('hidden');
};

window.showLoginView = function () {
    document.getElementById('signup-view').classList.add('hidden');
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('signup-error').classList.add('hidden');
};

// ==========================================
// MONTH NAVIGATION
// ==========================================

// ==========================================
// GLOBAL DATE RANGE
// ==========================================

function initGlobalDateRange() {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth(); // 0-11

    // Construct local YYYY-MM-DD
    const pad = (n) => n.toString().padStart(2, '0');

    // First day: YYYY-MM-01
    const start = `${year}-${pad(month + 1)}-01`;

    // Last day: 0th day of next month
    const lastDate = new Date(year, month + 1, 0);
    const end = `${year}-${pad(month + 1)}-${pad(lastDate.getDate())}`;

    document.getElementById('global-date-start').value = start;
    document.getElementById('global-date-end').value = end;
}

function getMonthRange() {
    // Return the selected range from header
    const start = document.getElementById('global-date-start').value;
    const end = document.getElementById('global-date-end').value;

    // If not ready yet (during init), return defaults
    if (!start || !end) {
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth();
        return {
            start: new Date(year, month, 1).toISOString().split('T')[0],
            end: new Date(year, month + 1, 0).toISOString().split('T')[0]
        };
    }

    return { start, end };
}

// Legacy/Compatibility placeholders if needed
window.prevMonth = function () { };
window.nextMonth = function () { };

// Month Navigation Functions
window.goToPrevMonth = function () {
    const startInput = document.getElementById('global-date-start');
    const endInput = document.getElementById('global-date-end');

    // Get current start date and go to previous month
    const currentDate = new Date(startInput.value);
    currentDate.setMonth(currentDate.getMonth() - 1);

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const pad = (n) => n.toString().padStart(2, '0');

    // First day of that month
    const newStart = `${year}-${pad(month + 1)}-01`;
    // Last day of that month
    const lastDate = new Date(year, month + 1, 0);
    const newEnd = `${year}-${pad(month + 1)}-${pad(lastDate.getDate())}`;

    startInput.value = newStart;
    endInput.value = newEnd;

    refreshCurrentModule();
};

window.goToNextMonth = function () {
    const startInput = document.getElementById('global-date-start');
    const endInput = document.getElementById('global-date-end');

    // Get current start date and go to next month
    const currentDate = new Date(startInput.value);
    currentDate.setMonth(currentDate.getMonth() + 1);

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const pad = (n) => n.toString().padStart(2, '0');

    // First day of that month
    const newStart = `${year}-${pad(month + 1)}-01`;
    // Last day of that month
    const lastDate = new Date(year, month + 1, 0);
    const newEnd = `${year}-${pad(month + 1)}-${pad(lastDate.getDate())}`;

    startInput.value = newStart;
    endInput.value = newEnd;

    refreshCurrentModule();
};

// ==========================================
// SIDEBAR & MODULE SWITCH
// ==========================================

window.toggleSidebar = function () {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('hidden');
};

window.switchModule = function (module) {
    currentModule = module;

    // Reset filter when switching modules
    if (typeof activeFilter !== 'undefined') {
        activeFilter.value = '';
        activeFilter.type = '';
    }

    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.module === module);
    });

    // Hide all modules
    document.querySelectorAll('[id^="module-"]').forEach(el => el.classList.add('hidden'));

    // Show selected
    document.getElementById(`module-${module}`).classList.remove('hidden');

    // Show/Hide global actions based on module
    const globalActions = document.getElementById('global-actions');
    if (module === 'home' || module === 'home2') {
        globalActions.classList.add('hidden');
    } else {
        globalActions.classList.remove('hidden');
    }

    // Show Last Accounts Checked control only on Dashboard 1
    const lastCheckedControl = document.getElementById('last-checked-control');
    if (lastCheckedControl) {
        if (module === 'home') {
            lastCheckedControl.classList.remove('hidden');
            lastCheckedControl.classList.add('flex');
        } else {
            lastCheckedControl.classList.add('hidden');
            lastCheckedControl.classList.remove('flex');
        }
    }

    // Update header
    const titles = { home: 'Dashboard', sales: 'Sales', lorry: 'Lorry Transports', expenses: 'Expenses', production: 'Production Wages', home2: 'Dashboard 2', expenses2: 'Expenses 2', transportwages: 'Transport Wages' };
    document.getElementById('header-title').textContent = titles[module] || 'Dashboard';

    // Close sidebar
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.add('hidden');

    // Refresh data
    refreshCurrentModule();
};

function refreshCurrentModule() {
    switch (currentModule) {
        case 'home': loadDashboard(); break;
        case 'sales': loadSales(); break;
        case 'lorry': loadLorry(); break;
        case 'expenses': loadExpenses(); break;
        case 'production': loadProductionWages(); break;
        case 'home2': loadDashboard2(); break;
        case 'expenses2': loadExpenses2(); break;
        case 'transportwages': loadTransportWages(); break;
    }
}

// ==========================================
// MASTER DATA LOADING
// ==========================================

async function loadMasterData() {
    await Promise.all([
        loadBricks(),
        loadDrivers(),
        loadLorryProducts(),
        loadLorryDrivers(),
        loadLorryPlaces(),
        loadCategories(),
        loadProductionEmployees(),
        loadProductionBricks(),
        loadCategories2(),
        loadTransportEmployees()
    ]);
}

async function fetchCollection(name) {
    const snapshot = await db.collection(name).orderBy('name').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function loadBricks() {
    bricksCache = await fetchCollection('brick_types');
    populateSelect('sales-brick-type', bricksCache);
}

async function loadDrivers() {
    driversCache = await fetchCollection('drivers');
    populateSelect('sales-driver', driversCache);
}

async function loadLorryProducts() {
    lorryProductsCache = await fetchCollection('lorry_products');
    populateSelect('lorry-product', lorryProductsCache);
}

async function loadLorryDrivers() {
    lorryDriversCache = await fetchCollection('lorry_drivers');
    populateSelect('lorry-driver', lorryDriversCache);
}

async function loadLorryPlaces() {
    lorryPlacesCache = await fetchCollection('lorry_places');
    populateSelect('lorry-place', lorryPlacesCache);
}

async function loadCategories() {
    categoriesCache = await fetchCollection('expense_categories');
    populateSelect('expenses-category', categoriesCache);
}

async function loadProductionEmployees() {
    productionEmployeesCache = await fetchCollection('production_employees');
}

async function loadProductionBricks() {
    productionBricksCache = await fetchCollection('production_bricks');
}

function populateSelect(selectId, items) {
    const select = document.getElementById(selectId);
    if (!select) return;
    // Clear existing options
    select.innerHTML = '';
    // Add default option
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = '- Select -';
    select.appendChild(defaultOpt);
    // Add items using DOM API to properly handle special characters like "
    items.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.name;
        opt.textContent = item.name;
        select.appendChild(opt);
    });
}

// ==========================================
// DASHBOARD
// ==========================================

async function loadDashboard() {
    const { start, end } = getMonthRange(currentMonth);

    // Helper to fetch by date range
    const fetchByDate = async (collection) => {
        const snapshot = await db.collection(collection)
            .where('date', '>=', start)
            .where('date', '<=', end)
            .get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    };

    // Load all data for month
    const [sales, lorry, expenses, production] = await Promise.all([
        fetchByDate('sales'),
        fetchByDate('lorry_transports'),
        fetchByDate('expenses'),
        fetchByDate('production_wages')
    ]);

    // --- SALES CALCULATIONS ---
    // Total sales = sum of (qty × rate) only - this is the "normal" sales amount
    const totalSales = sales.reduce((sum, s) => sum + ((s.quantity || 0) * (s.rate || 0)), 0);
    const paidSales = sales.filter(s => s.payment_status === 'Paid').reduce((sum, s) => sum + ((s.quantity || 0) * (s.rate || 0)), 0);
    const unpaidSales = totalSales - paidSales;

    // --- EXPENSES & PRODUCTION ---
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const totalProduction = production.reduce((sum, p) => sum + (p.total || 0), 0);

    // --- LORRY CALCULATIONS ---
    const selfTrips = lorry.filter(l => l.transport_type === 'self');
    const othersTrips = lorry.filter(l => l.transport_type === 'others');

    const lorrySelfValue = selfTrips.reduce((sum, l) => sum + (l.brought || 0), 0);
    const lorryBuy = othersTrips.reduce((sum, l) => sum + (l.brought || 0), 0);
    const lorrySold = othersTrips.reduce((sum, l) => sum + (l.sold || 0), 0);
    const lorryProfit = othersTrips.reduce((sum, l) => sum + (l.profit || 0), 0);

    // --- PROFIT SUMMARY ---
    // Current Profit (Cash in Hand) = Paid Sales + Lorry Profit - Self Use - Expenses - Production
    const realizedProfit = paidSales + lorryProfit - lorrySelfValue - totalExpenses - totalProduction;

    // Total Projected Profit = Total Sales + Lorry Profit - Self Use - Expenses - Production
    const totalProfit = totalSales + lorryProfit - lorrySelfValue - totalExpenses - totalProduction;

    // --- UI UPDATES ---

    // Top Row
    document.getElementById('dash-realized-profit').textContent = `₹${realizedProfit.toLocaleString()}`;
    document.getElementById('dash-unpaid-amount').textContent = `₹${unpaidSales.toLocaleString()}`;
    document.getElementById('dash-total-profit').textContent = `₹${totalProfit.toLocaleString()}`;

    // Main Numbers Grid
    document.getElementById('dash-total-sales').textContent = `₹${totalSales.toLocaleString()}`;
    document.getElementById('dash-paid-sales').textContent = `₹${paidSales.toLocaleString()}`;
    document.getElementById('dash-unpaid-sales').textContent = `₹${unpaidSales.toLocaleString()}`;

    document.getElementById('dash-lorry-self').textContent = `₹${lorrySelfValue.toLocaleString()}`;
    document.getElementById('dash-lorry-buy').textContent = `₹${lorryBuy.toLocaleString()}`;
    document.getElementById('dash-lorry-sold').textContent = `₹${lorrySold.toLocaleString()}`;
    document.getElementById('dash-lorry-profit').textContent = `₹${lorryProfit.toLocaleString()}`;

    document.getElementById('dash-production-wages').textContent = `₹${totalProduction.toLocaleString()}`;
    document.getElementById('dash-total-expenses').textContent = `₹${totalExpenses.toLocaleString()}`;

    // Expenses Breakdown Table
    const expensesByCategory = {};
    expenses.forEach(e => {
        const cat = e.category || 'Uncategorized';
        if (!expensesByCategory[cat]) expensesByCategory[cat] = 0;
        expensesByCategory[cat] += e.amount || 0;
    });    const expensesTable = document.getElementById('dash-expenses-breakdown');
    if (Object.keys(expensesByCategory).length) {
        expensesTable.innerHTML = `
            <table class="w-full text-sm">
                <thead class="text-xs text-slate-500 uppercase bg-gray-50 border-b">
                    <tr><th class="py-2 px-4 text-left">Category</th><th class="py-2 px-4 text-right">Amount</th></tr>
                </thead>
                <tbody class="divide-y">
                    ${Object.entries(expensesByCategory).map(([cat, amt]) => `
                        <tr><td class="py-2 px-4 font-medium text-slate-700">${cat}</td><td class="py-2 px-4 text-right font-mono text-red-600 font-bold">₹${amt.toLocaleString()}</td></tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } else {
        expensesTable.innerHTML = '<div class="text-center text-gray-400 py-4 text-xs">No expenses</div>';
    }

    // Refresh last-checked indicator alongside dashboard numbers
    loadLastChecked();
}

// ==========================================
// SALES MODULE
// ==========================================

async function loadSales() {
    const { start, end } = getMonthRange(currentMonth);
    const snapshot = await db.collection('sales')
        .where('date', '>=', start)
        .where('date', '<=', end)
        .orderBy('date', 'desc')
        .get();

    salesCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Sort by date DESC, then by created_at DESC (latest added first for same date)
    salesCache.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        const aTime = a.created_at?.toMillis?.() || 0;
        const bTime = b.created_at?.toMillis?.() || 0;
        return bTime - aTime;
    });

    renderSalesTable();

    // Also reload stocks dashboard if that view is active
    if (salesSubView === 'stocks') {
        loadStocksDashboard();
    }
}

// ==========================================
// SALES SEARCH
// ==========================================

// Levenshtein distance for fuzzy matching
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}

// Get all searchable text fields for a sale entry
function salesSearchFields(s) {
    return [s.customer, s.place, s.driver, s.brick_type, s.vehicle, s.payment_status]
        .filter(Boolean).map(f => f.toLowerCase());
}

// Classify entries against a query
function classifySalesResults(query) {
    const q = query.trim().toLowerCase();
    if (!q) return { exact: salesCache, fuzzy: [] };

    const exact = [];
    const fuzzy = [];
    const words = q.split(/\s+/);

    salesCache.forEach(s => {
        const fields = salesSearchFields(s);
        const combined = fields.join(' ');

        // Exact: every word in the query appears somewhere in the combined text
        const isExact = words.every(w => combined.includes(w));
        if (isExact) {
            exact.push(s);
            return;
        }

        // Fuzzy: check if any field has a word within edit-distance threshold
        const isFuzzy = words.some(word => {
            return fields.some(field => {
                // Split field into tokens and check each
                const tokens = field.split(/\s+/);
                return tokens.some(token => {
                    const maxLen = Math.max(word.length, token.length);
                    if (maxLen === 0) return false;
                    const dist = levenshtein(word, token);
                    // Allow 1 error per 4 chars, minimum threshold 1
                    const threshold = Math.max(1, Math.floor(maxLen / 4));
                    return dist <= threshold && dist > 0;
                });
            });
        });

        if (isFuzzy) fuzzy.push(s);
    });

    return { exact, fuzzy };
}

// Build a single <tr> HTML for a sale entry
function buildSalesRow(s, index, highlight = false) {
    const qty = s.quantity || 0;
    const rate = s.rate || 0;
    const tRate = s.transport_rate || 0;
    const normalAmt = qty * rate;
    const transAmt = qty * tRate;
    const total = normalAmt + transAmt;
    const rowClass = highlight ? 'bg-amber-50' : '';

    return `
    <tr class="${rowClass}">
        <td class="py-2 px-3 text-center text-xs text-slate-400">${index + 1}</td>
        <td class="py-2 px-3 text-xs">${formatDate(s.date)}</td>
        <td class="py-2 px-3 text-xs">${s.place || '-'}</td>
        <td class="py-2 px-3 text-xs font-medium">${s.customer || '-'}</td>
        <td class="py-2 px-3 text-xs">${s.driver || '-'}</td>
        <td class="py-2 px-3 text-xs">${s.brick_type ? escapeHtml(s.brick_type) : '-'}</td>
        <td class="py-2 px-3 text-right font-mono text-xs">${qty.toLocaleString()}</td>
        <td class="py-2 px-3 text-right font-mono text-xs">₹${rate.toLocaleString()}</td>
        <td class="py-2 px-3 text-right font-mono text-xs font-bold text-rose-600">₹${normalAmt.toLocaleString()}</td>
        <td class="py-2 px-3 text-right font-mono text-xs">₹${tRate.toLocaleString()}</td>
        <td class="py-2 px-3 text-right font-mono text-xs font-bold text-sky-600">₹${transAmt.toLocaleString()}</td>
        <td class="py-2 px-3 text-right font-mono text-xs font-bold text-indigo-600">₹${total.toLocaleString()}</td>
        <td class="py-2 px-3 text-center"><span class="badge-${s.payment_status === 'Paid' ? 'paid' : 'pending'}">${s.payment_status || 'Pending'}</span></td>
        <td class="py-2 px-3 text-center w-[100px]">
            <div class="actions-cell">
                <button onclick="editSales('${s.id}')" class="action-btn" title="Edit"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                <button onclick="copySales('${s.id}')" class="action-btn" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button>
                <button onclick="deleteSales('${s.id}')" class="action-btn delete" title="Delete"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
            </div>
        </td>
    </tr>`;
}

// Separator row for fuzzy section
function buildSalesSeparatorRow(label, color = 'amber') {
    return `<tr class="bg-${color}-50 border-t-2 border-${color}-200">
        <td colspan="14" class="py-1.5 px-3 text-[10px] font-bold uppercase tracking-widest text-${color}-600">${label}</td>
    </tr>`;
}

function renderSalesTable() {
    const tbody = document.getElementById('sales-table-body');
    const empty = document.getElementById('sales-empty');

    const query = (document.getElementById('sales-search-input')?.value || '').trim();

    if (!salesCache.length) {
        tbody.innerHTML = '';
        empty.classList.remove('hidden');
        updateSalesSearchInfo(0, 0, query);
        return;
    }

    empty.classList.add('hidden');

    if (!query) {
        // No search — show all rows normally
        tbody.innerHTML = salesCache.map((s, i) => buildSalesRow(s, i, false)).join('');
        updateSalesSearchInfo(salesCache.length, 0, '');
        return;
    }

    const { exact, fuzzy } = classifySalesResults(query);
    const totalFound = exact.length + fuzzy.length;

    if (totalFound === 0) {
        tbody.innerHTML = `<tr><td colspan="14" class="py-10 text-center text-xs text-slate-400 uppercase tracking-wide">No results found for "<strong>${escapeHtml(query)}</strong>"</td></tr>`;
        updateSalesSearchInfo(0, 0, query);
        return;
    }

    let html = '';

    if (exact.length) {
        html += buildSalesSeparatorRow(`✓ Exact matches — ${exact.length}`, 'emerald');
        html += exact.map((s, i) => buildSalesRow(s, i, true)).join('');
    }

    if (fuzzy.length) {
        html += buildSalesSeparatorRow(`~ Close matches — ${fuzzy.length} (possible spelling mistakes)`, 'amber');
        html += fuzzy.map((s, i) => buildSalesRow(s, i, false)).join('');
    }

    tbody.innerHTML = html;
    updateSalesSearchInfo(exact.length, fuzzy.length, query);
}

function updateSalesSearchInfo(exactCount, fuzzyCount, query) {
    const info = document.getElementById('sales-search-info');
    if (!info) return;
    if (!query) {
        info.textContent = '';
        return;
    }
    const parts = [];
    if (exactCount) parts.push(`${exactCount} exact`);
    if (fuzzyCount) parts.push(`${fuzzyCount} close`);
    info.textContent = parts.length ? `${parts.join(', ')} result${(exactCount + fuzzyCount) !== 1 ? 's' : ''}` : 'No results';
}

window.onSalesSearch = function () {
    const input = document.getElementById('sales-search-input');
    const clearBtn = document.getElementById('sales-search-clear');
    if (clearBtn) clearBtn.classList.toggle('hidden', !input.value);
    renderSalesTable();
};

window.clearSalesSearch = function () {
    const input = document.getElementById('sales-search-input');
    if (input) input.value = '';
    const clearBtn = document.getElementById('sales-search-clear');
    if (clearBtn) clearBtn.classList.add('hidden');
    renderSalesTable();
};

window.showSalesModal = function (entry = null) {
    document.getElementById('sales-modal-title').textContent = entry ? 'Edit Sales Entry' : 'Add Sales Entry';
    document.getElementById('sales-edit-id').value = entry?.id || '';
    document.getElementById('sales-date').value = entry?.date || new Date().toISOString().split('T')[0];
    document.getElementById('sales-place').value = entry?.place || '';
    document.getElementById('sales-customer').value = entry?.customer || '';
    document.getElementById('sales-driver').value = entry?.driver || '';
    document.getElementById('sales-vehicle').value = entry?.vehicle || '';
    document.getElementById('sales-brick-type').value = entry?.brick_type || '';
    document.getElementById('sales-quantity').value = entry?.quantity || '';
    document.getElementById('sales-rate').value = entry?.rate || '';
    document.getElementById('sales-transport-rate').value = entry?.transport_rate || '';

    // Calculate and display Normal Amt, Trans Amt, and Total
    calcSalesTotal();

    const paymentRadios = document.querySelectorAll('input[name="sales-payment"]');
    paymentRadios.forEach(r => r.checked = r.value === (entry?.payment_status || 'Paid'));

    document.getElementById('sales-modal').classList.remove('hidden');
};

window.closeSalesModal = function () {
    document.getElementById('sales-modal').classList.add('hidden');
    document.getElementById('sales-form').reset();
};

function calcSalesTotal() {
    const qty = parseFloat(document.getElementById('sales-quantity').value) || 0;
    const rate = parseFloat(document.getElementById('sales-rate').value) || 0;
    const tRate = parseFloat(document.getElementById('sales-transport-rate').value) || 0;

    const normalAmt = qty * rate;
    const transAmt = qty * tRate;
    const total = normalAmt + transAmt;

    document.getElementById('sales-normal-amt').value = normalAmt;
    document.getElementById('sales-trans-amt').value = transAmt;
    document.getElementById('sales-total').value = total;
}

async function saveSalesEntry(e) {
    console.log('[DEBUG] saveSalesEntry called');
    e.preventDefault();

    const id = document.getElementById('sales-edit-id').value;
    const entry = {
        date: document.getElementById('sales-date').value,
        place: document.getElementById('sales-place').value,
        customer: document.getElementById('sales-customer').value,
        driver: document.getElementById('sales-driver').value,
        vehicle: document.getElementById('sales-vehicle').value.toUpperCase(),
        brick_type: document.getElementById('sales-brick-type').value,
        quantity: parseInt(document.getElementById('sales-quantity').value) || 0,
        rate: parseFloat(document.getElementById('sales-rate').value) || 0,
        transport_rate: parseFloat(document.getElementById('sales-transport-rate').value) || 0,
        total: parseFloat(document.getElementById('sales-total').value) || 0,
        payment_status: document.querySelector('input[name="sales-payment"]:checked').value
    };

    if (id) {
        // Don't update created_at on edit to preserve sorting order
        await db.collection('sales').doc(id).update(entry);
    } else {
        entry.created_at = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('sales').add(entry);
    }

    showToast('Entry saved successfully', id ? 'warning' : 'success');
    closeSalesModal();
    loadSales();
}

// Temporary debug wrapper to surface any save error
window.__debugSaveSales = async function (e) {
    try {
        await saveSalesEntry(e);
    } catch (err) {
        console.error('[DEBUG] saveSalesEntry failed:', err);
        showToast('Save failed: ' + (err.message || err.code || err), 'error');
    }
};

window.editSales = function (id) {
    const entry = salesCache.find(s => s.id === id);
    if (entry) showSalesModal(entry);
};

window.copySales = function (id) {
    const entry = salesCache.find(s => s.id === id);
    if (entry) {
        const copy = { ...entry, id: null, date: new Date().toISOString().split('T')[0] };
        showSalesModal(copy);
    }
};

window.deleteSales = async function (id) {
    if (!confirm('Are you sure you want to delete this sales entry? This cannot be undone.')) return;
    await db.collection('sales').doc(id).delete();
    showToast('Entry deleted', 'error');
    loadSales();
};

window.exportSales = function () {
    if (!salesCache.length) return alert('No data to export');
    const ws = XLSX.utils.json_to_sheet(salesCache.map(s => ({
        Date: s.date, Place: s.place, Customer: s.customer, Driver: s.driver,
        Vehicle: s.vehicle, 'Brick Type': s.brick_type, Quantity: s.quantity,
        Rate: s.rate, Total: s.total, Status: s.payment_status
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sales');
    XLSX.writeFile(wb, `Sales_${currentMonth.toISOString().slice(0, 7)}.xlsx`);
};

// ==========================================
// STOCKS DASHBOARD MODULE
// ==========================================

let salesSubView = 'entries'; // 'entries' or 'stocks'
let stockAdjustmentsCache = [];

window.switchSalesView = function (view) {
    salesSubView = view;

    // Update toggle buttons
    const entriesBtn = document.getElementById('sales-view-entries');
    const stocksBtn = document.getElementById('sales-view-stocks');

    if (view === 'entries') {
        entriesBtn.className = 'px-4 py-1.5 text-xs font-bold rounded-md transition-all bg-rose-500 text-white shadow-sm';
        stocksBtn.className = 'px-4 py-1.5 text-xs font-bold rounded-md transition-all text-slate-600 hover:text-slate-800';
        document.getElementById('sales-entries-view').classList.remove('hidden');
        document.getElementById('sales-stocks-view').classList.add('hidden');
        document.getElementById('sales-entries-actions').classList.remove('hidden');
        document.getElementById('sales-stocks-actions').classList.add('hidden');
        document.getElementById('sales-search-bar').classList.remove('hidden');
    } else {
        entriesBtn.className = 'px-4 py-1.5 text-xs font-bold rounded-md transition-all text-slate-600 hover:text-slate-800';
        stocksBtn.className = 'px-4 py-1.5 text-xs font-bold rounded-md transition-all bg-emerald-500 text-white shadow-sm';
        document.getElementById('sales-entries-view').classList.add('hidden');
        document.getElementById('sales-stocks-view').classList.remove('hidden');
        document.getElementById('sales-entries-actions').classList.add('hidden');
        document.getElementById('sales-stocks-actions').classList.remove('hidden');
        // Hide search bar and clear it when switching to stocks
        document.getElementById('sales-search-bar').classList.add('hidden');
        const input = document.getElementById('sales-search-input');
        if (input) input.value = '';
        const clearBtn = document.getElementById('sales-search-clear');
        if (clearBtn) clearBtn.classList.add('hidden');
        const info = document.getElementById('sales-search-info');
        if (info) info.textContent = '';
        loadStocksDashboard();
    }
};

async function loadStocksDashboard() {
    const { start, end } = getMonthRange(currentMonth);

    // Fetch all data needed
    const [productionSnap, salesSnap, adjustmentsSnap] = await Promise.all([
        db.collection('production_wages')
            .where('date', '>=', start)
            .where('date', '<=', end)
            .get(),
        db.collection('sales')
            .where('date', '>=', start)
            .where('date', '<=', end)
            .get(),
        db.collection('stock_adjustments')
            .where('date', '>=', start)
            .where('date', '<=', end)
            .orderBy('date', 'desc')
            .get()
    ]);

    const productionData = productionSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const salesData = salesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    stockAdjustmentsCache = adjustmentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Build bricks_per_punch map from bricksCache
    const bricksPerPunchMap = {};
    bricksCache.forEach(b => {
        bricksPerPunchMap[b.name] = b.bricks_per_punch || 1;
    });

    // Calculate Production IN by brick type
    // Match production_bricks names to brick_types names
    const productionBricksMap = {};
    productionBricksCache.forEach(pb => {
        productionBricksMap[pb.name] = bricksPerPunchMap[pb.name] || 1;
    });

    const productionByType = {};
    productionData.forEach(p => {
        const production = p.production || {};
        Object.entries(production).forEach(([brickName, punches]) => {
            const bricksPerPunch = productionBricksMap[brickName] || bricksPerPunchMap[brickName] || 1;
            const bricks = punches * bricksPerPunch;
            productionByType[brickName] = (productionByType[brickName] || 0) + bricks;
        });
    });

    // Calculate Sales OUT by brick type
    const salesByType = {};
    salesData.forEach(s => {
        const brickType = s.brick_type || 'Unknown';
        salesByType[brickType] = (salesByType[brickType] || 0) + (s.quantity || 0);
    });

    // Calculate Manual Adjustments by brick type
    const manualInByType = {};
    const manualOutByType = {};
    stockAdjustmentsCache.forEach(adj => {
        const brickType = adj.brick_type || 'Unknown';
        if (adj.type === 'IN') {
            manualInByType[brickType] = (manualInByType[brickType] || 0) + (adj.quantity || 0);
        } else {
            manualOutByType[brickType] = (manualOutByType[brickType] || 0) + (adj.quantity || 0);
        }
    });

    // Collect all brick types
    const allBrickTypes = new Set([
        ...Object.keys(productionByType),
        ...Object.keys(salesByType),
        ...Object.keys(manualInByType),
        ...Object.keys(manualOutByType)
    ]);

    // Calculate totals
    let totalProductionIn = 0;
    let totalSalesOut = 0;
    let totalManualIn = 0;
    let totalManualOut = 0;

    const stockData = [];
    allBrickTypes.forEach(brickType => {
        const prodIn = productionByType[brickType] || 0;
        const salesOut = salesByType[brickType] || 0;
        const manualIn = manualInByType[brickType] || 0;
        const manualOut = manualOutByType[brickType] || 0;
        const balance = (prodIn + manualIn) - (salesOut + manualOut);

        totalProductionIn += prodIn;
        totalSalesOut += salesOut;
        totalManualIn += manualIn;
        totalManualOut += manualOut;

        stockData.push({ brickType, prodIn, salesOut, manualIn, manualOut, balance });
    });

    const totalBalance = (totalProductionIn + totalManualIn) - (totalSalesOut + totalManualOut);
    const manualAdjust = totalManualIn - totalManualOut;

    // Render stock table
    const stocksBody = document.getElementById('stocks-table-body');
    const stocksEmpty = document.getElementById('stocks-empty');

    if (!stockData.length) {
        stocksBody.innerHTML = '';
        stocksEmpty.classList.remove('hidden');
    } else {
        stocksEmpty.classList.add('hidden');
        stocksBody.innerHTML = stockData.map(row => `
            <tr>
                <td class="py-2.5 px-4 font-medium text-slate-700">${escapeHtml(row.brickType)}</td>
                <td class="py-2.5 px-4 text-right font-mono text-teal-600">${row.prodIn.toLocaleString()}</td>
                <td class="py-2.5 px-4 text-right font-mono text-rose-600">${row.salesOut.toLocaleString()}</td>
                <td class="py-2.5 px-4 text-right font-mono text-green-600">+${row.manualIn.toLocaleString()}</td>
                <td class="py-2.5 px-4 text-right font-mono text-orange-600">-${row.manualOut.toLocaleString()}</td>
                <td class="py-2.5 px-4 text-right font-mono font-bold ${row.balance >= 0 ? 'text-indigo-600' : 'text-red-600'}">${row.balance.toLocaleString()}</td>
            </tr>
        `).join('');
    }

    // Render adjustments table
    renderStockAdjustmentsTable();
}

function renderStockAdjustmentsTable() {
    const tbody = document.getElementById('stocks-adjustments-body');
    const empty = document.getElementById('stocks-adjustments-empty');

    if (!stockAdjustmentsCache.length) {
        tbody.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    tbody.innerHTML = stockAdjustmentsCache.map(adj => `
        <tr>
            <td class="py-2 px-4 text-xs">${formatDate(adj.date)}</td>
            <td class="py-2 px-4 text-xs font-medium">${escapeHtml(adj.brick_type)}</td>
            <td class="py-2 px-4 text-center">
                <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${adj.type === 'IN' ? 'bg-teal-100 text-teal-700' : 'bg-rose-100 text-rose-700'}">
                    ${adj.type}
                </span>
            </td>
            <td class="py-2 px-4 text-right font-mono text-xs">${(adj.quantity || 0).toLocaleString()}</td>
            <td class="py-2 px-4 text-xs text-slate-500">${adj.note || (adj.is_opening ? '📋 Opening Balance' : '-')}</td>
            <td class="py-2 px-4 text-center">
                <button onclick="deleteStockAdjustment('${adj.id}')" class="action-btn delete" title="Delete">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </td>
        </tr>
    `).join('');
}

// Stock Adjustment Modal
window.showStockAdjustmentModal = function () {
    document.getElementById('stock-adjustment-modal-title').textContent = 'Add Stock Adjustment';
    document.getElementById('stock-adjustment-edit-id').value = '';
    document.getElementById('stock-adjustment-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('stock-adjustment-quantity').value = '';
    document.getElementById('stock-adjustment-note').value = '';
    document.querySelector('input[name="stock-adjustment-type"][value="IN"]').checked = true;

    // Populate brick types from bricksCache
    populateSelect('stock-adjustment-brick-type', bricksCache);

    document.getElementById('stock-adjustment-modal').classList.remove('hidden');
};

window.closeStockAdjustmentModal = function () {
    document.getElementById('stock-adjustment-modal').classList.add('hidden');
};

async function saveStockAdjustment(e) {
    e.preventDefault();

    const brickType = document.getElementById('stock-adjustment-brick-type').value;
    if (!brickType) {
        showToast('Please select a brick type', 'error');
        return;
    }

    const quantity = parseInt(document.getElementById('stock-adjustment-quantity').value) || 0;
    if (quantity <= 0) {
        showToast('Please enter a valid quantity', 'error');
        return;
    }

    const entry = {
        date: document.getElementById('stock-adjustment-date').value,
        brick_type: brickType,
        type: document.querySelector('input[name="stock-adjustment-type"]:checked').value,
        quantity: quantity,
        note: document.getElementById('stock-adjustment-note').value,
        created_at: firebase.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('stock_adjustments').add(entry);
    showToast('Stock adjustment saved', 'success');
    closeStockAdjustmentModal();
    loadStocksDashboard();
}

window.deleteStockAdjustment = async function (id) {
    if (!confirm('Are you sure you want to delete this stock adjustment? This cannot be undone.')) return;
    await db.collection('stock_adjustments').doc(id).delete();
    showToast('Adjustment deleted', 'error');
    loadStocksDashboard();
};

// Close Month Feature
window.closeStocksMonth = async function () {
    const { start, end } = getMonthRange();

    // Calculate next month's first day from the actual selected month (start date)
    const selectedDate = new Date(start + 'T00:00:00');
    const nextMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1);
    const year = nextMonth.getFullYear();
    const month = String(nextMonth.getMonth() + 1).padStart(2, '0');
    const nextMonthFirstDay = `${year}-${month}-01`;

    // First, delete any existing opening entries for next month (from previous close)
    const existingOpeningSnap = await db.collection('stock_adjustments')
        .where('date', '==', nextMonthFirstDay)
        .where('is_opening', '==', true)
        .get();

    const deletePromises = existingOpeningSnap.docs.map(doc => doc.ref.delete());
    if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
    }

    // Fetch all data for current month
    const [productionSnap, salesSnap, adjustmentsSnap] = await Promise.all([
        db.collection('production_wages')
            .where('date', '>=', start)
            .where('date', '<=', end)
            .get(),
        db.collection('sales')
            .where('date', '>=', start)
            .where('date', '<=', end)
            .get(),
        db.collection('stock_adjustments')
            .where('date', '>=', start)
            .where('date', '<=', end)
            .get()
    ]);

    const productionData = productionSnap.docs.map(doc => doc.data());
    const salesData = salesSnap.docs.map(doc => doc.data());
    const adjustmentsData = adjustmentsSnap.docs.map(doc => doc.data());

    // Build bricks_per_punch map
    const bricksPerPunchMap = {};
    bricksCache.forEach(b => {
        bricksPerPunchMap[b.name] = b.bricks_per_punch || 1;
    });

    const productionBricksMap = {};
    productionBricksCache.forEach(pb => {
        productionBricksMap[pb.name] = bricksPerPunchMap[pb.name] || 1;
    });

    // Calculate balances by brick type
    const balanceByType = {};

    // Add production
    productionData.forEach(p => {
        const production = p.production || {};
        Object.entries(production).forEach(([brickName, punches]) => {
            const bricksPerPunch = productionBricksMap[brickName] || bricksPerPunchMap[brickName] || 1;
            const bricks = punches * bricksPerPunch;
            balanceByType[brickName] = (balanceByType[brickName] || 0) + bricks;
        });
    });

    // Subtract sales
    salesData.forEach(s => {
        const brickType = s.brick_type || 'Unknown';
        balanceByType[brickType] = (balanceByType[brickType] || 0) - (s.quantity || 0);
    });

    // Add/subtract adjustments
    adjustmentsData.forEach(adj => {
        const brickType = adj.brick_type || 'Unknown';
        if (adj.type === 'IN') {
            balanceByType[brickType] = (balanceByType[brickType] || 0) + (adj.quantity || 0);
        } else {
            balanceByType[brickType] = (balanceByType[brickType] || 0) - (adj.quantity || 0);
        }
    });

    // Create opening entries for next month
    const batch = db.batch();
    let entriesCreated = 0;

    Object.entries(balanceByType).forEach(([brickType, balance]) => {
        // Create entry even for zero or negative balances
        if (balance !== 0) {
            const docRef = db.collection('stock_adjustments').doc();
            batch.set(docRef, {
                date: nextMonthFirstDay,
                brick_type: brickType,
                type: balance >= 0 ? 'IN' : 'OUT',
                quantity: Math.abs(balance),
                note: `Carry forward from ${start.slice(0, 7)}`,
                is_opening: true,
                created_at: firebase.firestore.FieldValue.serverTimestamp()
            });
            entriesCreated++;
        }
    });

    if (entriesCreated > 0) {
        await batch.commit();
        showToast(`Month closed! ${entriesCreated} opening entries created for next month.`, 'success');
    } else {
        showToast('No stock to carry forward.', 'warning');
    }

    loadStocksDashboard();
};

// ==========================================
// LORRY MODULE
// ==========================================

async function loadLorry() {
    const { start, end } = getMonthRange(currentMonth);
    const snapshot = await db.collection('lorry_transports')
        .where('date', '>=', start)
        .where('date', '<=', end)
        .orderBy('date', 'desc')
        .get();

    lorryCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Sort by date DESC, then by created_at DESC (latest added first for same date)
    lorryCache.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        const aTime = a.created_at?.toMillis?.() || 0;
        const bTime = b.created_at?.toMillis?.() || 0;
        return bTime - aTime;
    });

    renderLorryTable();
}

function renderLorryTable() {
    const tbody = document.getElementById('lorry-table-body');
    const empty = document.getElementById('lorry-empty');

    if (!lorryCache.length) {
        tbody.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    tbody.innerHTML = lorryCache.map((l, i) => {
        const isSelf = l.transport_type === 'self';
        return `
            <tr>
                <td class="py-2 px-3 text-center text-xs text-slate-400">${i + 1}</td>
                <td class="py-2 px-3 text-xs">${formatDate(l.date)}</td>
                <td class="py-2 px-3 text-xs font-medium">${l.product || '-'}</td>
                <td class="py-2 px-3 text-xs">${l.place || '-'}</td>
                <td class="py-2 px-3"><span class="badge-${isSelf ? 'self' : 'others'}">${isSelf ? 'Self' : 'Others'}</span></td>
                <td class="py-2 px-3 text-xs">${l.driver || '-'}</td>
                <td class="py-2 px-3 text-xs">${isSelf ? '-' : (l.to_whom || '-')}</td>
                <td class="py-2 px-3 text-right font-mono text-xs">${l.weight || '-'}</td>
                <td class="py-2 px-3 text-right font-mono text-xs">₹${(l.brought || 0).toLocaleString()}</td>
                <td class="py-2 px-3 text-right font-mono text-xs">${isSelf ? '-' : '₹' + (l.sold || 0).toLocaleString()}</td>
                <td class="py-2 px-3 text-right font-mono text-xs font-bold ${isSelf ? 'text-slate-400' : 'text-green-600'}">${isSelf ? '-' : '₹' + (l.profit || 0).toLocaleString()}</td>
                <td class="py-2 px-3 text-center w-[100px]">
                    <div class="actions-cell">
                        <button onclick="editLorry('${l.id}')" class="action-btn" title="Edit"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                        <button onclick="copyLorry('${l.id}')" class="action-btn" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button>
                        <button onclick="deleteLorry('${l.id}')" class="action-btn delete" title="Delete"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

window.showLorryModal = function (entry = null) {
    document.getElementById('lorry-modal-title').textContent = entry ? 'Edit Lorry Entry' : 'Add Lorry Entry';
    document.getElementById('lorry-edit-id').value = entry?.id || '';
    document.getElementById('lorry-date').value = entry?.date || new Date().toISOString().split('T')[0];
    document.getElementById('lorry-product').value = entry?.product || '';
    document.getElementById('lorry-place').value = entry?.place || '';
    document.getElementById('lorry-driver').value = entry?.driver || '';
    document.getElementById('lorry-to-whom').value = entry?.to_whom || '';
    document.getElementById('lorry-weight').value = entry?.weight || '';
    document.getElementById('lorry-brought').value = entry?.brought || '';
    document.getElementById('lorry-sold').value = entry?.sold || '';
    document.getElementById('lorry-profit').value = entry?.profit || '';

    if (entry && entry.weight > 0 && entry.brought > 0) {
        document.getElementById('lorry-per-ton').value = Number((entry.brought / entry.weight).toFixed(2));
    } else {
        document.getElementById('lorry-per-ton').value = '';
    }

    const isSelf = !entry || entry.transport_type === 'self';
    document.getElementById('lorry-type-self').checked = isSelf;
    document.getElementById('lorry-type-others').checked = !isSelf;
    toggleLorryType();

    document.getElementById('lorry-modal').classList.remove('hidden');
};

window.closeLorryModal = function () {
    document.getElementById('lorry-modal').classList.add('hidden');
    document.getElementById('lorry-form').reset();
};

window.toggleLorryType = function () {
    const isSelf = document.getElementById('lorry-type-self').checked;
    document.getElementById('lorry-to-section').classList.toggle('hidden', isSelf);
    document.getElementById('lorry-sold-section').classList.toggle('hidden', isSelf);
};

function calcLorryProfit() {
    const sold = parseFloat(document.getElementById('lorry-sold').value) || 0;
    const brought = parseFloat(document.getElementById('lorry-brought').value) || 0;
    document.getElementById('lorry-profit').value = sold - brought;
}

function calcLorryBrought() {
    const weight = parseFloat(document.getElementById('lorry-weight').value) || 0;
    const perTon = parseFloat(document.getElementById('lorry-per-ton').value) || 0;
    const perTonInput = document.getElementById('lorry-per-ton');

    // Only update brought amount if a per-ton price is entered
    if (perTonInput.value.trim() !== '') {
        const brought = weight * perTon;
        document.getElementById('lorry-brought').value = Number(brought.toFixed(2)) || '';
        calcLorryProfit();
    }
}

async function saveLorryEntry(e) {
    e.preventDefault();

    const id = document.getElementById('lorry-edit-id').value;
    const isSelf = document.getElementById('lorry-type-self').checked;

    const entry = {
        date: document.getElementById('lorry-date').value,
        product: document.getElementById('lorry-product').value,
        place: document.getElementById('lorry-place').value,
        driver: document.getElementById('lorry-driver').value,
        transport_type: isSelf ? 'self' : 'others',
        to_whom: isSelf ? null : document.getElementById('lorry-to-whom').value,
        weight: parseFloat(document.getElementById('lorry-weight').value) || 0,
        brought: parseFloat(document.getElementById('lorry-brought').value) || 0,
        sold: isSelf ? 0 : (parseFloat(document.getElementById('lorry-sold').value) || 0),
        profit: isSelf ? 0 : (parseFloat(document.getElementById('lorry-profit').value) || 0)
    };

    if (id) {
        // Don't update created_at on edit to preserve sorting order
        await db.collection('lorry_transports').doc(id).update(entry);
    } else {
        entry.created_at = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('lorry_transports').add(entry);
    }

    showToast('Entry saved successfully', id ? 'warning' : 'success');
    closeLorryModal();
    loadLorry();
}

window.editLorry = function (id) {
    const entry = lorryCache.find(l => l.id === id);
    if (entry) showLorryModal(entry);
};

window.copyLorry = function (id) {
    const entry = lorryCache.find(l => l.id === id);
    if (entry) {
        const copy = { ...entry, id: null, date: new Date().toISOString().split('T')[0] };
        showLorryModal(copy);
    }
};

window.deleteLorry = async function (id) {
    if (!confirm('Are you sure you want to delete this lorry entry? This cannot be undone.')) return;
    await db.collection('lorry_transports').doc(id).delete();
    showToast('Entry deleted', 'error');
    loadLorry();
};

window.exportLorry = function () {
    if (!lorryCache.length) return alert('No data to export');
    const ws = XLSX.utils.json_to_sheet(lorryCache.map(l => ({
        Date: l.date, Product: l.product, Place: l.place, Type: l.transport_type,
        Driver: l.driver, 'To Whom': l.to_whom, Weight: l.weight,
        Brought: l.brought, Sold: l.sold, Profit: l.profit
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Lorry');
    XLSX.writeFile(wb, `Lorry_${currentMonth.toISOString().slice(0, 7)}.xlsx`);
};

// ==========================================
// EXPENSES MODULE
// ==========================================

async function loadExpenses() {
    const { start, end } = getMonthRange(currentMonth);
    const snapshot = await db.collection('expenses')
        .where('date', '>=', start)
        .where('date', '<=', end)
        .orderBy('date', 'desc')
        .get();

    expensesCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Sort by date DESC, then by created_at DESC (latest added first for same date)
    expensesCache.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        const aTime = a.created_at?.toMillis?.() || 0;
        const bTime = b.created_at?.toMillis?.() || 0;
        return bTime - aTime;
    });

    renderExpensesTable();
}

function renderExpensesTable() {
    const tbody = document.getElementById('expenses-table-body');
    const empty = document.getElementById('expenses-empty');

    if (!expensesCache.length) {
        tbody.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    tbody.innerHTML = expensesCache.map((e, i) => `
        <tr>
            <td class="py-2 px-3 text-center text-xs text-slate-400">${i + 1}</td>
            <td class="py-2 px-3 text-xs">${formatDate(e.date)}</td>
            <td class="py-2 px-3 text-xs"><span class="px-2 py-0.5 bg-violet-100 text-violet-700 rounded text-[10px] font-bold uppercase">${e.category || '-'}</span></td>
            <td class="py-2 px-3 text-xs font-medium">${e.name || '-'}</td>
            <td class="py-2 px-3 text-xs text-slate-500">${e.comment || '-'}</td>
            <td class="py-2 px-3 text-right font-mono text-xs font-bold text-red-600">₹${(e.amount || 0).toLocaleString()}</td>
            <td class="py-2 px-3 text-center w-[100px]">
                <div class="actions-cell">
                    <button onclick="editExpense('${e.id}')" class="action-btn" title="Edit"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                    <button onclick="copyExpense('${e.id}')" class="action-btn" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button>
                    <button onclick="deleteExpense('${e.id}')" class="action-btn delete" title="Delete"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                </div>
            </td>
        </tr>
    `).join('');
}

window.showExpensesModal = function (entry = null) {
    document.getElementById('expenses-modal-title').textContent = entry ? 'Edit Expense' : 'Add Expense';
    document.getElementById('expenses-edit-id').value = entry?.id || '';
    document.getElementById('expenses-date').value = entry?.date || new Date().toISOString().split('T')[0];
    document.getElementById('expenses-category').value = entry?.category || '';
    document.getElementById('expenses-name').value = entry?.name || '';
    document.getElementById('expenses-comment').value = entry?.comment || '';
    document.getElementById('expenses-amount').value = entry?.amount || '';

    document.getElementById('expenses-modal').classList.remove('hidden');
};

window.closeExpensesModal = function () {
    document.getElementById('expenses-modal').classList.add('hidden');
    document.getElementById('expenses-form').reset();
};

async function saveExpensesEntry(e) {
    e.preventDefault();

    const id = document.getElementById('expenses-edit-id').value;
    const entry = {
        date: document.getElementById('expenses-date').value,
        category: document.getElementById('expenses-category').value,
        name: document.getElementById('expenses-name').value,
        comment: document.getElementById('expenses-comment').value,
        amount: parseFloat(document.getElementById('expenses-amount').value) || 0
    };

    if (id) {
        // Don't update created_at on edit to preserve sorting order
        await db.collection('expenses').doc(id).update(entry);
    } else {
        entry.created_at = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('expenses').add(entry);
    }

    showToast('Entry saved successfully', id ? 'warning' : 'success');
    closeExpensesModal();
    loadExpenses();
}

window.editExpense = function (id) {
    const entry = expensesCache.find(e => e.id === id);
    if (entry) showExpensesModal(entry);
};

window.copyExpense = function (id) {
    const entry = expensesCache.find(e => e.id === id);
    if (entry) {
        const copy = { ...entry, id: null, date: new Date().toISOString().split('T')[0] };
        showExpensesModal(copy);
    }
};

window.deleteExpense = async function (id) {
    if (!confirm('Are you sure you want to delete this expense? This cannot be undone.')) return;
    await db.collection('expenses').doc(id).delete();
    showToast('Expense deleted', 'error');
    loadExpenses();
};

window.exportExpenses = function () {
    if (!expensesCache.length) return alert('No data to export');
    const ws = XLSX.utils.json_to_sheet(expensesCache.map(e => ({
        Date: e.date, Category: e.category, Name: e.name,
        Comment: e.comment, Amount: e.amount
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Expenses');
    XLSX.writeFile(wb, `Expenses_${currentMonth.toISOString().slice(0, 7)}.xlsx`);
};

// ==========================================
// MANAGE MODAL (Generic for all master data)
// ==========================================

window.showManageBricks = function () { openManageModal('bricks', 'Manage Brick Types'); };
window.showManageDrivers = function () { openManageModal('drivers', 'Manage Drivers'); };
window.showManageLorryProducts = function () { openManageModal('lorry_products', 'Manage Products'); };
window.showManageLorryDrivers = function () { openManageModal('lorry_drivers', 'Manage Lorry Drivers'); };
window.showManageLorryPlaces = function () { openManageModal('lorry_places', 'Manage Places'); };
window.showManageCategories = function () { openManageModal('categories', 'Manage Categories'); };

function openManageModal(type, title) {
    manageType = type;
    document.getElementById('manage-modal-title').textContent = title;
    document.getElementById('manage-new-item').value = '';
    renderManageList();
    document.getElementById('manage-modal').classList.remove('hidden');
}

window.closeManageModal = function () {
    document.getElementById('manage-modal').classList.add('hidden');
};

function getManageCache() {
    switch (manageType) {
        case 'bricks': return bricksCache;
        case 'drivers': return driversCache;
        case 'lorry_products': return lorryProductsCache;
        case 'lorry_drivers': return lorryDriversCache;
        case 'lorry_places': return lorryPlacesCache;
        case 'categories': return categoriesCache;
        case 'production_employees': return productionEmployeesCache;
        case 'production_bricks': return productionBricksCache;
        case 'categories2': return categories2Cache;
        case 'transport_employees': return transportEmployeesCache;
        default: return [];
    }
}

function getManageTable() {
    switch (manageType) {
        case 'bricks': return 'brick_types';
        case 'drivers': return 'drivers';
        case 'lorry_products': return 'lorry_products';
        case 'lorry_drivers': return 'lorry_drivers';
        case 'lorry_places': return 'lorry_places';
        case 'categories': return 'expense_categories';
        case 'production_employees': return 'production_employees';
        case 'production_bricks': return 'production_bricks';
        case 'categories2': return 'expense_categories_2';
        case 'transport_employees': return 'transport_employees';
        default: return '';
    }
}

function renderManageList() {
    const list = document.getElementById('manage-list');
    const items = getManageCache();
    const isBricks = manageType === 'bricks';
    const isDrivers = manageType === 'drivers';

    list.innerHTML = items.length ? items.map(item => `
        <div class="manage-item">
            <span class="manage-item-name">${escapeHtml(item.name)}</span>
            ${isBricks ? `
                <div class="flex items-center gap-2">
                    <div class="flex items-center gap-1">
                        <span class="text-[10px] text-slate-500">punches:</span>
                        <input type="number" value="${item.bricks_per_punch || 1}"
                            onchange="updateBricksPerPunch('${item.id}', this.value)"
                            class="w-14 text-xs text-right font-mono border border-slate-200 rounded px-1 py-0.5" title="Bricks per punch">
                    </div>
                    <div class="flex items-center gap-1">
                        <span class="text-[10px] text-slate-500">driver factor:</span>
                        <input type="number" step="1" min="1" value="${item.driver_factor || 0}"
                            onchange="updateDriverFactor('${item.id}', this.value)"
                            class="w-16 text-xs text-right font-mono border border-slate-200 rounded px-1 py-0.5" title="Salary = qty / factor (set 0 to disable)">
                    </div>
                </div>
            ` : ''}
            ${isDrivers ? `
                <label class="flex items-center cursor-pointer select-none px-2 py-1 rounded ${item.no_salary ? 'bg-rose-50 border border-rose-200' : 'hover:bg-slate-50'}" title="Tick to mark as NS (No Salary)">
                    <input type="checkbox" ${item.no_salary ? 'checked' : ''}
                        onchange="updateDriverNoSalary('${item.id}', this.checked)"
                        class="w-3.5 h-3.5 accent-rose-600">
                </label>
            ` : ''}
            <div class="manage-item-actions">
                <button onclick="deleteManageItem('${item.id}')" class="delete" title="Delete">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </div>
        </div>
    `).join('') : '<div class="text-center text-gray-400 py-4 text-sm">No items yet</div>';
}

// Helper to escape HTML special characters
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

window.saveManageItem = async function () {
    const input = document.getElementById('manage-new-item');
    const name = input.value.trim();
    if (!name) return;

    const table = getManageTable();
    const data = { name };

    // For brick types, add defaults
    if (manageType === 'bricks') {
        data.bricks_per_punch = 1;
        data.driver_factor = 0;
    }

    await db.collection(table).add(data);

    input.value = '';
    await refreshManageCache();
    renderManageList();
};

window.updateBricksPerPunch = async function (id, value) {
    const bricksPerPunch = parseInt(value) || 1;
    await db.collection('brick_types').doc(id).update({ bricks_per_punch: bricksPerPunch });
    await loadBricks();
    showToast('Bricks per punch updated', 'success');
};

window.updateDriverFactor = async function (id, value) {
    const factor = parseFloat(value) || 0;
    await db.collection('brick_types').doc(id).update({ driver_factor: factor });
    await loadBricks();
    showToast('Driver factor updated', 'success');
};

window.updateDriverNoSalary = async function (id, noSalary) {
    await db.collection('drivers').doc(id).update({ no_salary: !!noSalary });
    await loadDrivers();
    showToast(noSalary ? 'Driver marked as NS (No Salary)' : 'Driver salary enabled', noSalary ? 'warning' : 'success');
};

window.deleteManageItem = async function (id) {
    if (!confirm('Are you sure you want to delete this item? This cannot be undone.')) return;
    const table = getManageTable();
    await db.collection(table).doc(id).delete();
    await refreshManageCache();
    renderManageList();
};

async function refreshManageCache() {
    switch (manageType) {
        case 'bricks': await loadBricks(); break;
        case 'drivers': await loadDrivers(); break;
        case 'lorry_products': await loadLorryProducts(); break;
        case 'lorry_drivers': await loadLorryDrivers(); break;
        case 'lorry_places': await loadLorryPlaces(); break;
        case 'categories': await loadCategories(); break;
        case 'production_employees': await loadProductionEmployees(); break;
        case 'production_bricks': await loadProductionBricks(); break;
        case 'categories2': await loadCategories2(); break;
        case 'transport_employees': await loadTransportEmployees(); break;
    }
}

// ==========================================
// ANALYSIS MODALS
// ==========================================

let analysisType = '';

function setAnalysisDateRange() {
    const { start, end } = getMonthRange(currentMonth);
    document.getElementById('analysis-from-date').value = start;
    document.getElementById('analysis-to-date').value = end;
}

window.openSalesAnalysis = function () {
    analysisType = 'sales';
    document.getElementById('analysis-modal-header').className = 'modal-header bg-rose-600';
    document.getElementById('analysis-modal-title').textContent = 'Sales Analysis';
    setAnalysisDateRange();
    runAnalysis();
    document.getElementById('analysis-modal').classList.remove('hidden');
};

window.openLorryAnalysis = function () {
    analysisType = 'lorry';
    document.getElementById('analysis-modal-header').className = 'modal-header bg-amber-600';
    document.getElementById('analysis-modal-title').textContent = 'Lorry Analysis';
    setAnalysisDateRange();
    runAnalysis();
    document.getElementById('analysis-modal').classList.remove('hidden');
};

window.openExpensesAnalysis = function () {
    analysisType = 'expenses';
    document.getElementById('analysis-modal-header').className = 'modal-header bg-violet-600';
    document.getElementById('analysis-modal-title').textContent = 'Expenses Analysis';
    setAnalysisDateRange();
    runAnalysis();
    document.getElementById('analysis-modal').classList.remove('hidden');
};

window.openProductionAnalysis = function () {
    analysisType = 'production';
    document.getElementById('analysis-modal-header').className = 'modal-header bg-teal-600';
    document.getElementById('analysis-modal-title').textContent = 'Production Wages Analysis';
    setAnalysisDateRange();
    runAnalysis();
    document.getElementById('analysis-modal').classList.remove('hidden');
};

window.closeAnalysisModal = function () {
    document.getElementById('analysis-modal').classList.add('hidden');
};

// ==========================================
// PDF PRINT FEATURE
// ==========================================

// Section definitions for each analysis type
const analysisSections = {
    sales: [
        { id: 'summary-cards', label: 'Summary Cards' },
        { id: 'payment-breakdown', label: 'Payment Status Breakdown' },
        { id: 'by-brick-type', label: 'Sales by Brick Type' },
        { id: 'by-driver', label: 'Drivers by Bricks' }
    ],
    lorry: [
        { id: 'summary-cards', label: 'Summary Cards' },
        { id: 'by-product-self', label: 'By Product - Self' },
        { id: 'by-product-others', label: 'By Product - Others' },
        { id: 'by-driver', label: 'By Driver' }
    ],
    expenses: [
        { id: 'summary-cards', label: 'Total Expenses Card' },
        { id: 'by-category', label: 'By Category Table' }
    ],
    production: [
        { id: 'summary-cards', label: 'Summary Cards' },
        { id: 'by-employee', label: 'Wages by Employee' },
        { id: 'by-brick-type', label: 'Production by Brick Type' }
    ],
    expenses2: [
        { id: 'summary-cards', label: 'Total Expenses 2 Card' },
        { id: 'by-category', label: 'By Category Table' }
    ],
    transportwages: [
        { id: 'summary-cards', label: 'Total Transport Wages Card' },
        { id: 'by-employee', label: 'Wages by Employee' }
    ]
};

// Track selected sections for printing
let printSectionsState = {};

window.showPrintOptionsModal = function () {
    const container = document.getElementById('print-sections-container');
    const sections = analysisSections[analysisType] || [];

    // Initialize all sections as checked
    printSectionsState = {};
    sections.forEach(s => printSectionsState[s.id] = true);

    container.innerHTML = sections.map(section => `
        <label class="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
            <input type="checkbox" 
                id="print-section-${section.id}" 
                checked 
                onchange="printSectionsState['${section.id}'] = this.checked"
                class="w-4 h-4 accent-slate-600 rounded">
            <span class="text-sm font-medium text-slate-700">${section.label}</span>
        </label>
    `).join('');

    document.getElementById('print-options-modal').classList.remove('hidden');
};

window.closePrintOptionsModal = function () {
    document.getElementById('print-options-modal').classList.add('hidden');
};

window.toggleAllPrintSections = function () {
    const sections = analysisSections[analysisType] || [];
    const allChecked = Object.values(printSectionsState).every(v => v);

    sections.forEach(s => {
        printSectionsState[s.id] = !allChecked;
        const checkbox = document.getElementById(`print-section-${s.id}`);
        if (checkbox) checkbox.checked = !allChecked;
    });
};

window.printAnalysisToPDF = function () {
    // Apply print-hidden class to unselected sections
    const analysisContent = document.getElementById('analysis-content');
    const printSections = analysisContent.querySelectorAll('[data-print-section]');

    printSections.forEach(section => {
        const sectionId = section.getAttribute('data-print-section');
        if (!printSectionsState[sectionId]) {
            section.classList.add('print-hidden');
        } else {
            section.classList.remove('print-hidden');
        }
    });

    // Close the options modal
    closePrintOptionsModal();

    // Add print mode class to body
    document.body.classList.add('printing-analysis');

    // Trigger browser print
    window.print();

    // Remove print mode class after printing
    setTimeout(() => {
        document.body.classList.remove('printing-analysis');
        // Remove print-hidden from all sections
        printSections.forEach(section => section.classList.remove('print-hidden'));
    }, 1000);
};

window.openCurrentAnalysis = function () {
    switch (currentModule) {
        case 'sales': openSalesAnalysis(); break;
        case 'lorry': openLorryAnalysis(); break;
        case 'expenses': openExpensesAnalysis(); break;
        case 'production': openProductionAnalysis(); break;
        case 'expenses2': openExpenses2Analysis(); break;
        case 'transportwages': openTransportWagesAnalysis(); break;
        default: showToast('No analysis available', 'warning');
    }
};

window.exportCurrentModule = function () {
    let data = [];
    let filename = '';
    let headers = [];

    switch (currentModule) {
        case 'sales':
            data = salesCache;
            filename = 'sales_export.csv';
            headers = ['Date', 'Brick Type', 'Quantity', 'Rate', 'Transport Rate', 'Total', 'Driver', 'Payment Status'];
            break;
        case 'lorry':
            data = lorryCache;
            filename = 'lorry_export.csv';
            headers = ['Date', 'Product', 'Type', 'Brought', 'Sold', 'Profit', 'Driver', 'Place'];
            break;
        case 'expenses':
            data = expensesCache;
            filename = 'expenses_export.csv';
            headers = ['Date', 'Category', 'Name', 'Comment', 'Amount'];
            break;
        case 'expenses2':
            data = expenses2Cache;
            filename = 'expenses2_export.csv';
            headers = ['Date', 'Category', 'Name', 'Comment', 'Amount'];
            break;
        case 'transportwages':
            data = transportWagesCache;
            filename = 'transport_wages_export.csv';
            headers = ['Date', 'Total', 'Employee Wages'];
            break;
        default:
            showToast('No export available', 'warning');
            return;
    }

    if (!data.length) {
        showToast('No data to export', 'warning');
        return;
    }

    exportToCSV(data, filename, headers);
};

function exportToCSV(data, filename, headers) {
    let csv = headers.join(',') + '\n';

    data.forEach(row => {
        const values = headers.map(header => {
            const key = header.toLowerCase().replace(/ /g, '_');
            let val = row[key] || '';
            if (typeof val === 'object') val = JSON.stringify(val);
            return `"${String(val).replace(/"/g, '""')}"`;
        });
        csv += values.join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Export complete', 'success');
}

async function runAnalysis() {
    const container = document.getElementById('analysis-content');
    container.innerHTML = '<div class="text-center text-gray-400 py-12">Loading...</div>';

    const start = document.getElementById('analysis-from-date').value;
    const end = document.getElementById('analysis-to-date').value;

    if (!start || !end) return;

    const fetchAnalysisData = async (collection) => {
        const snapshot = await db.collection(collection)
            .where('date', '>=', start)
            .where('date', '<=', end)
            .get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    };

    if (analysisType === 'sales') {
        const data = await fetchAnalysisData('sales');
        renderSalesAnalysis(data || []);
    } else if (analysisType === 'lorry') {
        const data = await fetchAnalysisData('lorry_transports');
        renderLorryAnalysis(data || []);
    } else if (analysisType === 'expenses') {
        const data = await fetchAnalysisData('expenses');
        renderExpensesAnalysis(data || []);
    } else if (analysisType === 'production') {
        const data = await fetchAnalysisData('production_wages');
        renderProductionAnalysis(data || []);
    } else if (analysisType === 'expenses2') {
        const data = await fetchAnalysisData('expenses_2');
        renderExpenses2Analysis(data || []);
    } else if (analysisType === 'transportwages') {
        const data = await fetchAnalysisData('transport_wages');
        renderTransportWagesAnalysis(data || []);
    }
}

function renderSalesAnalysis(data) {
    const container = document.getElementById('analysis-content');

    // Calculate all totals
    let totalQty = 0;
    let normalTotal = 0;  // qty × rate
    let transportTotal = 0;  // qty × transport_rate
    let paidNormalTotal = 0;
    let paidTransportTotal = 0;
    let pendingNormalTotal = 0;
    let pendingTransportTotal = 0;

    data.forEach(s => {
        const qty = s.quantity || 0;
        const rate = s.rate || 0;
        const tRate = s.transport_rate || 0;
        const normal = qty * rate;
        const transport = qty * tRate;

        totalQty += qty;
        normalTotal += normal;
        transportTotal += transport;

        if (s.payment_status === 'Paid') {
            paidNormalTotal += normal;
            paidTransportTotal += transport;
        } else {
            pendingNormalTotal += normal;
            pendingTransportTotal += transport;
        }
    });

    const grandTotal = normalTotal + transportTotal;
    const paidTotal = paidNormalTotal + paidTransportTotal;
    const pendingTotal = pendingNormalTotal + pendingTransportTotal;

    const byType = {};
    const byDriver = {};
    const driverSalaryByDriver = {};
    const factorMap = getDriverFactorMap();
    const noSalaryDrivers = getNoSalaryDriversSet();

    data.forEach(s => {
        const qty = s.quantity || 0;
        const rate = s.rate || 0;
        const tRate = s.transport_rate || 0;

        const type = s.brick_type || 'Unknown';
        if (!byType[type]) byType[type] = { qty: 0, normal: 0, transport: 0 };
        byType[type].qty += qty;
        byType[type].normal += qty * rate;
        byType[type].transport += qty * tRate;

        const driver = s.driver || 'Unassigned';
        if (!byDriver[driver]) byDriver[driver] = { qty: 0, trips: 0, byType: {}, noSalary: noSalaryDrivers.has(driver) };
        byDriver[driver].qty += qty;
        byDriver[driver].trips += 1;

        // Track brick types per driver
        if (!byDriver[driver].byType[type]) byDriver[driver].byType[type] = 0;
        byDriver[driver].byType[type] += qty;

        // Driver salary = qty / factor — only for drivers WITH salary
        const factor = factorMap[type] || 0;
        if (factor > 0 && !noSalaryDrivers.has(driver)) {
            const salary = qty / factor;
            if (!driverSalaryByDriver[driver]) driverSalaryByDriver[driver] = 0;
            driverSalaryByDriver[driver] += salary;
        }
    });

    const totalDriverSalary = Object.values(driverSalaryByDriver).reduce((a, b) => a + b, 0);
    const totalQtyEligible = Object.entries(byDriver).reduce((sum, [d, s]) => sum + (s.noSalary ? 0 : s.qty), 0);
    const totalQtyAll = Object.values(byDriver).reduce((a, b) => a + b.qty, 0);
    const totalQtyNoSalary = totalQtyAll - totalQtyEligible;

    container.innerHTML = `
        <!-- Main Summary Cards -->
        <div data-print-section="summary-cards" class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="bg-white p-5 rounded-xl shadow-sm border">
                <div class="text-xs font-bold text-slate-500 uppercase">Total Quantity</div>
                <div class="text-3xl font-mono font-bold text-slate-800 mt-1">${totalQty.toLocaleString()}</div>
                <div class="text-xs text-slate-400">${data.length} orders</div>
            </div>
            <div class="bg-white p-5 rounded-xl shadow-sm border border-rose-200">
                <div class="text-xs font-bold text-rose-600 uppercase">Normal Total</div>
                <div class="text-[10px] text-rose-400">Qty × Rate</div>
                <div class="text-2xl font-mono font-bold text-rose-600 mt-1">₹${normalTotal.toLocaleString()}</div>
            </div>
            <div class="bg-white p-5 rounded-xl shadow-sm border border-sky-200">
                <div class="text-xs font-bold text-sky-600 uppercase">Transport Total</div>
                <div class="text-[10px] text-sky-400">Qty × T.Rate</div>
                <div class="text-2xl font-mono font-bold text-sky-600 mt-1">₹${transportTotal.toLocaleString()}</div>
            </div>
            <div class="bg-gradient-to-br from-indigo-600 to-indigo-700 p-5 rounded-xl shadow-lg text-white">
                <div class="text-xs font-bold uppercase opacity-80">Grand Total</div>
                <div class="text-[10px] opacity-60">Normal + Transport</div>
                <div class="text-3xl font-mono font-bold mt-1">₹${grandTotal.toLocaleString()}</div>
            </div>
        </div>

        <!-- Payment Status Breakdown -->
        <div data-print-section="payment-breakdown" class="grid grid-cols-2 gap-4">
            <div class="bg-emerald-50 p-5 rounded-xl border border-emerald-200">
                <div class="text-xs font-bold text-emerald-700 uppercase mb-3">✓ Paid Amount</div>
                <div class="grid grid-cols-3 gap-2 text-center">
                    <div>
                        <div class="text-[10px] text-emerald-500">Normal</div>
                        <div class="font-mono font-bold text-emerald-700">₹${paidNormalTotal.toLocaleString()}</div>
                    </div>
                    <div>
                        <div class="text-[10px] text-emerald-500">Transport</div>
                        <div class="font-mono font-bold text-emerald-700">₹${paidTransportTotal.toLocaleString()}</div>
                    </div>
                    <div class="bg-emerald-100 rounded-lg p-2">
                        <div class="text-[10px] text-emerald-600">Total Paid</div>
                        <div class="font-mono font-bold text-emerald-800 text-lg">₹${paidTotal.toLocaleString()}</div>
                    </div>
                </div>
            </div>
            <div class="bg-red-50 p-5 rounded-xl border border-red-200">
                <div class="text-xs font-bold text-red-700 uppercase mb-3">⏳ Pending Amount</div>
                <div class="grid grid-cols-3 gap-2 text-center">
                    <div>
                        <div class="text-[10px] text-red-500">Normal</div>
                        <div class="font-mono font-bold text-red-700">₹${pendingNormalTotal.toLocaleString()}</div>
                    </div>
                    <div>
                        <div class="text-[10px] text-red-500">Transport</div>
                        <div class="font-mono font-bold text-red-700">₹${pendingTransportTotal.toLocaleString()}</div>
                    </div>
                    <div class="bg-red-100 rounded-lg p-2">
                        <div class="text-[10px] text-red-600">Total Pending</div>
                        <div class="font-mono font-bold text-red-800 text-lg">₹${pendingTotal.toLocaleString()}</div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- By Brick Type -->
        <div data-print-section="by-brick-type" class="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div class="bg-rose-50 px-5 py-3 border-b"><h3 class="text-sm font-bold text-rose-800 uppercase">Sales by Brick Type</h3></div>
            <table class="w-full text-sm">
                <thead class="bg-gray-50 text-xs text-slate-500 uppercase">
                    <tr>
                        <th class="py-3 px-5 text-left">Brick Type</th>
                        <th class="py-3 px-5 text-right">Quantity</th>
                        <th class="py-3 px-5 text-right">Normal Total</th>
                        <th class="py-3 px-5 text-right">Transport Total</th>
                        <th class="py-3 px-5 text-right">Grand Total</th>
                    </tr>
                </thead>
                <tbody class="divide-y">
                    ${Object.entries(byType).sort((a, b) => (b[1].normal + b[1].transport) - (a[1].normal + a[1].transport)).map(([type, stats]) => `
                        <tr>
                            <td class="py-3 px-5 font-medium">${type}</td>
                            <td class="py-3 px-5 text-right font-mono">${stats.qty.toLocaleString()}</td>
                            <td class="py-3 px-5 text-right font-mono text-rose-600">₹${stats.normal.toLocaleString()}</td>
                            <td class="py-3 px-5 text-right font-mono text-sky-600">₹${stats.transport.toLocaleString()}</td>
                            <td class="py-3 px-5 text-right font-mono font-bold text-indigo-700">₹${(stats.normal + stats.transport).toLocaleString()}</td>
                        </tr>
                    `).join('')}
                    <tr class="bg-gray-50 font-bold">
                        <td class="py-3 px-5">TOTAL</td>
                        <td class="py-3 px-5 text-right font-mono">${totalQty.toLocaleString()}</td>
                        <td class="py-3 px-5 text-right font-mono text-rose-700">₹${normalTotal.toLocaleString()}</td>
                        <td class="py-3 px-5 text-right font-mono text-sky-700">₹${transportTotal.toLocaleString()}</td>
                        <td class="py-3 px-5 text-right font-mono text-indigo-800">₹${grandTotal.toLocaleString()}</td>
                    </tr>
                </tbody>
            </table>
        </div>
        
        <!-- By Driver with Brick Type Breakdown as Table (drivers by bricks) -->
        <div data-print-section="by-driver" class="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div class="bg-slate-100 px-5 py-3 border-b">
                <h3 class="text-sm font-bold text-slate-700 uppercase">Drivers by Bricks</h3>
            </div>
            <table class="w-full text-sm">
                <thead class="bg-gray-50 text-xs text-slate-500 uppercase">
                    <tr>
                        <th class="py-3 px-5 text-left">Driver</th>
                        ${Object.keys(byType).map(type => `<th class="py-3 px-5 text-right">${type}</th>`).join('')}
                        <th class="py-3 px-5 text-right">Total Bricks</th>
                        <th class="py-3 px-5 text-right font-bold text-rose-700">Salary</th>
                    </tr>
                </thead>
                <tbody class="divide-y">
                    ${Object.entries(byDriver).sort((a, b) => (a[1].noSalary ? 1 : -1) || (b[1].qty - a[1].qty)).map(([driver, stats]) => {
                        const salary = driverSalaryByDriver[driver] || 0;
                        return `
                        <tr class="${stats.noSalary ? 'bg-rose-50/40' : ''}">
                            <td class="py-3 px-5 font-medium">${driver}${stats.noSalary ? ' <span class="text-[9px] font-bold text-rose-600 uppercase ml-1">NS</span>' : ''}</td>
                            ${Object.keys(byType).map(type => `<td class="py-3 px-5 text-right font-mono">${(stats.byType[type] || 0).toLocaleString()}</td>`).join('')}
                            <td class="py-3 px-5 text-right font-mono">${stats.qty.toLocaleString()}</td>
                            <td class="py-3 px-5 text-right font-mono font-bold ${stats.noSalary ? 'text-slate-400' : 'text-rose-700'}">₹${stats.noSalary ? '0' : salary.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                        </tr>`;
                    }).join('')}
                    <tr class="bg-slate-100 font-bold">
                        <td class="py-3 px-5">TOTAL</td>
                        ${Object.keys(byType).map(type => {
                            const sum = Object.values(byDriver).reduce((a, b) => a + (b.byType[type] || 0), 0);
                            return `<td class="py-3 px-5 text-right font-mono">${sum.toLocaleString()}</td>`;
                        }).join('')}
                        <td class="py-3 px-5 text-right font-mono">${totalQtyAll.toLocaleString()}</td>
                        <td class="py-3 px-5 text-right font-mono text-rose-800">₹${totalDriverSalary.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
}

function renderLorryAnalysis(data) {
    const container = document.getElementById('analysis-content');

    const selfTrips = data.filter(l => l.transport_type === 'self');
    const othersTrips = data.filter(l => l.transport_type === 'others');

    const selfBrought = selfTrips.reduce((sum, l) => sum + (l.brought || 0), 0);
    const othersBrought = othersTrips.reduce((sum, l) => sum + (l.brought || 0), 0);
    const othersSold = othersTrips.reduce((sum, l) => sum + (l.sold || 0), 0);
    const othersProfit = othersTrips.reduce((sum, l) => sum + (l.profit || 0), 0);

    // By Product for Self
    const byProductSelf = {};
    selfTrips.forEach(l => {
        const prod = l.product || 'Unknown';
        if (!byProductSelf[prod]) byProductSelf[prod] = { tonns: 0, amount: 0 };
        byProductSelf[prod].tonns += parseFloat(l.weight) || 0;
        byProductSelf[prod].amount += l.brought || 0;
    });

    // By Product for Others
    const byProductOthers = {};
    othersTrips.forEach(l => {
        const prod = l.product || 'Unknown';
        if (!byProductOthers[prod]) byProductOthers[prod] = { tonns: 0, amount: 0, sold: 0, profit: 0 };
        byProductOthers[prod].tonns += parseFloat(l.weight) || 0;
        byProductOthers[prod].amount += l.brought || 0;
        byProductOthers[prod].sold += l.sold || 0;
        byProductOthers[prod].profit += l.profit || 0;
    });

    // Calculate totals for Self
    const selfTotalTonns = Object.values(byProductSelf).reduce((sum, s) => sum + s.tonns, 0);
    const selfTotalAmount = Object.values(byProductSelf).reduce((sum, s) => sum + s.amount, 0);

    // Calculate totals for Others
    const othersTotalTonns = Object.values(byProductOthers).reduce((sum, s) => sum + s.tonns, 0);
    const othersTotalAmount = Object.values(byProductOthers).reduce((sum, s) => sum + s.amount, 0);
    const othersTotalSold = Object.values(byProductOthers).reduce((sum, s) => sum + s.sold, 0);
    const othersTotalProfit = Object.values(byProductOthers).reduce((sum, s) => sum + s.profit, 0);

    // By Driver
    const byDriver = {};
    data.forEach(l => {
        const driver = l.driver || 'Unknown';
        if (!byDriver[driver]) byDriver[driver] = { trips: 0, brought: 0 };
        byDriver[driver].trips += 1;
        byDriver[driver].brought += l.brought || 0;
    });

    container.innerHTML = `
        <div data-print-section="summary-cards" class="grid grid-cols-2 gap-4">
            <div class="bg-sky-50 p-5 rounded-xl border border-sky-200">
                <div class="text-xs font-bold text-sky-700 uppercase">Self Use</div>
                <div class="text-2xl font-mono font-bold text-sky-800 mt-1">${selfTrips.length} trips</div>
                <div class="text-sm text-sky-600">₹${selfBrought.toLocaleString()} brought</div>
            </div>
            <div class="bg-amber-50 p-5 rounded-xl border border-amber-200">
                <div class="text-xs font-bold text-amber-700 uppercase">Others</div>
                <div class="text-2xl font-mono font-bold text-amber-800 mt-1">${othersTrips.length} trips</div>
                <div class="text-sm text-amber-600">₹${othersProfit.toLocaleString()} profit</div>
            </div>
        </div>
        
        <!-- Self By Product Table -->
        <div data-print-section="by-product-self" class="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div class="bg-sky-50 px-5 py-3 border-b"><h3 class="text-sm font-bold text-sky-800 uppercase">By Product - Self</h3></div>
            <table class="w-full text-sm">
                <thead class="bg-gray-50 text-xs text-slate-500 uppercase">
                    <tr><th class="py-3 px-5 text-left">Product</th><th class="py-3 px-5 text-right">Tonns</th><th class="py-3 px-5 text-right">Amount ₹</th></tr>
                </thead>
                <tbody class="divide-y">
                    ${Object.entries(byProductSelf).map(([prod, stats]) => `
                        <tr><td class="py-3 px-5 font-medium">${prod}</td><td class="py-3 px-5 text-right font-mono">${stats.tonns.toFixed(2)}</td><td class="py-3 px-5 text-right font-mono text-sky-600">₹${stats.amount.toLocaleString()}</td></tr>
                    `).join('')}
                    <tr class="bg-sky-50 font-bold">
                        <td class="py-3 px-5">TOTAL</td>
                        <td class="py-3 px-5 text-right font-mono">${selfTotalTonns.toFixed(2)}</td>
                        <td class="py-3 px-5 text-right font-mono text-sky-700">₹${selfTotalAmount.toLocaleString()}</td>
                    </tr>
                </tbody>
            </table>
        </div>
        
        <!-- Others By Product Table -->
        <div data-print-section="by-product-others" class="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div class="bg-amber-50 px-5 py-3 border-b"><h3 class="text-sm font-bold text-amber-800 uppercase">By Product - Others</h3></div>
            <table class="w-full text-sm">
                <thead class="bg-gray-50 text-xs text-slate-500 uppercase">
                    <tr><th class="py-3 px-5 text-left">Product</th><th class="py-3 px-5 text-right">Tonns</th><th class="py-3 px-5 text-right">Brought ₹</th><th class="py-3 px-5 text-right">Sold ₹</th><th class="py-3 px-5 text-right">Profit ₹</th></tr>
                </thead>
                <tbody class="divide-y">
                    ${Object.entries(byProductOthers).map(([prod, stats]) => `
                        <tr><td class="py-3 px-5 font-medium">${prod}</td><td class="py-3 px-5 text-right font-mono">${stats.tonns.toFixed(2)}</td><td class="py-3 px-5 text-right font-mono text-amber-600">₹${stats.amount.toLocaleString()}</td><td class="py-3 px-5 text-right font-mono text-blue-600">₹${stats.sold.toLocaleString()}</td><td class="py-3 px-5 text-right font-mono font-bold text-green-600">₹${stats.profit.toLocaleString()}</td></tr>
                    `).join('')}
                    <tr class="bg-amber-50 font-bold">
                        <td class="py-3 px-5">TOTAL</td>
                        <td class="py-3 px-5 text-right font-mono">${othersTotalTonns.toFixed(2)}</td>
                        <td class="py-3 px-5 text-right font-mono text-amber-700">₹${othersTotalAmount.toLocaleString()}</td>
                        <td class="py-3 px-5 text-right font-mono text-blue-700">₹${othersTotalSold.toLocaleString()}</td>
                        <td class="py-3 px-5 text-right font-mono text-green-700">₹${othersTotalProfit.toLocaleString()}</td>
                    </tr>
                </tbody>
            </table>
        </div>
        
        <div data-print-section="by-driver" class="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div class="bg-slate-100 px-5 py-3 border-b"><h3 class="text-sm font-bold text-slate-700 uppercase">By Driver</h3></div>
            <table class="w-full text-sm">
                <thead class="bg-gray-50 text-xs text-slate-500 uppercase">
                    <tr><th class="py-3 px-5 text-left">Driver</th><th class="py-3 px-5 text-right">Trips</th><th class="py-3 px-5 text-right">Total Brought ₹</th></tr>
                </thead>
                <tbody class="divide-y">
                    ${Object.entries(byDriver).map(([driver, stats]) => `
                        <tr><td class="py-3 px-5 font-medium">${driver}</td><td class="py-3 px-5 text-right font-mono">${stats.trips}</td><td class="py-3 px-5 text-right font-mono font-bold">₹${stats.brought.toLocaleString()}</td></tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
`;
}

function renderExpensesAnalysis(data) {
    const container = document.getElementById('analysis-content');

    const totalExpenses = data.reduce((sum, e) => sum + (e.amount || 0), 0);

    const byCategory = {};
    data.forEach(e => {
        const cat = e.category || 'Uncategorized';
        if (!byCategory[cat]) byCategory[cat] = 0;
        byCategory[cat] += e.amount || 0;
    });

    // Sort by amount
    const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

    container.innerHTML = `
        <div data-print-section="summary-cards" class="bg-white p-5 rounded-xl shadow-sm border">
            <div class="text-xs font-bold text-slate-500 uppercase">Total Expenses</div>
            <div class="text-3xl font-mono font-bold text-red-600 mt-1">₹${totalExpenses.toLocaleString()}</div>
            <div class="text-xs text-slate-400">${data.length} transactions</div>
        </div>

    <div data-print-section="by-category" class="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div class="bg-violet-50 px-5 py-3 border-b"><h3 class="text-sm font-bold text-violet-800 uppercase">By Category</h3></div>
        <table class="w-full text-sm">
            <thead class="bg-gray-50 text-xs text-slate-500 uppercase">
                <tr><th class="py-3 px-5 text-left">Category</th><th class="py-3 px-5 text-right">Amount</th><th class="py-3 px-5 text-right">%</th></tr>
            </thead>
            <tbody class="divide-y">
                ${sorted.map(([cat, amt]) => `
                        <tr><td class="py-3 px-5 font-medium">${cat}</td><td class="py-3 px-5 text-right font-mono font-bold text-red-600">₹${amt.toLocaleString()}</td><td class="py-3 px-5 text-right font-mono text-slate-500">${totalExpenses ? ((amt / totalExpenses) * 100).toFixed(1) : 0}%</td></tr>
                    `).join('')}
            </tbody>
        </table>
    </div>
`;
}

// Note: openCurrentAnalysis and exportCurrentModule are defined earlier in the file
// with complete support for all modules including expenses2 and transportwages

// ==========================================
// FILTER MODAL - REBUILT WITH CLIENT-SIDE FILTERING
// ==========================================

// Each module has its own filter value (simple approach)
let activeFilter = {
    value: '',  // The selected filter value
    type: ''    // The filter type (e.g., 'category', 'employee', etc.)
};

window.showFilterModal = function () {
    // Set default date range to current month
    const { start, end } = getMonthRange(currentMonth);
    document.getElementById('filter-from-date').value = start;
    document.getElementById('filter-to-date').value = end;

    const container = document.getElementById('filter-options-container');
    let html = '';
    let filterLabel = '';
    let filterOptions = [];

    // Build filter options based on current module
    switch (currentModule) {
        case 'sales':
            filterLabel = 'Payment Status';
            filterOptions = [
                { value: '', label: 'All' },
                { value: 'Paid', label: 'Paid' },
                { value: 'Pending', label: 'Pending' }
            ];
            activeFilter.type = 'payment_status';
            break;
        case 'lorry':
            filterLabel = 'Transport Type';
            filterOptions = [
                { value: '', label: 'All' },
                { value: 'self', label: 'Self' },
                { value: 'others', label: 'Others' }
            ];
            activeFilter.type = 'transport_type';
            break;
        case 'expenses':
            filterLabel = 'Category';
            filterOptions = [{ value: '', label: 'All' }].concat(
                categoriesCache.map(c => ({ value: c.name, label: c.name }))
            );
            activeFilter.type = 'category';
            break;
        case 'production':
            filterLabel = 'Employee';
            filterOptions = [{ value: '', label: 'All' }].concat(
                productionEmployeesCache.map(e => ({ value: e.name, label: e.name }))
            );
            activeFilter.type = 'employee';
            break;
        case 'expenses2':
            filterLabel = 'Category';
            filterOptions = [{ value: '', label: 'All' }].concat(
                categories2Cache.map(c => ({ value: c.name, label: c.name }))
            );
            activeFilter.type = 'category';
            break;
        case 'transportwages':
            filterLabel = 'Employee';
            filterOptions = [{ value: '', label: 'All' }].concat(
                transportEmployeesCache.map(e => ({ value: e.name, label: e.name }))
            );
            activeFilter.type = 'employee';
            break;
        default:
            filterLabel = 'Filter';
            filterOptions = [{ value: '', label: 'All' }];
            activeFilter.type = '';
    }

    html = `
        <div>
            <label class="form-label">${filterLabel}</label>
            <select id="filter-select" class="ledger-input w-full">
                ${filterOptions.map(opt => `<option value="${escapeHtml(opt.value)}" ${activeFilter.value === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('')}
            </select>
        </div>
    `;

    container.innerHTML = html;
    document.getElementById('filter-modal-title').textContent = `Filter ${currentModule.charAt(0).toUpperCase() + currentModule.slice(1)} `;
    document.getElementById('filter-modal').classList.remove('hidden');
};

window.closeFilterModal = function () {
    document.getElementById('filter-modal').classList.add('hidden');
};

window.applyFilters = async function () {
    const selectEl = document.getElementById('filter-select');
    activeFilter.value = selectEl ? selectEl.value : '';

    const fromDate = document.getElementById('filter-from-date').value;
    const toDate = document.getElementById('filter-to-date').value;

    closeFilterModal();

    // Re-fetch data with the date range, then apply client-side filter
    await fetchAndFilterData(fromDate, toDate, activeFilter.value);
};

window.clearFilters = function () {
    activeFilter.value = '';
    activeFilter.type = '';
    closeFilterModal();
    refreshCurrentModule();
};

// Fetch data from Firestore with date range, then apply additional filter
async function fetchAndFilterData(fromDate, toDate, filterValue) {
    let data = [];

    switch (currentModule) {
        case 'sales':
            const salesSnap = await db.collection('sales')
                .where('date', '>=', fromDate)
                .where('date', '<=', toDate)
                .orderBy('date', 'desc')
                .get();
            data = salesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (filterValue) {
                data = data.filter(s => s.payment_status === filterValue);
            }
            renderFilteredSalesTable(data);
            break;

        case 'lorry':
            const lorrySnap = await db.collection('lorry_transports')
                .where('date', '>=', fromDate)
                .where('date', '<=', toDate)
                .orderBy('date', 'desc')
                .get();
            data = lorrySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (filterValue) {
                data = data.filter(l => l.transport_type === filterValue);
            }
            renderFilteredLorryTable(data);
            break;

        case 'expenses':
            const expensesSnap = await db.collection('expenses')
                .where('date', '>=', fromDate)
                .where('date', '<=', toDate)
                .orderBy('date', 'desc')
                .get();
            data = expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (filterValue) {
                data = data.filter(e => e.category === filterValue);
            }
            renderFilteredExpensesTable(data);
            break;

        case 'production':
            const productionSnap = await db.collection('production_wages')
                .where('date', '>=', fromDate)
                .where('date', '<=', toDate)
                .orderBy('date', 'desc')
                .get();
            data = productionSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (filterValue) {
                data = data.filter(p => {
                    const wages = p.employee_wages || {};
                    return wages[filterValue] > 0;
                });
            }
            renderFilteredProductionTable(data);
            break;

        case 'expenses2':
            const expenses2Snap = await db.collection('expenses_2')
                .where('date', '>=', fromDate)
                .where('date', '<=', toDate)
                .orderBy('date', 'desc')
                .get();
            data = expenses2Snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (filterValue) {
                data = data.filter(e => e.category === filterValue);
            }
            renderFilteredExpenses2Table(data);
            break;

        case 'transportwages':
            const twSnap = await db.collection('transport_wages')
                .where('date', '>=', fromDate)
                .where('date', '<=', toDate)
                .orderBy('date', 'desc')
                .get();
            data = twSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (filterValue) {
                data = data.filter(t => {
                    const wages = t.employee_wages || {};
                    return wages[filterValue] > 0;
                });
            }
            renderFilteredTransportWagesTable(data);
            break;
    }
}

function applyClientSideFilter() {
    const filterValue = activeFilter.value;

    switch (currentModule) {
        case 'sales':
            if (filterValue) {
                const filtered = salesCache.filter(s => s.payment_status === filterValue);
                renderFilteredSalesTable(filtered);
            } else {
                renderSalesTable();
            }
            break;
        case 'lorry':
            if (filterValue) {
                const filtered = lorryCache.filter(l => l.transport_type === filterValue);
                renderFilteredLorryTable(filtered);
            } else {
                renderLorryTable();
            }
            break;
        case 'expenses':
            if (filterValue) {
                const filtered = expensesCache.filter(e => e.category === filterValue);
                renderFilteredExpensesTable(filtered);
            } else {
                renderExpensesTable();
            }
            break;
        case 'production':
            if (filterValue) {
                const filtered = productionCache.filter(p => {
                    const wages = p.employee_wages || {};
                    return wages[filterValue] > 0;
                });
                renderFilteredProductionTable(filtered);
            } else {
                renderProductionTable();
            }
            break;
        case 'expenses2':
            if (filterValue) {
                const filtered = expenses2Cache.filter(e => e.category === filterValue);
                renderFilteredExpenses2Table(filtered);
            } else {
                renderExpenses2Table();
            }
            break;
        case 'transportwages':
            if (filterValue) {
                const filtered = transportWagesCache.filter(t => {
                    const wages = t.employee_wages || {};
                    return wages[filterValue] > 0;
                });
                renderFilteredTransportWagesTable(filtered);
            } else {
                renderTransportWagesTable();
            }
            break;
    }
}

// Filtered render functions - same as regular renders but accept data parameter
function renderFilteredSalesTable(data) {
    const tbody = document.getElementById('sales-table-body');
    const empty = document.getElementById('sales-empty');

    if (!data.length) {
        tbody.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    tbody.innerHTML = data.map((s, i) => `
        <tr>
            <td class="py-2 px-3 text-center text-xs text-slate-400">${i + 1}</td>
            <td class="py-2 px-3 text-xs">${formatDate(s.date)}</td>
            <td class="py-2 px-3 text-xs">${s.place || '-'}</td>
            <td class="py-2 px-3 text-xs font-medium">${s.customer || '-'}</td>
            <td class="py-2 px-3 text-xs">${s.driver || '-'}</td>
            <td class="py-2 px-3 text-xs">${s.brick_type || '-'}</td>
            <td class="py-2 px-3 text-right font-mono text-xs">${(s.quantity || 0).toLocaleString()}</td>
            <td class="py-2 px-3 text-right font-mono text-xs">₹${(s.rate || 0).toLocaleString()}</td>
            <td class="py-2 px-3 text-right font-mono text-xs text-sky-600">₹${(s.transport_rate || 0).toLocaleString()}</td>
            <td class="py-2 px-3 text-right font-mono text-xs font-bold text-indigo-600">₹${(s.total || 0).toLocaleString()}</td>
            <td class="py-2 px-3 text-center"><span class="badge-${s.payment_status === 'Paid' ? 'paid' : 'pending'}">${s.payment_status || 'Pending'}</span></td>
            <td class="py-2 px-3 text-center w-[100px]">
                <div class="actions-cell">
                    <button onclick="editSales('${s.id}')" class="action-btn" title="Edit"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                    <button onclick="copySales('${s.id}')" class="action-btn" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button>
                    <button onclick="deleteSales('${s.id}')" class="action-btn delete" title="Delete"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                </div>
            </td>
        </tr>
    `).join('');
}

function renderFilteredLorryTable(data) {
    const tbody = document.getElementById('lorry-table-body');
    const empty = document.getElementById('lorry-empty');

    if (!data.length) {
        tbody.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    tbody.innerHTML = data.map((l, i) => {
        const isSelf = l.transport_type === 'self';
        return `
        <tr>
            <td class="py-2 px-3 text-center text-xs text-slate-400">${i + 1}</td>
            <td class="py-2 px-3 text-xs">${formatDate(l.date)}</td>
            <td class="py-2 px-3 text-xs font-medium">${l.product || '-'}</td>
            <td class="py-2 px-3 text-xs">${l.place || '-'}</td>
            <td class="py-2 px-3"><span class="badge-${isSelf ? 'self' : 'others'}">${isSelf ? 'Self' : 'Others'}</span></td>
            <td class="py-2 px-3 text-xs">${l.driver || '-'}</td>
            <td class="py-2 px-3 text-xs">${isSelf ? '-' : (l.to_whom || '-')}</td>
            <td class="py-2 px-3 text-right font-mono text-xs">${l.weight || '-'}</td>
            <td class="py-2 px-3 text-right font-mono text-xs">₹${(l.brought || 0).toLocaleString()}</td>
            <td class="py-2 px-3 text-right font-mono text-xs">${isSelf ? '-' : '₹' + (l.sold || 0).toLocaleString()}</td>
            <td class="py-2 px-3 text-right font-mono text-xs font-bold ${isSelf ? 'text-slate-400' : 'text-green-600'}">${isSelf ? '-' : '₹' + (l.profit || 0).toLocaleString()}</td>
            <td class="py-2 px-3 text-center w-[100px]">
                <div class="actions-cell">
                    <button onclick="editLorry('${l.id}')" class="action-btn" title="Edit"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                    <button onclick="copyLorry('${l.id}')" class="action-btn" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button>
                    <button onclick="deleteLorry('${l.id}')" class="action-btn delete" title="Delete"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                </div>
            </td>
        </tr>
    `;
    }).join('');
}

function renderFilteredExpensesTable(data) {
    const tbody = document.getElementById('expenses-table-body');
    const empty = document.getElementById('expenses-empty');

    if (!data.length) {
        tbody.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    tbody.innerHTML = data.map((e, i) => `
        <tr>
            <td class="py-2 px-3 text-center text-xs text-slate-400">${i + 1}</td>
            <td class="py-2 px-3 text-xs">${formatDate(e.date)}</td>
            <td class="py-2 px-3 text-xs"><span class="px-2 py-0.5 bg-violet-100 text-violet-700 rounded text-[10px] font-bold uppercase">${e.category || '-'}</span></td>
            <td class="py-2 px-3 text-xs font-medium">${e.name || '-'}</td>
            <td class="py-2 px-3 text-xs text-slate-500">${e.comment || '-'}</td>
            <td class="py-2 px-3 text-right font-mono text-xs font-bold text-red-600">₹${(e.amount || 0).toLocaleString()}</td>
            <td class="py-2 px-3 text-center w-[100px]">
                <div class="actions-cell">
                    <button onclick="editExpense('${e.id}')" class="action-btn" title="Edit"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                    <button onclick="copyExpense('${e.id}')" class="action-btn" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button>
                    <button onclick="deleteExpense('${e.id}')" class="action-btn delete" title="Delete"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                </div>
            </td>
        </tr>
    `).join('');
}

function renderFilteredProductionTable(data) {
    const tbody = document.getElementById('production-table-body');
    const empty = document.getElementById('production-empty');

    if (!data.length) {
        tbody.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    tbody.innerHTML = data.map((p, i) => {
        const production = p.production || {};
        const productionStr = Object.entries(production)
            .filter(([_, val]) => val > 0)
            .map(([type, val]) => `${type}: ${val}`)
            .join(', ') || '-';

        const wages = p.employee_wages || {};
        const wagesStr = Object.entries(wages)
            .filter(([_, val]) => val > 0)
            .map(([name, val]) => `<span class="text-teal-700 font-medium">${name}:</span> ₹${val.toLocaleString()}`)
            .join('<br>') || '-';

        return `
        <tr>
            <td class="py-2 px-3 text-center text-xs text-slate-400">${i + 1}</td>
            <td class="py-2 px-3 text-xs">${formatDate(p.date)}</td>
            <td class="py-2 px-3 text-xs font-medium text-slate-600">${productionStr}</td>
            <td class="py-2 px-3 text-xs">${wagesStr}</td>
            <td class="py-2 px-3 text-right font-mono text-xs">₹${(p.other_wages || 0).toLocaleString()}</td>
            <td class="py-2 px-3 text-right font-mono text-xs font-bold text-teal-600">₹${(p.total || 0).toLocaleString()}</td>
            <td class="py-2 px-3 text-center w-[100px]">
                <div class="actions-cell">
                    <button onclick="copyProduction('${p.id}')" class="action-btn" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button>
                    <button onclick="editProduction('${p.id}')" class="action-btn" title="Edit"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                    <button onclick="deleteProduction('${p.id}')" class="action-btn delete" title="Delete"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                </div>
            </td>
        </tr>
    `;
    }).join('');
}

function renderFilteredExpenses2Table(data) {
    const tbody = document.getElementById('expenses2-table-body');
    const empty = document.getElementById('expenses2-empty');

    if (!data.length) {
        tbody.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    tbody.innerHTML = data.map((e, i) => `
        <tr>
            <td class="py-2 px-3 text-center text-xs text-slate-400">${i + 1}</td>
            <td class="py-2 px-3 text-xs">${formatDate(e.date)}</td>
            <td class="py-2 px-3 text-xs">${e.category || '-'}</td>
            <td class="py-2 px-3 text-xs font-medium">${e.name || '-'}</td>
            <td class="py-2 px-3 text-xs text-gray-400">${e.comment || ''}</td>
            <td class="py-2 px-3 text-right font-mono text-xs font-bold text-purple-600">₹${(e.amount || 0).toLocaleString()}</td>
            <td class="py-2 px-3 text-center w-[100px]">
                <div class="actions-cell">
                    <button onclick="editExpenses2('${e.id}')" class="action-btn" title="Edit"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                    <button onclick="copyExpenses2('${e.id}')" class="action-btn" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button>
                    <button onclick="deleteExpenses2('${e.id}')" class="action-btn delete" title="Delete"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                </div>
            </td>
        </tr>
    `).join('');
}

function renderFilteredTransportWagesTable(data) {
    const tbody = document.getElementById('transportwages-table-body');
    const empty = document.getElementById('transportwages-empty');

    if (!data.length) {
        tbody.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    tbody.innerHTML = data.map((t, i) => {
        const wages = t.employee_wages || {};
        const wagesStr = Object.entries(wages)
            .filter(([_, val]) => val > 0)
            .map(([name, val]) => `<span class="text-orange-700 font-medium">${name}:</span> ₹${val.toLocaleString()}`)
            .join('<br>') || '-';

        return `
        <tr>
            <td class="py-2 px-3 text-center text-xs text-slate-400">${i + 1}</td>
            <td class="py-2 px-3 text-xs">${formatDate(t.date)}</td>
            <td class="py-2 px-3 text-xs">${wagesStr}</td>
            <td class="py-2 px-3 text-right font-mono text-xs font-bold text-orange-600">₹${(t.total || 0).toLocaleString()}</td>
            <td class="py-2 px-3 text-center w-[100px]">
                <div class="actions-cell">
                    <button onclick="editTransportWages('${t.id}')" class="action-btn" title="Edit"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                    <button onclick="deleteTransportWages('${t.id}')" class="action-btn delete" title="Delete"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                </div>
            </td>
        </tr>
    `;
    }).join('');
}

// ==========================================
// PRODUCTION WAGES MODULE
// ==========================================

let productionCache = [];
let productionEmployeesCache = [];
let productionBricksCache = [];

async function loadProductionEmployees() {
    productionEmployeesCache = await fetchCollection('production_employees');
}

async function loadProductionBricks() {
    productionBricksCache = await fetchCollection('production_bricks');
}

async function loadProductionWages() {
    const { start, end } = getMonthRange(currentMonth);
    const snapshot = await db.collection('production_wages')
        .where('date', '>=', start)
        .where('date', '<=', end)
        .orderBy('date', 'desc')
        .get();

    productionCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Sort by date DESC, then by created_at DESC (latest added first for same date)
    productionCache.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        const aTime = a.created_at?.toMillis?.() || 0;
        const bTime = b.created_at?.toMillis?.() || 0;
        return bTime - aTime;
    });

    renderProductionTable();
}

function renderProductionTable() {
    const tbody = document.getElementById('production-table-body');
    const empty = document.getElementById('production-empty');

    if (!productionCache.length) {
        tbody.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    tbody.innerHTML = productionCache.map((p, i) => {
        // Parse production data
        const production = p.production || {};
        const productionStr = Object.entries(production)
            .filter(([_, val]) => val > 0)
            .map(([type, val]) => `${type}: ${val}`)
            .join(', ') || '-';

        // Parse employee wages - filter out zero wages
        const wages = p.employee_wages || {};
        const wagesStr = Object.entries(wages)
            .filter(([_, val]) => val > 0)
            .map(([name, val]) => `<span class="text-teal-700 font-medium">${name}:</span> ₹${val.toLocaleString()}`)
            .join('<br>') || '-';

        return `
        <tr>
            <td class="py-2 px-3 text-center text-xs text-slate-400">${i + 1}</td>
            <td class="py-2 px-3 text-xs">${formatDate(p.date)}</td>
            <td class="py-2 px-3 text-xs font-medium text-slate-600">${productionStr}</td>
            <td class="py-2 px-3 text-xs">${wagesStr}</td>
            <td class="py-2 px-3 text-right font-mono text-xs">₹${(p.other_wages || 0).toLocaleString()}</td>
            <td class="py-2 px-3 text-right font-mono text-xs font-bold text-teal-600">₹${(p.total || 0).toLocaleString()}</td>
            <td class="py-2 px-3 text-center w-[100px]">
                <div class="actions-cell">
                    <button onclick="copyProduction('${p.id}')" class="action-btn" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button>
                    <button onclick="editProduction('${p.id}')" class="action-btn" title="Edit"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                    <button onclick="deleteProduction('${p.id}')" class="action-btn delete" title="Delete"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                </div>
            </td>
        </tr>
    `;
    }).join('');
}

window.showProductionModal = function (entry = null) {
    document.getElementById('production-modal-title').textContent = entry ? 'Edit Production Wages Entry' : 'Add Production Wages Entry';
    document.getElementById('production-edit-id').value = entry?.id || '';
    document.getElementById('production-date').value = entry?.date || new Date().toISOString().split('T')[0];
    document.getElementById('production-rate').value = entry?.rate || '';
    document.getElementById('production-other').value = entry?.other_wages || '';

    // Populate bricks inputs
    const bricksContainer = document.getElementById('production-bricks-container');
    const production = entry?.production || {};
    bricksContainer.innerHTML = productionBricksCache.map(b => `
        <div class="flex items-center justify-between bg-white p-2 rounded border">
            <span class="font-medium text-slate-700">${b.name}</span>
            <input type="number" id="prod-brick-${b.id}" data-brick='${b.name}' 
                class="ledger-input w-24 text-right font-mono" placeholder="0" 
                oninput="calcProductionTotal()">
        </div>
`).join('') || '<div class="text-gray-400 text-sm">No brick types defined. Add them first.</div>';

    // Set brick values programmatically
    productionBricksCache.forEach(b => {
        const input = document.getElementById(`prod - brick - ${b.id} `);
        if (input) {
            input.value = production[b.name] !== undefined ? production[b.name] : '';
        }
    });

    // Populate employees checkboxes
    const employeesContainer = document.getElementById('production-employees-container');
    const employeeWages = entry?.employee_wages || {};
    employeesContainer.innerHTML = productionEmployeesCache.map(e => `
        <label class="flex items-center gap-3 bg-white p-2 rounded border cursor-pointer hover:bg-slate-50">
        <input type="checkbox" id="prod-emp-${e.id}" data-employee='${e.name}'
            class="accent-teal-600 w-4 h-4" onchange="calcProductionTotal()">
            <span class="font-medium text-slate-700">${e.name}</span>
        </label>
`).join('') || '<div class="text-gray-400 text-sm">No employees defined. Add them first.</div>';

    // Set employee checkbox states programmatically
    productionEmployeesCache.forEach(e => {
        const checkbox = document.getElementById(`prod - emp - ${e.id} `);
        if (checkbox) {
            checkbox.checked = entry ? (employeeWages[e.name] > 0) : false;
        }
    });

    calcProductionTotal();
    document.getElementById('production-modal').classList.remove('hidden');
};

window.closeProductionModal = function () {
    document.getElementById('production-modal').classList.add('hidden');
    document.getElementById('production-form').reset();
};

window.calcProductionTotal = function () {
    // Get all punch values
    let totalPunches = 0;
    document.querySelectorAll('#production-bricks-container input[type="number"]').forEach(input => {
        totalPunches += parseFloat(input.value) || 0;
    });

    const rate = parseFloat(document.getElementById('production-rate').value) || 0;
    const otherWages = parseFloat(document.getElementById('production-other').value) || 0;

    // Count selected employees
    const selectedEmployees = document.querySelectorAll('#production-employees-container input[type="checkbox"]:checked');
    const employeeCount = selectedEmployees.length;

    const total = (totalPunches * rate) + otherWages;
    const perEmployee = employeeCount > 0 ? Math.round(total / employeeCount) : 0;

    document.getElementById('production-total-display').textContent = `₹${total.toLocaleString()} `;
    document.getElementById('production-per-employee').textContent = `₹${perEmployee.toLocaleString()} `;
};

async function saveProductionEntry(e) {
    e.preventDefault();

    const id = document.getElementById('production-edit-id').value;

    // Gather production data
    const production = {};
    document.querySelectorAll('#production-bricks-container input[type="number"]').forEach(input => {
        const brickName = input.dataset.brick;
        const value = parseInt(input.value) || 0;
        if (value > 0) production[brickName] = value;
    });

    const rate = parseFloat(document.getElementById('production-rate').value) || 0;
    const otherWages = parseFloat(document.getElementById('production-other').value) || 0;

    // Calculate total punches
    let totalPunches = Object.values(production).reduce((sum, v) => sum + v, 0);
    const total = (totalPunches * rate) + otherWages;

    // Get selected employees and calculate wages
    const selectedEmployees = document.querySelectorAll('#production-employees-container input[type="checkbox"]:checked');
    const employeeCount = selectedEmployees.length;
    const perEmployee = employeeCount > 0 ? Math.round(total / employeeCount) : 0;

    const employeeWages = {};
    selectedEmployees.forEach(checkbox => {
        employeeWages[checkbox.dataset.employee] = perEmployee;
    });

    const entry = {
        date: document.getElementById('production-date').value,
        production: production,
        rate: rate,
        other_wages: otherWages,
        employee_wages: employeeWages,
        total: total
    };

    if (id) {
        // Don't update created_at on edit to preserve sorting order
        await db.collection('production_wages').doc(id).update(entry);
    } else {
        entry.created_at = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('production_wages').add(entry);
    }

    showToast('Entry saved successfully', id ? 'warning' : 'success');
    closeProductionModal();
    loadProductionWages();
}

window.editProduction = function (id) {
    const entry = productionCache.find(p => p.id === id);
    if (entry) showProductionModal(entry);
};

window.copyProduction = function (id) {
    const entry = productionCache.find(p => p.id === id);
    if (entry) {
        const copy = { ...entry, id: null, date: new Date().toISOString().split('T')[0] };
        showProductionModal(copy);
    }
};

window.deleteProduction = async function (id) {
    if (!confirm('Are you sure you want to delete this production entry? This cannot be undone.')) return;
    await db.collection('production_wages').doc(id).delete();
    showToast('Entry deleted', 'error');
    loadProductionWages();
};

window.exportProduction = function () {
    if (!productionCache.length) return alert('No data to export');
    const ws = XLSX.utils.json_to_sheet(productionCache.map(p => {
        const production = p.production || {};
        const wages = p.employee_wages || {};
        return {
            Date: p.date,
            Production: Object.entries(production).map(([k, v]) => `${k}:${v} `).join(', '),
            Rate: p.rate,
            'Employee Wages': Object.entries(wages).filter(([_, v]) => v > 0).map(([k, v]) => `${k}:₹${v} `).join(', '),
            'Other Wages': p.other_wages,
            Total: p.total
        };
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Production Wages');
    XLSX.writeFile(wb, `ProductionWages_${currentMonth.toISOString().slice(0, 7)}.xlsx`);
};

// Manage Production Employees
window.showManageProductionEmployees = function () {
    openManageModal('production_employees', 'Manage Production Employees');
};

window.showManageProductionBricks = function () {
    openManageModal('production_bricks', 'Manage Brick Types');
};

// Production Analysis
window.openProductionAnalysis = function () {
    analysisType = 'production';
    document.getElementById('analysis-modal-header').className = 'modal-header bg-teal-600';
    document.getElementById('analysis-modal-title').textContent = 'Production Wages Analysis';
    setAnalysisDateRange();
    runAnalysis();
    document.getElementById('analysis-modal').classList.remove('hidden');
};

function renderProductionAnalysis(data) {
    const container = document.getElementById('analysis-content');

    const totalWages = data.reduce((sum, p) => sum + (p.total || 0), 0);
    const totalOther = data.reduce((sum, p) => sum + (p.other_wages || 0), 0);

    // Aggregate by employee
    const byEmployee = {};
    data.forEach(p => {
        const wages = p.employee_wages || {};
        Object.entries(wages).forEach(([name, amount]) => {
            if (amount > 0) {
                if (!byEmployee[name]) byEmployee[name] = 0;
                byEmployee[name] += amount;
            }
        });
    });

    // Aggregate by brick type
    const byBrick = {};
    data.forEach(p => {
        const production = p.production || {};
        Object.entries(production).forEach(([type, count]) => {
            if (count > 0) {
                if (!byBrick[type]) byBrick[type] = 0;
                byBrick[type] += count;
            }
        });
    });

    const sortedEmployees = Object.entries(byEmployee).sort((a, b) => b[1] - a[1]);
    const sortedBricks = Object.entries(byBrick).sort((a, b) => b[1] - a[1]);

    container.innerHTML = `
        <div data-print-section="summary-cards" class="grid grid-cols-2 gap-4">
            <div class="bg-white p-5 rounded-xl shadow-sm border">
                <div class="text-xs font-bold text-slate-500 uppercase">Total Wages Paid</div>
                <div class="text-2xl font-mono font-bold text-teal-600 mt-1">₹${totalWages.toLocaleString()}</div>
                <div class="text-xs text-slate-400">${data.length} entries</div>
            </div>
            <div class="bg-white p-5 rounded-xl shadow-sm border">
                <div class="text-xs font-bold text-slate-500 uppercase">Other Wages</div>
                <div class="text-2xl font-mono font-bold text-amber-600 mt-1">₹${totalOther.toLocaleString()}</div>
            </div>
        </div>
        
        <div data-print-section="by-employee" class="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div class="bg-teal-50 px-5 py-3 border-b"><h3 class="text-sm font-bold text-teal-800 uppercase">Wages by Employee</h3></div>
            <table class="w-full text-sm">
                <thead class="bg-gray-50 text-xs text-slate-500 uppercase">
                    <tr><th class="py-3 px-5 text-left">Employee</th><th class="py-3 px-5 text-right">Total Wages</th><th class="py-3 px-5 text-right">%</th></tr>
                </thead>
                <tbody class="divide-y">
                    ${sortedEmployees.map(([name, amount]) => `
                        <tr><td class="py-3 px-5 font-medium">${name}</td><td class="py-3 px-5 text-right font-mono font-bold text-teal-600">₹${amount.toLocaleString()}</td><td class="py-3 px-5 text-right font-mono text-slate-500">${totalWages ? ((amount / totalWages) * 100).toFixed(1) : 0}%</td></tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        
        <div data-print-section="by-brick-type" class="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div class="bg-slate-100 px-5 py-3 border-b"><h3 class="text-sm font-bold text-slate-700 uppercase">Production by Brick Type</h3></div>
            <table class="w-full text-sm">
                <thead class="bg-gray-50 text-xs text-slate-500 uppercase">
                    <tr><th class="py-3 px-5 text-left">Brick Type</th><th class="py-3 px-5 text-right">Total Punches</th></tr>
                </thead>
                <tbody class="divide-y">
                    ${sortedBricks.map(([type, count]) => `
                        <tr><td class="py-3 px-5 font-medium">${type}</td><td class="py-3 px-5 text-right font-mono font-bold">${count.toLocaleString()}</td></tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
`;
}

// ==========================================
// UTILITIES
// ==========================================

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}


// EXPENSES 2 MODULE
// ==========================================

async function loadCategories2() {
    categories2Cache = await fetchCollection('expense_categories_2');
    populateSelect('expenses2-category', categories2Cache);
    // Also populate filter dropdown
    const filterSelect = document.getElementById('expenses2-filter-category');
    if (filterSelect) {
        filterSelect.innerHTML = '';
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = 'All Categories';
        filterSelect.appendChild(defaultOpt);
        categories2Cache.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.name;
            opt.textContent = c.name;
            filterSelect.appendChild(opt);
        });
    }
}

let expenses2FilterCategory = '';

window.applyExpenses2Filter = function () {
    expenses2FilterCategory = document.getElementById('expenses2-filter-category').value;
    renderExpenses2Table();
};

async function loadExpenses2() {
    const { start, end } = getMonthRange(currentMonth);
    const snapshot = await db.collection('expenses_2')
        .where('date', '>=', start)
        .where('date', '<=', end)
        .orderBy('date', 'desc')
        .get();

    expenses2Cache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Sort by date DESC, then by created_at DESC (latest added first for same date)
    expenses2Cache.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        const aTime = a.created_at?.toMillis?.() || 0;
        const bTime = b.created_at?.toMillis?.() || 0;
        return bTime - aTime;
    });

    renderExpenses2Table();
}

function renderExpenses2Table() {
    const tbody = document.getElementById('expenses2-table-body');
    const empty = document.getElementById('expenses2-empty');

    if (!expenses2Cache.length) {
        tbody.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    tbody.innerHTML = expenses2Cache.map((e, i) => `
        <tr>
            <td class="py-2 px-3 text-center text-xs text-slate-400">${i + 1}</td>
            <td class="py-2 px-3 text-xs">${formatDate(e.date)}</td>
            <td class="py-2 px-3 text-xs">${e.category || '-'}</td>
            <td class="py-2 px-3 text-xs font-medium">${e.name || '-'}</td>
            <td class="py-2 px-3 text-xs text-gray-400">${e.comment || ''}</td>
            <td class="py-2 px-3 text-right font-mono text-xs font-bold text-purple-600">₹${(e.amount || 0).toLocaleString()}</td>
            <td class="py-2 px-3 text-center w-[100px]">
                <div class="actions-cell">
                    <button onclick="editExpenses2('${e.id}')" class="action-btn" title="Edit"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                    <button onclick="copyExpenses2('${e.id}')" class="action-btn" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button>
                    <button onclick="deleteExpenses2('${e.id}')" class="action-btn delete" title="Delete"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                </div>
            </td>
        </tr>
    `).join('');
}

window.showExpenses2Modal = function (entry = null) {
    document.getElementById('expenses2-modal-title').textContent = entry ? 'Edit Expense (2)' : 'Add Expense (2)';
    document.getElementById('expenses2-edit-id').value = entry?.id || '';
    document.getElementById('expenses2-date').value = entry?.date || new Date().toISOString().split('T')[0];
    document.getElementById('expenses2-category').value = entry?.category || '';
    document.getElementById('expenses2-name').value = entry?.name || '';
    document.getElementById('expenses2-comment').value = entry?.comment || '';
    document.getElementById('expenses2-amount').value = entry?.amount || '';
    document.getElementById('expenses2-modal').classList.remove('hidden');
};

window.closeExpenses2Modal = function () {
    document.getElementById('expenses2-modal').classList.add('hidden');
    document.getElementById('expenses2-form').reset();
};

document.getElementById('expenses2-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('expenses2-edit-id').value;
    const entry = {
        date: document.getElementById('expenses2-date').value,
        category: document.getElementById('expenses2-category').value,
        name: document.getElementById('expenses2-name').value,
        comment: document.getElementById('expenses2-comment').value,
        amount: parseFloat(document.getElementById('expenses2-amount').value) || 0
    };

    if (id) {
        // Don't update created_at on edit to preserve sorting order
        await db.collection('expenses_2').doc(id).update(entry);
    } else {
        entry.created_at = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('expenses_2').add(entry);
    }

    showToast('Expense saved', id ? 'warning' : 'success');
    closeExpenses2Modal();
    loadExpenses2();
});

window.editExpenses2 = function (id) {
    const entry = expenses2Cache.find(e => e.id === id);
    if (entry) showExpenses2Modal(entry);
};

window.deleteExpenses2 = async function (id) {
    if (!confirm('Are you sure you want to delete this expense? This cannot be undone.')) return;
    await db.collection('expenses_2').doc(id).delete();
    showToast('Expense deleted', 'error');
    loadExpenses2();
};

window.showManageCategories2 = function () { openManageModal('categories2', 'Manage Categories (2)'); };

// ==========================================
// TRANSPORT WAGES MODULE
// ==========================================

async function loadTransportEmployees() {
    transportEmployeesCache = await fetchCollection('transport_employees');
}

async function loadTransportWages() {
    const { start, end } = getMonthRange(currentMonth);
    const snapshot = await db.collection('transport_wages')
        .where('date', '>=', start)
        .where('date', '<=', end)
        .orderBy('date', 'desc')
        .get();

    transportWagesCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Sort by date DESC, then by created_at DESC (latest added first for same date)
    transportWagesCache.sort((a, b) => {
        // First sort by date descending
        if (a.date !== b.date) {
            return b.date.localeCompare(a.date);
        }
        // Then by created_at descending (latest added first)
        const aTime = a.created_at?.toMillis?.() || 0;
        const bTime = b.created_at?.toMillis?.() || 0;
        return bTime - aTime;
    });

    renderTransportWagesTable();
}

function renderTransportWagesTable() {
    const tbody = document.getElementById('transportwages-table-body');
    const empty = document.getElementById('transportwages-empty');

    if (!transportWagesCache.length) {
        tbody.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    tbody.innerHTML = transportWagesCache.map((t, i) => {
        const wages = t.employee_wages || {};
        const wagesStr = Object.entries(wages)
            .filter(([_, val]) => val > 0)
            .map(([name, val]) => `<span class="text-orange-700 font-medium">${name}:</span> ₹${val.toLocaleString()}`)
            .join('<br>') || '-';

        return `
        <tr>
            <td class="py-2 px-3 text-center text-xs text-slate-400">${i + 1}</td>
            <td class="py-2 px-3 text-xs">${formatDate(t.date)}</td>
            <td class="py-2 px-3 text-xs">${wagesStr}</td>
            <td class="py-2 px-3 text-right font-mono text-xs font-bold text-orange-600">₹${(t.total || 0).toLocaleString()}</td>
            <td class="py-2 px-3 text-center w-[100px]">
                <div class="actions-cell">
                    <button onclick="copyTransportWages('${t.id}')" class="action-btn" title="Copy"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button>
                    <button onclick="editTransportWages('${t.id}')" class="action-btn" title="Edit"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg></button>
                    <button onclick="deleteTransportWages('${t.id}')" class="action-btn delete" title="Delete"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                </div>
            </td>
        </tr>
    `;
    }).join('');
}

window.showTransportWagesModal = function (entry = null) {
    document.getElementById('transportwages-modal-title').textContent = entry ? 'Edit Transport Wages Entry' : 'Add Transport Wages Entry';
    document.getElementById('transportwages-edit-id').value = entry?.id || '';
    document.getElementById('transportwages-date').value = entry?.date || new Date().toISOString().split('T')[0];

    // Populate employee wage inputs
    const container = document.getElementById('transportwages-employees-container');
    const employeeWages = entry?.employee_wages || {};
    container.innerHTML = transportEmployeesCache.map(e => `
        <div class="flex items-center justify-between bg-white p-2 rounded border">
            <span class="font-medium text-slate-700">${e.name}</span>
            <input type="number" id="tw-emp-${e.id}" data-employee="${e.name}" 
                class="ledger-input w-24 text-right font-mono" placeholder="0" value="${employeeWages[e.name] || ''}"
                oninput="calcTransportWagesTotal()">
        </div>
    `).join('') || '<div class="text-gray-400 text-sm">No employees defined. Add them first.</div>';

    calcTransportWagesTotal();
    document.getElementById('transportwages-modal').classList.remove('hidden');
};

window.closeTransportWagesModal = function () {
    document.getElementById('transportwages-modal').classList.add('hidden');
    document.getElementById('transportwages-form').reset();
};

window.calcTransportWagesTotal = function () {
    let total = 0;
    document.querySelectorAll('#transportwages-employees-container input[type="number"]').forEach(input => {
        total += parseFloat(input.value) || 0;
    });
    document.getElementById('transportwages-total-display').textContent = `₹${total.toLocaleString()} `;
};

document.getElementById('transportwages-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('transportwages-edit-id').value;

    // Gather employee wages
    const employeeWages = {};
    let total = 0;
    document.querySelectorAll('#transportwages-employees-container input[type="number"]').forEach(input => {
        const empName = input.dataset.employee;
        const value = parseFloat(input.value) || 0;
        if (value > 0) {
            employeeWages[empName] = value;
            total += value;
        }
    });

    const entry = {
        date: document.getElementById('transportwages-date').value,
        employee_wages: employeeWages,
        total: total
    };

    if (id) {
        // Don't update created_at on edit to preserve sorting order
        await db.collection('transport_wages').doc(id).update(entry);
    } else {
        // Only set created_at on new entries
        entry.created_at = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('transport_wages').add(entry);
    }

    showToast('Entry saved', id ? 'warning' : 'success');
    closeTransportWagesModal();
    loadTransportWages();
});

window.editTransportWages = function (id) {
    const entry = transportWagesCache.find(t => t.id === id);
    if (entry) showTransportWagesModal(entry);
};

window.deleteTransportWages = async function (id) {
    if (!confirm('Are you sure you want to delete this transport wage entry? This cannot be undone.')) return;
    await db.collection('transport_wages').doc(id).delete();
    showToast('Entry deleted', 'error');
    loadTransportWages();
};

window.showManageTransportEmployees = function () { openManageModal('transport_employees', 'Manage Transport Employees'); };

window.copyExpenses2 = function (id) {
    const entry = expenses2Cache.find(e => e.id === id);
    if (entry) {
        const copy = { ...entry, id: null, date: new Date().toISOString().split('T')[0] };
        showExpenses2Modal(copy);
    }
};

window.copyTransportWages = function (id) {
    const entry = transportWagesCache.find(t => t.id === id);
    if (entry) {
        const copy = { ...entry, id: null, date: new Date().toISOString().split('T')[0] };
        showTransportWagesModal(copy);
    }
};

// ==========================================
// DASHBOARD 2
// ==========================================

async function loadDashboard2() {
    const { start, end } = getMonthRange(currentMonth);

    const fetchByDate = async (collection) => {
        const snapshot = await db.collection(collection)
            .where('date', '>=', start)
            .where('date', '<=', end)
            .get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    };

    const [sales, expenses2, transportWages] = await Promise.all([
        fetchByDate('sales'),
        fetchByDate('expenses_2'),
        fetchByDate('transport_wages')
    ]);

    // Transport Amount = transport_rate × quantity for each sale
    const transportRateTotal = sales.reduce((sum, s) => sum + ((s.transport_rate || 0) * (s.quantity || 0)), 0);

    // Paid vs Unpaid Transport
    const paidTransport = sales.filter(s => s.payment_status === 'Paid')
        .reduce((sum, s) => sum + ((s.transport_rate || 0) * (s.quantity || 0)), 0);
    const unpaidTransport = transportRateTotal - paidTransport;

    // Expenses 2 total
    const expenses2Total = expenses2.reduce((sum, e) => sum + (e.amount || 0), 0);

    // Transport Wages total
    const transportWagesTotal = transportWages.reduce((sum, t) => sum + (t.total || 0), 0);

    // Driver Salary (auto) = sum(sales.quantity * driver_factor[brick_type])
    const driverSalaryTotal = calculateDriverSalaryForSales(sales);

    // Total Outgoing
    const totalOutgoing = expenses2Total + transportWagesTotal + driverSalaryTotal;

    // Net Profit = Paid Transport - Total Outgoing (realized profit)
    const realizedNet = paidTransport - totalOutgoing;

    // Total Net = Total Transport - Total Outgoing (projected profit incl. unpaid)
    const totalNet = transportRateTotal - totalOutgoing;

    // Update UI - Top Cards (same structure as Dashboard 1)
    document.getElementById('d2-realized-profit').textContent = `₹${realizedNet.toLocaleString()}`;
    document.getElementById('d2-unpaid-amount').textContent = `₹${unpaidTransport.toLocaleString()}`;
    document.getElementById('d2-total-profit').textContent = `₹${totalNet.toLocaleString()}`;

    // Update Detail Cards - Row 1: Transport Totals
    document.getElementById('d2-transport-rate-detail').textContent = `₹${transportRateTotal.toLocaleString()}`;
    document.getElementById('d2-paid-transport').textContent = `₹${paidTransport.toLocaleString()}`;
    document.getElementById('d2-unpaid-transport').textContent = `₹${unpaidTransport.toLocaleString()}`;

    // Row 2: Expenses
    document.getElementById('d2-expenses2').textContent = `₹${expenses2Total.toLocaleString()}`;
    document.getElementById('d2-transport-wages').textContent = `₹${transportWagesTotal.toLocaleString()}`;

    // Row 2b: Driver Salary
    document.getElementById('d2-driver-salary').textContent = `₹${driverSalaryTotal.toLocaleString()}`;

    // Expenses 2 by Category (Transport Wages & Driver Salary are NOT included — separate line items)
    const byCategory = {};
    expenses2.forEach(e => {
        const cat = e.category || 'Uncategorized';
        if (!byCategory[cat]) byCategory[cat] = 0;
        byCategory[cat] += e.amount || 0;
    });
    const sortedCategories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    document.getElementById('d2-expenses2-by-category').innerHTML = sortedCategories.length ? `
        <table class="w-full text-sm">
            <tbody class="divide-y">
                ${sortedCategories.map(([cat, amount]) => `
                    <tr>
                        <td class="py-2 font-medium">${cat}</td>
                        <td class="py-2 text-right font-mono font-bold text-purple-600">₹${amount.toLocaleString()}</td>
                        <td class="py-2 text-right font-mono text-xs text-slate-400 w-16">${expenses2Total ? ((amount / expenses2Total) * 100).toFixed(0) : 0}%</td>
                    </tr>
                `).join('')}
                <tr class="bg-slate-50 font-bold">
                    <td class="py-2">TOTAL</td>
                    <td class="py-2 text-right font-mono text-slate-800">₹${expenses2Total.toLocaleString()}</td>
                    <td class="py-2 text-right font-mono text-xs text-slate-400 w-16">100%</td>
                </tr>
            </tbody>
        </table>
        ` : '<div class="text-gray-400 text-sm text-center py-4">No expenses</div>';

}

// ==========================================
// EXPENSES 2 ANALYSIS
// ==========================================

window.openExpenses2Analysis = function () {
    analysisType = 'expenses2';
    document.getElementById('analysis-modal-header').className = 'modal-header bg-purple-600';
    document.getElementById('analysis-modal-title').textContent = 'Expenses 2 Analysis';
    setAnalysisDateRange();
    runAnalysis();
    document.getElementById('analysis-modal').classList.remove('hidden');
};

function renderExpenses2Analysis(data) {
    const container = document.getElementById('analysis-content');
    const totalAmount = data.reduce((sum, e) => sum + (e.amount || 0), 0);

    // By Category
    const byCategory = {};
    data.forEach(e => {
        const cat = e.category || 'Uncategorized';
        if (!byCategory[cat]) byCategory[cat] = 0;
        byCategory[cat] += e.amount || 0;
    });

    const sortedCategories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

    container.innerHTML = `
        <div data-print-section="summary-cards" class="grid grid-cols-2 gap-4">
            <div class="bg-white p-5 rounded-xl shadow-sm border">
                <div class="text-xs font-bold text-slate-500 uppercase">Total Expenses 2</div>
                <div class="text-2xl font-mono font-bold text-purple-600 mt-1">₹${totalAmount.toLocaleString()}</div>
                <div class="text-xs text-slate-400">${data.length} entries</div>
            </div>
        </div>

        <div data-print-section="by-category" class="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div class="bg-purple-50 px-5 py-3 border-b"><h3 class="text-sm font-bold text-purple-800 uppercase">By Category</h3></div>
            <table class="w-full text-sm">
                <thead class="bg-gray-50 text-xs text-slate-500 uppercase">
                    <tr><th class="py-3 px-5 text-left">Category</th><th class="py-3 px-5 text-right">Amount</th><th class="py-3 px-5 text-right">%</th></tr>
                </thead>
                <tbody class="divide-y">
                    ${sortedCategories.map(([cat, amount]) => `
                        <tr><td class="py-3 px-5 font-medium">${cat}</td><td class="py-3 px-5 text-right font-mono font-bold text-purple-600">₹${amount.toLocaleString()}</td><td class="py-3 px-5 text-right font-mono text-slate-500">${totalAmount ? ((amount / totalAmount) * 100).toFixed(1) : 0}%</td></tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ==========================================
// TRANSPORT WAGES ANALYSIS
// ==========================================

window.openTransportWagesAnalysis = function () {
    analysisType = 'transportwages';
    document.getElementById('analysis-modal-header').className = 'modal-header bg-orange-600';
    document.getElementById('analysis-modal-title').textContent = 'Transport Wages Analysis';
    setAnalysisDateRange();
    runAnalysis();
    document.getElementById('analysis-modal').classList.remove('hidden');
};

function renderTransportWagesAnalysis(data) {
    const container = document.getElementById('analysis-content');
    const totalWages = data.reduce((sum, t) => sum + (t.total || 0), 0);

    // By Employee
    const byEmployee = {};
    data.forEach(t => {
        const wages = t.employee_wages || {};
        Object.entries(wages).forEach(([name, amount]) => {
            if (!byEmployee[name]) byEmployee[name] = 0;
            byEmployee[name] += amount;
        });
    });

    const sortedEmployees = Object.entries(byEmployee).sort((a, b) => b[1] - a[1]);

    container.innerHTML = `
        <div data-print-section="summary-cards" class="grid grid-cols-2 gap-4">
            <div class="bg-white p-5 rounded-xl shadow-sm border">
                <div class="text-xs font-bold text-slate-500 uppercase">Total Transport Wages</div>
                <div class="text-2xl font-mono font-bold text-orange-600 mt-1">₹${totalWages.toLocaleString()}</div>
                <div class="text-xs text-slate-400">${data.length} entries</div>
            </div>
        </div>

        <div data-print-section="by-employee" class="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div class="bg-orange-50 px-5 py-3 border-b"><h3 class="text-sm font-bold text-orange-800 uppercase">Wages by Employee</h3></div>
            <table class="w-full text-sm">
                <thead class="bg-gray-50 text-xs text-slate-500 uppercase">
                    <tr><th class="py-3 px-5 text-left">Employee</th><th class="py-3 px-5 text-right">Total Wages</th><th class="py-3 px-5 text-right">%</th></tr>
                </thead>
                <tbody class="divide-y">
                    ${sortedEmployees.map(([name, amount]) => `
                        <tr><td class="py-3 px-5 font-medium">${name}</td><td class="py-3 px-5 text-right font-mono font-bold text-orange-600">₹${amount.toLocaleString()}</td><td class="py-3 px-5 text-right font-mono text-slate-500">${totalWages ? ((amount / totalWages) * 100).toFixed(1) : 0}%</td></tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}
