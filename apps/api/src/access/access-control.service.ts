import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { DataSource, In, Repository } from 'typeorm';
import { JwtUser } from '../common/current-user.decorator';
import { EbayProduct } from '../products/ebay-product.entity';
import { User } from '../users/user.entity';
import { DistributorGroup } from './distributor-group.entity';
import { DistributorGroupMember } from './distributor-group-member.entity';
import { GroupProductSku } from './group-product-sku.entity';

function normalizeSku(sku: string): string {
  return String(sku ?? '').trim().toLowerCase();
}

/** 提取 SKU 中间码（前两段，小写），如 "bmw-30315" */
export function skuPrefix(sku: string): string {
  const parts = String(sku).trim().split('-');
  return parts.slice(0, 2).join('-').toLowerCase();
}

@Injectable()
export class AccessControlService {
  // 用户分组定价缓存（30 秒 TTL）
  private userGroupPricesCache = new Map<string, { at: number; value: Map<string, string> }>();
  private readonly CACHE_TTL_MS = 30_000;

  constructor(
    @InjectRepository(DistributorGroup) private readonly groupRepo: Repository<DistributorGroup>,
    @InjectRepository(DistributorGroupMember) private readonly memberRepo: Repository<DistributorGroupMember>,
    @InjectRepository(GroupProductSku) private readonly gpsRepo: Repository<GroupProductSku>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(EbayProduct) private readonly productRepo: Repository<EbayProduct>,
    private readonly ds: DataSource,
  ) {}

  // ─────────────────── 分组 CRUD ───────────────────

  async listGroups() {
    return this.groupRepo
      .createQueryBuilder('g')
      .orderBy('g.updatedAt', 'DESC')
      .addOrderBy('g.createdAt', 'DESC')
      .getMany();
  }

  async createGroup(args: { code: string; name: string; description?: string | null }) {
    const code = String(args.code ?? '').trim();
    const name = String(args.name ?? '').trim();
    if (!code) throw new BadRequestException('code 不能为空');
    if (!name) throw new BadRequestException('name 不能为空');
    const entity = this.groupRepo.create({ code, name, description: args.description ?? null });
    try {
      return await this.groupRepo.save(entity);
    } catch (err) {
      const dbCode = (err as { code?: string })?.code;
      if (dbCode === 'ER_DUP_ENTRY' || dbCode === 'SQLITE_CONSTRAINT' || dbCode === '23505') {
        throw new BadRequestException('组 code 已存在');
      }
      throw err;
    }
  }

  async updateGroup(id: string, patch: Partial<{ code: string; name: string; description: string | null }>) {
    const g = await this.groupRepo.findOne({ where: { id } });
    if (!g) throw new NotFoundException('组不存在');
    if (patch.code !== undefined) {
      const code = String(patch.code ?? '').trim();
      if (!code) throw new BadRequestException('code 不能为空');
      g.code = code;
    }
    if (patch.name !== undefined) {
      const name = String(patch.name ?? '').trim();
      if (!name) throw new BadRequestException('name 不能为空');
      g.name = name;
    }
    if (patch.description !== undefined) g.description = patch.description ?? null;
    try {
      return await this.groupRepo.save(g);
    } catch (err) {
      const dbCode = (err as { code?: string })?.code;
      if (dbCode === 'ER_DUP_ENTRY' || dbCode === 'SQLITE_CONSTRAINT' || dbCode === '23505') {
        throw new BadRequestException('组 code 已存在');
      }
      throw err;
    }
  }

  async deleteGroup(id: string) {
    const g = await this.groupRepo.findOne({ where: { id } });
    if (!g) throw new NotFoundException('组不存在');
    await this.ds.transaction(async (tx) => {
      await tx.getRepository(DistributorGroupMember).delete({ groupId: id });
      await tx.getRepository(GroupProductSku).delete({ groupId: id });
      await tx.getRepository(DistributorGroup).delete({ id });
    });
    this.clearGroupPricesCacheForGroup(id);
    return g;
  }

  // ─────────────────── 分组成员 ───────────────────

