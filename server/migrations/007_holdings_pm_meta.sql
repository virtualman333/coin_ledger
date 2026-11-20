-- 账本里的贵金属/按单枚记藏品需要额外的展示元数据：
--   thumb  贵金属缩略图（相对路径或完整 URL），普通币留空，展示时回落到本地图
--   unit   'piece' 表示按单枚/单张记，其余（含空）沿用套/卷口径
-- 与 category 同为账本行的可选属性，缺省不影响既存 coin/note 藏品。
SET @s = (SELECT IF(COUNT(*)=0,
  'ALTER TABLE cl_holdings ADD COLUMN thumb VARCHAR(512) NOT NULL DEFAULT ''''',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cl_holdings' AND COLUMN_NAME='thumb');

-- @@
PREPARE st FROM @s;

-- @@
EXECUTE st;

-- @@
DEALLOCATE PREPARE st;

-- @@

SET @s = (SELECT IF(COUNT(*)=0,
  'ALTER TABLE cl_holdings ADD COLUMN unit VARCHAR(8) NOT NULL DEFAULT ''''',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cl_holdings' AND COLUMN_NAME='unit');

-- @@
PREPARE st FROM @s;

-- @@
EXECUTE st;

-- @@
DEALLOCATE PREPARE st;
