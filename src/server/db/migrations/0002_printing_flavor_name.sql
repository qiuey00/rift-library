ALTER TABLE `printings` ADD `flavor_name` text;--> statement-breakpoint
CREATE INDEX `printings_flavor_name` ON `printings` ("flavor_name" COLLATE NOCASE);--> statement-breakpoint
ALTER TABLE `printings_staging` ADD `flavor_name` text;--> statement-breakpoint
-- Card data loaded before has no flavor names: mark it out of date so the next start downloads it again.
UPDATE `card_data_status` SET `bulk_updated_at` = NULL;