ALTER TABLE `purchases` ADD `owner_user_id` text REFERENCES users(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `purchases_owner_user_created` ON `purchases` (`owner_user_id`,`created_at`);
