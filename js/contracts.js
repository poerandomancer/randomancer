import { generateChallengeContract } from './15-challenge-engine.js';

const CONTRACT_VERSION = 'v1';
const CADENCES = [
  { cadence: 'daily', severity: 'mild' },
  { cadence: 'weekly', severity: 'cruel' },
  { cadence: 'monthly', severity: 'diabolical' }
];

function isoWeek(date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return { year: day.getUTCFullYear(), week: Math.ceil((((day - yearStart) / 86400000) + 1) / 7) };
}
export function contractPeriod(cadence, now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate();
  if (cadence === 'daily') return { cadence, key: `${y}-${String(m + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, renews: new Date(Date.UTC(y,m,d + 1)) };
  if (cadence === 'monthly') return { cadence, key: `${y}-${String(m + 1).padStart(2,'0')}`, renews: new Date(Date.UTC(y,m + 1,1)) };
  const iso = isoWeek(now); const days = 8 - (now.getUTCDay() || 7);
  return { cadence, key: `${iso.year}-W${String(iso.week).padStart(2,'0')}`, renews: new Date(Date.UTC(y,m,d + days)) };
}
export function seededRandom(seed) {
  let h = 2166136261;
  for (let i=0;i<seed.length;i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6D2B79F5; let t=h; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; };
}
export function renewalLabel(period, now = new Date()) {
  if (period.cadence === 'daily') { const mins=Math.max(0,Math.ceil((period.renews-now)/60000)); return `Renews in ${Math.floor(mins/60)}h ${mins%60}m`; }
  if (period.cadence === 'weekly') return 'Renews Monday';
  return `Renews ${period.renews.toLocaleDateString('en-US',{timeZone:'UTC',month:'long',day:'numeric'})}`;
}
export async function generateContracts(now = new Date()) {
  const result=[];
  for (const config of CADENCES) {
    const period=contractPeriod(config.cadence,now);
    const seed=`contract:${config.cadence}:${period.key}:${CONTRACT_VERSION}`;
    const contract=await generateChallengeContract({severity:config.severity,random:seededRandom(seed)});
    result.push({period,seed,contract});
  }
  return result;
}
