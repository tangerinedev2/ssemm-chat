import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// CORS ayarları
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://ssemm-chat.netlify.app',
  'http://localhost:3000',
  'http://localhost:5173'
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Blocked origin:', origin);
      callback(null, true); // development için geçici olarak herkese aç
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
}));

app.use(express.json());

// Socket.io CORS ayarları
const io = new Server(httpServer, {
  cors: {
    origin: function(origin, callback) {
      if (!origin) return callback(null, true);
      callback(null, true); // geçici olarak herkese açık
    },
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

// ========== PING ENDPOINT ==========
app.get('/api/ping', (req, res) => {
  res.json({ 
    status: 'alive', 
    time: new Date().toISOString(),
    message: 'SSEMM Backend Çalışıyor'
  });
});

// ========== ANA SAYFA ==========
app.get('/', (req, res) => {
  res.json({
    name: 'SSEMM Backend API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      ping: '/api/ping',
      health: '/api/health'
    }
  });
});

// ========== HEALTH CHECK ==========
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

// ========== SOCKET.IO OLAYLARI ==========
const onlineUsers = new Map(); // socketId -> userId
const userSockets = new Map(); // userId -> socketId
const typingUsers = new Map(); // roomId -> Set of typing users

io.use(async (socket, next) => {
  // Geçici auth - herkes bağlanabilir (test için)
  socket.userId = socket.handshake.auth.userId || `user_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  socket.username = socket.handshake.auth.username || `agent_${socket.userId.slice(-4)}`;
  next();
});

io.on('connection', (socket) => {
  console.log('✅ Bağlantı kuruldu:', socket.id, 'Kullanıcı:', socket.username);
  
  // Kullanıcıyı online listesine ekle
  onlineUsers.set(socket.id, {
    id: socket.userId,
    username: socket.username
  });
  userSockets.set(socket.userId, socket.id);
  
  // Online kullanıcıları herkese bildir
  const usersList = Array.from(onlineUsers.values());
  io.emit('users:online', usersList);
  
  // ========== MESAJ GÖNDERME ==========
  socket.on('message:send', (data) => {
    const { roomId, content } = data;
    const message = {
      id: Date.now().toString(),
      sender_id: socket.userId,
      sender_username: socket.username,
      content: content,
      room_id: roomId || 'global',
      created_at: new Date().toISOString()
    };
    
    console.log(`📨 Mesaj: ${socket.username} -> ${roomId || 'global'}: ${content.substring(0, 50)}`);
    
    if (roomId && roomId !== 'global') {
      // Özel odaya gönder
      io.to(roomId).emit('message:new', message);
    } else {
      // Genel sohbete gönder
      io.emit('message:new', message);
    }
  });
  
  // ========== ÖZEL MESAJ ==========
  socket.on('private:message', (data) => {
    const { to, content } = data;
    const targetSocket = userSockets.get(to);
    const message = {
      id: Date.now().toString(),
      sender_id: socket.userId,
      sender_username: socket.username,
      content: content,
      created_at: new Date().toISOString()
    };
    
    if (targetSocket) {
      io.to(targetSocket).emit('private:message', message);
      socket.emit('private:message', message); // gönderene de göster
    } else {
      socket.emit('private:error', { to, error: 'Kullanıcı çevrimdışı' });
    }
  });
  
  // ========== ODAYA KATIL ==========
  socket.on('room:join', (roomId) => {
    socket.join(roomId);
    socket.to(roomId).emit('room:user-joined', {
      userId: socket.userId,
      username: socket.username
    });
  });
  
  // ========== ODAYI TERK ET ==========
  socket.on('room:leave', (roomId) => {
    socket.leave(roomId);
    socket.to(roomId).emit('room:user-left', {
      userId: socket.userId,
      username: socket.username
    });
  });
  
  // ========== YAZIYOR BİLDİRİMİ ==========
  socket.on('typing:start', (data) => {
    const { to, roomId } = data;
    if (to) {
      // Özel mesaj için yazıyor bildirimi
      const targetSocket = userSockets.get(to);
      if (targetSocket) {
        io.to(targetSocket).emit('typing:start', {
          userId: socket.userId,
          username: socket.username
        });
      }
    } else if (roomId) {
      // Oda için yazıyor bildirimi
      socket.to(roomId).emit('typing:start', {
        userId: socket.userId,
        username: socket.username
      });
    }
  });
  
  socket.on('typing:stop', (data) => {
    const { to, roomId } = data;
    if (to) {
      const targetSocket = userSockets.get(to);
      if (targetSocket) {
        io.to(targetSocket).emit('typing:stop', {
          userId: socket.userId
        });
      }
    } else if (roomId) {
      socket.to(roomId).emit('typing:stop', {
        userId: socket.userId
      });
    }
  });
  
  // ========== PING/PONG ==========
  socket.on('ping', (callback) => {
    if (typeof callback === 'function') {
      callback();
    }
  });
  
  // ========== BAĞLANTI KESİLME ==========
  socket.on('disconnect', () => {
    const user = onlineUsers.get(socket.id);
    console.log('❌ Bağlantı kesildi:', socket.id, user?.username);
    onlineUsers.delete(socket.id);
    if (user) {
      userSockets.delete(user.id);
    }
    io.emit('users:online', Array.from(onlineUsers.values()));
  });
});

// ========== SUNUCU BAŞLAT ==========
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`
  🚀 SSEMM Backend Sunucusu Başladı!
  📡 Port: ${PORT}
  🌐 URL: http://0.0.0.0:${PORT}
  🏓 Ping: http://0.0.0.0:${PORT}/api/ping
  `);
});

// ========== HATA YAKALAMA ==========
process.on('uncaughtException', (err) => {
  console.error('❌ Yakalanmamış hata:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Yakalanmamış promise rejection:', reason);
});
