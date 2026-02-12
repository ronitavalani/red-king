const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const { registerSocketHandlers } = require('./socketHandlers');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  registerSocketHandlers(io, socket);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Red King server running on http://localhost:${PORT}`);
});
