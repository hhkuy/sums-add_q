// server.js
const express = require('express');
const fetch = require('node-fetch');
const FormData = require('form-data');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// تأكد من ضبط متغيرات البيئة التالية في Vercel أو ملف .env
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;       // المستودع الخاص بالمواضيع والملفات الفرعية
const REPO_NAME_PIC = process.env.REPO_NAME_PIC; // المستودع الخاص بالصور (مثلاً "Sums_Q_Pic")
// يمكن ضبط الفرع الخاص بمستودع الصور، افتراضي "main"
const BRANCH_PIC = process.env.BRANCH_PIC || 'main';

// دوال المساعدة الخاصة بـ GitHub مع تمرير اسم المستودع كمعامل
async function getGitHubFile(repo, path) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${repo}/contents/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json'
    }
  });
  if (!res.ok) {
    throw new Error(`getGitHubFile failed: ${res.status} - ${res.statusText}`);
  }
  return await res.json();
}

async function updateGitHubFile(repo, path, newContent, sha, commitMessage) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${repo}/contents/${path}`;
  const body = {
    message: commitMessage,
    content: Buffer.from(newContent, 'utf-8').toString('base64')
  };
  if (sha) body.sha = sha;
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

async function deleteGitHubFile(repo, path, sha, commitMessage) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${repo}/contents/${path}`;
  const body = {
    message: commitMessage,
    sha
  };
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`deleteGitHubFile failed: ${res.status} - ${res.statusText}`);
  }
  return await res.json();
}

async function uploadGitHubImage(repo, filePath, fileBuffer, commitMessage) {
  let sha;
  try {
    const fileInfo = await getGitHubFile(repo, filePath);
    sha = fileInfo.sha;
  } catch (e) {
    if (!e.message.includes('404')) {
      throw e;
    }
  }
  const body = {
    message: commitMessage,
    content: fileBuffer.toString('base64')
  };
  if (sha) {
    body.sha = sha;
  }
  const url = `https://api.github.com/repos/${REPO_OWNER}/${repo}/contents/${filePath}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`uploadGitHubImage failed: ${res.status} - ${res.statusText}`);
  }
  return await res.json();
}

// ========== Routes ==========

app.get('/api/test', (req, res) => {
  res.json({
    message: "Server up, with separate image repo.",
    GITHUB_TOKEN: !!GITHUB_TOKEN,
    REPO_OWNER,
    REPO_NAME,
    REPO_NAME_PIC,
    BRANCH_PIC
  });
});

// 1) Load topics
app.get('/api/topics', async (req, res) => {
  try {
    const info = await getGitHubFile(REPO_NAME, 'data/topics.json');
    const dec = Buffer.from(info.content, 'base64').toString('utf-8');
    const topics = JSON.parse(dec);
    res.json({ success: true, topics, sha: info.sha });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 2) Save topics
app.post('/api/topics', async (req, res) => {
  const { topics, sha } = req.body;
  if (!Array.isArray(topics) || !sha) {
    return res.status(400).json({ success: false, error: 'Invalid data for topics' });
  }
  try {
    const content = JSON.stringify(topics, null, 2);
    const up = await updateGitHubFile(REPO_NAME, 'data/topics.json', content, sha, 'Save topics');
    res.json({ success: true, commit: up.commit });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 3) Get subtopic file
app.get('/api/get-subtopic-file', async (req, res) => {
  const path = req.query.path;
  if (!path) return res.status(400).json({ success: false, error: 'No path param' });
  try {
    const info = await getGitHubFile(REPO_NAME, path);
    const dec = Buffer.from(info.content, 'base64').toString('utf-8');
    let arr;
    try {
      arr = JSON.parse(dec);
    } catch (e) {
      arr = [];
    }
    if (!Array.isArray(arr)) arr = [];
    res.json({ success: true, content: arr, sha: info.sha });
  } catch (e) {
    if (e.message.includes('404')) {
      return res.json({ success: true, content: [], sha: null });
    }
    res.status(500).json({ success: false, error: e.message });
  }
});

// 4) Update subtopic file
app.post('/api/update-subtopic-file', async (req, res) => {
  const { path, content, sha } = req.body;
  if (!path || !content) {
    return res.status(400).json({ success: false, error: 'Missing path or content' });
  }
  try {
    const finalStr = JSON.stringify(content, null, 2);
    const r = await updateGitHubFile(REPO_NAME, path, finalStr, sha || '', 'Update subtopic');
    res.json({ success: true, commit: r.commit });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 5) Delete questions by prefix
app.post('/api/delete-questions-by-prefix', async (req, res) => {
  const { path, sha, prefix } = req.body;
  if (!path || !sha || !prefix)
    return res.status(400).json({ success: false, error: 'Missing data for prefix deleting' });
  try {
    const info = await getGitHubFile(REPO_NAME, path);
    const dec = Buffer.from(info.content, 'base64').toString('utf-8');
    let arr = JSON.parse(dec);
    if (!Array.isArray(arr)) arr = [];
    let newArr = arr.filter(q => !q.question.includes(prefix));
    const finalStr = JSON.stringify(newArr, null, 2);
    const up = await updateGitHubFile(REPO_NAME, path, finalStr, sha, 'Delete by prefix');
    res.json({ success: true, commit: up.commit, deletedCount: arr.length - newArr.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 6) Upload image to GitHub (into folder pic in REPO_NAME_PIC)
// الآن نضيف معطيات إضافية (topic, subtopic, questionNumber) في رسالة commit
app.post('/api/upload-image', async (req, res) => {
  const { name, base64, topic, subtopic, questionNumber } = req.body;
  if (!base64) {
    return res.status(400).json({ success: false, error: 'No base64 in request' });
  }
  try {
    const buf = Buffer.from(base64, 'base64');
    let timestamp = Date.now();
    let safeName = name ? name.replace(/[^a-zA-Z0-9.\-_]/g, '') : 'uploaded.jpg';
    let filePath = `pic/${timestamp}_${safeName}`;
    // بناء رسالة commit تتضمن البيانات الإضافية إذا كانت متوفرة
    let commitMessage = '';
    if(topic && subtopic && questionNumber) {
      commitMessage = `Upload image for topic: ${topic}, subtopic: ${subtopic}, question: ${questionNumber}`;
    } else {
      commitMessage = `Upload image ${filePath}`;
    }
    const result = await uploadGitHubImage(REPO_NAME_PIC, filePath, buf, commitMessage);
    // بناء الرابط الخام باستخدام الفرع المحدد
    const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME_PIC}/${BRANCH_PIC}/${filePath}`;
    res.json({ success: true, url: rawUrl, filePath });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 7) Delete file (subtopic or image)
app.delete('/api/delete-file', async (req, res) => {
  const { filePath } = req.query;
  if (!filePath) return res.status(400).json({ success: false, error: 'No filePath param for deletion' });
  
  // تحديد المستودع بحسب مسار الملف
  const repo = filePath.startsWith('pic/') ? REPO_NAME_PIC : REPO_NAME;
  
  try {
    const fileInfo = await getGitHubFile(repo, filePath);
    const sha = fileInfo.sha;
    const r = await deleteGitHubFile(repo, filePath, sha, `Delete file ${filePath}`);
    res.json({ success: true, commit: r.commit });
  } catch (e) {
    if (e.message.includes('404')) {
      return res.json({ success: false, error: 'File not found or already deleted', code: 404 });
    }
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
}
