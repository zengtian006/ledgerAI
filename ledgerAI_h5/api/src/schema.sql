CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'GBP',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS country CHAR(2);
-- Cognito users have no local password
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cognito_sub VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cognito_sub ON users (cognito_sub);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP;
ALTER TABLE users DROP COLUMN IF EXISTS monthly_email_enabled;

CREATE TABLE IF NOT EXISTS receipts (
    receipt_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    image_key TEXT,
    image_hash CHAR(64),
    merchant_name VARCHAR(255) NOT NULL,
    transaction_date DATE NOT NULL,
    currency VARCHAR(10) DEFAULT 'GBP',
    subtotal NUMERIC(12,2),
    tax NUMERIC(12,2),
    total_amount NUMERIC(12,2) NOT NULL,
    category VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'verified',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_receipts_user_date ON receipts (user_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_receipts_user_category ON receipts (user_id, category);
CREATE INDEX IF NOT EXISTS idx_receipts_user_hash ON receipts (user_id, image_hash);

CREATE TABLE IF NOT EXISTS line_items (
    item_id SERIAL PRIMARY KEY,
    receipt_id INT NOT NULL REFERENCES receipts(receipt_id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity NUMERIC(10,3) DEFAULT 1,
    price NUMERIC(12,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_line_items_receipt ON line_items (receipt_id);

CREATE TABLE IF NOT EXISTS budgets (
    user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    month CHAR(7) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    PRIMARY KEY (user_id, month)
);

CREATE TABLE IF NOT EXISTS insights (
    user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    period CHAR(7) NOT NULL,
    payload JSONB NOT NULL,
    source VARCHAR(20) NOT NULL DEFAULT 'gemini',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, period)
);

-- One row per AI call (receipt scan / insights digest). user_id is kept as NULL after account deletion so aggregates survive.
CREATE TABLE IF NOT EXISTS usage_events (
    event_id BIGSERIAL PRIMARY KEY,
    user_id INT REFERENCES users(user_id) ON DELETE SET NULL,
    kind VARCHAR(20) NOT NULL,
    ok BOOLEAN NOT NULL,
    model VARCHAR(60),
    duration_ms INT,
    input_tokens INT,
    output_tokens INT,
    error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events (created_at);
CREATE INDEX IF NOT EXISTS idx_usage_user_created ON usage_events (user_id, created_at);

DROP TABLE IF EXISTS monthly_report_deliveries;
