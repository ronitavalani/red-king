const express = require('express');
const path = require('node:path');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const { registerSocketHandlers } = require('./socketHandlers');

const app = express();
const server = createServer(app);

const isDev = process.env.NODE_ENV !== 'production';

const io = new Server(server, {
  cors: isDev
    ? { origin: 'http://localhost:5173', methods: ['GET', 'POST'] }
    : undefined,
});

// In production, serve the built client files
if (!isDev) {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  registerSocketHandlers(io, socket);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Red King server running on port ${PORT}`);
});
