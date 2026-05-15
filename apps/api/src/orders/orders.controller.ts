import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import ExcelJS from 'exceljs';
import type { Response } from 'express';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @ApiOperation({ summary: '创建订单（购物车合单）' })
  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateOrderDto) {
    return this.service.create(user, dto);
  }

  @ApiOperation({ summary: '订单列表（分销商默认仅看自己；管理员加 ?all=true 可看全部）' })
  @Get()
  list(
    @CurrentUser() user: JwtUser,
    @Query('all', new DefaultValuePipe(false), ParseBoolPipe) all: boolean,
    @Query('keyword') keyword: string | undefined,
    @Query('status') status: string | undefined,
    @Query('lingxingStatusText') lingxingStatusText: string | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(10), ParseIntPipe) pageSize: number,
  ) {
    return this.service.list(user, { all, page, pageSize, keyword, status, lingxingStatusText });
  }

  @ApiOperation({ summary: '订单状态下拉选项（从订单表 lingxing_status_text 去重）' })
  @Get('status-options')
  statusOptions(@CurrentUser() user: JwtUser) {
    return this.service.listLingxingStatusTextOptions(user);
  }

  @ApiOperation({ summary: '导出账单（Excel，按选中订单）' })
  @HttpCode(200)
  @Post('export/xlsx')
  async exportBillXlsx(
    @CurrentUser() user: JwtUser,
    @Body() body: { orderIds?: string[] },
    @Res() res: Response,
  ) {
    const ids = Array.isArray(body?.orderIds) ? body.orderIds.map((x) => String(x).trim()).filter(Boolean) : [];
    const rows = await this.service.billRowsByIds(user, ids);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Distribution System';
    wb.created = new Date();

    const ws = wb.addWorksheet('Bill');
    ws.columns = [
      { header: 'Order No', key: 'orderNo', width: 22 },
      { header: 'Created At', key: 'createdAt', width: 20 },
      { header: 'Buyer Email', key: 'buyerEmail', width: 26 },
      { header: 'Status', key: 'statusText', width: 18 },
      { header: 'Currency', key: 'currency', width: 10 },
      { header: 'Order Total', key: 'orderTotal', width: 14 },
      { header: 'Items Count', key: 'itemsCount', width: 12 },
      { header: 'SKU', key: 'sku', width: 18 },
      { header: 'Title', key: 'title', width: 40 },
      { header: 'Qty', key: 'qty', width: 8 },
      { header: 'Unit Price', key: 'unitPrice', width: 14 },
      { header: 'Line Total', key: 'lineTotal', width: 14 },
    ];

    ws.addRows(
      rows.map((r) => ({
        orderNo: r.orderNo,
        createdAt: r.createdAtText,
        buyerEmail: r.buyerEmail,
        statusText: r.statusText,
        currency: r.currency,
        orderTotal: r.orderTotal,
        itemsCount: r.itemsCount,
        sku: r.sku,
        title: r.title,
        qty: r.qty,
        unitPrice: r.unitPrice,
        lineTotal: r.lineTotal,
      })),
    );

    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: ws.columns.length },
    };

    const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const file = Buffer.from(buf);

    const date = new Date();
    const y = String(date.getFullYear());
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const filename = `bill-${y}${m}${d}-${hh}${mm}${ss}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Exported-By', String(user.email ?? ''));
    res.setHeader('X-Export-Count', String(rows.length));
    res.send(file);
  }

  @ApiOperation({ summary: '订单详情' })
  @Get(':orderNo')
  detail(@CurrentUser() user: JwtUser, @Param('orderNo') orderNo: string) {
    return this.service.findByOrderNo(user, orderNo);
  }
}
