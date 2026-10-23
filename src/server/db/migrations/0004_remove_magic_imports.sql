ALTER TABLE `buy_list_items` RENAME COLUMN "scryfall_id" TO "printing_id";--> statement-breakpoint
ALTER TABLE `copy_stacks` RENAME COLUMN "scryfall_id" TO "printing_id";--> statement-breakpoint
ALTER TABLE `deck_slots` RENAME COLUMN "picked_scryfall_id" TO "picked_printing_id";--> statement-breakpoint
ALTER TABLE `movements` RENAME COLUMN "scryfall_id" TO "printing_id";--> statement-breakpoint
ALTER TABLE `printings` RENAME COLUMN "scryfall_id" TO "printing_id";--> statement-breakpoint
ALTER TABLE `printings_staging` RENAME COLUMN "scryfall_id" TO "printing_id";--> statement-breakpoint
DROP TABLE `binder_mappings`;--> statement-breakpoint
DROP TABLE `imports`;--> statement-breakpoint
DROP INDEX `movements_scryfall_id`;--> statement-breakpoint
CREATE INDEX `movements_printing_id` ON `movements` (`printing_id`);--> statement-breakpoint
ALTER TABLE `movement_batches` DROP COLUMN `import_id`;
