# Online Chess Game

This version supports two players from different PCs using GitHub Pages + Firebase Firestore.

## Setup

1. Create a Firebase project.
2. Add a Web App in Firebase Project Settings.
3. Copy your Firebase config into `firebase-config.js`.
4. Enable Firestore Database.
5. For quick testing, use these Firestore rules:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /chessRooms/{roomId} {
      allow read, write: if true;
    }
  }
}
```

For public long-term use, add Firebase Authentication and stricter rules.

## How to play

- Player 1 creates a room as White.
- Copy the room code and send it to Player 2.
- Player 2 joins as Black from another PC.

## Scoring

The score is based on captured material:
- Pawn = 1
- Knight = 3
- Bishop = 3
- Rook = 5
- Queen = 9
- King = 0
