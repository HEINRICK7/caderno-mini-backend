CREATE TABLE `merchant_catalog_items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`price_minor` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `merchant_catalog_items_owner_status_updated` ON `merchant_catalog_items` (`owner_user_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `merchant_catalog_items_owner_kind_name` ON `merchant_catalog_items` (`owner_user_id`,`kind`,`name`);--> statement-breakpoint
CREATE TABLE `merchant_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`whatsapp` text,
	`email` text,
	`address` text,
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `merchant_customers_owner_status_updated` ON `merchant_customers` (`owner_user_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `merchant_customers_owner_name` ON `merchant_customers` (`owner_user_id`,`name`);