-- Add contact email field for gallery inquiry form submissions.
-- B2B contact only; not used for user tracking.
ALTER TABLE gallery_listings ADD COLUMN IF NOT EXISTS contact_email TEXT;
