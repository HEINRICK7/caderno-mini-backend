CREATE TABLE `analytics_events` (
	`id` text PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`name` text NOT NULL,
	`user_id` text,
	`draft_id` text,
	`purchase_id` text,
	`publication_id` text,
	`template_id` text,
	`source` text,
	`medium` text,
	`campaign` text,
	`referrer_host` text,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_events_dedupe_unique` ON `analytics_events` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `analytics_events_name_date` ON `analytics_events` (`name`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_purchase` ON `analytics_events` (`purchase_id`,`name`);--> statement-breakpoint
CREATE INDEX `analytics_events_campaign` ON `analytics_events` (`name`,`source`,`campaign`);