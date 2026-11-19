-- =====================================================================
-- 002 · 目录附属表（系列 / 套系 / 多图 / 年度计划 / 迁移记录）
-- 语句之间用独立行 `-- @@` 分隔（见 001 头部说明）
-- =====================================================================

-- @@

-- 系列主数据（20 条，仅元信息）。成员不在这里：靠 cl_coins.series_keys，
-- 因为品种与系列是多对多（「纪念钞」与「生肖纪念钞」可同时含龙钞/蛇钞/马钞）。
-- sort 值域 10–180 为普通系列；贵金属系列 PM 用 200，天然排在最后。
CREATE TABLE IF NOT EXISTS cl_series (
  series_key VARCHAR(16)  NOT NULL,
  name       VARCHAR(32)  NOT NULL,
  descr      VARCHAR(255) NOT NULL DEFAULT '' COMMENT '对外字段名 desc（desc 是 SQL 保留字，列名用 descr）',
  img        VARCHAR(160) NOT NULL DEFAULT '',
  img_from   VARCHAR(16)  NULL,
  sort       SMALLINT     NOT NULL DEFAULT 0,
  PRIMARY KEY (series_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系列主数据（20 条，仅元信息；成员靠 cl_coins.series_keys）';

-- @@

-- 普通币套系（21 条）。贵金属套装不复用此表（它的规格在 cl_pm_pieces）。
CREATE TABLE IF NOT EXISTS cl_sets (
  set_code VARCHAR(32)       NOT NULL,
  name     VARCHAR(64)       NOT NULL,
  unit     VARCHAR(8)        NOT NULL DEFAULT '枚',
  total    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  members  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  size     SMALLINT UNSIGNED NULL COMMENT '每卷/每刀枚数',
  kind     VARCHAR(16)       NULL COMMENT 'roll 等',
  PRIMARY KEY (set_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='普通币套系（21 条）';

-- @@

-- 品种多图。gallery.json 的 {f,k} 原样落这里；images.json 的 real/mock 由 is_mock 派生。
CREATE TABLE IF NOT EXISTS cl_coin_images (
  coin_no  INT UNSIGNED     NOT NULL,
  kind     ENUM('main','obverse','reverse','set') NOT NULL,
  filename VARCHAR(64)      NOT NULL,
  is_mock  TINYINT(1)       NOT NULL DEFAULT 0 COMMENT '1=占位图（存量 34/56）',
  ord      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (coin_no, kind),
  KEY idx_kind (kind),
  CONSTRAINT fk_img_coin FOREIGN KEY (coin_no) REFERENCES cl_coins (no)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='品种多图；images.json 的 real/mock 由 is_mock 派生';

-- @@

-- 央行年度发行计划。items 原样存 JSON：条目字段异质（extra/banks/design/schedule…），
-- 拆成列必然漂移；整份替换语义（PUT /api/admin/plan）也靠这一个 JSON 列最省事。
CREATE TABLE IF NOT EXISTS cl_plan_years (
  year         SMALLINT UNSIGNED NOT NULL,
  published_at DATE            NULL COMMENT '对外字段 publishedAt',
  published_by VARCHAR(64)     NULL,
  source_url   VARCHAR(255)    NULL,
  source_text  TEXT            NULL,
  items        JSON            NOT NULL,
  ord          TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='央行年度发行计划（只含普通币钞，永不含贵金属）';

-- @@

CREATE TABLE IF NOT EXISTS cl_plan_doc (
  id      TINYINT UNSIGNED NOT NULL DEFAULT 1,
  updated DATE             NULL,
  note    TEXT             NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='计划文档级元信息（1 行）';

-- @@

-- 迁移记账：runner.js 按 version 顺序执行、按 checksum 判定「内容被改过」。
CREATE TABLE IF NOT EXISTS cl_schema_migrations (
  version    VARCHAR(32) NOT NULL,
  checksum   CHAR(64)    NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='已应用的迁移版本与文件校验和';
