// app.js
const express = require('express');
const path = require('path');
const app = express();

// Required modules
const session = require('express-session');
const crypto = require('crypto');

function generateSecret(length = 64) {
  return crypto.randomBytes(length).toString('hex');
}

const sessionSecret = process.env.SESSION_SECRET || generateSecret();

// Session setup
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false
}));

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For parsing form data
app.use((req, res, next) => {
  if (req.path === '/index.html') return res.redirect('/');
  if (req.path === '/dm.html') return res.redirect('/dm');
  if (req.path === '/files.html') return res.redirect('/files');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  setHeaders(res, filePath) {
    if (/\.(html|css|js)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
    }
  },
}));

// Routes
const routes = require('./routes');
app.use('/', routes);

module.exports = app;
