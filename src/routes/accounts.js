const express = require('express');

function accountRoutes(configManager) {
  const router = express.Router();

  // List all accounts (without tokens)
  router.get('/', (req, res) => {
    const accounts = configManager.getAccounts();
    res.json(accounts.map(a => ({
      id: a.id,
      name: a.name,
      isDefault: a.isDefault
    })));
  });

  // Add new account
  router.post('/', (req, res) => {
    const { name, token, groupId } = req.body;
    if (!name || !token) {
      return res.status(400).json({ error: 'name and token are required' });
    }
    const id = configManager.addAccount({ name, token, groupId });
    res.json({ id, message: 'Account added successfully' });
  });

  // Delete account
  router.delete('/:id', (req, res) => {
    configManager.removeAccount(req.params.id);
    res.json({ message: 'Account removed successfully' });
  });

  return router;
}

module.exports = { accountRoutes };
