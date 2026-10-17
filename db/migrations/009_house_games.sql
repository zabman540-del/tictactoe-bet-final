-- Migration 009: house games (Mines, Dice)
BEGIN;

-- allow new ledger types / reference type (drop whatever check constraints exist on those columns)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid='wallet_transactions'::regclass AND contype='c'
             AND (pg_get_constraintdef(oid) LIKE '%stake_lock%' OR pg_get_constraintdef(oid) LIKE '%reference_type%')
  LOOP
    EXECUTE format('ALTER TABLE wallet_transactions DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE wallet_transactions ADD CONSTRAINT chk_wallet_txn_type CHECK (type IN
  ('deposit','withdrawal','stake_lock','stake_release','payout','fee','draw_refund','admin_adjustment','house_bet','house_payout'));
ALTER TABLE wallet_transactions ADD CONSTRAINT chk_wallet_txn_reftype CHECK (reference_type IS NULL OR reference_type IN
  ('deposit','withdrawal','match','admin','house_round'));

CREATE TABLE IF NOT EXISTS game_rounds (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(internal_id),
    game            TEXT NOT NULL CHECK (game IN ('mines','dice')),
    bet_amount      NUMERIC(14,2) NOT NULL CHECK (bet_amount > 0),
    status          TEXT NOT NULL CHECK (status IN ('active','won','lost','cashed_out')),
    params          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- mines: {mines:N, positions:[..], revealed:[..]}; dice: {direction,target,roll,chance}
    multiplier      NUMERIC(18,4) NOT NULL DEFAULT 0,
    payout_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    settled_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_game_rounds_user ON game_rounds(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_mines ON game_rounds(user_id) WHERE game='mines' AND status='active';

COMMIT;
