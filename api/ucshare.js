const axios = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36';
const BACKEND_NYA = 'https://m-intldrive.ucweb.com/1/clouddrive/share/sharepage/video_preview';

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function formatDuration(seconds) {
  if (!seconds) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDate(ts) {
  if (!ts) return '-';
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

function safeDecode(str) {
  if (!str) return str;
  try {
    return str.includes('%') ? decodeURIComponent(str) : str;
  } catch {
    return str;
  }
}

function isVideoFile(item) {
  if (item.obj_category === 'video') return true;
  if (typeof item.format_type === 'string' && item.format_type.toLowerCase().includes('video')) return true;
  return /\.(mp4|mov|mkv|avi|webm|3gp|flv|m4v)$/i.test(item.file_name || '');
}

function formatItems(list) {
  const files = list
    .filter(item => !item.dir)
    .map((item, i) => ({
      no: i + 1,
      file_name: item.file_name,
      fid: item.fid,
      size: item.size,
      size_formatted: formatSize(item.size),
      type: item.format_type || '-',
      category: item.obj_category || '-',
      is_video: isVideoFile(item),
      duration: item.duration || 0,
      duration_formatted: formatDuration(item.duration),
      resolution: item.video_max_resolution || '-',
      thumbnail: item.thumbnail || null,
      created_at: formatDate(item.created_at),
      share_fid_token: item.share_fid_token,
    }));

  const folders = list
    .filter(item => item.dir)
    .map(item => ({
      name: item.file_name,
      fid: item.fid,
      items_count: item.include_items || 0,
    }));

  return { files, folders };
}

function extractInitialProps(html) {
  const start = html.indexOf('window.__INITIAL_PROPS__');
  if (start === -1) return null;

  const braceStart = html.indexOf('{', start);
  if (braceStart === -1) return null;

  let depth = 0, inStr = false, esc = false;
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(braceStart, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function findStoken(html, props) {
  const candidates = [
    props?.initialData?.stokenDetail?.stoken,
    props?.initialData?.shareDetail?.stoken,
    props?.initialData?.shareDetail?.share?.stoken,
    props?.initialData?.shareInfo?.stoken,
  ];
  for (const c of candidates) {
    if (c) return safeDecode(c);
  }
  const m = html.match(/"stoken"\s*:\s*"([^"]+)"/);
  if (m) return safeDecode(m[1]);
  return null;
}

function parseFromJson(props) {
  if (!props?.initialData) return null;

  try {
    const data = props.initialData;
    const share = data.shareDetail?.share || {};
    const list = data.shareDetail?.list || [];
    const author = data.stokenDetail?.author || {};

    const { files, folders } = formatItems(list);

    return {
      success: true,
      method: 'json_extract',
      share: {
        title: share.title || data.stokenDetail?.title,
        pwd_id: share.pwd_id,
        share_url: share.share_url,
        author: author.nick_name || '-',
        file_num: share.file_num || list.length,
        total_size_formatted: formatSize(share.size),
        expired_at: formatDate(share.expired_at),
        is_permanent: share.expired_type === 1,
        created_at: formatDate(share.created_at),
      },
      folders,
      files,
      total_files: files.length,
      total_folders: folders.length,
    };
  } catch {
    return null;
  }
}

function parseFromHtml(html) {
  const $ = cheerio.load(html);

  const title = $('meta[property="og:title"]').attr('content')?.replace(' - Pembagian UC Drive', '').trim()
    || $('title').text().replace(' - Pembagian UC Drive', '').trim()
    || '-';

  const author = $('.author-name').text().replace('Dibagikan oleh', '').trim() || '-';

  const files = [];
  $('.file-item').each((i, el) => {
    const name = $(el).find('.item-tit').attr('title') || $(el).find('.item-tit').text().trim();
    const subs = $(el).find('.item-sub-tit span');
    const date = $(subs[0]).text().trim();
    const sizeOrCount = $(subs[1]).text().trim();
    const isFolder = /items?/i.test(sizeOrCount);

    files.push({
      no: i + 1,
      file_name: name,
      date,
      size: isFolder ? null : sizeOrCount,
      is_folder: isFolder,
      items_count: isFolder ? parseInt(sizeOrCount) || 0 : null,
    });
  });

  return {
    success: true,
    method: 'html_parse',
    share: { title, author },
    files,
    total_files: files.filter(f => !f.is_folder).length,
    total_folders: files.filter(f => f.is_folder).length,
  };
}

async function getFolderDetail({ pwd_id, stoken, pdir_fid, shareUrl }) {
  const apis = [
    'https://m-intldrive.ucweb.com/1/clouddrive/share/sharepage/v2/detail',
    'https://m-intldrive.ucweb.com/1/clouddrive/share/sharepage/detail'
  ];

  const params = {
    pr: 'UCBrowser',
    fr: 'h5',
    __t: Date.now(),
    pwd_id,
    stoken,
    pdir_fid: pdir_fid || '0',
    force: 0,
    _page: 1,
    _size: 100,
    _fetch_total: 1,
    _sort: 'file_type:asc,updated_at:desc'
  };

  for (const api of apis) {
    try {
      const { data } = await axios.get(api, {
        params,
        headers: {
          'User-Agent': UA,
          'Accept': 'application/json, text/plain, */*',
          'Referer': shareUrl,
          'Origin': 'https://uc-share.com',
        },
        timeout: 15000,
      });

      if (data?.code === 0 && Array.isArray(data?.data?.list)) {
        return data.data.list;
      }
    } catch {}
  }

  return [];
}

async function getVideoPreview({ pwd_id, stoken, fid, fid_token, path_no, shareUrl }) {
  const params = {
    pr: 'UCBrowser',
    fr: 'h5',
    __t: Date.now(),
    pwd_id,
    stoken,
    fid,
    fid_token,
  };
  if (path_no) params.path_no = path_no;

  const { data } = await axios.get(BACKEND_NYA, {
    params,
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json, text/plain, */*',
      'Referer': shareUrl,
      'Origin': 'https://uc-share.com',
    },
    timeout: 20000,
  });

  if (data?.code !== 0 || !data?.data?.play_info?.url) {
    throw new Error(`video_preview gagal: code=${data?.code} msg=${data?.message || '-'}`);
  }

  const play = data.data.play_info;
  return {
    video_url: play.url,
    thumbnail_url: data.data.preview_url || null,
    duration: formatDuration(play.duration),
    size_formatted: formatSize(play.size),
    raw_size: play.size || 0,
    resolution: play.width && play.height ? `${play.width}x${play.height}` : '-',
    bitrate: play.bitrate,
    codec: play.codec,
  };
}

async function ucshare(url, { pdir_fid = null, getPreview = true } = {}) {
  let targetUrl = url.trim();
  if (!targetUrl.startsWith('http')) {
    targetUrl = `https://uc-share.com/s/${targetUrl}`;
  }

  if (!targetUrl.includes('la=')) {
    const separator = targetUrl.includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${separator}la=id`;
  }

  const { data: html } = await axios.get(targetUrl, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
    },
    timeout: 20000,
    maxRedirects: 5,
  });

  const props = extractInitialProps(html);
  let result = parseFromJson(props) || parseFromHtml(html);

  if (!result) {
    return { success: false, error: 'Failed to parse page', url: targetUrl };
  }

  result.url = targetUrl;
  result.videos = [];

  const pwd_id = result.share?.pwd_id || targetUrl.match(/\/s\/([^/?#]+)/)?.[1];
  const stoken = findStoken(html, props);

  let targetPdirFid = pdir_fid || targetUrl.match(/[?&]pdir_fid=([^&#]+)/)?.[1];

  if (!targetPdirFid && result.files.length === 0 && result.folders.length > 0) {
    targetPdirFid = result.folders[0].fid;
  }

  if (targetPdirFid && pwd_id && stoken) {
    const subList = await getFolderDetail({
      pwd_id,
      stoken,
      pdir_fid: targetPdirFid,
      shareUrl: targetUrl,
    });

    if (subList.length > 0) {
      const parsed = formatItems(subList);
      result.active_folder_fid = targetPdirFid;
      result.files = parsed.files;
      result.total_files = parsed.files.length;
      if (parsed.folders.length > 0) {
        result.sub_folders = parsed.folders;
      }
    }
  }

  if (!getPreview) return result;

  const videos = (result.files || []).filter(f => f.is_video && f.fid);

  if (videos.length === 0) {
    result.note = 'Tidak ada file video dengan fid.';
    return result;
  }

  if (!stoken) {
    result.note = 'stoken tidak ditemukan di halaman.';
    return result;
  }

  for (const v of videos) {
    try {
      const preview = await getVideoPreview({
        pwd_id,
        stoken,
        fid: v.fid,
        fid_token: v.share_fid_token,
        shareUrl: targetUrl,
      });

      result.videos.push({
        file_name: v.file_name,
        original_size: v.size || preview.raw_size,
        ...preview,
      });
    } catch (e) {
      result.videos.push({ file_name: v.file_name, error: e.message });
    }
  }

  return result;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const url = req.method === 'POST' ? req.body?.url : req.query?.url;
    const pdir_fid = req.method === 'POST' ? req.body?.pdir_fid : req.query?.pdir_fid;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Parameter URL wajib disertakan (contoh: ?url=https://uc-share.com/s/xxxx)'
      });
    }

    const data = await ucshare(url, { pdir_fid });
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal Server Error'
    });
  }
};
