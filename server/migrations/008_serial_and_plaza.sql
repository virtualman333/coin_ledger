-- 收藏增强 + 收藏广场（2026-11-20）
-- 1) cl_holdings 增加号码/形态/图片三列（可选，缺省空，不影响既有收藏）
--    serials  JSON 数组字符串：["J12345678","J12345679"]，最多 200 张
--    form     single | set —— 单个 / 整套（沿用账本口径，与 unit 的 piece 计价口径正交）
--    images   JSON 数组字符串：["/collection/xxx.jpg"]，最多 3 张
-- 2) 广场四张表独立建模，不进 store 的整份文档同步（帖子可能增长，整份同步会拖慢所有写）

-- ---- holdings 列（幂等）----
SET @s = (SELECT IF(COUNT(*)=0,
  'ALTER TABLE cl_holdings ADD COLUMN serials TEXT NULL',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cl_holdings' AND COLUMN_NAME='serials');
-- @@
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
-- @@

SET @s = (SELECT IF(COUNT(*)=0,
  'ALTER TABLE cl_holdings ADD COLUMN form VARCHAR(8) NOT NULL DEFAULT ''',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cl_holdings' AND COLUMN_NAME='form');
-- @@
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
-- @@

SET @s = (SELECT IF(COUNT(*)=0,
  'ALTER TABLE cl_holdings ADD COLUMN images TEXT NULL',
  'SELECT 1') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cl_holdings' AND COLUMN_NAME='images');
-- @@
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
-- @@

-- ---- 广场帖子 ----
CREATE TABLE IF NOT EXISTS cl_share (
  id VARCHAR(24) NOT NULL,
  uid VARCHAR(16) NOT NULL,
  holding_name VARCHAR(64) NOT NULL COMMENT '关联品种名',
  serials TEXT NULL COMMENT '分享的号码 JSON 数组',
  images TEXT NULL COMMENT '图片路径 JSON 数组',
  form VARCHAR(8) NOT NULL DEFAULT '' COMMENT 'single|set',
  caption VARCHAR(280) NOT NULL DEFAULT '' COMMENT '分享文案',
  tags TEXT NULL COMMENT '号码花样标签 JSON 数组（冗余，便于列表展示）',
  likes INT NOT NULL DEFAULT 0,
  comments INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_share_time (created_at),
  KEY idx_share_uid (uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='收藏广场-分享帖子';

-- ---- 点赞 ----
CREATE TABLE IF NOT EXISTS cl_share_like (
  share_id VARCHAR(24) NOT NULL,
  uid VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (share_id, uid),
  KEY idx_like_uid (uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='收藏广场-点赞';

-- ---- 评论 ----
CREATE TABLE IF NOT EXISTS cl_share_comment (
  id VARCHAR(24) NOT NULL,
  share_id VARCHAR(24) NOT NULL,
  uid VARCHAR(16) NOT NULL,
  text VARCHAR(280) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_comment_share (share_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='收藏广场-评论';

-- ---- 关注 ----
CREATE TABLE IF NOT EXISTS cl_follow (
  uid VARCHAR(16) NOT NULL COMMENT '关注者',
  target_uid VARCHAR(16) NOT NULL COMMENT '被关注者',
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (uid, target_uid),
  KEY idx_follow_target (target_uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='收藏广场-关注';
