const API_BASE = '/api';
let accounts = [];
let cachedStatuses = {};  // Cache last known good status per accountId
let refreshInterval = 30000;
let refreshTimer = null;
let isAutoRefresh = true;
let currentTheme = 'gradient';
let secondsSinceRefresh = 0;
let refreshCounterTimer = null;

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  if (theme === 'system') {
    theme = getSystemTheme();
  }
  if (theme === 'gradient') {
    document.body.removeAttribute('data-theme');
  } else {
    document.body.setAttribute('data-theme', theme);
  }
}

const i18n = {
  'en': {
    title: 'MiniMax Dashboard',
    subtitle: 'Token-Plan Monitor',
    manual: 'Manual',
    addAccount: '+ Add Account',
    refresh: 'Refresh',
    noAccounts: 'No accounts configured',
    noAccountsHint: 'Click "Add Account" to add your first MiniMax account',
    addNewAccount: 'Add New Account',
    accountName: 'Account Name',
    apiToken: 'API Token',
    groupId: 'Group ID',
    add: 'Add',
    cancel: 'Cancel',
    remaining: 'Remaining',
    resetIn: '5 hour reset in',
    weekly: 'Weekly',
    expires: 'Expires',
    usage: 'Usage',
    default: 'Default',
    deleteConfirm: 'Delete this account?',
    lastUpdated: 'Last updated'
  }
};

function t(key) {
  return i18n['en']?.[key] || key;
}

function applyI18n() {
  // Update static text elements
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });

  // Update placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });

  // Update document title
  document.title = t('title');
}

async function fetchAccounts() {
  const res = await fetch(`${API_BASE}/accounts`);
  accounts = await res.json();
}