  async listGroupMembers(groupId: string) {
    const g = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!g) throw new NotFoundException('组不存在');
    const members = await this.memberRepo.find({ where: { groupId } });
    if (members.length === 0) return [];
    const userIds = Array.from(new Set(members.map((m) => m.userId)));
    const users = await this.userRepo.find({ where: { id: In(userIds) } });
    const map = new Map(users.map((u) => [u.id, u]));
    return userIds
      .map((id) => map.get(id))
      .filter((u): u is User => Boolean(u))
      .map((u) => ({
        id: u.id,
        email: u.email,
        phone: u.phone ?? null,
        displayName: u.displayName ?? null,
        role: u.role,
      }));
  }

  async setGroupMembers(groupId: string, userIds: string[]) {
    const g = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!g) throw new NotFoundException('组不存在');
    const unique = Array.from(new Set((userIds ?? []).map((x) => String(x ?? '').trim()).filter(Boolean)));
    const users = unique.length ? await this.userRepo.find({ where: { id: In(unique) } }) : [];
    if (users.length !== unique.length) throw new BadRequestException('存在无效的用户 id');
    if (users.some((u) => u.role !== 'DISTRIBUTOR')) throw new BadRequestException('只能将 DISTRIBUTOR 用户加入组');
    await this.ds.transaction(async (tx) => {
      await tx.getRepository(DistributorGroupMember).delete({ groupId });
      if (unique.length) {
        await tx.getRepository(DistributorGroupMember).insert(unique.map((uid) => ({ groupId, userId: uid })));
      }
    });
    this.clearGroupPricesCacheForGroup(groupId);
    return { groupId, userIds: unique };
  }

  async getUserGroupIds(userId: string): Promise<string[]> {
    const rows = await this.memberRepo.find({ where: { userId } });
    return Array.from(new Set(rows.map((r) => r.groupId))).filter(Boolean);
  }

  // ─────────────────── 分组可见商品（SKU 中间码） ───────────────────

  /** 获取某个分组的可见商品中间码列表 */
  async listGroupProductSkus(groupId: string): Promise<string[]> {
    const g = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!g) throw new NotFoundException('组不存在');
    const rows = await this.gpsRepo.find({ where: { groupId }, order: { skuPrefix: 'ASC' } });
    return rows.map((r) => r.skuPrefix);
  }

  /** 设置某个分组的可见商品（按 SKU 中间码，全量覆盖） */
  async setGroupProductsBySkus(
    groupId: string,
    rawSkus: string[],
  ): Promise<{ totalRows: number; bound: number; missing: string[]; totalProducts: number }> {
    const g = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!g) throw new NotFoundException('组不存在');

    // 提取中间码并去重
    const prefixSet = new Set<string>();
    for (const raw of rawSkus ?? []) {
      const s = String(raw ?? '').trim();
      if (!s) continue;
      prefixSet.add(skuPrefix(s));
    }
    const prefixes = Array.from(prefixSet);

    if (prefixes.length === 0) {
      await this.gpsRepo.delete({ groupId });
      this.clearGroupPricesCacheForGroup(groupId);
      return { totalRows: 0, bound: 0, missing: [], totalProducts: 0 };
    }

    // 校验这些中间码在 ebay_products 中是否存在
    const products = await this.ds.query(
      `SELECT id, TRIM(sku) AS sku
       FROM (
         SELECT p.id, p.sku,
           ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(p.sku)) ORDER BY p.updated_at DESC, p.created_at DESC) AS rn
         FROM ebay_products p
         WHERE LOWER(SUBSTRING_INDEX(TRIM(p.sku), '-', 2)) IN (?)
       ) t WHERE t.rn = 1`,
      [prefixes],
    ) as Array<{ id?: string; sku?: string }>;

    const foundPrefixes = new Set(
      products.map((p) => skuPrefix(String(p?.sku ?? ''))).filter(Boolean),
    );
    const validPrefixes = prefixes.filter((p) => foundPrefixes.has(p));
    const missing = prefixes.filter((p) => !foundPrefixes.has(p));

    // 全量替换该组的可见商品
    await this.ds.transaction(async (tx) => {
      await tx.getRepository(GroupProductSku).delete({ groupId });
      if (validPrefixes.length) {
        await tx.getRepository(GroupProductSku).insert(
          validPrefixes.map((prefix) => ({ groupId, skuPrefix: prefix, price: null })),
        );
      }
    });

    this.clearGroupPricesCacheForGroup(groupId);
    return {
      totalRows: prefixes.length,
      bound: validPrefixes.length,
      missing,
      totalProducts: products.length,
    };
  }

  // ─────────────────── 专属定价 ───────────────────

  /** 获取分组所有可见 SKU 中间码及其价格（含默认价） */
  async getGroupPrices(groupId: string): Promise<Array<{ sku: string; price: string; source: 'group' | 'default' }>> {
    const rows = await this.gpsRepo.find({ where: { groupId }, order: { skuPrefix: 'ASC' } });
    if (rows.length === 0) return [];

    const prefixes = rows.map((r) => r.skuPrefix);

    // 默认价格直接取 ebay_products 原价（领星同步，通常 USD）
    const defaultPriceMap = new Map<string, string>();
    if (prefixes.length > 0) {
      const productRows = await this.ds.query(
        `SELECT
           SUBSTRING_INDEX(LOWER(TRIM(sku)), '-', 2) AS prefix_norm,
           MAX(CAST(COALESCE(price, 0) AS DECIMAL(14,2))) AS price
         FROM ebay_products
         WHERE LOWER(SUBSTRING_INDEX(TRIM(sku), '-', 2)) IN (?)
         GROUP BY SUBSTRING_INDEX(LOWER(TRIM(sku)), '-', 2)`,
        [prefixes],
      ) as Array<{ prefix_norm?: string; price?: number }>;
      for (const r of productRows) {
        const pfx = String(r?.prefix_norm ?? '').trim();
        if (pfx) defaultPriceMap.set(pfx, String(r?.price ?? 0));
      }
    }

    return rows.map((r) => {
      const hasGroupPrice = r.price !== null && r.price !== undefined && Number(r.price) > 0;
      const defaultPrice = defaultPriceMap.get(r.skuPrefix) || '0';
      return {
        sku: r.skuPrefix,
        defaultPrice,
        groupPrice: hasGroupPrice ? r.price! : null,
        price: hasGroupPrice ? r.price! : defaultPrice,
        source: hasGroupPrice ? ('group' as const) : ('default' as const),
      };
    });
  }

  /** 手动添加/更新单条专属定价 */
  async addGroupPrice(groupId: string, sku: string, price: string): Promise<{ sku: string; price: string }> {
    const g = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!g) throw new NotFoundException('组不存在');

    const s = String(sku ?? '').trim();
    if (!s) throw new BadRequestException('SKU 不能为空');
    const p = Number(price);
    if (!Number.isFinite(p) || p < 0) throw new BadRequestException('价格必须为非负数');

    const prefix = skuPrefix(s);

    // 校验中间码必须在 ebay_products 中存在
    const exists = await this.ds.query(
      `SELECT 1 AS one FROM ebay_products
       WHERE LOWER(SUBSTRING_INDEX(TRIM(sku), '-', 2)) = ?
       LIMIT 1`,
      [prefix],
    ) as Array<{ one?: unknown }>;
    if (!exists?.[0]?.one) {
      throw new BadRequestException(`SKU 中间码 "${prefix}" 在商品表中不存在，请确认 SKU 是否正确`);
    }

    // 校验中间码必须在该分组的可见商品中
    const inGroup = await this.gpsRepo.findOne({ where: { groupId, skuPrefix: prefix } });
    if (!inGroup) {
      throw new BadRequestException(`SKU 中间码 "${prefix}" 不在该分组的可见商品中，请先在"可见商品"Tab 中添加`);
    }

    const priceStr = p.toFixed(2);
    inGroup.price = priceStr;
    await this.gpsRepo.save(inGroup);
    this.clearGroupPricesCacheForGroup(groupId);

    return { sku: prefix, price: priceStr };
  }

  /** 删除分组某个 SKU 中间码的专属定价（恢复默认价） */
  async deleteGroupPrice(groupId: string, sku: string): Promise<boolean> {
    const prefix = skuPrefix(sku);
    const gps = await this.gpsRepo.findOne({ where: { groupId, skuPrefix: prefix } });
    if (!gps) return false;

    gps.price = null;
    await this.gpsRepo.save(gps);
    this.clearGroupPricesCacheForGroup(groupId);
    return true;
  }

  // ─────────────────── 用户定价查询 + 缓存 ───────────────────

  /** 获取用户所属各组的所有专属定价 */
  async getUserGroupPrices(userId: string): Promise<Map<string, string>> {
    const groupIds = await this.getUserGroupIds(userId);
    if (groupIds.length === 0) return new Map();

    const cacheKey = `${userId}:${groupIds.sort().join(',')}`;
    const cached = this.userGroupPricesCache.get(cacheKey);
    if (cached && Date.now() - cached.at < this.CACHE_TTL_MS) {
      return new Map(cached.value);
    }

    const rows = await this.gpsRepo.find({ where: { groupId: In(groupIds) } });

    // 按中间码取最低价（多组时取低）
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.price === null || r.price === undefined) continue;
      const existing = map.get(r.skuPrefix);
      if (existing === undefined || Number(r.price) < Number(existing)) {
        map.set(r.skuPrefix, r.price);
      }
    }

    this.userGroupPricesCache.set(cacheKey, { at: Date.now(), value: new Map(map) });
    return map;
  }

  private clearGroupPricesCacheForGroup(groupId: string): void {
    for (const key of this.userGroupPricesCache.keys()) {
      if (key.includes(groupId)) this.userGroupPricesCache.delete(key);
    }
  }

  // ─────────────────── Excel 导入 ───────────────────

  async importGroupProductsXlsx(args: { groupId: string; fileBuffer: Buffer; mode?: 'replace' | 'add' | 'remove' }) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(args.fileBuffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Excel 文件为空');

    // 解析 Excel：第 1 列 SKU，可选第 2 列 price
    const skus: string[] = [];
    const priceMap = new Map<string, string>();

    const headerRow = ws.getRow(1);
    const headerValues = (headerRow.values as Array<string | number | null | undefined>)
      .slice(1)
      .map((v) => String(v ?? '').trim().toLowerCase());

    const priceAliases = ['price', '价格', '售价', '定价', '单价', '分销价', 'rmb'];
    const hasPriceCol = headerValues.some((h) => h && priceAliases.some((a) => h.includes(a)));
    let priceCol = hasPriceCol
      ? headerValues.findIndex((h) => h && priceAliases.some((a) => h.includes(a))) + 1
      : -1;
    if (priceCol < 0) {
      const sample = ws.getRow(2)?.getCell(2)?.value ?? ws.getRow(1)?.getCell(2)?.value;
      if (sample !== null && sample !== undefined && Number.isFinite(Number(String(sample).trim().replace(/,/g, '')))) {
        priceCol = 2;
      }
    }

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        const first = String(row.getCell(1).text ?? '').trim().toLowerCase();
        if (first.includes('sku')) return;
      }
      const sku = String(row.getCell(1).text ?? '').trim();
      if (!sku) return;
      skus.push(sku);

      if (priceCol > 0) {
        const priceRaw = row.getCell(priceCol).value;
        if (priceRaw !== null && priceRaw !== undefined && String(priceRaw).trim()) {
          const n = Number(String(priceRaw).trim().replace(/,/g, ''));
          if (Number.isFinite(n)) priceMap.set(skuPrefix(sku), n.toFixed(2));
        }
      }
    });

    const mode = (args.mode ?? 'replace').toLowerCase();

    // 提取中间码并去重
    const incomingPrefixes = Array.from(new Set(skus.map((s) => skuPrefix(s)).filter(Boolean)));

    // 校验中间码在 ebay_products 中存在
    let validPrefixes: string[];
    let missing: string[];
    if (incomingPrefixes.length > 0) {
      const products = await this.ds.query(
        `SELECT TRIM(sku) AS sku
         FROM (
           SELECT p.sku,
             ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(p.sku)) ORDER BY p.updated_at DESC, p.created_at DESC) AS rn
           FROM ebay_products p
           WHERE LOWER(SUBSTRING_INDEX(TRIM(p.sku), '-', 2)) IN (?)
         ) t WHERE t.rn = 1`,
        [incomingPrefixes],
      ) as Array<{ sku?: string }>;
      const found = new Set(products.map((p) => skuPrefix(String(p?.sku ?? ''))).filter(Boolean));
      validPrefixes = incomingPrefixes.filter((p) => found.has(p));
      missing = incomingPrefixes.filter((p) => !found.has(p));
    } else {
      validPrefixes = [];
      missing = [];
    }

    await this.ds.transaction(async (tx) => {
      const gpsTx = tx.getRepository(GroupProductSku);

      if (mode === 'replace') {
        // 全量替换
        await gpsTx.delete({ groupId: args.groupId });
        if (validPrefixes.length) {
          await gpsTx.insert(
            validPrefixes.map((prefix) => ({
              groupId: args.groupId,
              skuPrefix: prefix,
              price: priceMap.get(prefix) ?? null,
            })),
          );
        }
      } else if (mode === 'add') {
        // 增量添加
        const existingRows = await gpsTx.find({ where: { groupId: args.groupId } });
        const existingPrefixes = new Set(existingRows.map((r) => r.skuPrefix));
        const newPrefixes = validPrefixes.filter((p) => !existingPrefixes.has(p));
        if (newPrefixes.length) {
          await gpsTx.insert(
            newPrefixes.map((prefix) => ({
              groupId: args.groupId,
              skuPrefix: prefix,
              price: priceMap.get(prefix) ?? null,
            })),
          );
        }
        // 更新已有行的定价（如果 Excel 有填价格）
        for (const r of existingRows) {
          const newPrice = priceMap.get(r.skuPrefix);
          if (newPrice !== undefined) {
            r.price = newPrice;
            await gpsTx.save(r);
          }
        }
      } else if (mode === 'remove') {
        // 移除指定中间码
        if (incomingPrefixes.length) {
          await gpsTx.delete({ groupId: args.groupId, skuPrefix: In(incomingPrefixes) });
        }
      }
    });

    this.clearGroupPricesCacheForGroup(args.groupId);

    const boundProducts = validPrefixes.length > 0
      ? await this.ds.query(
          `SELECT COUNT(1) AS c FROM (
             SELECT 1 FROM ebay_products
             WHERE LOWER(SUBSTRING_INDEX(TRIM(sku), '-', 2)) IN (?)
             LIMIT 1000
           ) t`,
          [validPrefixes],
        )
      : [{ c: 0 }];

    return {
      totalRows: incomingPrefixes.length,
      bound: validPrefixes.length,
      missing,
      totalProducts: Number((boundProducts as Array<{ c?: number }>)?.[0]?.c ?? 0),
    };
  }

  // ─────────────────── 统计 ───────────────────

  /** 未分组商品统计 */
  async getUngroupedStats(): Promise<{ totalProducts: number; groupedProducts: number; ungroupedProducts: number }> {
    const total = await this.productRepo.createQueryBuilder('p').select('COUNT(1)', 'c').getRawOne<{ c: number }>();
    const totalProducts = Number(total?.c ?? 0);

    // 有至少一个分组的商品数（按实际商品去重）
    const grouped = await this.ds.query(
      `SELECT COUNT(DISTINCT p.id) AS c
       FROM ebay_products p
       INNER JOIN group_product_skus gps
         ON LOWER(SUBSTRING_INDEX(TRIM(p.sku), '-', 2)) = gps.sku_prefix`,
    ) as Array<{ c?: number }>;
    const groupedProducts = Number(grouped?.[0]?.c ?? 0);

    return { totalProducts, groupedProducts, ungroupedProducts: Math.max(0, totalProducts - groupedProducts) };
  }

  // ─────────────────── 可见性判断 ───────────────────

  /** 判断某个 SKU 对用户是否可见 */
  async isEbaySkuVisibleToUser(sku: string, user: JwtUser): Promise<boolean> {
    if (user.role === 'ADMIN') return true;
    const prefix = skuPrefix(sku);
    if (!prefix) return false;

    const groupIds = await this.getUserGroupIds(user.sub);
    // 无分组用户：所有商品可见
    if (groupIds.length === 0) return true;

    // 有分组用户：检查中间码是否在 group_product_skus 中
    const row = await this.gpsRepo.findOne({
      where: { skuPrefix: prefix, groupId: In(groupIds) },
    });
    return !!row;
  }

  async assertEbaySkuVisibleToUser(sku: string, user: JwtUser): Promise<void> {
    const ok = await this.isEbaySkuVisibleToUser(sku, user);
    if (!ok) throw new NotFoundException('商品不存在');
  }
}
