const express = require('express');
const cors = require('cors');
const path = require('path');

const ucshareHandler = require('./api/ucshare');
const teraboxHandler = require('./api/terabox');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

app.all('/api/ucshare', ucshareHandler);
app.all('/api/terabox', teraboxHandler);

app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'docs.html'));
});

app.get('/505', (req, res) => {
  res.status(505).sendFile(path.join(__dirname, 'public', '505.html'));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Terjadi kesalahan pada server internal.' });
  }
  res.status(500).sendFile(path.join(__dirname, 'public', '500.html'));
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint API tidak ditemukan.' });
  }
  res.status(404).send('Halaman tidak ditemukan');
});

app.listen(PORT, () => {
  console.log(`Server aktif di http://localhost:${PORT}`);
});
