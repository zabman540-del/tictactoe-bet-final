-- Migration 011: Chicken Road
ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_game_check;
ALTER TABLE game_rounds ADD CONSTRAINT game_rounds_game_check CHECK (game IN ('mines','dice','chicken'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_chicken ON game_rounds(user_id) WHERE game='chicken' AND status='active';
SELECT 1
