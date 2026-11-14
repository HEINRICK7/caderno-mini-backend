CREATE TABLE `__new_purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text,
	`owner_user_id` text,
	`callback_hash` text NOT NULL,
	`provider_order_id` text,
	`customer_email` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`amount_minor` integer,
	`currency` text,
	`sale_source` text DEFAULT 'checkout' NOT NULL,
	`access_plan` text,
	`payment_method` text,
	`payment_reference` text,
	`recorded_by_admin_email` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_purchases`("id", "draft_id", "owner_user_id", "callback_hash", "provider_order_id", "customer_email", "status", "amount_minor", "currency", "sale_source", "access_plan", "payment_method", "payment_reference", "recorded_by_admin_email", "created_at", "updated_at") SELECT "id", "draft_id", "owner_user_id", "callback_hash", "provider_order_id", "customer_email", "status", "amount_minor", "currency", "sale_source", "access_plan", "payment_method", "payment_reference", "recorded_by_admin_email", "created_at", "updated_at" FROM `purchases`;--> statement-breakpoint
CREATE TEMP TABLE `__access_grants_backup` AS SELECT * FROM `access_grants`;--> statement-breakpoint
CREATE TEMP TABLE `__purchase_analytics_backup` AS SELECT `id`, `purchase_id` FROM `analytics_events` WHERE `purchase_id` IS NOT NULL;--> statement-breakpoint
DELETE FROM `access_grants`;--> statement-breakpoint
DROP TABLE `purchases`;--> statement-breakpoint
ALTER TABLE `__new_purchases` RENAME TO `purchases`;--> statement-breakpoint
INSERT INTO `access_grants` SELECT * FROM `__access_grants_backup`;--> statement-breakpoint
UPDATE `analytics_events` SET `purchase_id` = (SELECT `purchase_id` FROM `__purchase_analytics_backup` WHERE `id` = `analytics_events`.`id`) WHERE `id` IN (SELECT `id` FROM `__purchase_analytics_backup`);--> statement-breakpoint
DROP TABLE `__access_grants_backup`;--> statement-breakpoint
DROP TABLE `__purchase_analytics_backup`;--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_callback_hash_unique` ON `purchases` (`callback_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_provider_order_id_unique` ON `purchases` (`provider_order_id`);--> statement-breakpoint
CREATE INDEX `purchases_draft_created` ON `purchases` (`draft_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `purchases_status_updated` ON `purchases` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `purchases_owner_user_created` ON `purchases` (`owner_user_id`,`created_at`);
