import { firebaseConfig } from "./firebase-config.js";

const QUESTION_BANK = [
  {
    text: "What does HTML stand for?",
    answers: ["HyperText Markup Language", "HighText Machine Language", "Home Tool Markup Language", "Hyper Transfer Markup Level"],
    correctIndex: 0
  },
  {
    text: "Which language is mainly used to style web pages?",
    answers: ["Python", "C++", "CSS", "SQL"],
    correctIndex: 2
  },
  {
    text: "Which keyword creates a constant in JavaScript?",
    answers: ["let", "var", "const", "fixed"],
    correctIndex: 2
  },
  {
    text: "What does API stand for?",
    answers: ["Application Programming Interface", "Automated Program Integration", "Applied Page Index", "Algorithm Process Input"],
    correctIndex: 0
  },
  {
    text: "Which HTTP method is typically used to create new data?",
    answers: ["GET", "POST", "HEAD", "TRACE"],
    correctIndex: 1
  }
];

const POINTS_PER_CORRECT = 10;
const BEST_SCORE_KEY = "quizBestScore";
const LAST_PLAYER_KEY = "quizLastPlayer";
const LEADERBOARD_KEY = "quizLeaderboard";
const DAILY_PLAY_KEY = "quizDailyPlayByName";
const MAX_LEADERBOARD_ENTRIES = 10;

const setupScreen = document.querySelector("#setup-screen");
const quizScreen = document.querySelector("#quiz-screen");
const resultScreen = document.querySelector("#result-screen");
const playerNameInput = document.querySelector("#player-name");
const startQuizButton = document.querySelector("#start-quiz");
const setupMessage = document.querySelector("#setup-message");
const playerDisplay = document.querySelector("#player-display");
const questionProgress = document.querySelector("#question-progress");
const currentPoints = document.querySelector("#current-points");
const bestPoints = document.querySelector("#best-points");
const questionText = document.querySelector("#question-text");
const answersContainer = document.querySelector("#answers");
const feedback = document.querySelector("#feedback");
const nextQuestionButton = document.querySelector("#next-question");
const resultText = document.querySelector("#result-text");
const playAgainButton = document.querySelector("#play-again");
const leaderboardList = document.querySelector("#leaderboard-list");
const leaderboardListResult = document.querySelector("#leaderboard-list-result");

let playerName = "";
let points = 0;
let questionIndex = 0;
let questions = [];
let activeQuestionBank = [...QUESTION_BANK];
let backend = null;

function hasFirebaseConfig() {
  return Boolean(
    firebaseConfig.apiKey
    && firebaseConfig.authDomain
    && firebaseConfig.projectId
    && firebaseConfig.appId
  );
}

function getBestScore() {
  return Number(localStorage.getItem(BEST_SCORE_KEY) || 0);
}

function getTodayLocalDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizePlayerKey(name) {
  return name.trim().toLowerCase();
}

function getDailyPlayMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DAILY_PLAY_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function hasPlayedToday(name) {
  const today = getTodayLocalDateKey();
  const playMap = getDailyPlayMap();
  return playMap[normalizePlayerKey(name)] === today;
}

function markPlayedToday(name) {
  const today = getTodayLocalDateKey();
  const playMap = getDailyPlayMap();
  playMap[normalizePlayerKey(name)] = today;
  localStorage.setItem(DAILY_PLAY_KEY, JSON.stringify(playMap));
}

function getLocalLeaderboard() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEADERBOARD_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function saveLocalLeaderboard(entries) {
  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(entries));
}

function updateLocalLeaderboard(name, score) {
  const next = [...getLocalLeaderboard(), { name, score }]
    .filter((entry) => typeof entry.name === "string" && Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_LEADERBOARD_ENTRIES);

  saveLocalLeaderboard(next);
  return next;
}

function renderLeaderboard(entries) {
  const targets = [leaderboardList, leaderboardListResult];

  targets.forEach((target) => {
    target.innerHTML = "";
    if (!entries.length) {
      const li = document.createElement("li");
      li.textContent = "No scores yet. Be the first!";
      target.appendChild(li);
      return;
    }

    entries.forEach((entry) => {
      const li = document.createElement("li");
      li.textContent = `${entry.name} - ${entry.score} pts`;
      target.appendChild(li);
    });
  });
}

function normalizeQuestion(docData) {
  if (!docData || typeof docData.text !== "string") {
    return null;
  }

  if (!Array.isArray(docData.answers) || docData.answers.length < 2) {
    return null;
  }

  if (!Number.isInteger(docData.correctIndex)) {
    return null;
  }

  if (docData.correctIndex < 0 || docData.correctIndex >= docData.answers.length) {
    return null;
  }

  return {
    text: docData.text,
    answers: docData.answers,
    correctIndex: docData.correctIndex
  };
}

async function createFirebaseBackend() {
  if (!hasFirebaseConfig()) {
    return null;
  }

  try {
    const [{ initializeApp }, firestoreModule] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js")
    ]);

    const {
      getFirestore,
      collection,
      addDoc,
      getDocs,
      query,
      orderBy,
      limit,
      serverTimestamp
    } = firestoreModule;

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    return {
      async fetchQuestions() {
        const snapshot = await getDocs(collection(db, "questions"));
        const docs = snapshot.docs
          .map((doc) => doc.data())
          .filter((doc) => doc.active !== false)
          .map(normalizeQuestion)
          .filter(Boolean);

        return docs;
      },
      async fetchLeaderboard() {
        const leaderboardQuery = query(
          collection(db, "leaderboard"),
          orderBy("score", "desc"),
          limit(MAX_LEADERBOARD_ENTRIES)
        );

        const snapshot = await getDocs(leaderboardQuery);
        return snapshot.docs
          .map((doc) => doc.data())
          .filter((entry) => typeof entry.name === "string" && Number.isFinite(entry.score))
          .map((entry) => ({ name: entry.name, score: entry.score }));
      },
      async submitScore(name, score) {
        await addDoc(collection(db, "leaderboard"), {
          name,
          score,
          createdAt: serverTimestamp()
        });
      }
    };
  } catch (error) {
    console.warn("Firebase backend unavailable, using local mode.", error);
    return null;
  }
}

