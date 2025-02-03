// server.js
const express = require('express');
const fetch = require('node-fetch'); // node-fetch v2
const FormData = require('form-data');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// =========== متغيرات البيئة (Secrets) ==========
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;   // مفاتيح GitHub
const REPO_OWNER = process.env.REPO_OWNER;       // اسم المستخدم/المنظمة
const REPO_NAME = process.env.REPO_NAME;         // اسم المستودع
const IMAGE_API_KEY = process.env.IMAGE_API_KEY; // مفتاح imghippo (للصور)

// =========== دوال مساعدة للتعامل مع GitHub ==========
async function getGitHubFile(path) {
  // مثلاً path = "data/topics.json"
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
  const res = await fetch(url, {
    method: 'GET',
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
  // path = "data/topics.json" أو "data/cns_anatomy.json" مثلاً
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
  return await res.json(); // معلومات الـcommit
}

// =========== رفع صورة عبر imghippo ==========
async function uploadToImgHippo(fileBuffer, fileName) {
  if (!IMAGE_API_KEY) {
    throw new Error("No IMAGE_API_KEY found in environment.");
  }
  const form = new FormData();
  form.append('api_key', IMAGE_API_KEY);
  form.append('file', fileBuffer, fileName);

  const res = await fetch("https://api.imghippo.com/v1/upload", {
    method: 'POST',
    headers: {
      Accept: 'application/json'
    },
    body: form
  });
  if (!res.ok) {
    throw new Error(`uploadToImgHippo failed: ${res.status} - ${res.statusText}`);
  }
  const json = await res.json();
  if (json.success && json.data && json.data.url) {
    return json.data.url;
  } else {
    throw new Error('ImgHippo upload error: ' + JSON.stringify(json));
  }
}

// ================== المسارات ==================

// فحص السيرفر وقراءة المتغيرات
app.get('/api/test', (req, res) => {
  res.json({
    message: 'Server is up. Checking secrets...',
    GITHUB_TOKEN: GITHUB_TOKEN ? "Loaded" : "Missing",
    REPO_OWNER,
    REPO_NAME,
    IMAGE_API_KEY: IMAGE_API_KEY ? "Loaded" : "Missing"
  });
});

// 1) جلب (Load) ملف المواضيع: "data/topics.json"
app.get('/api/topics', async (req, res) => {
  try {
    const filePath = 'data/topics.json'; // المسار داخل المستودع
    const info = await getGitHubFile(filePath);  // { content, sha, ...}
    const decoded = Buffer.from(info.content, 'base64').toString('utf-8');
    const topics = JSON.parse(decoded);
    res.json({ success: true, topics, sha: info.sha });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2) حفظ (Save) ملف المواضيع: "data/topics.json"
app.post('/api/topics', async (req, res) => {
  // body => { topics: [...], sha: "..." }
  try {
    const { topics, sha } = req.body;
    if (!Array.isArray(topics) || !sha) {
      return res.status(400).json({ success: false, error: 'Invalid body for topics' });
    }
    const filePath = 'data/topics.json';
    const newContent = JSON.stringify(topics, null, 2);
    const commitMsg = `Update topics.json via admin panel at ${new Date().toISOString()}`;
    const updateInfo = await updateGitHubFile(filePath, newContent, sha, commitMsg);
    res.json({ success: true, commit: updateInfo.commit });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3) جلب أي ملف (مثل "data/cns_anatomy.json")
app.get('/api/get-file', async (req, res) => {
  const path = req.query.path;  // مثلاً ?path=data/cns_anatomy.json
  if (!path) {
    return res.status(400).json({ success: false, error: 'No ?path param' });
  }
  try {
    const info = await getGitHubFile(path);
    const decoded = Buffer.from(info.content, 'base64').toString('utf-8');
    let parsed;
    try {
      parsed = JSON.parse(decoded);
    } catch(e) {
      parsed = decoded; // ربما نص
    }
    res.json({ success: true, content: parsed, sha: info.sha });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4) تحديث أي ملف (مثل "data/cns_anatomy.json")
app.post('/api/update-file', async (req, res) => {
  // body => { path, content, sha }
  const { path, content, sha } = req.body;
  if (!path || !sha) {
    return res.status(400).json({ success: false, error: 'Missing path or sha' });
  }
  try {
    let finalStr;
    if (typeof content === 'object') {
      finalStr = JSON.stringify(content, null, 2);
    } else {
      finalStr = String(content);
    }
    const commitMsg = `Update file ${path} from admin panel at ${new Date().toISOString()}`;
    const updateResp = await updateGitHubFile(path, finalStr, sha, commitMsg);
    res.json({ success: true, commit: updateResp.commit });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5) رفع صورة واحدة
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

// تصدير التطبيق لكي يستخدمه Vercel
module.exports = app;
