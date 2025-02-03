// server.js
const express = require('express');
const fetch = require('node-fetch'); // node-fetch v2
const FormData = require('form-data');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// مفاتيح من بيئة Vercel
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const IMAGE_API_KEY = process.env.IMAGE_API_KEY;

// ========== GitHub Helper ==========
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

// ========== رفع الصور (imghippo) ==========
async function uploadToImgHippo(fileBuffer, fileName) {
  if (!IMAGE_API_KEY) {
    throw new Error("No IMAGE_API_KEY found in environment");
  }
  const Form = require('form-data');
  const form = new Form();
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

// اختبار
app.get('/api/test', (req, res) => {
  res.json({
    message: 'Server up, same code, custom popups for everything!',
    GITHUB_TOKEN: !!GITHUB_TOKEN,
    REPO_OWNER,
    REPO_NAME,
    IMAGE_API_KEY: !!IMAGE_API_KEY
  });
});

// 1) Load topics.json
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

// 2) Save topics.json
app.post('/api/topics', async (req, res) => {
  const { topics, sha } = req.body;
  if (!Array.isArray(topics) || !sha) {
    return res.status(400).json({ success: false, error: 'Invalid body for topics' });
  }
  try {
    const filePath = 'data/topics.json';
    const newContent = JSON.stringify(topics, null, 2);
    const commitMsg = `Update topics.json - ${new Date().toISOString()}`;
    const updateInfo = await updateGitHubFile(filePath, newContent, sha, commitMsg);
    res.json({ success: true, commit: updateInfo.commit });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3) get subtopic file
app.get('/api/get-subtopic-file', async (req, res) => {
  const path = req.query.path;
  if (!path) {
    return res.status(400).json({ success: false, error: 'No path param' });
  }
  try {
    const info = await getGitHubFile(path);
    const decoded = Buffer.from(info.content, 'base64').toString('utf-8');
    let arr;
    try { arr = JSON.parse(decoded); } catch(e) { arr=[]; }
    if (!Array.isArray(arr)) arr=[];
    res.json({ success: true, content: arr, sha: info.sha });
  } catch(err) {
    if (err.message.includes('404')) {
      return res.json({ success: true, content: [], sha: null });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4) update subtopic file
app.post('/api/update-subtopic-file', async (req, res) => {
  const { path, content, sha } = req.body;
  if (!path || !content) {
    return res.status(400).json({ success: false, error: 'Missing path or content' });
  }
  try {
    const finalStr = JSON.stringify(content, null, 2);
    const commitMsg = `Update subtopic file ${path} at ${new Date().toISOString()}`;
    const result = await updateGitHubFile(path, finalStr, sha||'', commitMsg);
    res.json({ success: true, commit: result.commit });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5) delete questions by prefix
app.post('/api/delete-questions-by-prefix', async (req, res) => {
  const { path, sha, prefix } = req.body;
  if (!path || !sha || !prefix) {
    return res.status(400).json({ success: false, error: 'Missing path or sha or prefix' });
  }
  try {
    const info = await getGitHubFile(path);
    const decoded = Buffer.from(info.content, 'base64').toString('utf-8');
    let arr = JSON.parse(decoded);
    if (!Array.isArray(arr)) arr=[];
    const newArr = arr.filter(q => !q.question.includes(prefix));
    const commitMsg = `Delete questions by bold prefix: ${prefix}`;
    const finalStr = JSON.stringify(newArr, null, 2);
    const updateResult = await updateGitHubFile(path, finalStr, sha, commitMsg);
    res.json({
      success: true,
      commit: updateResult.commit,
      deletedCount: arr.length - newArr.length
    });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6) upload image
app.post('/api/upload-image', async (req, res) => {
  const { name, base64 } = req.body;
  if (!base64) {
    return res.status(400).json({ success: false, error: 'No base64 in request' });
  }
  try {
    const buffer = Buffer.from(base64, 'base64');
    const url = await uploadToImgHippo(buffer, name||'uploaded.jpg');
    res.json({ success: true, url });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = app;
