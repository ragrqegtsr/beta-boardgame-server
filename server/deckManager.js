// server/deckManager.js
function partitionMisc(misc) {
  const bonus = [];
  const contrainte = [];
  for (const n of misc) {
    const pile = (n.pile || '').toLowerCase();
    if (pile === 'bonus') bonus.push(n);
    else if (pile === 'contrainte') contrainte.push(n);
    else {
      if (n.tags?.includes('contrainte')) contrainte.push(n);
      else bonus.push(n);
    }
  }
  return { bonus, contrainte };
}

function randomFrom(arr, excludeIds = new Set()) {
  const pool = arr.filter(n => !excludeIds.has(n.id));
  const src = pool.length ? pool : arr;
  const idx = Math.floor(Math.random() * src.length);
  return src[idx];
}

function drawCommonCards(session, decks) {
  const { bonus, contrainte } = partitionMisc(decks.misc);
  const ev = randomFrom(decks.events, session.exclusions.eventIds);
  const bo = randomFrom(bonus, session.exclusions.miscBonusIds);
  const co = randomFrom(contrainte, session.exclusions.miscContrainteIds);

  session.exclusions.eventIds.add(ev.id);
  session.exclusions.miscBonusIds.add(bo.id);
  session.exclusions.miscContrainteIds.add(co.id);

  session.commonDraw = {
    bonus: { id: bo.id, title: bo.title, slug: bo.slug, category: bo.category },
    contrainte: { id: co.id, title: co.title, slug: co.slug, category: co.category },
    evenement: { id: ev.id, title: ev.title, slug: ev.slug, category: ev.category },
  };
  return session.commonDraw;
}

module.exports = { drawCommonCards };
