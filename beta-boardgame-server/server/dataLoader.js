// server/dataLoader.js
const fs = require('fs');
const path = require('path');

const REQUIRED = [
  'deck_events.fr.v11.json',
  'deck_misc.fr.v11.json',
  'deck_logic.v11.after_duration_patches.v2.json',
  'tools.v2.json',
  'profiles_fr.json',
];

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function ensureUniqueIds(items, fileName) {
  const seen = new Set();
  for (const it of items) {
    const id = it.id ?? it.ID ?? it.key ?? it.slug;
    if (id == null) throw new Error(`[dataLoader] ${fileName} → missing id/slug on node`);
    if (seen.has(id)) throw new Error(`[dataLoader] ${fileName} → duplicate id/slug: ${id}`);
    seen.add(id);
  }
}

function verifyPiles(nodes, fileName, expectedPile) {
  for (const n of nodes) {
    if (n.pile && n.pile !== expectedPile && !(expectedPile === 'Misc' && (n.pile === 'Bonus' || n.pile === 'Contrainte'))) {
      throw new Error(`[dataLoader] ${fileName} → node ${n.id} has pile=${n.pile}, expected ${expectedPile}`);
    }
  }
}

function loadAll(dataDir = path.resolve(process.cwd(), 'data')) {
  for (const f of REQUIRED) {
    const p = path.join(dataDir, f);
    if (!fs.existsSync(p)) throw new Error(`[dataLoader] Missing required file: ${f} in ${dataDir}`);
  }

  const events = readJSON(path.join(dataDir, 'deck_events.fr.v11.json'));
  const misc = readJSON(path.join(dataDir, 'deck_misc.fr.v11.json'));
  const logic = readJSON(path.join(dataDir, 'deck_logic.v11.after_duration_patches.v2.json'));
  const tools = readJSON(path.join(dataDir, 'tools.v2.json'));
  const profiles = readJSON(path.join(dataDir, 'profiles_fr.json'));

  const eventNodes = Array.isArray(events.nodes) ? events.nodes : events;
  const miscNodes = Array.isArray(misc.nodes) ? misc.nodes : misc;

  ensureUniqueIds(eventNodes, 'deck_events');
  ensureUniqueIds(miscNodes, 'deck_misc');
  verifyPiles(eventNodes, 'deck_events', 'Événement');

  if (Array.isArray(profiles)) ensureUniqueIds(profiles, 'profiles');

  return { events: eventNodes, misc: miscNodes, logic, tools, profiles };
}

module.exports = { loadAll };
