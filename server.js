// server.js
const express = require('express');
const fetch = require('node-fetch'); // node-fetch v2
const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 1) قراءة المتغيرات السرية (Secrets) من بيئة Vercel
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;  // مثلا: ghp_... 
const REPO_OWNER = process.env.REPO_OWNER;      // مثلا: yourusername
const REPO_NAME = process.env.REPO_NAME;        // مثلا: your-repo
// (اختياري) للصور:
const IMAGE_API_KEY = process.env.IMAGE_API_KEY; // اذا عندك رفع صور

//------------------ دوال مساعدة للتعامل مع GitHub ------------------
async function getGitHubFile(filePath) {
  // مسار الملف في المستودع مثل: "data/topics.json"
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  if (!res.ok) {
    throw new Error(`getGitHubFile failed: ${res.status} ${res.statusText}`);
  }
  return await res.json(); // { content, sha, ...}
}

async function updateGitHubFile(filePath, newContent, sha, commitMessage) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;
  const body = {
    message: commitMessage,
    content: Buffer.from(newContent, 'utf-8').toString('base64'),
    sha: sha
  };
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`updateGitHubFile failed: ${res.status} ${res.statusText}`);
  }
  return await res.json(); // معلومات الـ commit الجديد
}

//------------------ مثال رفع صورة (اختياري) ------------------
async function uploadImage(fileDataBase64) {
  // fileDataBase64 = سلسلة Base64 للصورة
  // IMAGE_API_KEY = المفتاح
  if (!IMAGE_API_KEY) {
    throw new Error('No IMAGE_API_KEY found in env');
  }
  // استبدل بـ API الرفع الذي تريده
  const url = "https://api.imghippo.com/v1/upload"; 
  const bodyForm = new FormData();
  bodyForm.append("api_key", IMAGE_API_KEY);
  // ... الخ
  // (ممكن استخدام node-fetch-multipart أو form-data library لإرسال multipart)

  // هذا مثال مبسط -> قد تحتاج تحديثه
  return "https://someimage.com/youruploaded.jpg";
}

//------------------ المسارات (Routes) ------------------

// اختبار:
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Server is up and reading secrets', 
    githubToken: GITHUB_TOKEN ? "Loaded" : "Missing",
    owner: REPO_OWNER,
    repo: REPO_NAME
  });
});

// جلب ملف (topics.json مثلا)
app.get('/api/get-file', async (req, res) => {
  // نتوقع ?path=data/topics.json
  const path = req.query.path;
  if (!path) {
    return res.status(400).json({ success: false, error: 'No ?path provided' });
  }
  try {
    const info = await getGitHubFile(path);
    // info = { content, sha, ...}
    const decoded = Buffer.from(info.content, 'base64').toString('utf-8');
    let parsed;
    try {
      parsed = JSON.parse(decoded);
    } catch(e) {
      parsed = decoded; 
    }
    res.json({ success: true, content: parsed, sha: info.sha });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// تحديث ملف
app.post('/api/update-file', async (req, res) => {
  // يتوقع body: { path: "data/topics.json", content: {...}, sha: "..."}
  const { path, content, sha } = req.body;
  if (!path || !sha || (!content && content!=="" )) {
    return res.status(400).json({ success: false, error: 'Missing path or content or sha' });
  }
  try {
    // اذا كان content كائن => JSON.stringify
    let finalStr;
    if (typeof content === 'object') {
      finalStr = JSON.stringify(content, null, 2);
    } else {
      finalStr = content; 
    }
    const commitMsg = `Update file ${path} from admin panel - ${new Date().toISOString()}`;
    const updateInfo = await updateGitHubFile(path, finalStr, sha, commitMsg);
    res.json({ success: true, commit: updateInfo.commit });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// رفع صورة (اختياري)
app.post('/api/upload-image', async (req, res) => {
  // نتوقع body: { base64: "..."}
  const { base64 } = req.body;
  if (!base64) {
    return res.status(400).json({ success: false, error: 'No base64 data' });
  }
  try {
    const imageUrl = await uploadImage(base64);
    res.json({ success: true, url: imageUrl });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// تصدير app لكي تستخدمه Vercel
module.exports = app;
