'use strict';
const {list,del}=require('@vercel/blob');
const {timingSafeEqual}=require('node:crypto');
const {branch}=require('./evidence-config.json');
const RETENTION_DAYS=30;

module.exports=async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
  const secret=process.env.CRON_SECRET;
  if(!secret || secret.length<32)return res.status(503).json({error:'cleanup_not_configured'});
  const actual=Buffer.from(String(req.headers.authorization||'')),expected=Buffer.from('Bearer '+secret);
  if(actual.length!==expected.length || !timingSafeEqual(actual,expected))return res.status(401).json({error:'unauthorized'});
  if(!/^[a-z0-9_-]+$/.test(branch))return res.status(503).json({error:'invalid_branch'});
  const prefix='evidence/'+branch+'/';
  const validPath=new RegExp('^'+prefix+'\\d{4}-\\d{2}-\\d{2}/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\\.jpg(?:\\.json)?$');
  const started=Date.now(),cutoff=started-RETENTION_DAYS*24*60*60*1000;
  const groups=new Map();let cursor,hasMore=true,scanned=0,deleted=0;
  try {
    // Finish listing before deleting so mutation cannot move the pagination boundary.
    for(let page=0;page<20 && hasMore;page++) {
      const batch=await list({prefix,limit:1000,...(cursor?{cursor}:{})});
      for(const blob of batch.blobs) {
        scanned++;
        if(!validPath.test(blob.pathname))continue;
        const key=blob.pathname.replace(/\.json$/,'');
        const group=groups.get(key)||{paths:[],newest:0};
        const timestamp=new Date(blob.uploadedAt).getTime();
        group.newest=Math.max(group.newest,Number.isFinite(timestamp)?timestamp:Infinity);
        group.paths.push(blob.pathname);groups.set(key,group);
      }
      hasMore=batch.hasMore;
      if(hasMore && (!batch.cursor || batch.cursor===cursor))throw Error('invalid_cursor');
      cursor=batch.cursor;
      if(hasMore && Date.now()-started>25000)throw Error('listing_incomplete');
    }
    if(hasMore)throw Error('listing_incomplete');
    const expired=[...groups.values()].filter(group=>group.newest<cutoff);
    // A companion received more recently protects the entire evidence pair.
    const targets=[];let remaining=false;
    for(const group of expired) {
      if(targets.length+group.paths.length>1000){remaining=true;continue;}
      targets.push(...group.paths);
    }
    const dryRun=process.env.VERCEL_ENV!=='production';
    if(!dryRun) {
      for(let i=0;i<targets.length;i+=100) {
        if(Date.now()-started>50000)throw Error('cleanup_incomplete');
        const batch=targets.slice(i,i+100);await del(batch);deleted+=batch.length;
      }
    }
    return res.status(200).json({retentionDays:RETENTION_DAYS,scanned,expiredFiles:targets.length,deleted,dryRun,remaining});
  } catch {
    console.error('attendance-evidence-cleanup-failed',{scanned,deleted});
    return res.status(503).json({error:'cleanup_incomplete',scanned,deleted});
  }
};
