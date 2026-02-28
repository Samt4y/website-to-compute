import OpenAI from "openai";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const REQUIRED_ENV = ["OPENAI_API_KEY", "FIREBASE_SERVICE_ACCOUNT_KEY"];
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

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

async function generateQuestions() {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.9,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You create high-quality multiple-choice quiz questions. Keep content safe for general audiences. Output JSON only."
      },
      {
        role: "user",
        content:
          "Generate exactly 5 new quiz questions for a general knowledge web quiz. Return JSON with this shape: {\"questions\":[{\"text\":string,\"answers\":[string,string,string,string],\"correctIndex\":number}]}. Rules: exactly 4 answer options per question, one correct answer, no trick wording, no duplicate questions, and vary topics."
      }
    ]
  });

  const content = completion.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Model returned empty content");
  }

  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed.questions) || parsed.questions.length !== 5) {
    throw new Error("Model did not return exactly 5 questions");
  }

  return parsed.questions.map(normalizeQuestion);
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
      source: "openai"
    });
  });

  await batch.commit();
}

async function main() {
  console.log(`Generating daily questions with model ${MODEL}...`);
  const questions = await generateQuestions();
  await replaceQuestionsCollection(questions);
  console.log("Successfully replaced Firestore questions collection with 5 new questions.");
}

main().catch((error) => {
  console.error("Daily question generation failed:", error);
  process.exit(1);
});
