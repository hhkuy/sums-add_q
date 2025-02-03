// server.js
const express = require('express');
const fetch = require('node-fetch');
const FormData = require('form-data');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// =========== Env Variables (Secrets) ===========
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;   // مفتاح الوصول لـ GitHub
const REPO_OWNER = process.env.REPO_OWNER;       // اسم المستخدم/المنظمة
const REPO_NAME = process.env.REPO_NAME;         // اسم المستودع
const IMAGE_API_KEY = process.env.IMAGE_API_KEY; // مفتاح رفع الصور (imghippo)

// ======= GitHub Helper Functions =======
async function getGitHubFile(path) {
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
  return await res.json(); // { content, sha, ... }
}

async function updateGitHubFile(path, newContent, sha, commitMessage) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
  const body = {
    message: commitMessage,
    content: Buffer.from(newContent, 'utf-8').toString('base64'),
    sha: sha
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

// ======= Image upload helper (imghippo) =======
async function uploadToImgHippo(fileBuffer, fileName) {
  if (!IMAGE_API_KEY) {
    throw new Error("No IMAGE_API_KEY found in environment.");
  }
  const form = new FormData();
  form.append('api_key', IMAGE_API_KEY);
  form.append('file', fileBuffer, fileName);

  const res = await fetch("https://api.imghippo.com/v1/upload", {
    method: 'POST',
    headers: { Accept: 'application/json' },
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

// ================== Routes ==================

// 1) test server
app.get('/api/test', (req, res) => {
  res.json({
    message: 'Server is up. Secrets loaded?',
    GITHUB_TOKEN: GITHUB_TOKEN ? "Loaded" : "Missing",
    REPO_OWNER,
    REPO_NAME,
    IMAGE_API_KEY: IMAGE_API_KEY ? "Loaded" : "Missing"
  });
});

// 2) Load topics.json automatically and return content
app.get('/api/topics', async (req, res) => {
  // نفتح data/topics.json
  try {
    const filePath = 'data/topics.json'; // مسار ثابت
    const info = await getGitHubFile(filePath);
    const decoded = Buffer.from(info.content, 'base64').toString('utf-8');
    const topics = JSON.parse(decoded);
    res.json({ success: true, topics, sha: info.sha });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3) Save topics.json automatically
app.post('/api/topics', async (req, res) => {
  // body: { topics: [...], sha: "..." }
  try {
    const { topics, sha } = req.body;
    if (!Array.isArray(topics) || !sha) {
      return res.status(400).json({ success: false, error: 'Invalid body for topics' });
    }
    const filePath = 'data/topics.json';
    const newContent = JSON.stringify(topics, null, 2);
    const commitMsg = `Update topics.json from admin panel - ${new Date().toISOString()}`;
    const updateInfo = await updateGitHubFile(filePath, newContent, sha, commitMsg);
    res.json({ success: true, commit: updateInfo.commit });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4) Load any file from GitHub (like questions file)
app.get('/api/get-file', async (req, res) => {
  const path = req.query.path;
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
      parsed = decoded;
    }
    res.json({ success: true, content: parsed, sha: info.sha });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5) Update any file (like questions file)
app.post('/api/update-file', async (req, res) => {
  // body: { path, content, sha }
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
    const commitMsg = `Update file ${path} from admin panel - ${new Date().toISOString()}`;
    const updateResp = await updateGitHubFile(path, finalStr, sha, commitMsg);
    res.json({ success: true, commit: updateResp.commit });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6) Upload image to imghippo
app.post('/api/upload-image', async (req, res) => {
  // body: { name, base64 }
  const { name, base64 } = req.body;
  if (!base64) {
    return res.status(400).json({ success: false, error: 'No base64 in body' });
  }
  try {
    const buffer = Buffer.from(base64, 'base64');
    const imageUrl = await uploadToImgHippo(buffer, name || 'uploaded.jpg');
    res.json({ success: true, url: imageUrl });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================== Export for Vercel ==================
module.exports = app;
