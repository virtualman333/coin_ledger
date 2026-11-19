-- =====================================================================
-- 001 · 目录核心表（品种主表 / 描述 / 新账号初始藏品模板）
--
-- 约定（见 arch-db-refactor.md 3.1 与 10）：
--   · 表名 cl_ 前缀；列 snake_case；对外 JSON 一律 camelCase（SQL 里 AS 转换）
--   · 时间 DATETIME(3) UTC；金额/克重 DECIMAL
--   · 语句之间用独立行 `-- @@` 分隔：触发器体里有分号，DELIMITER 是 CLI 语法
--     驱动不认，所以 runner 按 `-- @@` 切块、每块整段发送，且全程
--     multipleStatements: false
-- =====================================================================

-- @@

-- 品种主表：一行 = 一个「目录单元」
--   普通币/纪念钞 = 一枚（kind 区分 coin/note）
--   贵金属       = 一「套」（is_set=1，套内每一枚的规格见 cl_pm_pieces）
-- no 是业务主键，与 id 自增 PK 分离：id 给外键用，no 给路由/图片名/SEO/描述 key 用。
CREATE TABLE IF NOT EXISTS cl_coins (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  no             INT UNSIGNED     NOT NULL COMMENT '对外序号 = 旧数组下标 i+1。业务主键，UNIQUE，1..137 永久锁定',
  category       ENUM('commemorative_coin','commemorative_note','precious_metal')
                                  NOT NULL DEFAULT 'commemorative_coin',
  category_rank  TINYINT UNSIGNED NOT NULL DEFAULT 0
                                  COMMENT '排序权重 0=普通币 1=纪念钞 2=贵金属；与 category 同步写',
  kind           ENUM('coin','note') NOT NULL DEFAULT 'coin' COMMENT 'legacy 兼容字段，贵金属写 coin',
  year           SMALLINT UNSIGNED NOT NULL,
  name           VARCHAR(128)     NOT NULL,
  series         VARCHAR(16)      NOT NULL DEFAULT '' COMMENT '主系列 key（可为空串）',
  series_keys    JSON             NULL COMMENT '多系列；NULL 时投影回落 [series]',
  face           DECIMAL(10,2)    NOT NULL DEFAULT 0
                                  COMMENT '面额（元）。贵金属「套」= 整套面额合计（set_face_total），前台卡片不展示',
  mintage        DECIMAL(12,2)    NULL
                                  COMMENT '最大发行量，单位见 mintage_unit（存量=万枚，含 261.5 这类小数）。贵金属套无单一发行量→NULL',
  mintage_unit   ENUM('wan_piece','piece') NOT NULL DEFAULT 'wan_piece'
                                  COMMENT '发行量单位：wan_piece=万枚/万张（存量普通币钞）、piece=枚（贵金属公告口径）。两者绝不能混',
  mintage_note   VARCHAR(255)     NULL,
  material       VARCHAR(32)      NOT NULL DEFAULT '' COMMENT '展示文本（金质/铜镍合金…）',
  dia            DECIMAL(6,1)     NULL COMMENT '直径数值；存量纪念钞的「—」不进本列',
  dia_text       VARCHAR(8)       NULL COMMENT '非数值占位（存量 10 条纪念钞的 "—"）',
  size           VARCHAR(16)      NULL COMMENT '纪念钞票幅 165×80',
  thickness      VARCHAR(16)      NULL,
  weight         VARCHAR(16)      NULL COMMENT 'legacy 展示文本 9.32克；结构化克重看 weight_g',
  caster         VARCHAR(64)      NULL,
  edge           VARCHAR(32)      NULL COMMENT '初始宽度 32；005_edge_widen.sql 放宽到 128（公告原文最长 42 字符）',
  obverse        TEXT             NULL,
  reverse        TEXT             NULL,
  spec_from      VARCHAR(64)      NULL COMMENT '旧字段 specFrom：参数是否推定',
  est            DECIMAL(12,2)    NULL COMMENT '参考估值，非交易价；贵金属恒为 NULL',
  set_code       VARCHAR(32)      NOT NULL DEFAULT 'single',
  pieces         SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  set_size       SMALLINT UNSIGNED NULL,
  limit_qty      SMALLINT UNSIGNED NULL COMMENT '旧字段 limit：预约限额',
  reserve_limit  SMALLINT UNSIGNED NULL,
  /* ---- 贵金属结构化字段（普通币钞全 NULL） ---- */
  metal          ENUM('gold','silver','platinum','bimetal','mixed') NULL
                                  COMMENT 'mixed=套内多材质，真实值看 cl_pm_pieces',
  purity         DECIMAL(5,3)     NULL COMMENT '0.999',
  weight_g       DECIMAL(10,2)    NULL COMMENT '单枚克重；is_set=1 时留空，改用 set_weight_g',
  spec           VARCHAR(64)      NULL COMMENT '规格/尺寸/精制等展示描述',
  shape          ENUM('round','plum','rhombus','other') NULL,
  quality        ENUM('proof','uncirculated') NULL,
  issue_method   ENUM('reservation','lottery','direct_sale','unknown') NULL,
  issue_date     DATE             NULL,
  is_set         TINYINT(1)       NOT NULL DEFAULT 0,
  set_pieces     SMALLINT UNSIGNED NULL COMMENT 'is_set=1 必填',
  set_weight_g   DECIMAL(10,2)    NULL COMMENT '套内总克重（逐枚求和，不是估算）',
  set_face_total DECIMAL(12,2)    NULL COMMENT '套内总面额（逐枚求和）',
  sales_channel  VARCHAR(64)      NULL,
  dealer         VARCHAR(64)      NULL,
  certificate    VARCHAR(64)      NULL,
  packaging      VARCHAR(64)      NULL,
  /* ---- 来源与状态 ---- */
  source_url     VARCHAR(255)     NOT NULL DEFAULT '' COMMENT '存量 137 条以 legacy:public/data/coins.json 占位',
  source_text    VARCHAR(255)     NULL,
  source_date    DATE             NULL,
  verified       TINYINT(1)       NOT NULL DEFAULT 0 COMMENT '1=已核验来源；未核验不允许 publish',
  status         ENUM('draft','published') NOT NULL DEFAULT 'published',
  created_at     DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_no (no),
  KEY idx_cat_sort (category_rank, year, no),
  KEY idx_series (series),
  KEY idx_status (status),
  KEY idx_year (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='品种目录单一事实源（no 为业务主键）';

-- @@

-- 品种描述（原 descriptions.json，128 条）。9 个品种没有描述属正常，
-- 缺的是 19/26/38/59/86/87/101/130/136 —— 迁移时原样保留缺失，不补空行。
CREATE TABLE IF NOT EXISTS cl_coin_descriptions (
  coin_no      INT UNSIGNED NOT NULL,
  title        VARCHAR(255) NOT NULL DEFAULT '',
  url          VARCHAR(255) NULL,
  body         MEDIUMTEXT   NOT NULL COMMENT '原 text',
  body_md      MEDIUMTEXT   NULL COMMENT '原 textMd',
  published_on DATE         NULL COMMENT '原 date（原文里是「1984年」这类，迁移时能解析则入列，否则留空）',
  date_text    VARCHAR(32)  NULL COMMENT '原 date 的原始文本（无法解析成日期时保留原样，保证导出零漂移）',
  source       VARCHAR(32)  NULL COMMENT '原 source（baike / 空）',
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (coin_no),
  CONSTRAINT fk_desc_coin FOREIGN KEY (coin_no) REFERENCES cl_coins (no)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='央行公告原文/百科介绍，按 no 一对一';

-- @@

-- 新账号的初始藏品模板（coins.json 的 defaults，12 条；/api/bootstrap 必须原样下发）
CREATE TABLE IF NOT EXISTS cl_default_holdings (
  ord    SMALLINT UNSIGNED NOT NULL,
  name   VARCHAR(64)       NOT NULL,
  rolls  INT               NOT NULL DEFAULT 0,
  cost   DECIMAL(12,2)     NOT NULL DEFAULT 0,
  market DECIMAL(12,2)     NOT NULL DEFAULT 0,
  grp    VARCHAR(32)       NOT NULL DEFAULT '独立藏品',
  sep    TINYINT(1)        NOT NULL DEFAULT 0,
  PRIMARY KEY (ord)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='新用户初始藏品模板';
