import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  @ApiOperation({ summary: '库存看板汇总' })
  @Get('summary')
  summary(
    @Query('lowStockThreshold', new DefaultValuePipe(10), ParseIntPipe) threshold: number,
  ) {
    return this.service.summary(threshold);
  }

  @ApiOperation({ summary: '库存明细分页' })
  @Get('lines')
  list(
    @Query('sku') sku?: string,
    @Query('platform') platform?: string,
    @Query('warehouse') warehouse?: string,
    @Query('lowStockOnly') lowStockOnly?: string,
    @Query('lowStockThreshold', new DefaultValuePipe(10), ParseIntPipe) lowStockThreshold?: number,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize?: number,
  ) {
    return this.service.list({
      sku,
      platform,
      warehouse,
      lowStockOnly: String(lowStockOnly).toLowerCase() === 'true',
      lowStockThreshold,
      sortBy,
      sortOrder,
      page,
      pageSize,
    });
  }
}