function shuffleQuestions(questionList) {
  const copy = [...questionList];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function switchScreen(screenToShow) {
  setupScreen.hidden = screenToShow !== "setup";
  quizScreen.hidden = screenToShow !== "quiz";
  resultScreen.hidden = screenToShow !== "result";
}

function renderQuestion() {
  const currentQuestion = questions[questionIndex];
  questionText.textContent = currentQuestion.text;
  questionProgress.textContent = `${questionIndex + 1} / ${questions.length}`;
  currentPoints.textContent = String(points);
  feedback.textContent = "";
  feedback.className = "message";
  nextQuestionButton.hidden = true;
  answersContainer.innerHTML = "";

  currentQuestion.answers.forEach((answer, index) => {
    const answerButton = document.createElement("button");
    answerButton.className = "btn answer-btn";
    answerButton.type = "button";
    answerButton.textContent = answer;
    answerButton.addEventListener("click", () => evaluateAnswer(index));
    answersContainer.appendChild(answerButton);
  });
}

function disableAnswers() {
  const allButtons = answersContainer.querySelectorAll("button");
  allButtons.forEach((button) => {
    button.disabled = true;
  });
}

function evaluateAnswer(selectedIndex) {
  const currentQuestion = questions[questionIndex];
  const answerButtons = answersContainer.querySelectorAll("button");
  disableAnswers();

  answerButtons.forEach((button, index) => {
    if (index === currentQuestion.correctIndex) {
      button.classList.add("correct");
    } else if (index === selectedIndex) {
      button.classList.add("wrong");
    }
  });

  if (selectedIndex === currentQuestion.correctIndex) {
    points += POINTS_PER_CORRECT;
    feedback.textContent = `Correct! +${POINTS_PER_CORRECT} points`;
    feedback.classList.add("ok");
  } else {
    feedback.textContent = "Wrong answer. No points this round.";
    feedback.classList.add("error");
  }

  currentPoints.textContent = String(points);
  nextQuestionButton.hidden = false;
}

async function syncLeaderboardAfterResult() {
  const localEntries = updateLocalLeaderboard(playerName, points);

  if (!backend) {
    renderLeaderboard(localEntries);
    return;
  }

  try {
    await backend.submitScore(playerName, points);
    const remoteEntries = await backend.fetchLeaderboard();
    renderLeaderboard(remoteEntries.length ? remoteEntries : localEntries);
  } catch (error) {
    console.warn("Could not sync leaderboard to Firebase.", error);
    renderLeaderboard(localEntries);
  }
}

function showResults() {
  const best = getBestScore();
  const isNewBest = points > best;

  if (isNewBest) {
    localStorage.setItem(BEST_SCORE_KEY, String(points));
    bestPoints.textContent = String(points);
  }

  resultText.textContent = isNewBest
    ? `${playerName}, you scored ${points} points. New best score!`
    : `${playerName}, you scored ${points} points. Best score stays at ${best}.`;

  switchScreen("result");
  void syncLeaderboardAfterResult();
}

function onNextQuestion() {
  questionIndex += 1;
  if (questionIndex >= questions.length) {
    showResults();
    return;
  }
  renderQuestion();
}

function startQuiz() {
  const providedName = playerNameInput.value.trim();
  if (!providedName) {
    setupMessage.textContent = "Please enter your name to start.";
    setupMessage.className = "message error";
    return;
  }

  if (hasPlayedToday(providedName)) {
    setupMessage.textContent = "You already played today. Come back tomorrow for the next quiz attempt.";
    setupMessage.className = "message error";
    return;
  }

  setupMessage.textContent = "";
  setupMessage.className = "message";
  playerName = providedName;
  points = 0;
  questionIndex = 0;
  questions = shuffleQuestions(activeQuestionBank.length ? activeQuestionBank : QUESTION_BANK);
  playerDisplay.textContent = playerName;
  bestPoints.textContent = String(getBestScore());
  localStorage.setItem(LAST_PLAYER_KEY, playerName);
  markPlayedToday(playerName);

  switchScreen("quiz");
  renderQuestion();
}

function preloadPlayerName() {
  const saved = localStorage.getItem(LAST_PLAYER_KEY);
  if (saved) {
    playerNameInput.value = saved;
  }
}

async function bootstrapBackend() {
  backend = await createFirebaseBackend();

  if (!backend) {
    renderLeaderboard(getLocalLeaderboard());
    return;
  }

  try {
    const [remoteQuestions, remoteLeaderboard] = await Promise.all([
      backend.fetchQuestions(),
      backend.fetchLeaderboard()
    ]);

    if (remoteQuestions.length) {
      activeQuestionBank = remoteQuestions;
    }

    if (remoteLeaderboard.length) {
      renderLeaderboard(remoteLeaderboard);
    } else {
      renderLeaderboard(getLocalLeaderboard());
    }
  } catch (error) {
    console.warn("Firebase data load failed, using local fallback.", error);
    renderLeaderboard(getLocalLeaderboard());
  }
}

startQuizButton.addEventListener("click", startQuiz);
nextQuestionButton.addEventListener("click", onNextQuestion);
playAgainButton.addEventListener("click", () => {
  switchScreen("setup");
});
playerNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    startQuiz();
  }
});

preloadPlayerName();
renderLeaderboard(getLocalLeaderboard());
void bootstrapBackend();
