// server.js
const express = require('express');
const fetch = require('node-fetch'); // node-fetch v2
const FormData = require('form-data');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ====== مفاتيح سرية من بيئة Vercel ======
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;    // لوصول GitHub
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const IMAGE_API_KEY = process.env.IMAGE_API_KEY; // لرفع الصور إلى imghippo

// ====== دوال مساعدة ======
async function getGitHubFile(path) {
  // جلب ملف من مستودع GitHub
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json'
    }
  });
  if (!res.ok) {
    throw new Error(`getGitHubFile failed: ${res.status} ${res.statusText}`);
  }
  return await res.json(); // { content, sha, ... }
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
    throw new Error(`updateGitHubFile failed: ${res.status} ${res.statusText}`);
  }
  return await res.json(); // معلومات الـcommit
}

async function uploadToImgHippo(fileBuffer, fileName) {
  // رفع الصورة (Buffer) إلى imghippo
  if (!IMAGE_API_KEY) {
    throw new Error("No IMAGE_API_KEY found in environment");
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
    throw new Error(`uploadToImgHippo failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (json.success && json.data && json.data.url) {
    return json.data.url;
  } else {
    throw new Error('ImgHippo upload error: ' + JSON.stringify(json));
  }
}

// ====== المسارات ======

// فحص السيرفر
app.get('/api/test', (req, res) => {
  res.json({
    message: 'Server is up, reading secrets from process.env!',
    GITHUB_TOKEN: GITHUB_TOKEN ? "Loaded" : "Not set",
    REPO_OWNER,
    REPO_NAME,
    IMAGE_API_KEY: IMAGE_API_KEY ? "Loaded" : "Not set"
  });
});

// جلب ملف من GitHub
app.get('/api/get-file', async (req, res) => {
  // ?path=data/topics.json
  const path = req.query.path;
  if (!path) {
    return res.status(400).json({ success: false, error: 'No ?path provided' });
  }
  try {
    const info = await getGitHubFile(path);
    // نفك التشفير:
    const decoded = Buffer.from(info.content, 'base64').toString('utf-8');
    let parsed;
    try {
      parsed = JSON.parse(decoded);
    } catch(e) {
      // ربما ملف نص
      parsed = decoded;
    }
    res.json({ success: true, content: parsed, sha: info.sha });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// تحديث ملف على GitHub
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
    const commitMsg = `Update file ${path} from Quiz Converter panel - ${new Date().toISOString()}`;
    const updateInfo = await updateGitHubFile(path, finalStr, sha, commitMsg);
    res.json({ success: true, commit: updateInfo.commit });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// رفع صورة واحدة (عبر imghippo)
app.post('/api/upload-image', async (req, res) => {
  // نتوقع body: { name: "filename.png", base64: "..." }
  const { name, base64 } = req.body;
  if (!base64) {
    return res.status(400).json({ success: false, error: 'No base64' });
  }
  try {
    const fileBuffer = Buffer.from(base64, 'base64');
    const imageUrl = await uploadToImgHippo(fileBuffer, name || "uploaded_image.jpg");
    res.json({ success: true, url: imageUrl });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// التصدير لـ Vercel
module.exports = app;
