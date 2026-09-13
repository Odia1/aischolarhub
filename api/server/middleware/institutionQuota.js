const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const CACHE_TTL_MS = 10000;
const cache = new Map();
function monthWindow(now = new Date()) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}
function txTokens(tx) {
  if (tx?.tokenType === 'prompt' &&
      (tx?.inputTokens != null || tx?.writeTokens != null || tx?.readTokens != null)) {
    return Math.abs(Number(tx.inputTokens)||0)+Math.abs(Number(tx.writeTokens)||0)+Math.abs(Number(tx.readTokens)||0);
  }
  return Math.abs(Number(tx?.rawAmount)||0);
}
async function getInstitutionMonthlyUsage(tenantId, fresh=false) {
  const id=String(tenantId||'').trim();
  const {start,end}=monthWindow();
  const key=`${id}:${start.toISOString()}`;
  const hit=cache.get(key);
  if (!fresh && hit && Date.now()-hit.at<CACHE_TTL_MS) return hit.value;
  const db=mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not ready');
  const institutions=db.collection('institutions');
  const users=db.collection('users');
  const transactions=db.collection('transactions');
  const [institution,userDocs]=await Promise.all([
    institutions.findOne({_id:id},{projection:{_id:1,name:1,status:1,limits:1}}),
    users.find({tenantId:id},{projection:{_id:1}}).toArray(),
  ]);
  let monthlyTokens=0;
  if (userDocs.length) {
    const cur=transactions.find({
      user:{$in:userDocs.map(u=>u._id)}, createdAt:{$gte:start,$lt:end},
      tokenType:{$in:['prompt','completion']}
    },{projection:{tokenType:1,rawAmount:1,inputTokens:1,writeTokens:1,readTokens:1}});
    for await (const tx of cur) monthlyTokens += txTokens(tx);
  }
  const value={institution,accountCount:userDocs.length,monthlyTokens,periodStart:start,periodEnd:end};
  cache.set(key,{at:Date.now(),value});
  return value;
}
async function institutionTokenQuota(req,res,next) {
  try {
    const tenantId=String(req.user?.tenantId||'').trim();
    if (!tenantId) return next();
    const u=await getInstitutionMonthlyUsage(tenantId);
    const n=Number(u.institution?.limits?.monthlyTokens);
    const limit=Number.isSafeInteger(n)&&n>0?n:null;
    if (!limit || u.monthlyTokens<limit) return next();
    res.set('Retry-After',String(Math.max(1,Math.ceil((u.periodEnd-Date.now())/1000))));
    return res.status(429).json({
      code:'INSTITUTION_MONTHLY_TOKEN_LIMIT',
      error:'Institution monthly token limit reached',
      tenantId, used:u.monthlyTokens, limit, resetAt:u.periodEnd.toISOString()
    });
  } catch (e) {
    logger.error('[institutionTokenQuota]',e);
    return next();
  }
}
module.exports={institutionTokenQuota,getInstitutionMonthlyUsage,txTokens,monthWindow};
