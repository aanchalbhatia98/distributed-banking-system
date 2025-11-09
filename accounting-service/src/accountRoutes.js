import express from 'express';
import pool from './db.js'; // Import the PostgreSQL pool
import { v4 as uuidv4, validate as uuidValidate } from 'uuid';

const router = express.Router();

// --- Utility Function (Data Formatting) ---
// Ensures DECIMAL fields are returned as clean strings for API consistency
const formatAccountData = (account) => {
    if (!account) return null;
    
    // Fixed: Uses the spread operator correctly
    return {
        ...account,
        balance: parseFloat(account.balance).toFixed(4),
        daily_transfer_limit: parseFloat(account.daily_transfer_limit).toFixed(4),
    };
};

// --- API Endpoints ---

// POST /accounts: Create a new account
router.post('/accounts', async (req, res) => {
    const { customer_id, account_number, account_type, initial_deposit } = req.body;

    if (!customer_id || !account_number || !account_type || initial_deposit === undefined) {
        return res.status(400).json({ error: 'Missing required fields: customer_id, account_number, account_type, initial_deposit.' });
    }
    if (!uuidValidate(customer_id)) {
        return res.status(400).json({ error: 'Invalid customer_id format (must be UUID).' });
    }
    
    const balance = parseFloat(initial_deposit);
    if (isNaN(balance) || balance < 0) {
         return res.status(400).json({ error: 'initial_deposit must be a non-negative number.' });
    }

    const account_id = uuidv4();
    const currency = 'INR';
    const status = 'ACTIVE';

    try {
        const result = await pool.query(
            `INSERT INTO accounts 
             (account_id, customer_id, account_number, account_type, balance, currency, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [account_id, customer_id, account_number, account_type, balance, currency, status]
        );
        
        console.log(`[EVENT] Publishing AccountCreatedEvent for Account ID: ${account_id}`);
        
        res.status(201).json(formatAccountData(result.rows[0]));

    } catch (error) {
        if (error.code === '23505') { 
            return res.status(409).json({ error: 'Account number already exists.' });
        }
        console.error('Error creating account:', error.stack);
        res.status(500).json({ error: 'Internal server error during account creation.' });
    }
});

// GET /accounts/:accountId: Fetch account details
router.get('/accounts/:accountId', async (req, res) => {
    const { accountId } = req.params;
    
    if (!uuidValidate(accountId)) {
        return res.status(400).json({ error: 'Invalid account ID format.' });
    }

    try {
        const result = await pool.query('SELECT * FROM accounts WHERE account_id = $1', [accountId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Account not found.' });
        }

        res.status(200).json(formatAccountData(result.rows[0])); 

    } catch (error) {
        console.error(`Error fetching account ${accountId}:`, error.stack);
        res.status(500).json({ error: 'Internal server error while fetching account.' });
    }
});


// PUT /accounts/:accountId/status: Change account status (e.g., FROZEN, CLOSED)
router.put('/accounts/:accountId/status', async (req, res) => {
    const { accountId } = req.params;
    const { status } = req.body;

    if (!uuidValidate(accountId) || !status) {
        return res.status(400).json({ error: 'Invalid input or missing status.' });
    }

    const validStatuses = ['ACTIVE', 'FROZEN', 'CLOSED'];
    if (!validStatuses.includes(status.toUpperCase())) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }
    
    try {
        const result = await pool.query(
            `UPDATE accounts SET status = $1, updated_at = NOW() WHERE account_id = $2 RETURNING *`,
            [status.toUpperCase(), accountId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Account not found.' });
        }

        console.log(`[EVENT] Publishing AccountStatusChangedEvent for Account ID: ${accountId}, New Status: ${status.toUpperCase()}`);

        res.json(formatAccountData(result.rows[0]));

    } catch (error) {
        console.error(`Error updating account status ${accountId}:`, error.stack);
        res.status(500).json({ error: 'Internal server error during status update.' });
    }
});


// POST /accounts/:accountId/check-transaction-eligibility: Business Rule Enforcement
router.post('/accounts/:accountId/check-transaction-eligibility', async (req, res) => {
    const { accountId } = req.params;

    if (!uuidValidate(accountId)) {
        return res.status(400).json({ error: 'Invalid account ID format.' });
    }

    try {
        const result = await pool.query(
            'SELECT balance, status, daily_transfer_limit FROM accounts WHERE account_id = $1',
            [accountId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Account not found.' });
        }

        const account = result.rows[0];
        const status = account.status.toUpperCase();
        
        // Business Rule: Frozen accounts cannot transact
        if (status === 'FROZEN' || status === 'CLOSED') {
            const message = status === 'FROZEN' 
                ? 'Transaction failed: This account is currently frozen and cannot perform transfers.'
                : 'Transaction failed: This account is permanently closed.';
            return res.status(403).json({
                is_eligible: false,
                error_code: `${status}_ACCOUNT`,
                message: message
            });
        }

        // If active, return eligibility and limits for the Transaction Service
        res.json({
            is_eligible: true,
            account_status: status,
            available_balance: parseFloat(account.balance).toFixed(4),
            daily_limit: parseFloat(account.daily_transfer_limit).toFixed(4),
            message: 'Account is eligible for transactions.'
        });

    } catch (error) {
        console.error(`Error checking eligibility for ${accountId}:`, error.stack);
        res.status(500).json({ error: 'Internal server error during eligibility check.' });
    }
});
router.post('/accounts/:accountId/debit', async (req, res) => {
    const { accountId } = req.params;
    const { amount } = req.body;

    if (!uuidValidate(accountId)) {
        return res.status(400).json({ error: 'Invalid account ID format.' });
    }
    
    const debitAmount = parseFloat(amount);
    if (isNaN(debitAmount) || debitAmount <= 0) {
        return res.status(400).json({ error: 'Amount must be a positive number.' });
    }

    try {
        // CRITICAL: The UPDATE query checks three conditions simultaneously (Atomicity):
        // 1. Account must exist ($2)
        // 2. Status must be 'ACTIVE'
        // 3. Balance must be sufficient (>= $1)
        const result = await pool.query(
            `UPDATE accounts 
             SET balance = balance - $1, updated_at = NOW() 
             WHERE account_id = $2 
             AND status = 'ACTIVE' 
             AND balance >= $1
             RETURNING *`,
            [debitAmount, accountId]
        );

        if (result.rows.length === 0) {
            // If the update fails, we need to check *why* it failed to return the correct error.
            
            // First, fetch the current state to determine the failure reason
            const checkResult = await pool.query(
                'SELECT balance, status FROM accounts WHERE account_id = $1', 
                [accountId]
            );

            if (checkResult.rows.length === 0) {
                 return res.status(404).json({ error: 'Account not found.' });
            }

            const accountStatus = checkResult.rows[0].status.toUpperCase();
            
            if (accountStatus !== 'ACTIVE') {
                 // Rule 1: Frozen or Closed
                return res.status(403).json({ 
                    is_eligible: false,
                    error_code: `${accountStatus}_ACCOUNT`,
                    message: `Transaction failed: Account is currently ${accountStatus} and cannot be debited.` 
                });
            } else {
                 // Rule 2: Insufficient Funds
                 return res.status(403).json({ 
                    is_eligible: false,
                    error_code: 'INSUFFICIENT_FUNDS',
                    message: 'Transaction failed: Insufficient funds in account.' 
                });
            }
        }
        
        console.log(`[EVENT] Publishing FundsDebitedEvent for Account ID: ${accountId}`);

        res.json(formatAccountData(result.rows[0]));

    } catch (error) {
        console.error(`Error processing debit for ${accountId}:`, error.stack);
        res.status(500).json({ error: 'Internal server error during debit process.' });
    }
});

// POST /accounts/:accountId/credit: Credit an account (Deposit Funds)
router.post('/accounts/:accountId/credit', async (req, res) => {
    const { accountId } = req.params;
    const { amount } = req.body;

    if (!uuidValidate(accountId)) {
        return res.status(400).json({ error: 'Invalid account ID format.' });
    }
    
    const creditAmount = parseFloat(amount);
    if (isNaN(creditAmount) || creditAmount <= 0) {
        return res.status(400).json({ error: 'Amount must be a positive number.' });
    }

    try {
        // Atomic update for credit. Only check status, as balance constraint is not needed.
        const result = await pool.query(
            `UPDATE accounts 
             SET balance = balance + $1, updated_at = NOW() 
             WHERE account_id = $2 
             AND status = 'ACTIVE' 
             RETURNING *`,
            [creditAmount, accountId]
        );

        if (result.rows.length === 0) {
            // Check status to determine if account was not found or not active
            const checkResult = await pool.query(
                'SELECT status FROM accounts WHERE account_id = $1', 
                [accountId]
            );

            if (checkResult.rows.length === 0) {
                 return res.status(404).json({ error: 'Account not found.' });
            }

            const accountStatus = checkResult.rows[0].status.toUpperCase();
            
            // Rule: Account must be ACTIVE to receive funds
            return res.status(403).json({ 
                is_eligible: false,
                error_code: `${accountStatus}_ACCOUNT`,
                message: `Credit failed: Account is currently ${accountStatus} and cannot receive funds.` 
            });
        }
        
        console.log(`[EVENT] Publishing FundsCreditedEvent for Account ID: ${accountId}`);

        res.json(formatAccountData(result.rows[0]));

    } catch (error) {
        console.error(`Error processing credit for ${accountId}:`, error.stack);
        res.status(500).json({ error: 'Internal server error during credit process.' });
    }
});

// FIX: Export the router as a named export
export { router };