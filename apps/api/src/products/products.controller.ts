import { Controller, DefaultValuePipe, Get, ParseIntPipe, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProductsService } from './products.service';
import { EbayOfficialProductsService } from './ebay-official-products.service';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { AccessControlService } from '../access/access-control.service';

@ApiTags('products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(
    private readonly service: ProductsService,
    private readonly official: EbayOfficialProductsService,
    private readonly access: AccessControlService,
  ) {}

  @ApiOperation({ summary: 'eBay 商品分页（按 SKU 或标题搜索）' })
  @Get('ebay')
  list(
    @CurrentUser() user: JwtUser,
    @Query('keyword') keyword?: string,
    @Query('sortBy') sortBy?: 'stockQty' | 'price' | 'sku' | 'syncedAt',
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize?: number,
  ) {
    return this.service.list({ keyword, sortBy, sortOrder, page, pageSize }, user);
  }

  @ApiOperation({ summary: 'eBay 官方 API 商品信息（从三张落库表读取）' })
  @Get('ebay/:sku/official')
  async officialBySku(@CurrentUser() user: JwtUser, @Param('sku') sku: string) {
    const s = decodeURIComponent(String(sku ?? ''));
    await this.access.assertEbaySkuVisibleToUser(s, user);
    return this.official.bySku(s);
  }

  @ApiOperation({ summary: 'eBay 官方数据（实时从 item_url 调用 Browse+Trading）' })
  @Get('ebay/:sku/official-live')
  async officialLiveBySku(@CurrentUser() user: JwtUser, @Param('sku') sku: string) {
    const s = decodeURIComponent(String(sku ?? ''));
    await this.access.assertEbaySkuVisibleToUser(s, user);
    return this.service.getEbayOfficialLiveBySku(s);
  }

  @ApiOperation({ summary: 'eBay 官方数据（实时，从 item_url 调用 Browse；用于商品细节）' })
  @Get('ebay/:sku/official-live/browse')
  async officialLiveBrowseBySku(
    @CurrentUser() user: JwtUser,
    @Param('sku') sku: string,
    @Query('timeoutMs') timeoutMs?: string,
    @Query('refreshMode') refreshMode?: string,
  ) {
    const s = decodeURIComponent(String(sku ?? ''));
    await this.access.assertEbaySkuVisibleToUser(s, user);
    const timeout = Number(timeoutMs);
    const rm = String(refreshMode ?? '').trim().toLowerCase();
    return this.service.getEbayOfficialLiveBrowseBySku({
      sku: s,
      timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : undefined,
      refreshMode: rm === 'background' ? 'background' : null,
    });
  }

  @ApiOperation({ summary: 'eBay 官方数据（实时，从 item_url 调用 Trading Fitment；用于适配车型）' })
  @Get('ebay/:sku/official-live/fitment')
  async officialLiveFitmentBySku(
    @CurrentUser() user: JwtUser,
    @Param('sku') sku: string,
    @Query('timeoutMs') timeoutMs?: string,
    @Query('lite') lite?: string,
    @Query('refreshMode') refreshMode?: string,
  ) {
    const s = decodeURIComponent(String(sku ?? ''));
    await this.access.assertEbaySkuVisibleToUser(s, user);
    const timeout = Number(timeoutMs);
    const liteBool = String(lite ?? '').trim().toLowerCase() === 'true' || String(lite ?? '').trim() === '1';
    const rm = String(refreshMode ?? '').trim().toLowerCase();
    return this.service.getEbayOfficialLiveFitmentBySku({
      sku: s,
      timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : undefined,
      lite: liteBool,
      refreshMode: rm === 'background' ? 'background' : null,
    });
  }

  @ApiOperation({ summary: 'eBay 商品详情（仅基于领星同步+SKU白名单，多图聚合）' })
  @Get('ebay/:sku')
  async bySku(@CurrentUser() user: JwtUser, @Param('sku') sku: string) {
    const s = decodeURIComponent(String(sku ?? ''));
    await this.access.assertEbaySkuVisibleToUser(s, user);
    return this.service.getEbayBySku(s);
  }
}
