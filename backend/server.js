import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const httpServer = createServer(app);

app.use(cors({
  origin: ['https://ssemm-chat.netlify.app', 'http://localhost:3000', 'http://localhost:5173'],
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));

app.use(express.json());

const io = new Server(httpServer, {
  cors: {
    origin: ['https://ssemm-chat.netlify.app', 'http://localhost:3000', 'http://localhost:5173'],
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

app.get('/api/ping', (req, res) => {
  res.json({ status: 'alive', time: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ name: 'SSEMM Backend', status: 'running' });
});

const onlineUsers = new Map();
const userSockets = new Map();

io.on('connection', (socket) => {
  // Frontend'den gelen KULLANICI ADI (agent yok!)
  const userId = socket.handshake.auth.userId;
  const username = socket.handshake.auth.username;
  const userRole = socket.handshake.auth.role || 'Üye';
  
  if (!userId || !username) {
    console.log('❌ Kullanıcı bilgisi eksik');
    socket.disconnect();
    return;
  }
  
  socket.userId = userId;
  socket.username = username;
  socket.userRole = userRole;
  
  console.log('✅ Bağlandı:', username, `(${userRole})`);
  
  onlineUsers.set(socket.id, {
    id: userId,
    username: username,
    role: userRole
  });
  userSockets.set(userId, socket.id);
  
  io.emit('users:online', Array.from(onlineUsers.values()));
  
  socket.on('message:send', (data) => {
    const message = {
      id: Date.now().toString(),
      sender_id: userId,
      sender_username: username,
      sender_role: userRole,
      content: data.content,
      channel_type: data.channel_type || 'global',
      channel_id: data.channel_id || 'global',
      created_at: new Date().toISOString()
    };
    io.emit('message:new', message);
  });
  
  socket.on('private:message', (data) => {
    const targetSocket = userSockets.get(data.to);
    const message = {
      id: Date.now().toString(),
      sender_id: userId,
      sender_username: username,
      sender_role: userRole,
      content: data.content,
      created_at: new Date().toISOString()
    };
    if (targetSocket) {
      io.to(targetSocket).emit('private:message', message);
      socket.emit('private:message', message);
    }
  });
  
  socket.on('typing:start', (data) => {
    if (data.to) {
      const targetSocket = userSockets.get(data.to);
      if (targetSocket) {
        io.to(targetSocket).emit('typing:start', { userId, username });
      }
    }
  });
  
  socket.on('typing:stop', (data) => {
    if (data.to) {
      const targetSocket = userSockets.get(data.to);
      if (targetSocket) {
        io.to(targetSocket).emit('typing:stop', { userId });
      }
    }
  });
  
  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    userSockets.delete(userId);
    io.emit('users:online', Array.from(onlineUsers.values()));
    console.log('❌ Ayrıldı:', username);
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 SSEMM Backend: http://0.0.0.0:${PORT}`);
});
