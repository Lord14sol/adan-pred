import fs from 'fs';
import path from 'path';

const DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.adan-pred');
const INTEL_DIR = path.join(DIR, 'intel');

const rawConfig = fs.readFileSync(path.join(DIR, 'config.json'), 'utf8');
const config = JSON.parse(rawConfig);

const parentIntelEntries = [];
if (config?.mesaRedonda?.parents) {
console.log("Found mesaRedonda parents:", config.mesaRedonda.parents.length);
for (const parent of config.mesaRedonda.parents) {
    try {
    const fp = path.join(INTEL_DIR, parent.id + '.json');
    if (fs.existsSync(fp)) {
        const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
        const age = (Date.now() - new Date(d.ts).getTime()) / 60000;
        console.log("Parent", parent.id, "age:", age);
        if (age <= 10) {
        parentIntelEntries.push({
            spec: parent.id,
            name: parent.name,
            role: parent.role,
            intel: { signal: d.signal, intelScore: d.intelScore, ts: d.ts },
            report: d.report || null,
            signal: d.signal,
            isParent: true
        });
        } else { console.log("Too old"); }
    } else { console.log("Missing", fp); }
    } catch(e) { console.log("Error", parent.id, e); }
}
}
console.log("Result:", parentIntelEntries.map(p => p.spec));
