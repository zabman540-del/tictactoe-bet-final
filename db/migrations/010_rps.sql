-- Migration 010: Rock Paper Scissors
CREATE TABLE IF NOT EXISTS rps_games (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id     UUID NOT NULL REFERENCES users(internal_id),
    opponent_id    UUID REFERENCES users(internal_id),
    invited_id     UUID REFERENCES users(internal_id),
    stake_amount   NUMERIC(14,2) NOT NULL CHECK (stake_amount > 0),
    platform_fee   NUMERIC(14,2) NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','picking','completed','draw','cancelled','expired')),
    creator_move   TEXT CHECK (creator_move IN ('rock','paper','scissors')),
    opponent_move  TEXT CHECK (opponent_move IN ('rock','paper','scissors')),
    winner_id      UUID REFERENCES users(internal_id),
    result_reason  TEXT,
    payout_amount  NUMERIC(14,2),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL,
    joined_at      TIMESTAMPTZ,
    pick_deadline  TIMESTAMPTZ,
    settled_at     TIMESTAMPTZ,
    CONSTRAINT chk_rps_not_self CHECK (opponent_id IS NULL OR opponent_id <> creator_id)
);
CREATE INDEX IF NOT EXISTS ix_rps_status ON rps_games(status);
CREATE INDEX IF NOT EXISTS ix_rps_creator ON rps_games(creator_id);
CREATE INDEX IF NOT EXISTS ix_rps_opponent ON rps_games(opponent_id);
SELECT 1
