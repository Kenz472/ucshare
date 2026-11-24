const express = require('express');
const cors = require('cors');
const path = require('path');
const ucshareHandler = require('./api/ucshare');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve file statis
app.use(express.static(path.join(__dirname, 'public')));

// Routing API
app.all('/api/ucshare', ucshareHandler);

// Routing Dokumen
app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'docs.html'));
});

// Simulasi 505 (HTTP Version Not Supported)
app.get('/505', (req, res) => {
  res.status(505).sendFile(path.join(__dirname, 'public', '505.html'));
});

// Error handling 500
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).sendFile(path.join(__dirname, 'public', '500.html'));
});

// Fallback 404
app.use((req, res) => {
  res.status(404).send('Halaman tidak ditemukan');
});

app.listen(PORT, () => {
  console.log(`Server aktif di http://localhost:${PORT}`);
});