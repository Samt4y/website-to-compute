import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const REQUIRED_ENV = ["FIREBASE_SERVICE_ACCOUNT_KEY"];
const QUESTIONS_PER_DAY = 5;
const TRIVIA_ENDPOINT = `https://opentdb.com/api.php?amount=${QUESTIONS_PER_DAY}&type=multiple`;

for (const envName of REQUIRED_ENV) {
  if (!process.env[envName]) {
    throw new Error(`Missing required env var: ${envName}`);
  }
}

function todayKey() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseServiceAccount(rawJson) {
  const parsed = JSON.parse(rawJson);
  if (typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }
  return parsed;
}

function normalizeQuestion(question, index) {
  const text = String(question?.text || "").trim();
  const answers = Array.isArray(question?.answers)
    ? question.answers.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const correctIndex = Number.isInteger(question?.correctIndex) ? question.correctIndex : -1;

  if (!text) {
    throw new Error(`Question ${index + 1} missing text`);
  }
  if (answers.length !== 4) {
    throw new Error(`Question ${index + 1} must have exactly 4 answers`);
  }
  if (new Set(answers.map((a) => a.toLowerCase())).size !== answers.length) {
    throw new Error(`Question ${index + 1} answers must be unique`);
  }
  if (correctIndex < 0 || correctIndex >= answers.length) {
    throw new Error(`Question ${index + 1} has invalid correctIndex`);
  }

  return { text, answers, correctIndex, active: true };
}

function decodeHtmlEntities(input) {
  return String(input)
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&eacute;/g, "e");
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function generateQuestions() {
  const response = await fetch(TRIVIA_ENDPOINT);
  if (!response.ok) {
    throw new Error(`Trivia API failed with status ${response.status}`);
  }

  const payload = await response.json();
  if (payload.response_code !== 0 || !Array.isArray(payload.results)) {
    throw new Error(`Trivia API returned invalid response code: ${payload.response_code}`);
  }

  if (payload.results.length !== QUESTIONS_PER_DAY) {
    throw new Error(`Trivia API did not return exactly ${QUESTIONS_PER_DAY} questions`);
  }

  const mapped = payload.results.map((item) => {
    const correctAnswer = decodeHtmlEntities(item.correct_answer);
    const wrongAnswers = item.incorrect_answers.map(decodeHtmlEntities);
    const answers = shuffle([correctAnswer, ...wrongAnswers]);
    const correctIndex = answers.findIndex((answer) => answer === correctAnswer);

    return {
      text: decodeHtmlEntities(item.question),
      answers,
      correctIndex
    };
  });

  return mapped.map(normalizeQuestion);
}

async function replaceQuestionsCollection(questions) {
  const serviceAccount = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

  if (!getApps().length) {
    initializeApp({
      credential: cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id
    });
  }

  const db = getFirestore();
  const questionsRef = db.collection("questions");
  const snapshot = await questionsRef.get();
  const batch = db.batch();

  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  const generatedOn = todayKey();
  questions.forEach((question, index) => {
    const ref = questionsRef.doc(`q${index + 1}`);
    batch.set(ref, {
      ...question,
      generatedOn,
      source: "opentdb"
    });
  });

  await batch.commit();
}

async function main() {
  console.log("Generating daily questions from Open Trivia DB...");
  const questions = await generateQuestions();
  await replaceQuestionsCollection(questions);
  console.log("Successfully replaced Firestore questions collection with 5 new questions.");
}

main().catch((error) => {
  console.error("Daily question generation failed:", error);
  process.exit(1);
});
