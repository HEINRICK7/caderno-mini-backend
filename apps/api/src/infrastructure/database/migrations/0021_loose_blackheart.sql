CREATE TABLE `merchant_charge_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `merchant_customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_charge_messages_draft_unique` ON `merchant_charge_messages` (`draft_id`);--> statement-breakpoint
CREATE INDEX `merchant_charge_messages_owner_customer_created` ON `merchant_charge_messages` (`owner_user_id`,`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `merchant_charge_messages_owner_source` ON `merchant_charge_messages` (`owner_user_id`,`source_type`,`source_id`);