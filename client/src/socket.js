import { io } from 'socket.io-client';

// In production the client is served by the same server, so connect to origin.
// In development, connect to the local dev server.
const SERVER_URL =
  import.meta.env.MODE === 'production' ? '/' : 'http://localhost:3001';

export const socket = io(SERVER_URL, {
  autoConnect: false,
});
