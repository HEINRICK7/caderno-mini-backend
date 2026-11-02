CREATE TABLE `demo_publications` (
	`slug` text PRIMARY KEY NOT NULL,
	`visitor_hash` text NOT NULL,
	`category` text NOT NULL,
	`draft_id` text NOT NULL,
	`template_id` text NOT NULL,
	`template_version` integer NOT NULL,
	`template_name` text NOT NULL,
	`template_description` text,
	`template_definition` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demo_publications_visitor_category_unique` ON `demo_publications` (`visitor_hash`,`category`);--> statement-breakpoint
CREATE INDEX `demo_publications_expiry` ON `demo_publications` (`expires_at`);