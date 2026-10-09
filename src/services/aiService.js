const pool = require('../../config/db');

// Rule-based AI disaster assistant. Scores the question against the
// ai_knowledge base by keyword overlap and answers with the best match,
// enriched with live context (active alerts) from the database.
async function ask(question) {
  const q = String(question || '').toLowerCase().trim();
  if (!q) return { answer: 'Please type your question about disaster preparedness, alerts, or how to use this system.', topic: null };

  const [rows] = await pool.query('SELECT topic, keywords, answer, category FROM ai_knowledge');
  let best = null;
  let bestScore = 0;
  for (const row of rows) {
    const keywords = String(row.keywords).toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
    let score = 0;
    for (const kw of keywords) {
      if (q.includes(kw)) score += kw.split(/\s+/).length; // multi-word matches weigh more
    }
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  // Live context: most recent active alerts
  let contextNote = '';
  try {
    const [alerts] = await pool.query(
      `SELECT a.title, a.severity FROM alerts a
       WHERE a.status = 'sent'
         AND (a.expires_at IS NULL OR a.expires_at > NOW())
       ORDER BY a.sent_at DESC, a.id DESC LIMIT 3`);
    if (alerts.length) {
      contextNote =
        '\n\nActive alerts right now:\n' +
        alerts.map(a => `• [${a.severity.toUpperCase()}] ${a.title}`).join('\n');
    } else {
      contextNote = '\n\nThere are currently no active alerts for the municipality.';
    }
  } catch { /* context is optional */ }

  if (!best || bestScore === 0) {
    // Greetings / unrecognized
    if (/^(hi|hello|hey|good (morning|afternoon|evening))/.test(q)) {
      return {
        answer: 'Hello! I am the MDAS Disaster Assistant. Ask me about flood, typhoon, earthquake, fire or landslide preparedness, go-bags, evacuation centers, risk levels, missing persons, or how to report an incident.' + contextNote,
        topic: 'greeting'
      };
    }
    return {
      answer:
        'I can help with disaster preparedness and this system. Try asking, for example: "What should I do before a flood?", "What is in a go-bag?", "Where are the evacuation centers?", or "How do I report an incident?"' + contextNote,
      topic: null
    };
  }

  return { answer: best.answer + contextNote, topic: best.topic, category: best.category };
}

module.exports = { ask };
