CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`template_version` integer NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`template_id`,`template_version`) REFERENCES `templates`(`id`,`version`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `drafts_template_reference` ON `drafts` (`template_id`,`template_version`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`definition` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`id`, `version`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_one_active_version_per_id` ON `templates` (`id`) WHERE "templates"."is_active" = 1;--> statement-breakpoint
CREATE INDEX `templates_active_id_version` ON `templates` (`id`,`is_active`,`version`);