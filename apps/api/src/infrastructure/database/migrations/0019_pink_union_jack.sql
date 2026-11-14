CREATE TABLE `merchant_installments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`number` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `merchant_sales`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_installments_sale_number_unique` ON `merchant_installments` (`sale_id`,`number`);--> statement-breakpoint
CREATE INDEX `merchant_installments_owner_customer_due` ON `merchant_installments` (`owner_user_id`,`customer_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `merchant_installments_owner_due_status` ON `merchant_installments` (`owner_user_id`,`due_date`,`status`);--> statement-breakpoint
CREATE TABLE `merchant_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`installment_id` text,
	`amount_minor` integer NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`paid_at` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `merchant_sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`installment_id`) REFERENCES `merchant_installments`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `merchant_payments_owner_sale_paid` ON `merchant_payments` (`owner_user_id`,`sale_id`,`paid_at`);--> statement-breakpoint
CREATE INDEX `merchant_payments_owner_installment` ON `merchant_payments` (`owner_user_id`,`installment_id`);--> statement-breakpoint
CREATE TABLE `merchant_sale_items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`catalog_item_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`line_total_minor` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `merchant_sales`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `merchant_sale_items_owner_sale` ON `merchant_sale_items` (`owner_user_id`,`sale_id`);--> statement-breakpoint
CREATE TABLE `merchant_sales` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`condition` text NOT NULL,
	`total_minor` integer NOT NULL,
	`down_payment_minor` integer NOT NULL,
	`financed_minor` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `merchant_customers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `merchant_sales_owner_customer_created` ON `merchant_sales` (`owner_user_id`,`customer_id`,`created_at`);