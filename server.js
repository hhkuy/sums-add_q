// server.js
const express = require('express');
const fetch = require('node-fetch'); // node-fetch v2
const FormData = require('form-data');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ========== Secrets via Vercel Env Vars ==========
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;    // مفتاح GitHub
const REPO_OWNER = process.env.REPO_OWNER;        // اسم المستخدم/المنظمة
const REPO_NAME = process.env.REPO_NAME;          // اسم المستودع
const IMAGE_API_KEY = process.env.IMAGE_API_KEY;  // مفتاح رفع الصور (imghippo)

// ========== GitHub Helper Functions ==========
async function getGitHubFile(path) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json'
    }
  });
  if (!res.ok) {
    throw new Error(`getGitHubFile failed: ${res.status} - ${res.statusText}`);
  }
  return await res.json(); // { content, sha, ...}
}

async function updateGitHubFile(path, newContent, sha, commitMessage) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
  const body = {
    message: commitMessage,
    content: Buffer.from(newContent, 'utf-8').toString('base64'),
    sha
  };
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`updateGitHubFile failed: ${res.status} - ${res.statusText}`);
  }
  return await res.json();
}

// ====== رفع صورة عبر imghippo ======
async function uploadToImgHippo(fileBuffer, fileName) {
  if (!IMAGE_API_KEY) {
    throw new Error("No IMAGE_API_KEY found in environment");
  }
  const form = new FormData();
  form.append("api_key", IMAGE_API_KEY);
  form.append("file", fileBuffer, fileName);

  const res = await fetch("https://api.imghippo.com/v1/upload", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: form
  });
  if (!res.ok) {
    throw new Error(`uploadToImgHippo failed: ${res.status} - ${res.statusText}`);
  }
  const json = await res.json();
  if (json.success && json.data && json.data.url) {
    return json.data.url;
  } else {
    throw new Error("ImgHippo upload error: " + JSON.stringify(json));
  }
}

// ========== Routes ==========

// 1) Test route
app.get('/api/test', (req, res) => {
  res.json({
    message: 'Server up. Checking env vars...',
    GITHUB_TOKEN: GITHUB_TOKEN ? 'Loaded' : 'Missing',
    REPO_OWNER,
    REPO_NAME,
    IMAGE_API_KEY: IMAGE_API_KEY ? 'Loaded' : 'Missing'
  });
});

// 2) Load "topics.json" from data/topics.json
app.get('/api/topics', async (req, res) => {
  try {
    const filePath = 'data/topics.json'; 
    const info = await getGitHubFile(filePath);
    const decoded = Buffer.from(info.content, 'base64').toString('utf-8');
    const topics = JSON.parse(decoded);
    res.json({ success: true, topics, sha: info.sha });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3) Save "topics.json"
app.post('/api/topics', async (req, res) => {
  // body => { topics: [...], sha: "..." }
  try {
    const { topics, sha } = req.body;
    if (!Array.isArray(topics) || !sha) {
      return res.status(400).json({ success: false, error: 'Invalid body for topics' });
    }
    const filePath = 'data/topics.json';
    const newContent = JSON.stringify(topics, null, 2);
    const commitMsg = `Update topics.json from admin panel at ${new Date().toISOString()}`;
    const updateInfo = await updateGitHubFile(filePath, newContent, sha, commitMsg);
    res.json({ success: true, commit: updateInfo.commit });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4) إنشاء ملف Subtopic تلقائيًا بمجرد أن تكون له قيمة file في topics.json
//    (يمكنك بدلاً من ذلك إنشاؤه مباشرةً عند /api/get-subtopic-file)


// 5) جلب ملف أسئلة محدّد (مثل data/myTopic_subName.json)
app.get('/api/get-subtopic-file', async (req, res) => {
  // نتوقع ?path=data/...json
  const path = req.query.path;
  if (!path) {
    return res.status(400).json({ success: false, error: 'No path' });
  }
  try {
    const info = await getGitHubFile(path);
    const decoded = Buffer.from(info.content, 'base64').toString('utf-8');
    let parsed;
    try {
      parsed = JSON.parse(decoded);
    } catch(e) {
      parsed = decoded;
    }
    res.json({ success: true, content: parsed, sha: info.sha });
  } catch(err) {
    if (err.message.includes('404')) {
      // الملف غير موجود => سنرجع مصفوفة فارغة
      return res.json({ success: true, content: [], sha: null });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6) حفظ الأسئلة (تحديث ملف subtopic)
app.post('/api/update-subtopic-file', async (req, res) => {
  // body => { path, content, sha } 
  // path = data/topicName_subName.json
  // content => array of questions
  // sha => null لو الملف غير موجود سابقًا
  const { path, content, sha } = req.body;
  if (!path || !content) {
    return res.status(400).json({ success: false, error: 'Missing path or content' });
  }
  try {
    let finalStr = JSON.stringify(content, null, 2);
    const commitMsg = `Update subtopic file (${path}) at ${new Date().toISOString()}`;
    // لو sha غير موجود => يعني ملف جديد 
    const info = await updateGitHubFile(path, finalStr, sha || '', commitMsg);
    res.json({ success: true, commit: info.commit });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7) حذف أسئلة بالاعتماد على الكلام الغامق
//    سنفتح الملف, نفلتر الأسئلة, ونحفظه
app.post('/api/delete-questions-by-prefix', async (req, res) => {
  // body => { path, sha, prefix, singleBoldTextOptional }
  // prefix = "Dr. Golshan", في question
  // يفلتر الأسئلة
  const { path, sha, prefix } = req.body;
  if (!path || !sha || !prefix) {
    return res.status(400).json({ success: false, error: 'Missing path or sha or prefix' });
  }
  try {
    // 1) نقرأ الملف
    const info = await getGitHubFile(path);
    const decoded = Buffer.from(info.content, 'base64').toString('utf-8');
    let questions = JSON.parse(decoded);
    if (!Array.isArray(questions)) {
      return res.status(400).json({ success: false, error: 'File is not an array of questions' });
    }
    // 2) نحذف الأسئلة التي يبدأ سؤالها بالكلام الغامق
    //    افترضنا شكل question: <span style='color: darkred; font-weight: bold;'>Dr. Golshan ... 
    //    نبحث عن "prefix" بعد bold
    const newQuestions = questions.filter(q => {
      // استخراج الجزء الغامق
      // ممكن match /<span[^>]*>(.*?)<\/span>/  
      // أو أبسط: ننظر إن كان question.includes(prefix)
      return !q.question.includes(prefix);
    });
    // 3) نرفع الملف المحدث
    const commitMsg = `Delete questions by bold prefix: ${prefix}`;
    const finalStr = JSON.stringify(newQuestions, null, 2);
    const updateInfo = await updateGitHubFile(path, finalStr, sha, commitMsg);
    res.json({ success: true, commit: updateInfo.commit, deletedCount: questions.length - newQuestions.length });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8) رفع صورة 
app.post('/api/upload-image', async (req, res) => {
  // body => { name, base64 }
  const { name, base64 } = req.body;
  if (!base64) {
    return res.status(400).json({ success: false, error: 'No base64 in body' });
  }
  try {
    const buffer = Buffer.from(base64, 'base64');
    const url = await uploadToImgHippo(buffer, name || 'uploaded.jpg');
    res.json({ success: true, url });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== Export for Vercel ==========
module.exports = app;
