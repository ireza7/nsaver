CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `telegram_id` bigint NOT NULL,
  `username` varchar(255),
  `first_name` varchar(255),
  `is_active` boolean NOT NULL DEFAULT true,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_telegram_id_unique` (`telegram_id`)
);

CREATE TABLE `sessions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `session_id` varchar(512) NOT NULL,
  `csrf_token` varchar(512) NOT NULL,
  `cf_clearance` varchar(512) NOT NULL,
  `user_agent` text,
  `is_valid` boolean NOT NULL DEFAULT true,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `sessions_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

CREATE TABLE `galleries` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nhentai_id` int NOT NULL,
  `title` varchar(1024) NOT NULL,
  `tags` json NOT NULL,
  `language` varchar(64) NOT NULL DEFAULT '',
  `category` varchar(64) NOT NULL DEFAULT '',
  `pages` int NOT NULL DEFAULT 0,
  `thumbnail` varchar(1024) NOT NULL DEFAULT '',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `nhentai_id_idx` (`nhentai_id`)
);

CREATE TABLE `user_favorites` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `gallery_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_gallery_idx` (`user_id`, `gallery_id`),
  CONSTRAINT `user_favorites_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_favorites_gallery_id_fk` FOREIGN KEY (`gallery_id`) REFERENCES `galleries` (`id`) ON DELETE CASCADE
);

CREATE TABLE `channel_cache` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `telegram_message_id` int NOT NULL,
  `telegram_file_id` varchar(512) NOT NULL,
  `description` text,
  `filter_hash` varchar(128) NOT NULL,
  `tags` json NOT NULL DEFAULT ('[]'),
  `gallery_count` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  CONSTRAINT `channel_cache_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

CREATE TABLE `export_jobs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'pending',
  `filter_hash` varchar(128) NOT NULL DEFAULT '',
  `gallery_count` int NOT NULL DEFAULT 0,
  `error` text,
  `started_at` timestamp,
  `completed_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  CONSTRAINT `export_jobs_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);
