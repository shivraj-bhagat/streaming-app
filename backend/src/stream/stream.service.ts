import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*', // Change this to your frontend URL in production
    methods: ['GET', 'POST'],
  },
})
export class StreamService implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly rooms: Map<string, Set<string>> = new Map();

  handleConnection(client: Socket) {
    console.log('Rooms list:', JSON.stringify(this.rooms));
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    this.removeClientFromRooms(client.id);
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(client: Socket, roomId: string) {
    client.join(roomId);

    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    this.rooms.get(roomId).add(client.id);

    // Notify other clients in the room
    client.to(roomId).emit('peer-joined', { peerId: client.id });
    console.log(`${client.id} joined room: ${roomId}`);
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(client: Socket, roomId: string) {
    client.leave(roomId);

    if (this.rooms.has(roomId)) {
      this.rooms.get(roomId).delete(client.id);

      // Notify other clients
      client.to(roomId).emit('peer-left', { peerId: client.id });
      console.log(`${client.id} left room: ${roomId}`);

      // Remove room if empty
      if (this.rooms.get(roomId).size === 0) {
        this.rooms.delete(roomId);
      }
    }
  }

  @SubscribeMessage('offer')
  handleOffer(
    client: Socket,
    data: { roomId: string; offer: RTCSessionDescription },
  ) {
    console.log(`Received offer from ${client.id} for room ${data.roomId}`);
    client.to(data.roomId).emit('offer', {
      peerId: client.id,
      offer: data.offer,
    });
  }

  @SubscribeMessage('answer')
  handleAnswer(
    client: Socket,
    data: { roomId: string; answer: RTCSessionDescription },
  ) {
    console.log(`Received answer from ${client.id} for room ${data.roomId}`);
    client.to(data.roomId).emit('answer', {
      peerId: client.id,
      answer: data.answer,
    });
  }

  @SubscribeMessage('ice-candidate')
  handleIceCandidate(
    client: Socket,
    data: { roomId: string; candidate: RTCIceCandidate },
  ) {
    console.log(`Received ICE candidate from ${client.id}`);
    client.to(data.roomId).emit('ice-candidate', {
      peerId: client.id,
      candidate: data.candidate,
    });
  }

  private removeClientFromRooms(clientId: string) {
    for (const [roomId, clients] of this.rooms.entries()) {
      if (clients.has(clientId)) {
        clients.delete(clientId);

        // Notify other clients in the room
        this.server.to(roomId).emit('peer-left', { peerId: clientId });
        console.log(`${clientId} removed from room: ${roomId}`);

        // Clean up empty rooms
        if (clients.size === 0) {
          this.rooms.delete(roomId);
        }
      }
    }
  }
}