async function fetchStatus(accountId) {
  const res = await fetch(`${API_BASE}/status/${accountId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function fetchSettings() {
  try {
    const res = await fetch(`${API_BASE}/settings`);
    const settings = await res.json();
    const interval = settings.refreshInterval || 30;
    refreshInterval = interval * 1000;
    isAutoRefresh = interval > 0;
    currentTheme = settings.theme || 'gradient';

    const refreshSelect = document.getElementById('refreshIntervalSelect');
    if (refreshSelect) refreshSelect.value = interval.toString();

    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) themeSelect.value = currentTheme;

    applyTheme(currentTheme);
    applyI18n();
  } catch (e) {
    console.error('Failed to fetch settings:', e);
  }
}

async function saveSettings(settings) {
  try {
    await fetch(`${API_BASE}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

async function refreshAllAccounts() {
  resetRefreshCounter();
  const grid = document.getElementById('accountsGrid');
  const emptyState = document.getElementById('emptyState');

  if (accounts.length === 0) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    // Update empty state text directly
    emptyState.querySelector('p').textContent = t('noAccounts');
    const hint = emptyState.querySelector('.hint');
    if (hint) hint.textContent = t('noAccountsHint');
    return;
  }

  emptyState.classList.add('hidden');

  const results = await Promise.allSettled(
    accounts.map(account => fetchStatus(account.id).then(s => ({ account, status: s, error: null })).catch(e => ({ account, status: null, error: e.message })))
  );

  // Only clear grid AFTER we have new results to avoid brief blank flash
  grid.innerHTML = '';
  for (const result of results) {
    if (result.value.error) {
      // Show cached data with error indicator, don't overwrite with blank
      const cached = cachedStatuses[result.value.account.id];
      if (cached) {
        renderAccountCard(result.value.account, cached, true, result.value.error);
      } else {
        renderErrorCard(result.value.account, result.value.error);
      }
    } else {
      cachedStatuses[result.value.account.id] = result.value.status;
      renderAccountCard(result.value.account, result.value.status, false, null);
    }
  }

}

// Smooth color gradient for usage bars:
// 0-50%: solid green (held)
// 50-75%: green → yellow
// 75-100%: yellow → red
// At 50% the bar is still fully green; the gradient starts after that.
function getUsageColor(pct) {
  const t = Math.max(0, Math.min(100, pct)) / 100;
  const stops = [
    { p: 0,    h: 120, s: 38,  l: 49 }, // #4caf50 green
    { p: 0.5,  h: 120, s: 38,  l: 49 }, // green (held through 50%)
    { p: 0.75, h:  36, s: 100, l: 50 }, // #ff9800 yellow
    { p: 1,    h:   4, s: 89,  l: 58 }  // #f44336 red
  ];
  let i = 0;
  while (i < stops.length - 1 && stops[i + 1].p < t) i++;
  const a = stops[i];
  const b = stops[Math.min(i + 1, stops.length - 1)];
  const lt = a.p === b.p ? 0 : (t - a.p) / (b.p - a.p);
  const h = a.h + lt * (b.h - a.h);
  const s = a.s + lt * (b.s - a.s);
  const l = a.l + lt * (b.l - a.l);
  return `hsl(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`;
}

// Reset bars are always blue, regardless of elapsed time.
const RESET_BAR_COLOR = '#2196f3';

function renderAccountCard(account, status, isStale = false, errorMessage = null) {
  const grid = document.getElementById('accountsGrid');
  const card = document.createElement('div');
  card.className = 'account-card plan-hero' + (isStale ? ' stale' : '');

  const pct = status.usage.percentage;
  const usageColor = getUsageColor(pct);

  const weeklyPct = status.weekly?.percentage ?? 0;
  const weeklyUsageColor = getUsageColor(weeklyPct);

  // 5-hour reset countdown: percentage of time ELAPSED (filling bar)
  const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
  const resetRemainingMs = status.remaining?.ms || 0;
  const resetElapsedPct = Math.min(100, Math.max(0, ((FIVE_HOURS_MS - resetRemainingMs) / FIVE_HOURS_MS) * 100));

  // Weekly reset countdown: percentage of time ELAPSED (filling bar)
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const weeklyRemainingMs = status.weekly?.ms || 0;
  const weeklyResetElapsedPct = Math.min(100, Math.max(0, ((WEEK_MS - weeklyRemainingMs) / WEEK_MS) * 100));

  card.innerHTML = `
    ${isStale && errorMessage ? `<div class="error-banner">Failed: ${escapeHtml(errorMessage)} (showing cached data)</div>` : ''}
    <div class="card-body">
      <!-- 5-Hour Usage Meter -->
      <div class="progress-section">
        <div class="progress-header">
          <span class="progress-label">5 hour usage</span>
          <span class="progress-value">${pct}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${pct}%; background: ${usageColor}"></div>
        </div>
        <div class="progress-detail">${status.usage.hasCounts ? `${status.usage.remaining} / ${status.usage.total}` : ''}</div>
      </div>

      <!-- 5-Hour Reset Countdown Meter -->
      <div class="progress-section">
        <div class="progress-header">
          <span class="progress-label">${t('resetIn')}</span>
          <span class="progress-value">${status.remaining.text}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${resetElapsedPct}%; background: ${RESET_BAR_COLOR}"></div>
        </div>
        <div class="progress-detail">${Math.round(100 - resetElapsedPct)}% until reset</div>
      </div>

      <hr class="section-divider">

      <!-- Weekly Usage Meter -->
      ${weeklyPct !== null ? `
      <div class="progress-section">
        <div class="progress-header">
          <span class="progress-label">Weekly usage</span>
          <span class="progress-value">${weeklyPct}%</span>
        </div>
        <div class="progress-bar-10">
          <div class="progress-fill" style="width: ${weeklyPct}%; background: ${weeklyUsageColor}"></div>
          <div class="dividers">
            <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
          </div>
          <div class="number-labels">
            <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>10</span>
          </div>
        </div>
        <div class="progress-detail">${status.weekly.hasCounts ? `${status.weekly.remaining} / ${status.weekly.total}` : ''}</div>
      </div>

      <!-- Weekly Reset Countdown Meter -->
      <div class="progress-section">
        <div class="progress-header">
          <span class="progress-label">Weekly reset in</span>
          <span class="progress-value">${status.weekly.text}</span>
        </div>
        <div class="progress-bar-7day">
          <div class="progress-fill" style="width: ${weeklyResetElapsedPct}%; background: ${RESET_BAR_COLOR}"></div>
          <div class="dividers">
            <span></span><span></span><span></span><span></span><span></span><span></span>
          </div>
          <div class="day-labels">
            <span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span>
          </div>
        </div>
        <div class="progress-detail">${Math.round(100 - weeklyResetElapsedPct)}% until reset</div>
      </div>
      ` : ''}
    </div>
  `;
  grid.appendChild(card);
}

function renderErrorCard(account, error) {
  const grid = document.getElementById('accountsGrid');
  const card = document.createElement('div');
  card.className = 'account-card error';
  card.innerHTML = `
    <div class="card-header">
      <h3>${escapeHtml(account.name)}</h3>
      <button class="btn-delete" onclick="deleteAccount('${account.id}')" title="Delete">&times;</button>
    </div>
    <div class="error-message">
      <p>Failed: ${escapeHtml(error)}</p>
    </div>
  `;
  grid.appendChild(card);
}

async function deleteAccount(id) {
  if (!confirm(t('deleteConfirm'))) return;
  await fetch(`${API_BASE}/accounts/${id}`, { method: 'DELETE' });
  await loadDashboard();
}

function openModal() {
  document.getElementById('addModal').classList.remove('hidden');
  document.getElementById('accountName').focus();
}

function closeModal() {
  document.getElementById('addModal').classList.add('hidden');
  document.getElementById('addAccountForm').reset();
}

async function handleAddAccount(e) {
  e.preventDefault();
  const data = {
    name: document.getElementById('accountName').value.trim(),
    token: document.getElementById('accountToken').value.trim(),
    groupId: document.getElementById('accountGroupId').value.trim() || null
  };

  const res = await fetch(`${API_BASE}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Failed to add account');
  }

  closeModal();
  await loadDashboard();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function loadDashboard() {
  await fetchSettings();
  await fetchAccounts();
  await refreshAllAccounts();
  startRefreshCounter();
  setupAutoRefresh();
}

function setupAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  if (isAutoRefresh && refreshInterval > 0) {
    refreshTimer = setInterval(refreshAllAccounts, refreshInterval);
  }
}

function startRefreshCounter() {
  if (refreshCounterTimer) {
    clearInterval(refreshCounterTimer);
  }
  secondsSinceRefresh = 0;
  updateRefreshTimerDisplay();
  refreshCounterTimer = setInterval(() => {
    secondsSinceRefresh++;
    updateRefreshTimerDisplay();
  }, 1000);
}

function resetRefreshCounter() {
  secondsSinceRefresh = 0;
  updateRefreshTimerDisplay();
}

function formatTimer(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updateRefreshTimerDisplay() {
  const indicator = document.getElementById('refreshTimerIndicator');
  if (indicator) {
    indicator.textContent = formatTimer(secondsSinceRefresh);
  }
}

// Init
document.getElementById('addAccountBtn').addEventListener('click', openModal);
document.getElementById('refreshBtn').addEventListener('click', () => {
  refreshAllAccounts();
  startRefreshCounter();
});
document.getElementById('addAccountForm').addEventListener('submit', handleAddAccount);
document.getElementById('refreshIntervalSelect').addEventListener('change', async (e) => {
  const interval = parseInt(e.target.value, 10);
  refreshInterval = interval * 1000;
  isAutoRefresh = interval > 0;
  await saveSettings({ refreshInterval: interval, theme: currentTheme });
  setupAutoRefresh();
});
document.getElementById('themeSelect').addEventListener('change', async (e) => {
  currentTheme = e.target.value;
  applyTheme(currentTheme);
  await saveSettings({ refreshInterval: parseInt(document.getElementById('refreshIntervalSelect').value, 10), theme: currentTheme });
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
document.getElementById('addModal').addEventListener('click', e => { if (e.target.id === 'addModal') closeModal(); });

loadDashboard();
