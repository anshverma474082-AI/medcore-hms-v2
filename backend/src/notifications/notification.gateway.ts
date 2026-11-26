import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { RedisService } from '../infra/redis.service';

@WebSocketGateway({ cors: { origin: (process.env.FRONTEND_ORIGINS || 'http://localhost:3000').split(','), credentials: true }, namespace: '/events' })
export class NotificationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  constructor(private jwt: JwtService, private redis: RedisService) {}
  async handleConnection(client: Socket) {
    try {
      const cookie = String(client.handshake.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('access_token='));
      const token = String(client.handshake.auth?.token || cookie?.slice('access_token='.length) || '');
      if (!token) throw new Error('missing token');
      const user = await this.jwt.verifyAsync(token, { secret: process.env.JWT_ACCESS_SECRET });
      if (!(await this.redis.client.exists('session:' + user.sid))) throw new Error('revoked session');
      await client.join('user:' + user.id);
    } catch { client.disconnect(true); }
  }
  handleDisconnect(_client: Socket) {}
  @SubscribeMessage('notification:read')
  acknowledge(@ConnectedSocket() client: Socket, @MessageBody() payload: { id: number }) {
    if (!Number.isInteger(payload?.id)) return { success: false };
    return { success: true, id: payload.id };
  }
  publish(userId: number, value: unknown) { this.server?.to('user:' + userId).emit('notification', value); }
}
