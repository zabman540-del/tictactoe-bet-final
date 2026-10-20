-- 012_nova_flight.sql — Nova Flight (virtual points only, no wallet link)
CREATE TABLE IF NOT EXISTS nova_flight_rounds (
    id           BIGSERIAL PRIMARY KEY,
    crash_point  NUMERIC(10,2) NOT NULL,
    start_at     TIMESTAMPTZ NOT NULL,
    crash_at     TIMESTAMPTZ NOT NULL,
    end_at       TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS nova_flight_points (
    user_id     UUID PRIMARY KEY REFERENCES users(internal_id),
    balance     NUMERIC(14,2) NOT NULL DEFAULT 1000,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_nf_balance CHECK (balance >= 0)
);
CREATE TABLE IF NOT EXISTS nova_flight_bets (
    id                 BIGSERIAL PRIMARY KEY,
    round_id           BIGINT NOT NULL REFERENCES nova_flight_rounds(id),
    user_id            UUID NOT NULL REFERENCES users(internal_id),
    amount             NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    cashout_multiplier NUMERIC(10,2),
    payout             NUMERIC(14,2),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_nf_one_bet UNIQUE (round_id, user_id)
);
SELECT 1;
