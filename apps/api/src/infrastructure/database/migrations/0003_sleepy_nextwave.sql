CREATE TABLE `access_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`user_id` text,
	`customer_email` text NOT NULL,
	`status` text NOT NULL,
	`granted_at` integer NOT NULL,
	`revoked_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_grants_purchase_id_unique` ON `access_grants` (`purchase_id`);--> statement-breakpoint
CREATE INDEX `access_grants_user_status` ON `access_grants` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `access_grants_email_status` ON `access_grants` (`customer_email`,`status`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`event_type` text NOT NULL,
	`provider_order_id` text,
	`provider_status` text,
	`callback_hash` text,
	`customer_email` text,
	`product_id` text,
	`offer_id` text,
	`offer_type` text,
	`amount_minor` integer,
	`currency` text,
	`occurred_at` text,
	`processing_status` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`processing_started_at` integer,
	`processed_at` integer,
	`last_error_code` text,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_events_dedupe_key_unique` ON `webhook_events` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `webhook_events_status_received` ON `webhook_events` (`processing_status`,`received_at`);--> statement-breakpoint
CREATE INDEX `webhook_events_provider_order` ON `webhook_events` (`provider_order_id`,`received_at`);