-- Migration 008: friendships
CREATE TABLE IF NOT EXISTS friendships (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id  UUID NOT NULL REFERENCES users(internal_id),
    addressee_id  UUID NOT NULL REFERENCES users(internal_id),
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_friendship_status CHECK (status IN ('pending','accepted','declined')),
    CONSTRAINT chk_friendship_not_self CHECK (requester_id <> addressee_id),
    CONSTRAINT uq_friend_pair UNIQUE (requester_id, addressee_id)
);
CREATE INDEX IF NOT EXISTS ix_friendships_requester ON friendships(requester_id);
CREATE INDEX IF NOT EXISTS ix_friendships_addressee ON friendships(addressee_id);
