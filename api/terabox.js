const axios = require('axios');

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = async function teraboxHandler(req, res) {
  const targetUrl = req.body?.url || req.query?.url;

  if (!targetUrl) {
    return res.status(400).json({
      error: 'Parameter "url" wajib diisi. Contoh: { "url": "https://1024terabox.com/s/xxxx" }'
    });
  }

  const teraboxRegex = /(terabox\.com|1024terabox\.com|terasharelink\.com|teraboxapp\.com|mirrobox\.com|nephobox\.com|4funbox\.com)\/s\/[a-zA-Z0-9_-]+/i;
  if (!teraboxRegex.test(targetUrl)) {
    return res.status(400).json({
      error: 'URL yang dimasukkan bukan tautan share TeraBox yang valid.'
    });
  }

  try {
    const upstreamApiUrl = `https://flowvideoplayer.com/api/v2/parse?url=${encodeURIComponent(targetUrl)}`;
    
    const response = await axios.get(upstreamApiUrl, {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const data = response.data;

    if (data && Array.isArray(data.Result)) {
      return res.json({
        Result: data.Result.map(item => ({
          filename: item.filename || item.server_filename || 'Video TeraBox',
          size: item.size || 0,
          sizeFormatted: item.sizeFormatted || formatSize(item.size || 0),
          fsId: item.fsId || item.fs_id || null,
          isDir: Boolean(item.isDir),
          thumbUrl: item.thumbUrl || item.thumbs?.url3 || item.thumbs?.url1 || '',
          downloadUrl: item.downloadUrl || item.dlink || '',
          fast_stream_url: item.fast_stream_url || item.m3u8_url || item.downloadUrl || '',
          link_status: item.link_status || (item.fast_stream_url ? 'active' : 'inactive')
        }))
      });
    }

    if (data && Array.isArray(data.list || data.data)) {
      const list = data.list || data.data;
      return res.json({
        Result: list.map(item => ({
          filename: item.filename || item.server_filename || 'Video TeraBox',
          size: item.size || 0,
          sizeFormatted: item.sizeFormatted || formatSize(item.size || 0),
          fsId: item.fs_id || null,
          isDir: Boolean(item.isDir || item.isdir),
          thumbUrl: item.thumbUrl || item.thumbs?.url3 || '',
          downloadUrl: item.downloadUrl || item.dlink || '',
          fast_stream_url: item.fast_stream_url || item.m3u8 || '',
          link_status: item.fast_stream_url ? 'active' : 'inactive'
        }))
      });
    }

    return res.status(404).json({
      error: 'Tidak dapat menemukan konten file dari link TeraBox tersebut.'
    });

  } catch (err) {
    console.error('Error TeraBox API:', err.message);
    return res.status(500).json({
      error: 'Gagal mengambil data dari TeraBox: ' + (err.response?.data?.message || err.message)
    });
  }
};
