CREATE TABLE `platform_access_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`access_plan` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'BRL' NOT NULL,
	`payment_method` text NOT NULL,
	`payment_reference` text,
	`recorded_by_admin_email` text NOT NULL,
	`granted_at` integer NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `platform_access_grants_user_status` ON `platform_access_grants` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `platform_access_grants_expiry` ON `platform_access_grants` (`user_id`,`expires_at`);