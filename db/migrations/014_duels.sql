-- Migration 014: generic 1v1 games (chess, archery, race, pool)
CREATE TABLE IF NOT EXISTS duel_games (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game           TEXT NOT NULL CHECK (game IN ('chess','archery','race','pool')),
    creator_id     UUID NOT NULL REFERENCES users(internal_id),
    opponent_id    UUID REFERENCES users(internal_id),
    invited_id     UUID REFERENCES users(internal_id),
    stake_amount   NUMERIC(14,2) NOT NULL CHECK (stake_amount > 0),
    platform_fee   NUMERIC(14,2) NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','playing','completed','draw','cancelled','expired')),
    state          JSONB NOT NULL DEFAULT '{}'::jsonb,
    winner_id      UUID REFERENCES users(internal_id),
    result_reason  TEXT,
    payout_amount  NUMERIC(14,2),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL,
    joined_at      TIMESTAMPTZ,
    deadline       TIMESTAMPTZ,
    settled_at     TIMESTAMPTZ,
    CONSTRAINT chk_duel_not_self CHECK (opponent_id IS NULL OR opponent_id <> creator_id)
);
CREATE INDEX IF NOT EXISTS ix_duel_game ON duel_games(game);
CREATE INDEX IF NOT EXISTS ix_duel_status ON duel_games(status);
CREATE INDEX IF NOT EXISTS ix_duel_creator ON duel_games(creator_id);
CREATE INDEX IF NOT EXISTS ix_duel_opponent ON duel_games(opponent_id);
SELECT 1
