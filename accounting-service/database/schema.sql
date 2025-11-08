-- PostgreSQL Schema for the Accounting Service

-- Enables the UUID data type
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ACCOUNTS Table (Source of Truth)
CREATE TABLE accounts (
    account_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL,          -- Logical Foreign Key to Customer Service
    account_number VARCHAR(20) UNIQUE NOT NULL, -- Unique bank account number
    account_type VARCHAR(50) NOT NULL,
    balance DECIMAL(19, 4) NOT NULL DEFAULT 0.0000, -- Store financial data with high precision
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, FROZEN, CLOSED
    daily_transfer_limit DECIMAL(19, 4) NOT NULL DEFAULT 200000.0000, -- Business Rule Enforcement
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE
);

-- Indexing on customer_id for quick lookups
CREATE INDEX idx_accounts_customer_id ON accounts (customer_id);

-- 2. CUSTOMER READ MODEL Table (Replicated Read Model)
-- This table stores necessary customer info (replicated from Customer Service via events)
-- to avoid synchronous REST calls from this service.
CREATE TABLE customer_read_model (
    customer_id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);