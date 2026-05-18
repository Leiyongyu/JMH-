import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { InventorySyncService } from '../inventory/inventory-sync.service';
import { ProductsSyncService } from '../products/products-sync.service';
import { ProductsService } from '../products/products.service';
import { EbayOfficialProductsSyncService } from '../products/ebay-official-products-sync.service';
import { SyncService } from '../sync/sync.service';
import { SyncType } from '../sync/sync-run.entity';
import { UpdateEbayProductDto } from './dto/update-ebay-product.dto';
import { WarehousesService } from '../warehouses/warehouses.service';
import { WarehousesSyncService } from '../warehouses/warehouses-sync.service';
import { LingxingOrderStatusSyncService } from '../orders/lingxing-order-status-sync.service';
import { OrdersService } from '../orders/orders.service';
import { EbayUserOAuthService } from '../ebay/ebay-user-oauth.service';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly inventorySync: InventorySyncService,
    private readonly warehousesSync: WarehousesSyncService,
    private readonly warehouses: WarehousesService,
    private readonly productsSync: ProductsSyncService,
    private readonly ebayOfficialProductsSync: EbayOfficialProductsSyncService,
    private readonly products: ProductsService,
    private readonly lingxingOrderStatusSync: LingxingOrderStatusSyncService,
    private readonly orders: OrdersService,
    private readonly ebayUserOAuth: EbayUserOAuthService,
    private readonly sync: SyncService,
  ) {}

  @ApiOperation({ summary: '手动同步库存（异步，返回 run）' })
  @HttpCode(200)
  @Post('sync/inventory')
  syncInventory(@CurrentUser() user: JwtUser) {
    return this.inventorySync.triggerRun(user.email);
  }

  @ApiOperation({ summary: '手动同步 eBay 商品（异步，返回 run）' })
  @HttpCode(200)
  @Post('sync/ebay-products')
  syncEbayProducts(@CurrentUser() user: JwtUser) {
    return this.productsSync.triggerRun(user.email);
  }

  @ApiOperation({ summary: '从 eBay 官方 API 拉取商品信息并入库（异步，返回 run）' })
  @HttpCode(200)
  @Post('sync/ebay-official-products')
  syncEbayOfficialProducts(@CurrentUser() user: JwtUser) {
    return this.ebayOfficialProductsSync.triggerRun(user.email);
  }

  @ApiOperation({ summary: '手动同步领星海外仓列表（异步，返回 run）' })
  @HttpCode(200)
  @Post('sync/lingxing-warehouses')
  syncLingxingWarehouses(@CurrentUser() user: JwtUser) {
    return this.warehousesSync.triggerRun(user.email);
  }

  @ApiOperation({ summary: '手动同步领星订单状态（异步，返回 run）' })
  @HttpCode(200)
  @Post('sync/lingxing-order-status')
  syncLingxingOrderStatus(@CurrentUser() user: JwtUser) {
    return this.lingxingOrderStatusSync.triggerRun(user.email);
  }

  @ApiOperation({ summary: '管理员：设置订单状态文本（写入订单表 lingxing_status_text）' })
  @HttpCode(200)
  @Patch('orders/:orderNo/lingxing-status-text')
  setOrderLingxingStatusText(
    @CurrentUser() user: JwtUser,
    @Param('orderNo') orderNo: string,
    @Body() body: { statusText?: string | null },
  ) {
    const text = body?.statusText === undefined ? null : body.statusText;
    return this.orders.setLingxingStatusTextByAdmin(user, orderNo, text ?? null);
  }

  @ApiOperation({ summary: '同步历史' })
  @Get('sync-runs')
  syncRuns(
    @Query('type') type?: SyncType,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    return this.sync.list({ type, limit });
  }

  @ApiOperation({ summary: '同步进度（按 runId 查询）' })
  @Get('sync-runs/:id')
  async syncRun(@Param('id') id: string) {
    const run = await this.sync.getById(id);
    if (!run) throw new NotFoundException('未找到同步记录');
    return run;
  }

  @ApiOperation({ summary: 'eBay OAuth：生成授权链接（用于获取 refresh token）' })
  @Get('ebay/oauth/authorize-url')
  ebayAuthorizeUrl(@Query('state') state?: string) {
    return this.ebayUserOAuth.buildAuthorizeUrl({ state });
  }

  @ApiOperation({ summary: 'eBay OAuth：查看 refresh token 配置状态' })
  @Get('ebay/oauth/status')
  ebayOAuthStatus() {
    return this.ebayUserOAuth.getRefreshTokenStatus();
  }

  @ApiOperation({ summary: 'eBay OAuth：用 code 换取 access/refresh token' })
  @HttpCode(200)
  @Post('ebay/oauth/exchange')
  ebayExchangeCode(@Body() body: { code?: string }) {
    const code = String(body?.code ?? '').trim();
    if (!code) throw new BadRequestException('缺少 code');
    return this.ebayUserOAuth.exchangeCode(code);
  }

  @ApiOperation({ summary: '管理员：领星海外仓列表（从本地数据库读取）' })
  @Get('lingxing/warehouses')
  listLingxingWarehouses(@Query('limit', new DefaultValuePipe(2000), ParseIntPipe) limit?: number) {
    return this.warehouses.listOverseas(limit);
  }

  @ApiOperation({ summary: '管理员获取单个 eBay 商品（从数据库读取）' })
  @Get('products/ebay/:sku')
  getEbayProduct(@Param('sku') sku: string) {
    return this.products.findBySku(sku);
  }

  @ApiOperation({ summary: '管理员导出 eBay 商品 SKU/价格（Excel）' })
  @Get('products/ebay/export/xlsx')
  async exportEbayProductsXlsx(@CurrentUser() user: JwtUser, @Res() res: Response) {
    const rows = await this.products.adminExportEbayProducts();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Distribution System';
    wb.created = new Date();
    const ws = wb.addWorksheet('eBay Products');

    ws.columns = [
      { header: 'SKU', key: 'sku', width: 26 },
      { header: 'Price', key: 'price', width: 12 },
    ];
    ws.addRows(rows.map((r) => ({ sku: r.sku, price: r.price })));

    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 2 },
    };

    const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const date = new Date();
    const y = String(date.getFullYear());
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const filename = `ebay-products-sku-price-${y}${m}${d}.xlsx`;

    const file = Buffer.from(buf);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Exported-By', String(user.email ?? ''));
    res.setHeader('X-Export-Count', String(rows.length));
    res.send(file);
  }

  @ApiOperation({ summary: '管理员上传 Excel 批量更新 eBay 商品价格（按 SKU 匹配），并自动拉取 eBay 官方数据' })
  @HttpCode(200)
  @Post('products/ebay/import/price-xlsx')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async importEbayPricesXlsx(@UploadedFile() file?: Express.Multer.File, @CurrentUser() user?: JwtUser) {
    if (!file?.buffer?.length) throw new BadRequestException('请上传 Excel 文件');
    const result = await this.productsSync.importSkuPriceXlsx(file.buffer, user?.email);
    return result;
  }

  @ApiOperation({ summary: '管理员更新 eBay 商品（写入数据库）' })
  @HttpCode(200)
  @Patch('products/ebay/:sku')
  updateEbayProduct(
    @Param('sku') sku: string,
    @Body() dto: UpdateEbayProductDto,
  ) {
    return this.products.updateBySku(sku, dto);
  }

  @ApiOperation({ summary: '管理员抓取 eBay 商品页面信息（仅用于补全图片等展示数据）' })
  @HttpCode(200)
  @Post('products/ebay/:sku/scrape')
  async scrapeEbayProduct(@Param('sku') sku: string) {
    const scraped = await this.products.scrapeBySku(sku);
    const product = await this.products.findBySku(sku);
    const raw = (product.rawPayload ?? {}) as Record<string, unknown>;
    const merged = {
      ...raw,
      images: scraped.images,
      picture_urls: scraped.images,
      scraped: {
        ...(typeof raw.scraped === 'object' && raw.scraped !== null ? (raw.scraped as Record<string, unknown>) : {}),
        sourceUrl: scraped.sourceUrl,
        title: scraped.title,
        description: scraped.description,
        fetchedAt: new Date().toISOString(),
      },
    } as Record<string, unknown>;
    return this.products.updateBySku(sku, { rawPayload: merged } as UpdateEbayProductDto);
  }

  @ApiOperation({ summary: '管理员通过 eBay 官方 Browse API 刷新商品图片/标题等信息' })
  @HttpCode(200)
  @Post('products/ebay/:sku/refresh-from-ebay')
  async refreshFromEbay(@Param('sku') sku: string) {
    return this.products.refreshFromEbayApiBySku(sku);
  }

}
