const fs = require('fs');
const path = require('path');
const os = require('os');

class ConfigManager {
  constructor() {
    this.configPath = path.join(os.homedir(), '.minimax-accounts.json');
    this.legacyConfigPath = path.join(os.homedir(), '.minimax-config.json');
    this.config = this.loadConfig();
  }

  loadConfig() {
    // Migrate legacy config if exists
    if (fs.existsSync(this.legacyConfigPath) && !fs.existsSync(this.configPath)) {
      this.migrateLegacyConfig();
    }

    if (fs.existsSync(this.configPath)) {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    }
    return {
      accounts: [],
      settings: { refreshInterval: 30, theme: 'gradient' }
    };
  }

  migrateLegacyConfig() {
    try {
      const legacy = JSON.parse(fs.readFileSync(this.legacyConfigPath, 'utf8'));
      const newConfig = {
        accounts: [{
          id: 'acc_default',
          name: 'Default Account',
          token: legacy.token,
          groupId: legacy.groupId,
          isDefault: true
        }],
        settings: { refreshInterval: 30, theme: 'gradient' }
      };
      fs.writeFileSync(this.configPath, JSON.stringify(newConfig, null, 2));
      console.log('[Config] Migrated legacy config to new format');
    } catch (error) {
      console.error('[Config] Migration failed:', error.message);
    }
  }

  saveConfig() {
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }

  getAccounts() {
    return this.config.accounts;
  }

  getAccount(id) {
    return this.config.accounts.find(a => a.id === id);
  }

  addAccount({ name, token, groupId }) {
    const id = 'acc_' + Date.now();
    this.config.accounts.push({
      id,
      name,
      token,
      groupId: groupId || null,
      isDefault: this.config.accounts.length === 0
    });
    this.saveConfig();
    return id;
  }

  removeAccount(id) {
    const account = this.getAccount(id);
    if (account?.isDefault && this.config.accounts.length > 1) {
      const other = this.config.accounts.find(a => a.id !== id);
      if (other) other.isDefault = true;
    }
    this.config.accounts = this.config.accounts.filter(a => a.id !== id);
    this.saveConfig();
  }

  updateSettings(settings) {
    this.config.settings = { ...this.config.settings, ...settings };
    this.saveConfig();
  }
}

module.exports = ConfigManager;
