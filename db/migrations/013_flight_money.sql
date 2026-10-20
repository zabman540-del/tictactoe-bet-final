-- 013_flight_money.sql — Nova Flight now plays with real ETB (wallet ledger) + provably-fair seeds.
-- Safe to run whether or not 012 was run before.
CREATE TABLE IF NOT EXISTS nova_flight_rounds (
    id           BIGSERIAL PRIMARY KEY,
    crash_point  NUMERIC(10,2) NOT NULL,
    start_at     TIMESTAMPTZ NOT NULL,
    crash_at     TIMESTAMPTZ NOT NULL,
    end_at       TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE nova_flight_rounds ADD COLUMN IF NOT EXISTS server_seed TEXT;
ALTER TABLE nova_flight_rounds ADD COLUMN IF NOT EXISTS seed_hash TEXT;
DROP TABLE IF EXISTS nova_flight_bets;
DROP TABLE IF EXISTS nova_flight_points;
CREATE TABLE nova_flight_bets (
    id                 UUID PRIMARY KEY,
    round_id           BIGINT NOT NULL REFERENCES nova_flight_rounds(id),
    user_id            UUID NOT NULL REFERENCES users(internal_id),
    amount             NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    auto_cashout       NUMERIC(10,2),
    cashout_multiplier NUMERIC(10,2),
    payout             NUMERIC(14,2),
    settled            BOOLEAN NOT NULL DEFAULT false,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_nf_one_bet UNIQUE (round_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_nf_bets_unsettled ON nova_flight_bets (round_id) WHERE NOT settled;
SELECT 1;
