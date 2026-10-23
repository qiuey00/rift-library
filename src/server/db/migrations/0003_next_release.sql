CREATE TABLE `deck_slot_tags` (
	`slot_id` integer NOT NULL,
	`tag` text NOT NULL,
	`tag_key` text NOT NULL,
	PRIMARY KEY(`slot_id`, `tag_key`),
	FOREIGN KEY (`slot_id`) REFERENCES `deck_slots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deck_slot_tags_tag_key` ON `deck_slot_tags` (`tag_key`);--> statement-breakpoint
ALTER TABLE `locations` ADD `for_trade` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `printings` ADD `price_usd` integer;--> statement-breakpoint
ALTER TABLE `printings` ADD `price_usd_foil` integer;--> statement-breakpoint
ALTER TABLE `printings` ADD `price_usd_etched` integer;--> statement-breakpoint
ALTER TABLE `printings_staging` ADD `price_usd` integer;--> statement-breakpoint
ALTER TABLE `printings_staging` ADD `price_usd_foil` integer;--> statement-breakpoint
ALTER TABLE `printings_staging` ADD `price_usd_etched` integer;