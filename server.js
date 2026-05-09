const app = require('./app');
const http = require('http');
const fs = require('fs');
const path = require('path');
const socketIo = require('socket.io');

const server = http.createServer(app);
const io = socketIo(server);

const secretDir = path.join(__dirname, 'data', 'private');
const secretFile = path.join(secretDir, 'secrets.txt');
const legacySecretFile = path.join(__dirname, 'secret.txt');
const defaultSecrets = {
  DM_PASSWORD: 'CODE',
  PLAYER_PASSWORD: 'PLAY',
};

function parseSecrets(raw) {
  const trimmed = raw.trim();
  if (!trimmed.includes('=')) {
    return { ...defaultSecrets, DM_PASSWORD: trimmed || defaultSecrets.DM_PASSWORD };
  }

  return raw.split(/\r?\n/).reduce((secrets, line) => {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) return secrets;

    const eq = clean.indexOf('=');
    if (eq === -1) return secrets;

    const key = clean.slice(0, eq).trim();
    const value = clean.slice(eq + 1).trim();
    if (key) secrets[key] = value;
    return secrets;
  }, { ...defaultSecrets });
}

function formatSecrets(secrets) {
  return [
    '# Passwords can be edited here or from the Media Library password tab.',
    '# These values stay server-side and are never sent to browser JavaScript.',
    `DM_PASSWORD=${secrets.DM_PASSWORD || defaultSecrets.DM_PASSWORD}`,
    `PLAYER_PASSWORD=${secrets.PLAYER_PASSWORD || defaultSecrets.PLAYER_PASSWORD}`,
    '',
  ].join('\n');
}

function ensureSecretStorage() {
  fs.mkdirSync(secretDir, { recursive: true });

  if (!fs.existsSync(secretFile) && fs.existsSync(legacySecretFile)) {
    try {
      fs.renameSync(legacySecretFile, secretFile);
    } catch {
      fs.copyFileSync(legacySecretFile, secretFile);
      fs.unlinkSync(legacySecretFile);
    }
  }
}

let secrets = { ...defaultSecrets };
try {
  ensureSecretStorage();
  secrets = parseSecrets(fs.readFileSync(secretFile, 'utf8'));
} catch {
  ensureSecretStorage();
  fs.writeFileSync(secretFile, formatSecrets(secrets), 'utf8');
}

const bold = '\x1b[1m';
const green = '\x1b[32m';
const reset = '\x1b[0m';

app.locals.dmPassword = secrets.DM_PASSWORD || defaultSecrets.DM_PASSWORD;
app.locals.playerPassword = secrets.PLAYER_PASSWORD || defaultSecrets.PLAYER_PASSWORD;

console.log(`${bold}Passwords loaded from:${reset} ${secretFile}`);
console.log(`${bold}Project folder:${reset} ${__dirname}`);
console.log(`${bold}Public folder:${reset} ${path.join(__dirname, 'public')}`);
console.log(`${bold}DM Password:${reset} ${green}${app.locals.dmPassword}${reset}`);
console.log(`${bold}Player Password:${reset} ${green}${app.locals.playerPassword}${reset}`);

require('./socketHandler')(io);

function parsePort(value) {
  const port = Number.parseInt(value, 10);
  if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
  return 3000;
}

const PORT = parsePort(process.argv[2] || process.env.PORT);
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
