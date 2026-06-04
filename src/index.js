#!/usr/bin/env node

const http = require('http');
const https = require('https');
const express = require('express');
const path = require('path');
const ConfigManager = require('./config/config-manager');
const MinimaxAPI = require('./api/minimax');
const { accountRoutes } = require('./routes/accounts');

const app = express();
const PORT = 7777;

// Initialize config manager
const configManager = new ConfigManager();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/accounts', accountRoutes(configManager));

app.get('/api/settings', (req, res) => {
  res.json(configManager.config.settings);
});

app.put('/api/settings', (req, res) => {
  configManager.updateSettings(req.body);
  res.json({ message: 'Settings updated successfully' });
});

app.get('/api/status/:accountId', async (req, res) => {
  const account = configManager.getAccount(req.params.accountId);
  if (!account) {
    return res.status(404).json({ error: 'Account not found' });
  }

  try {
    const api = new MinimaxAPI(account.token, account.groupId);
    const lang = configManager.config.settings?.language || 'zh-CN';
    const usageData = await api.getUsageStatus();
    const parsedData = api.parseUsageData(usageData, lang);
    const models = api.parseAllModels(usageData);
    res.json({ ...parsedData, models });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    accounts: configManager.getAccounts().length,
    timestamp: new Date().toISOString()
  });
});

// Start server
const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║     MiniMax Token-Plan Dashboard                      ║
║     Running at http://localhost:${PORT}                    ║
╚═══════════════════════════════════════════════════════╝
  `);
});

const dnsKeepalive = setupDnsKeepalive();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  clearInterval(dnsKeepalive);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// DNS keepalive: periodically HEAD-ping the API host so the OS DNS cache
// stays warm. Prevents cold-DNS hiccups (getaddrinfo ENOTFOUND) on the
// first real request after a long idle period. Never throws, never
// crashes the server.
function setupDnsKeepalive() {
  const KEEPALIVE_HOST = 'www.minimax.io';
  const KEEPALIVE_PATH = '/';
  const KEEPALIVE_INTERVAL_MS = 30000;
  const KEEPALIVE_TIMEOUT_MS = 5000;

  function ping() {
    let req;
    try {
      req = https.request(
        { method: 'HEAD', host: KEEPALIVE_HOST, path: KEEPALIVE_PATH, timeout: KEEPALIVE_TIMEOUT_MS }
      );

      req.on('response', () => {
        req.destroy();
      });

      req.on('timeout', () => {
        req.destroy();
        console.error('[keepalive] ping failed: timeout after ' + KEEPALIVE_TIMEOUT_MS + 'ms');
      });

      req.on('error', (err) => {
        req.destroy();
        console.error('[keepalive] ping failed:', err.message);
      });

      req.end();
    } catch (err) {
      if (req) {
        try { req.destroy(); } catch (_) { /* swallow */ }
      }
      console.error('[keepalive] ping failed:', err.message);
    }
  }

  return setInterval(ping, KEEPALIVE_INTERVAL_MS);
}
