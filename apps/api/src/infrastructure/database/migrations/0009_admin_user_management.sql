ALTER TABLE `users` ADD `account_status` text NOT NULL DEFAULT 'active';
--> statement-breakpoint
CREATE TABLE `admin_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`action` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `admin_audit_target_created` ON `admin_audit_log` (`target_user_id`,`created_at`);
