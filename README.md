# Quiz Points Challenge

A simple quiz website where players answer multiple-choice questions to earn points.

## Features

- Player name input before starting
- Multiple-choice quiz flow
- `+10` points for every correct answer
- Per-question feedback (correct/wrong)
- Round progress indicator
- Best score stored in browser `localStorage`
- Leaderboard (local fallback + Firebase sync when configured)
- Last player name remembered in `localStorage`
- Responsive layout for desktop and mobile
- Optional Firebase Firestore backend for questions and scores

## Tech Stack

- HTML
- CSS
- Vanilla JavaScript
- [Vite](https://vite.dev/) for local dev/build

## Project Structure

- `index.html` - quiz app structure
- `style.css` - UI styles
- `app.js` - quiz logic, scoring, and backend integration
- `firebase-config.js` - Firebase client config (fill this in)
- `public/` - static assets
- `helpers/` - publish/share helper scripts for this template

## Run Locally

```bash
npm install
npm start
```

Then open the local Vite URL shown in the terminal.

## Build for Production

```bash
npm run build
```

This generates static files in `deploy/_site`.

## Customize the Quiz

Edit the `QUESTION_BANK` array in `app.js`:

- `text`: question prompt
- `answers`: list of options
- `correctIndex`: zero-based index of the correct answer

Example:

```js
{
  text: "2 + 2 = ?",
  answers: ["3", "4", "5", "6"],
  correctIndex: 1
}
```

You can also change:

- `POINTS_PER_CORRECT` to adjust scoring
- Colors and layout variables in `style.css`

## Firebase Backend Setup

The app works without Firebase, but if configured it will:

- Load quiz questions from Firestore (`questions` collection)
- Save leaderboard entries to Firestore (`leaderboard` collection)
- Read top leaderboard scores from Firestore

### 1) Add your Firebase config

Edit `firebase-config.js`:

```js
export const firebaseConfig = {
  apiKey: "YOUR_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### 2) Firestore collections

Create collection `questions` with documents like:

```json
{
  "text": "What is 5 + 7?",
  "answers": ["10", "11", "12", "13"],
  "correctIndex": 2,
  "active": true
}
```

Create collection `leaderboard`; entries are inserted by the app as:

```json
{
  "name": "Sam",
  "score": 40,
  "createdAt": "server timestamp"
}
```

### 3) Basic Firestore rules (starter)

These are open for easy testing; tighten them before production.

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /questions/{docId} {
      allow read: if true;
      allow write: if false;
    }
    match /leaderboard/{docId} {
      allow read, create: if true;
      allow update, delete: if false;
    }
  }
}
```

## Daily Questions Automation

This repo now includes a scheduled GitHub Action that fetches 5 new multiple-choice questions every day from [Open Trivia DB](https://opentdb.com/) and replaces the Firestore `questions` collection.

File: `.github/workflows/daily-questions.yml`

- Runs daily at `00:05 UTC`
- Can also run manually from GitHub Actions (`workflow_dispatch`)

### Required GitHub Secrets

Add these repository secrets in GitHub: `Settings -> Secrets and variables -> Actions`.

- `FIREBASE_SERVICE_ACCOUNT_KEY`: full JSON for a Firebase service account (single-line JSON)
- `FIREBASE_PROJECT_ID`: your Firebase project id (e.g. `quizapp-a184b`)

### Firebase service account setup

1. Firebase Console -> Project Settings -> Service accounts
2. Generate new private key (JSON)
3. Copy the JSON content into `FIREBASE_SERVICE_ACCOUNT_KEY` GitHub secret

### Notes

- The automation deletes old docs in `questions` and writes exactly 5 new docs (`q1` to `q5`).
- Each written doc includes:
  - `text`
  - `answers`
  - `correctIndex`
  - `active: true`
  - `generatedOn` (UTC date string)
  - `source: "opentdb"`

## Deploy

This repository still includes Fastly helper scripts from the original template.

Typical flow in Codespaces:

1. Add `FASTLY_API_TOKEN` as a Codespaces secret.
2. Use the `Publish` action/button in the environment.
3. Re-run publish when content changes.

If you prefer, you can also deploy the static output (`deploy/_site`) to platforms like GitHub Pages, Netlify, or Vercel.

## Next Improvements

- Timed quiz mode
- Category selection
- Admin moderation for leaderboard entries
- Authentication for protected write access
