import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { SocketProvider, useSocket } from './context/SocketContext';
import HomePage from './pages/HomePage';
import WaitingRoom from './pages/WaitingRoom';
import GameRoom from './pages/GameRoom';

function RequireRoom({ children, requiredState }) {
  const { roomCode, roomState } = useSocket();
  if (!roomCode) return <Navigate to="/" replace />;
  if (requiredState && roomState !== requiredState) {
    if (roomState === 'playing') return <Navigate to="/game-room" replace />;
    if (roomState === 'waiting') return <Navigate to="/waiting-room" replace />;
    return <Navigate to="/" replace />;
  }
  return children;
}

export default function App() {
  return (
    <SocketProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route
            path="/waiting-room"
            element={
              <RequireRoom requiredState="waiting">
                <WaitingRoom />
              </RequireRoom>
            }
          />
          <Route
            path="/game-room"
            element={
              <RequireRoom requiredState="playing">
                <GameRoom />
              </RequireRoom>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SocketProvider>
  );
}
