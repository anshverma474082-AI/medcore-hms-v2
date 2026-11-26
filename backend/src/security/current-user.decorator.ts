import { createParamDecorator, ExecutionContext } from '@nestjs/common';
export type SessionUser = { id: number; name: string; email: string; role: string; hospitalId: number | null; sid: string };
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): SessionUser => ctx.switchToHttp().getRequest().user);
