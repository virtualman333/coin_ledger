-- 贵金属全量目录（金币云集抓取的 2823 枚），与前台 /api/catalog/pm 共用。
-- 迁移只负责建表 + 索引；数据由 tools/crawl-ecgci.js + import-ecgci-sql.js 导入。
CREATE TABLE IF NOT EXISTS cl_ecgci_pm (
  code VARCHAR(32) NOT NULL PRIMARY KEY,
  project_code VARCHAR(32) NULL,
  project_name VARCHAR(255) NULL,
  year VARCHAR(8) NULL,
  name VARCHAR(255) NULL,
  material VARCHAR(64) NULL,
  weight_g VARCHAR(64) NULL,
  face DECIMAL(14,2) NULL,
  fineness VARCHAR(32) NULL,
  max_mintage BIGINT NULL,
  quality VARCHAR(32) NULL,
  front_picture VARCHAR(512) NULL,
  back_picture VARCHAR(512) NULL,
  raw JSON NULL,
  thumb VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_project (project_code),
  KEY idx_year (year),
  KEY idx_name (name(64))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- @@

-- 账本品类（coin / note / pm）
SET @s = (SELECT IF(COUNT(*)=0,
  'ALTER TABLE cl_holdings ADD COLUMN category VARCHAR(16) NOT NULL DEFAULT ''coin''',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cl_holdings' AND COLUMN_NAME='category');

-- @@
PREPARE st FROM @s;

-- @@
EXECUTE st;

-- @@
DEALLOCATE PREPARE st;
