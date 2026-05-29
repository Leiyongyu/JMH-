import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { DataSource, In, Repository } from 'typeorm';
import { JwtUser } from '../common/current-user.decorator';
import { EbayProduct } from '../products/ebay-product.entity';
import { User } from '../users/user.entity';
import { DistributorGroup } from './distributor-group.entity';
import { DistributorGroupMember } from './distributor-group-member.entity';
import { DistributorGroupPrice } from './distributor-group-price.entity';
import { EbayProductVisibilityGroup } from './ebay-product-visibility-group.entity';

function normalizeSku(sku: string): string {
  return String(sku ?? '').trim().toLowerCase();
}

function skuPrefix(sku: string): string {
  const parts = String(sku).trim().split('-');
  return parts.slice(0, 2).join('-').toLowerCase();
}

@Injectable()
export class AccessControlService {
  constructor(
    @InjectRepository(DistributorGroup) private readonly groupRepo: Repository<DistributorGroup>,
    @InjectRepository(DistributorGroupMember) private readonly memberRepo: Repository<DistributorGroupMember>,
    @InjectRepository(DistributorGroupPrice) private readonly groupPriceRepo: Repository<DistributorGroupPrice>,
    @InjectRepository(EbayProductVisibilityGroup) private readonly pvgRepo: Repository<EbayProductVisibilityGroup>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(EbayProduct) private readonly productRepo: Repository<EbayProduct>,
    private readonly ds: DataSource,
  ) {}

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
    const entity = this.groupRepo.create({
      code,
      name,
      description: args.description ?? null,
    });
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
      await tx.getRepository(EbayProductVisibilityGroup).delete({ groupId: id });
      await tx.getRepository(DistributorGroup).delete({ id });
    });
    return g;
  }

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
        await tx.getRepository(DistributorGroupMember).insert(
          unique.map((uid) => ({
            groupId,
            userId: uid,
          })),
        );
      }
    });
    return { groupId, userIds: unique };
  }

  async listGroupProductSkus(groupId: string) {
    const g = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!g) throw new NotFoundException('组不存在');
    const links = await this.pvgRepo.find({ where: { groupId } });
    if (links.length === 0) return [];
    const productIds = Array.from(new Set(links.map((x) => x.productId)));
    const products = await this.productRepo.find({ where: { id: In(productIds) } });
    const map = new Map(products.map((p) => [p.id, p]));
    const out: string[] = [];
    const seen = new Set<string>();
    for (const id of productIds) {
      const p = map.get(id);
      if (!p) continue;
      const norm = normalizeSku(p.sku);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      out.push(p.sku);
    }
    return out;
  }

  async setGroupProductsBySkus(groupId: string, skus: string[]) {
    const g = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!g) throw new NotFoundException('组不存在');
    const normMap = new Map<string, string>();
    for (const raw of skus ?? []) {
      const s = String(raw ?? '').trim();
      if (!s) continue;
      const norm = normalizeSku(s);
      if (!normMap.has(norm)) normMap.set(norm, s);
    }
    const normList = Array.from(normMap.keys());
    if (normList.length === 0) {
      await this.pvgRepo.delete({ groupId });
      return { totalRows: 0, bound: 0, missing: [] as string[] };
    }

    const products = await this.ds.query(
      `
      SELECT id, TRIM(sku) AS sku
      FROM (
        SELECT
          p.id AS id,
          p.sku AS sku,
          ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(p.sku)) ORDER BY p.updated_at DESC, p.created_at DESC) AS rn
        FROM ebay_products p
        WHERE LOWER(TRIM(p.sku)) IN (?)
      ) t
      WHERE t.rn = 1
      `,
      [normList],
    );
    const productIds: string[] = [];
    const foundNorm = new Set<string>();
    for (const row of products as Array<{ id?: string; sku?: string }>) {
      const id = String(row?.id ?? '').trim();
      const sku = String(row?.sku ?? '').trim();
      if (!id || !sku) continue;
      productIds.push(id);
      foundNorm.add(normalizeSku(sku));
    }
    const missing = normList.filter((n) => !foundNorm.has(n)).map((n) => normMap.get(n) ?? n);

    await this.ds.transaction(async (tx) => {
      await tx.getRepository(EbayProductVisibilityGroup).delete({ groupId });
      if (productIds.length) {
        await tx.getRepository(EbayProductVisibilityGroup).insert(
          Array.from(new Set(productIds)).map((pid) => ({
            groupId,
            productId: pid,
          })),
        );
      }
    });

    return { totalRows: normList.length, bound: productIds.length, missing };
  }

  async setGroupPrices(groupId: string, priceMap: Map<string, string>) {
    const entries = Array.from(priceMap.entries()).filter(([sku]) => String(sku).trim());
    if (entries.length === 0) return { updated: 0 };

    const rows = entries.map(([sku, price]) => ({
      groupId,
      sku: String(sku).trim(),
      price,
    }));

    await this.groupPriceRepo
      .createQueryBuilder()
      .insert()
      .into(DistributorGroupPrice)
      .values(rows as unknown as Record<string, unknown>[])
      .orUpdate(['price', 'updated_at'], ['group_id', 'sku'])
      .execute();

    return { updated: rows.length };
  }

  async getGroupPrices(groupId: string): Promise<Array<{ sku: string; price: string }>> {
    const rows = await this.groupPriceRepo.find({ where: { groupId }, order: { sku: 'ASC' } });
    return rows.map((r) => ({ sku: r.sku, price: r.price }));
  }

  async deleteGroupPrice(groupId: string, sku: string): Promise<boolean> {
    const prefix = skuPrefix(sku);
    const result = await this.groupPriceRepo
      .createQueryBuilder()
      .delete()
      .where('group_id = :groupId', { groupId })
      .andWhere("LOWER(SUBSTRING_INDEX(TRIM(sku), '-', 2)) = :prefix", { prefix })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /** 获取用户所属组对所有 SKU 前缀的定价 */
  async getUserGroupPrices(userId: string): Promise<Map<string, string>> {
    const groupIds = await this.getUserGroupIds(userId);
    if (groupIds.length === 0) return new Map();

    const rows = await this.groupPriceRepo
      .createQueryBuilder('p')
      .where('p.groupId IN (:...groupIds)', { groupIds })
      .getMany();

    // 按前缀取最低价（同一前缀多组时取最低）
    const map = new Map<string, string>();
    for (const r of rows) {
      const prefix = skuPrefix(r.sku);
      const existing = map.get(prefix);
      if (existing === undefined || Number(r.price) < Number(existing)) {
        map.set(prefix, r.price);
      }
    }
    return map;
  }

  async importGroupProductsXlsx(args: { groupId: string; fileBuffer: Buffer; mode?: 'replace' | 'add' | 'remove' }) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(args.fileBuffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Excel 文件为空');

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
    // 兜底：如果第 2 列的值看起来像数字，默认它就是价格列
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
          if (Number.isFinite(n)) priceMap.set(sku, n.toFixed(2));
        }
      }
    });

    const mode = (args.mode ?? 'replace').toLowerCase();

    // 处理定价
    if (priceMap.size > 0) {
      if (mode === 'replace') {
        await this.groupPriceRepo.delete({ groupId: args.groupId });
      }
      await this.setGroupPrices(args.groupId, priceMap);
    }

    if (mode === 'replace') return this.setGroupProductsBySkus(args.groupId, skus);

    const g = await this.groupRepo.findOne({ where: { id: args.groupId } });
    if (!g) throw new NotFoundException('组不存在');

    const existingLinks = await this.pvgRepo.find({ where: { groupId: args.groupId } });
    const existingProductIds = new Set(existingLinks.map((x) => x.productId));
    const existingProducts = existingProductIds.size
      ? await this.productRepo.find({ where: { id: In(Array.from(existingProductIds)) } })
      : [];
    const existingSkus = new Set(existingProducts.map((p) => normalizeSku(p.sku)));

    const normIncoming = Array.from(new Set(skus.map((s) => normalizeSku(s)).filter(Boolean)));
    const mergedNorm =
      mode === 'add'
        ? Array.from(new Set([...existingSkus, ...normIncoming]))
        : mode === 'remove'
          ? Array.from(new Set([...existingSkus].filter((x) => !new Set(normIncoming).has(x))))
          : normIncoming;

    return this.setGroupProductsBySkus(args.groupId, mergedNorm);
  }

  async getUserGroupIds(userId: string): Promise<string[]> {
    const rows = await this.memberRepo.find({ where: { userId } });
    return Array.from(new Set(rows.map((r) => r.groupId))).filter(Boolean);
  }

  async isEbaySkuVisibleToUser(sku: string, user: JwtUser): Promise<boolean> {
    if (user.role === 'ADMIN') return true;
    const skuNorm = normalizeSku(sku);
    if (!skuNorm) return false;
    const rows = (await this.ds.query(
      `SELECT id FROM ebay_products WHERE (LOWER(TRIM(sku)) COLLATE utf8mb4_unicode_ci) = (? COLLATE utf8mb4_unicode_ci) ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
      [skuNorm],
    )) as Array<{ id?: string }>;
    const productId = String(rows?.[0]?.id ?? '').trim();
    if (!productId) return false;

    const hasRule = (await this.ds.query(
      `SELECT 1 AS one FROM ebay_product_visibility_groups WHERE product_id=? LIMIT 1`,
      [productId],
    )) as Array<{ one?: unknown }>;
    if (!hasRule?.[0]?.one) return true;

    const groupIds = await this.getUserGroupIds(user.sub);
    if (groupIds.length === 0) return false;
    const allowed = (await this.ds.query(
      `SELECT 1 AS one FROM ebay_product_visibility_groups WHERE product_id=? AND group_id IN (?) LIMIT 1`,
      [productId, groupIds],
    )) as Array<{ one?: unknown }>;
    return Boolean(allowed?.[0]?.one);
  }

  async assertEbaySkuVisibleToUser(sku: string, user: JwtUser): Promise<void> {
    const ok = await this.isEbaySkuVisibleToUser(sku, user);
    if (!ok) throw new NotFoundException('商品不存在');
  }
}
