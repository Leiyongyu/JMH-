import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { DataSource, In, Repository } from 'typeorm';
import { JwtUser } from '../common/current-user.decorator';
import { EbayProduct } from '../products/ebay-product.entity';
import { User } from '../users/user.entity';
import { DistributorGroup } from './distributor-group.entity';
import { DistributorGroupMember } from './distributor-group-member.entity';
import { EbayProductVisibilityGroup } from './ebay-product-visibility-group.entity';

function normalizeSku(sku: string): string {
  return String(sku ?? '').trim().toLowerCase();
}

@Injectable()
export class AccessControlService {
  constructor(
    @InjectRepository(DistributorGroup) private readonly groupRepo: Repository<DistributorGroup>,
    @InjectRepository(DistributorGroupMember) private readonly memberRepo: Repository<DistributorGroupMember>,
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

  async importGroupProductsXlsx(args: { groupId: string; fileBuffer: Buffer; mode?: 'replace' | 'add' | 'remove' }) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(args.fileBuffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Excel 文件为空');

    const skus: string[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        const first = String(row.getCell(1).text ?? '').trim().toLowerCase();
        if (first.includes('sku')) return;
      }
      const sku = String(row.getCell(1).text ?? '').trim();
      if (sku) skus.push(sku);
    });

    const mode = (args.mode ?? 'replace').toLowerCase();
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
