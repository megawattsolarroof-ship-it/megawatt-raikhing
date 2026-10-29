'use strict';
const {put,get,head} = require('@vercel/blob');
const jpeg = require('jpeg-js');
const config = require('./evidence-config.json');
const normalize = value => String(value||'').normalize('NFC').trim().replace(/\s+/g,' ');

// Private evidence only: this route never returns image bytes or signed read URLs.
module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
  const origin=req.headers.origin;
  if(origin && ![...config.origins,'https://'+process.env.VERCEL_URL].includes(origin))return res.status(403).json({error:'origin_not_allowed'});
  let body;
  try {body=typeof req.body==='string'?JSON.parse(req.body):req.body;} catch {return res.status(400).json({error:'bad_request'});}
  if(!body || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.id||'') ||
    typeof body.name!=='string' || body.name.length>200 || typeof body.jpeg!=='string' || body.jpeg.length>350000 ||
    !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(body.jpeg) || typeof (body.key||'')!=='string' || (body.key||'').length>512)
    return res.status(400).json({error:'bad_request'});
  try {
    // Fixed branch upstream; a client cannot choose another backend or another branch.
    const url=new URL(config.upstream);url.search=new URLSearchParams({action:'getKnownFaces',key:body.key||'',...(config.site?{site:config.site}:{})}).toString();
    const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
    if(!response.ok)return res.status(503).json({error:'roster_unavailable'});
    const rows=await response.json();
    if(!Array.isArray(rows))return res.status(403).json({error:'not_authorized'});
    const matches=[...new Set(rows.filter(r=>r&&typeof r.label==='string'&&normalize(r.label)===normalize(body.name)).map(r=>r.label.trim()))];
    if(matches.length!==1)return res.status(400).json({error:'unknown_employee'});
    let encoded;
    try {
      const bytes=Buffer.from(body.jpeg.split(',')[1],'base64');
      const decoded=jpeg.decode(bytes,{useTArray:true,maxResolutionInMP:1,maxMemoryUsageInMB:32});
      if(decoded.width<64 || decoded.height<64 || decoded.width>640 || decoded.height>640)throw Error('dimensions');
      encoded=jpeg.encode(decoded,80).data;
    } catch {return res.status(400).json({error:'invalid_image'});}
    // Bind an immutable image to the original name. Use the UUID as the stable upload key.
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const pathname='evidence/'+config.branch+'/'+date+'/'+body.id.toLowerCase()+'.jpg';
    // Unique paths never overwrite evidence. Retry verifies the same bytes via a hash in the receipt.
    const {createHash}=require('node:crypto');
    const digest=createHash('sha256').update(encoded).update(matches[0]).digest('hex');
    const receiptPath=pathname+'.json';
    const description=JSON.stringify({branch:config.branch,name:matches[0],receivedAt:new Date().toISOString(),kind:'manual-photo-not-face-verified',sha256:digest});
    try {
      await put(receiptPath,description,{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json'});
    } catch(error) {
      const old=await get(receiptPath,{access:'private',useCache:false});
      if(!old || old.statusCode!==200)throw error;
      const receipt=await new Response(old.stream).json();
      if(receipt.sha256!==digest)return res.status(409).json({error:'upload_conflict'});
    }
    try {
      await put(pathname,encoded,{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'image/jpeg'});
    } catch(error) {
      const existing=await head(pathname);
      if(existing.size!==encoded.length)throw error;
    }
    return res.status(200).json({status:'stored',reference:pathname});
  } catch {return res.status(503).json({error:'evidence_unavailable'});}
};
