CREATE TABLE `publications` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`slug` text NOT NULL,
	`status` text NOT NULL,
	`published_at` integer NOT NULL,
	`unpublished_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publications_draft_unique` ON `publications` (`draft_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `publications_slug_unique` ON `publications` (`slug`);--> statement-breakpoint
CREATE INDEX `publications_owner_status` ON `publications` (`owner_user_id`,`status`);