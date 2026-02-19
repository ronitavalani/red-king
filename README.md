# Red King

A real-time multiplayer card game built with React and Socket.io. Players try to have the lowest hand total by peeking, swapping, and matching cards — then call "Red King" when they think they're winning.

## How to Play

### Setup
1. One player creates a room and shares the 4-letter room code
2. Other players join using the code (2-6 players)
3. The host starts the game

### Game Flow
1. **Peek Phase** — Each player is dealt 4 face-down cards. You get to peek at your bottom two cards, then play begins.
2. **Play Phase** — On your turn, draw a card from the deck. Then either:
   - **Keep it** — swap it with one of your face-down cards (the replaced card is discarded)
   - **Discard it** — throw it on the discard pile. If the card has a rule, you must use it.
3. **Call Red King** — Before drawing, you can declare "Red King" if you think you have the lowest total. Everyone else gets one final redemption turn (your cards are locked), then all cards are revealed.

### Card Rules
| Card | Rule |
|------|------|
| 7, 8 | Peek at one of your own cards |
| 9, 10 | Peek at one of an opponent's cards |
| J, Q | Blind swap — swap one of your cards with an opponent's card (no peeking) |
| Black K | Peek at one of your cards AND one of an opponent's cards, then optionally swap them |

### Matching
At any point during the play/redemption phase, if you spot a card in your hand that matches the top of the discard pile, you can call a match to remove it. You can also call a match on an opponent's card — if correct, you give them one of your cards; if wrong, you draw a penalty card.

### Scoring
| Card | Points |
|------|--------|
| Ace | 1 |
| 2-10 | Face value |
| Jack, Queen | 10 |
| Black King (spades/clubs) | 10 |
| Red King (hearts/diamonds) | -1 |
| Joker | 0 |

**Lowest score wins.** If the Red King caller ties with another player, the other player wins.

## Running Locally

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)

### Install & Run
```bash
# Install all dependencies
npm run install:all

# Start development servers (client + server)
npm run dev
```

The client runs on `http://localhost:5173` and the server on `http://localhost:3001`.

## Deploying Online

The app is configured for single-server deployment — the Express server serves the built React client in production.

### Deploy to Render (free tier)

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) and create a new **Web Service**
3. Connect your GitHub repo
4. Configure:
   - **Build Command:** `npm run install:all && npm run build`
   - **Start Command:** `npm start`
   - **Environment:** Node
5. Deploy — share the URL with friends to play!

### Deploy to Railway

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) and create a new project from your repo
3. Railway auto-detects Node.js. Set the following:
   - **Build Command:** `npm run install:all && npm run build`
   - **Start Command:** `npm start`
4. Deploy and grab your public URL

### Manual / VPS Deployment

```bash
# Install dependencies
npm run install:all

# Build the client
npm run build

# Start production server
npm start
```

The server runs on port `3001` by default (override with the `PORT` environment variable).

## Tech Stack

- **Frontend:** React 19, React Router, Vite
- **Backend:** Node.js, Express, Socket.io
- **Realtime:** WebSockets via Socket.io
