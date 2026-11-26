import { Body, Controller, Headers, Param, ParseIntPipe, Post, Get, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { CurrentUser, SessionUser } from '../security/current-user.decorator';
import { Public } from '../security/public.decorator';
import { Roles } from '../security/roles.decorator';
import { BillingService } from './billing.service';
import { CreateInvoiceDto, VerifyPaymentDto } from './billing.dto';
import { PageQueryDto } from '../common/pagination.dto';

@ApiTags('billing and payments')
@Controller()
export class BillingController {
  constructor(private service: BillingService) {}
  @Post('appointments/:id/invoice') @Roles(Role.HOSPITAL_ADMIN, Role.RECEPTIONIST, Role.ACCOUNTANT)
  async create(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateInvoiceDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.createInvoice(id, dto, user), message: 'Invoice created' }; }
  @Get('billing/invoices') @Roles(Role.PATIENT, Role.HOSPITAL_ADMIN, Role.ACCOUNTANT, Role.RECEPTIONIST, Role.SUPER_ADMIN)
  async list(@CurrentUser() user: SessionUser) { return { success: true, data: await this.service.list(user), message: 'OK' }; }
  @Get('billing/invoices/page') @Roles(Role.PATIENT, Role.HOSPITAL_ADMIN, Role.ACCOUNTANT, Role.RECEPTIONIST, Role.SUPER_ADMIN)
  async listPage(@Query() query: PageQueryDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.listPage(query, user), message: 'OK' }; }
  @Post('billing/invoices/:id/payment-order') @Roles(Role.PATIENT)
  async order(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.createOrder(id, user), message: 'Payment order created' }; }
  @Post('billing/payments/verify') @Roles(Role.PATIENT)
  async verify(@Body() dto: VerifyPaymentDto, @CurrentUser() user: SessionUser) { return { success: true, data: await this.service.verify(dto, user), message: 'Payment verified' }; }
  @Public() @Post('billing/payments/webhook')
  async webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-razorpay-signature') signature?: string) { return { success: true, data: await this.service.webhook(req.rawBody, signature), message: 'Webhook processed' }; }
}
