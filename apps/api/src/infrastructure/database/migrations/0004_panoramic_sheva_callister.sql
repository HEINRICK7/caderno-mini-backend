ALTER TABLE `drafts` ADD `owner_user_id` text REFERENCES users(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `drafts_owner_user_id` ON `drafts` (`owner_user_id`);
