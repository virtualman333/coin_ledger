-- 我的收藏：分享快照（2026-11-20）
-- 转发/朋友圈分享时生成一份只读副本，朋友点开看到的是分享者的收藏清单。
-- 快照里只存公开字段（品种名/年份/数量/图片/系列），不存成本、市值、盈亏。
CREATE TABLE IF NOT EXISTS cl_colshare (
  code       VARCHAR(16) NOT NULL COMMENT '分享码',
  uid        VARCHAR(16) NOT NULL COMMENT '分享者 uid',
  nickname   VARCHAR(64) NOT NULL DEFAULT '' COMMENT '分享者昵称（冗余，避免联表）',
  items      MEDIUMTEXT NOT NULL COMMENT '脱敏后的收藏 JSON 数组',
  kinds      INT NOT NULL DEFAULT 0 COMMENT '品种数',
  total      INT NOT NULL DEFAULT 0 COMMENT '总件数',
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (code),
  KEY idx_colshare_uid (uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='我的收藏-分享快照';
