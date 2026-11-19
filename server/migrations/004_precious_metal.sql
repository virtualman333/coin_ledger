-- =====================================================================
-- 004 · 贵金属套内规格明细
--
-- 粒度决策（A1）：一「套」= 一个目录单元（cl_coins 一行），
-- 套内每一枚的规格落在这里（一套 15 枚 = 15 行）。
-- 为什么不给每枚建一行目录：28 个规格 / 165 个品种 = 17%，直接破 G3「≤10%」红线；
-- 按套算 3 / 140 = 2.1%。
--
-- 单位红线（A3）：贵金属公告的发行量单位是「枚」（18 枚 / 2000 枚），
-- 而存量普通币的 mintage 单位是「万枚」（2041 = 2041 万枚）。
-- 18 枚 = 0.0018 万枚，DECIMAL(12,2) 存不下，混用必然出错 ——
-- 所以套级 mintage 恒 NULL，逐枚发行量以「枚」存 max_mintage，
-- 并用 mintage_unit 显式标注单位，任何聚合都不会再靠猜。
-- =====================================================================

-- @@

CREATE TABLE IF NOT EXISTS cl_pm_pieces (
  coin_no      INT UNSIGNED     NOT NULL COMMENT '所属套的 cl_coins.no',
  seq          TINYINT UNSIGNED NOT NULL COMMENT '套内序号 1..n，按公告顺序',
  name         VARCHAR(64)      NOT NULL,
  metal        ENUM('gold','silver','platinum','bimetal') NOT NULL,
  weight_g     DECIMAL(10,2)    NOT NULL COMMENT '单枚克重（克）',
  purity       DECIMAL(5,3)     NOT NULL COMMENT '成色 0.999',
  face         DECIMAL(10,2)    NOT NULL COMMENT '单枚面额（元）',
  max_mintage  INT UNSIGNED     NOT NULL COMMENT '单枚最大发行量，单位见 mintage_unit',
  mintage_unit ENUM('piece','wan_piece') NOT NULL DEFAULT 'piece'
                                COMMENT 'piece=枚（贵金属公告口径）、wan_piece=万枚（存量普通币口径）；绝不能混',
  shape        ENUM('round','plum','rhombus','other') NOT NULL DEFAULT 'round'
                                COMMENT '梅花形→plum、菱形→rhombus',
  size_text    VARCHAR(32)      NULL COMMENT '⌀32mm / 外接⌀100mm / 边长 23mm（保留公告原表述）',
  quality      ENUM('proof','uncirculated') NULL,
  reverse_text VARCHAR(255)     NULL COMMENT '背面图案',
  PRIMARY KEY (coin_no, seq),
  CONSTRAINT fk_piece_coin FOREIGN KEY (coin_no) REFERENCES cl_coins (no)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='贵金属套内每一枚的规格（只读参考，不参与成本折算）';
