const path = require('path');
const fsPromises = require('fs').promises;
const fs = require('fs');

const DATA_DIR   = path.join(__dirname, '..', 'data');
const NOTES_FILE = path.join(DATA_DIR, 'sticky-notes.json');

async function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  try { await fsPromises.access(NOTES_FILE); } catch {
    await fsPromises.writeFile(NOTES_FILE, '[]', 'utf8');
  }
}

exports.getNotes = async (req, res) => {
  try {
    await ensureFile();
    const data = await fsPromises.readFile(NOTES_FILE, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.saveNotes = async (req, res) => {
  try {
    await ensureFile();
    const notes = req.body;
    if (!Array.isArray(notes)) return res.status(400).json({ error: 'Expected array' });
    await fsPromises.writeFile(NOTES_FILE, JSON.stringify(notes), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
