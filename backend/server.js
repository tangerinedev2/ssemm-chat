import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Anahtar kodu kontrolü
const SITE_KEY = 'SSEMMPRIVATE';

app.post('/api/verify-key', (req, res) => {
  const { key } = req.body;
  if (key === SITE_KEY) {
    res.json({ valid: true });
  } else {
    res.json({ valid: false });
  }
});

// Socket.io bağlantıları
const onlineUsers = new Map(); // socketId -> userId
const userSockets = new Map(); // userId -> socketId

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));
  
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return next(new Error('Invalid token'));
    socket.user = user;
    next();
  } catch (err) {
    next(new Error('Authentication failed'));
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.user.id);
  
  // Kullanıcıyı online listesine ekle
  onlineUsers.set(socket.id, socket.user.id);
  userSockets.set(socket.user.id, socket.id);
  
  // Online kullanıcıları herkese bildir
  io.emit('users:online', Array.from(onlineUsers.values()));
  
  // Mesaj gönderme
  socket.on('message:send', async (data) => {
    const { roomId, content } = data;
    
    // Mesajı Supabase'e kaydet
    const { data: message, error } = await supabase
      .from('messages')
      .insert({
        room_id: roomId || 'global',
        sender_id: socket.user.id,
        sender_username: socket.user.user_metadata?.username || socket.user.email,
        content: content
      })
      .select()
      .single();
    
    if (!error && message) {
      // Mesajı odaya yayınla
      if (roomId) {
        io.to(roomId).emit('message:new', message);
      } else {
        io.emit('message:new', message);
      }
    }
  });
  
  // Odaya katılma
  socket.on('room:join', (roomId) => {
    socket.join(roomId);
    socket.to(roomId).emit('room:user-joined', {
      userId: socket.user.id,
      username: socket.user.user_metadata?.username
    });
  });
  
  // Odadan ayrılma
  socket.on('room:leave', (roomId) => {
    socket.leave(roomId);
    socket.to(roomId).emit('room:user-left', {
      userId: socket.user.id,
      username: socket.user.user_metadata?.username
    });
  });
  
  // Yazıyor bildirimi
  socket.on('typing:start', (roomId) => {
    socket.to(roomId).emit('typing:start', {
      userId: socket.user.id,
      username: socket.user.user_metadata?.username
    });
  });
  
  socket.on('typing:stop', (roomId) => {
    socket.to(roomId).emit('typing:stop', {
      userId: socket.user.id
    });
  });
  
  // Bağlantı kesilme
  socket.on('disconnect', () => {
    const userId = onlineUsers.get(socket.id);
    onlineUsers.delete(socket.id);
    userSockets.delete(userId);
    io.emit('users:online', Array.from(onlineUsers.values()));
    console.log('User disconnected:', userId);
  });
});

// Ping endpoint (Render'ı uyanık tutmak için)
app.get('/api/ping', (req, res) => {
  res.json({ status: 'alive', time: new Date() });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});