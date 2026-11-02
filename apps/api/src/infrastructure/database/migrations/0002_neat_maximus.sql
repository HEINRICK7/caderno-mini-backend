CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`callback_hash` text NOT NULL,
	`provider_order_id` text,
	`customer_email` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_callback_hash_unique` ON `purchases` (`callback_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_provider_order_id_unique` ON `purchases` (`provider_order_id`);--> statement-breakpoint
CREATE INDEX `purchases_draft_created` ON `purchases` (`draft_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `purchases_status_updated` ON `purchases` (`status`,`updated_at`);