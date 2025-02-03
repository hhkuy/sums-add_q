// server.js
const express = require('express');
const fetch = require('node-fetch');
const FormData = require('form-data');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const IMAGE_API_KEY = process.env.IMAGE_API_KEY;

// Helpers
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
  return await res.json();
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
  if(!res.ok){
    throw new Error(`updateGitHubFile failed: ${res.status} - ${res.statusText}`);
  }
  return await res.json();
}

// رفع الصور
async function uploadToImgHippo(fileBuffer, fileName) {
  if(!IMAGE_API_KEY){
    throw new Error("No IMAGE_API_KEY found");
  }
  const form = new FormData();
  form.append("api_key", IMAGE_API_KEY);
  form.append("file", fileBuffer, fileName);

  const res = await fetch("https://api.imghippo.com/v1/upload", {
    method:"POST",
    headers:{Accept:"application/json"},
    body:form
  });
  if(!res.ok){
    throw new Error(`uploadToImgHippo failed: ${res.status} - ${res.statusText}`);
  }
  const json=await res.json();
  if(json.success && json.data && json.data.url){
    return json.data.url;
  } else {
    throw new Error("ImgHippo upload error:"+ JSON.stringify(json));
  }
}

// Routes
app.get('/api/test',(req,res)=>{
  res.json({message:"Server up, reordering topics/subtopics"});
});

// 1) load topics
app.get('/api/topics', async(req,res)=>{
  try{
    const info=await getGitHubFile('data/topics.json');
    const dec=Buffer.from(info.content,'base64').toString('utf-8');
    const topics=JSON.parse(dec);
    res.json({success:true, topics, sha:info.sha});
  }catch(e){
    res.status(500).json({success:false,error:e.message});
  }
});

// 2) save topics
app.post('/api/topics', async(req,res)=>{
  const {topics, sha}=req.body;
  if(!Array.isArray(topics)||!sha){
    return res.status(400).json({success:false,error:'Invalid data for topics'});
  }
  try{
    const content=JSON.stringify(topics,null,2);
    const up=await updateGitHubFile('data/topics.json',content,sha,'Save topics');
    res.json({success:true, commit:up.commit});
  }catch(e){
    res.status(500).json({success:false,error:e.message});
  }
});

// 3) get subtopic file
app.get('/api/get-subtopic-file', async(req,res)=>{
  const path=req.query.path;
  if(!path)return res.status(400).json({success:false,error:'No path param'});
  try{
    const info=await getGitHubFile(path);
    const dec=Buffer.from(info.content,'base64').toString('utf-8');
    let arr; try{arr=JSON.parse(dec);}catch(e){arr=[];}
    if(!Array.isArray(arr)) arr=[];
    res.json({success:true, content:arr, sha:info.sha});
  }catch(e){
    if(e.message.includes('404')) return res.json({success:true, content:[], sha:null});
    res.status(500).json({success:false,error:e.message});
  }
});

// 4) update subtopic file
app.post('/api/update-subtopic-file', async(req,res)=>{
  const {path, content, sha}=req.body;
  if(!path||!content) return res.status(400).json({success:false,error:'Missing path or content'});
  try{
    const finalStr=JSON.stringify(content,null,2);
    const r=await updateGitHubFile(path, finalStr, sha||'','Update subtopic');
    res.json({success:true, commit:r.commit});
  }catch(e){
    res.status(500).json({success:false,error:e.message});
  }
});

// 5) delete prefix
app.post('/api/delete-questions-by-prefix', async(req,res)=>{
  const {path, sha, prefix}=req.body;
  if(!path||!sha||!prefix)return res.status(400).json({success:false,error:'Missing data'});
  try{
    const info=await getGitHubFile(path);
    const dec=Buffer.from(info.content,'base64').toString('utf-8');
    let arr=JSON.parse(dec); if(!Array.isArray(arr))arr=[];
    let newArr=arr.filter(q=>!q.question.includes(prefix));
    const finalStr=JSON.stringify(newArr,null,2);
    const up=await updateGitHubFile(path, finalStr, sha,'Delete by prefix');
    res.json({success:true, commit:up.commit,deletedCount:arr.length-newArr.length});
  }catch(e){
    res.status(500).json({success:false,error:e.message});
  }
});

// 6) upload image
app.post('/api/upload-image', async(req,res)=>{
  const {name, base64}=req.body;
  if(!base64)return res.status(400).json({success:false,error:'No base64'});
  try{
    const buf=Buffer.from(base64,'base64');
    const url=await uploadToImgHippo(buf,name||'uploaded.jpg');
    res.json({success:true,url});
  }catch(e){
    res.status(500).json({success:false,error:e.message});
  }
});

module.exports=app;
