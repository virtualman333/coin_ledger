-- =====================================================================
-- 003 · 保号红线（库级落地）
--
-- 为什么 `no` 必须锁死：
--   no 同时是「数组下标 / 图片文件名 / 路由段 / 描述 key / sitemap 序号」五重身份。
--   一旦重排，137 个 SEO 页 + 137 张图 + 已收录的外部链接全部错位，且无法自动修复。
--   所以这里用触发器把「改 no」「改已发布品种的 category」「删已发布品种」全部拒掉。
--
-- 双保险：coin.service 在写入前先做一次断言（400 + 中文文案），
--        触发器是最后一道闸（SQLSTATE 45000，兜住任何绕过 service 的写入）。
--
-- 137 这个常量是「历史已收录边界」，刻意写死在触发器里，不是可配置项。
-- 将来真要动，必须走「新增迁移 + 全站 301 映射」的专项。
--
-- 注意：触发器体里有分号，mysql2 一旦开 multipleStatements 就会被拆断，
--      而 DELIMITER 是 mysql CLI 语法、驱动不认。因此每个触发器整段作为一个
--      `-- @@` 块发送，runner 全程 multipleStatements: false。
-- =====================================================================

-- @@

DROP TRIGGER IF EXISTS trg_cl_coins_no_immutable;

-- @@

CREATE TRIGGER trg_cl_coins_no_immutable BEFORE UPDATE ON cl_coins
FOR EACH ROW
BEGIN
  IF NEW.no <> OLD.no THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cl_coins.no 禁止修改（保号红线：路由/图片/SEO 全错位）';
  END IF;
  IF NEW.id <> OLD.id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cl_coins.id 禁止修改';
  END IF;
  IF OLD.no <= 137 AND NEW.category <> OLD.category THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '已发布品种的 category 禁止变更（排序与分类口径会漂移）';
  END IF;
END;

-- @@

DROP TRIGGER IF EXISTS trg_cl_coins_legacy_delete;

-- @@

CREATE TRIGGER trg_cl_coins_legacy_delete BEFORE DELETE ON cl_coins
FOR EACH ROW
BEGIN
  IF OLD.no <= 137 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '已发布品种 1..137 禁止删除（只允许删除 no>=138 且 status=draft 的新品种）';
  END IF;
END;

-- 说明：arch 的 003 里还列了一个「运维可读视图」。这里**故意不建**：
--   CREATE VIEW 需要额外的 CREATE VIEW 权限，而线上库账号是按表授权的（最小权限）。
--   为了一个「代码不读、只给人看」的视图，让整个 003 迁移在权限不足时失败，
--   代价远大于收益 —— 需要看「已发布品种」时直接 SELECT ... WHERE status='published' 即可。
