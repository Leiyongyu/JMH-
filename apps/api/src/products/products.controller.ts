import { Controller, DefaultValuePipe, Get, ParseIntPipe, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProductsService } from './products.service';
import { EbayOfficialProductsService } from './ebay-official-products.service';

@ApiTags('products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(
    private readonly service: ProductsService,
    private readonly official: EbayOfficialProductsService,
  ) {}

  @ApiOperation({ summary: 'eBay 商品分页（按 SKU 或标题搜索）' })
  @Get('ebay')
  list(
    @Query('keyword') keyword?: string,
    @Query('sortBy') sortBy?: 'stockQty' | 'price' | 'sku' | 'syncedAt',
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize?: number,
  ) {
    return this.service.list({ keyword, sortBy, sortOrder, page, pageSize });
  }

  @ApiOperation({ summary: 'eBay 官方 API 商品信息（从三张落库表读取）' })
  @Get('ebay/:sku/official')
  officialBySku(@Param('sku') sku: string) {
    return this.official.bySku(decodeURIComponent(String(sku ?? '')));
  }

  @ApiOperation({ summary: 'eBay 官方数据（实时从 item_url 调用 Browse+Trading）' })
  @Get('ebay/:sku/official-live')
  officialLiveBySku(@Param('sku') sku: string) {
    return this.service.getEbayOfficialLiveBySku(decodeURIComponent(String(sku ?? '')));
  }

  @ApiOperation({ summary: 'eBay 商品详情（仅基于领星同步+SKU白名单，多图聚合）' })
  @Get('ebay/:sku')
  bySku(@Param('sku') sku: string) {
    return this.service.getEbayBySku(decodeURIComponent(String(sku ?? '')));
  }
}
