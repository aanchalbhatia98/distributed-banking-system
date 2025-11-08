import express from 'express';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables from .env file for local development
dotenv.config();

const app = express();
app.use(express.json());

// --- Database Configuration (using environment variables from .env/docker-compose) ---
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// Test DB connection
pool.connect()
    .then(client => {
        console.log('✅ Connected to PostgreSQL database');
        client.release();
    })
    .catch(err => {
        console.error('❌ Connection error to PostgreSQL:', err.stack);
        process.exit(1);
    });

const PORT = process.env.PORT || 8080;

// --- API Endpoints ---

// POST /accounts: Create a new account
app.post('/api/v1/accounts', async (req, res) => {
    const { customer_id, account_type, account_number, initial_deposit } = req.body;
    
    // Simple validation
    if (!customer_id || !account_type || !account_number) {
        return res.status(400).send({ message: 'Missing required fields.' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO accounts 
            (customer_id, account_number, account_type, balance, status)
            VALUES ($1, $2, $3, $4, 'ACTIVE')
            RETURNING *`,
            [customer_id, account_number, account_type, initial_deposit || 0]
        );

        // NOTE: In a real system, you would publish an 'AccountCreated' event here.
        console.log(`Account created: ${result.rows[0].account_id}`);

        res.status(201).json(result.rows[0]);

    } catch (error) {
        console.error('Error creating account:', error);
        // Handle unique constraint violation gracefully
        if (error.code === '23505') { 
             return res.status(409).send({ message: 'Account number already exists.' });
        }
        res.status(500).send({ message: 'Internal server error.' });
    }
});

// GET /accounts/:accountId: Fetch account details
app.get('/api/v1/accounts/:accountId', async (req, res) => {
    const { accountId } = req.params;

    try {
        const result = await pool.query('SELECT * FROM accounts WHERE account_id = $1', [accountId]);

        if (result.rows.length === 0) {
            return res.status(404).send({ message: 'Account not found.' });
        }

        res.status(200).json(result.rows[0]);

    } catch (error) {
        console.error('Error fetching account:', error);
        res.status(500).send({ message: 'Internal server error.' });
    }
});

// PUT /accounts/:accountId/status: Change account status (e.g., Freeze/Close)
app.put('/api/v1/accounts/:accountId/status', async (req, res) => {
    const { accountId } = req.params;
    const { status } = req.body; // Expects 'FROZEN' or 'CLOSED'

    if (!['ACTIVE', 'FROZEN', 'CLOSED'].includes(status)) {
        return res.status(400).send({ message: 'Invalid status provided.' });
    }

    try {
        const result = await pool.query(
            'UPDATE accounts SET status = $1, updated_at = NOW() WHERE account_id = $2 RETURNING *',
            [status, accountId]
        );

        if (result.rows.length === 0) {
            return res.status(404).send({ message: 'Account not found.' });
        }

        // NOTE: Publish 'AccountStatusChanged' event here.
        console.log(`Account ${accountId} status changed to ${status}`);

        res.status(200).json(result.rows[0]);

    } catch (error) {
        console.error('Error updating account status:', error);
        res.status(500).send({ message: 'Internal server error.' });
    }
});

// --- Business Rule Enforcement Endpoint (Used by Transaction Service) ---
// This synchronous endpoint enforces the "Frozen accounts cannot transact" rule.

app.post('/api/v1/accounts/:accountId/check-transaction-eligibility', async (req, res) => {
    const { accountId } = req.params;
    // const { amount } = req.body; // If we were checking limits, we'd use this

    try {
        const result = await pool.query(
            'SELECT status, balance, daily_transfer_limit FROM accounts WHERE account_id = $1',
            [accountId]
        );

        if (result.rows.length === 0) {
            return res.status(404).send({ message: 'Account not found.' });
        }

        const account = result.rows[0];

        // 1. FROZEN ACCOUNT CHECK (Business Rule)
        if (account.status === 'FROZEN') {
            // Expose a clear error as requested
            return res.status(403).json({ 
                is_eligible: false, 
                error_code: 'FROZEN_ACCOUNT',
                message: 'Transaction failed: This account is currently frozen and cannot perform transfers.'
            });
        }
        
        // 2. DAILY LIMIT CHECK (Simplified for this service - actual check belongs in Transaction Service)
        // This service simply exposes the limit. The Transaction Service manages the tally.
        // We'll skip the actual limit check logic here as it requires transaction history.

        // If active and other checks pass
        return res.status(200).json({
            is_eligible: true,
            account_status: account.status,
            available_balance: account.balance,
            daily_limit: account.daily_transfer_limit,
            message: 'Account is eligible for transactions.'
        });

    } catch (error) {
        console.error('Error checking eligibility:', error);
        res.status(500).send({ message: 'Internal server error.' });
    }
});


// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Accounting Service running on http://localhost:${PORT}`);
});