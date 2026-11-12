ALTER TABLE `templates` ADD `publication_status` text DEFAULT 'archived' NOT NULL;--> statement-breakpoint
UPDATE `templates`
SET `publication_status` = CASE WHEN `is_active` = 1 THEN 'published' ELSE 'archived' END;
