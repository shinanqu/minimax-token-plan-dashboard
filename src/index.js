#!/usr/bin/env node

const http = require('http');
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
    const [usageData, subscriptionData] = await Promise.all([
      api.getUsageStatus(),
      api.getSubscriptionDetails()
    ]);
    const parsedData = api.parseUsageData(usageData, subscriptionData, lang);
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

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
