import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const screenshotDir = path.join(root, 'store-assets', 'screenshots');

const requiredScreenshots = [
  ['01_home', '首页确认活着'],
  ['02_journal_photos_quote', '随笔、照片和每日箴言'],
  ['03_todos', '今天最想做的三件事'],
  ['04_calendar', '打卡日历'],
  ['05_friends', '好友存活雷达'],
];

function readUInt32(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function getPngSize(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') return null;
  return {
    width: readUInt32(buffer, 16),
    height: readUInt32(buffer, 20),
    type: 'png',
  };
}

function getJpegSize(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return null;

    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

    if (isStartOfFrame) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
        type: 'jpeg',
      };
    }

    offset += 2 + length;
  }

  return null;
}

function getImageSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  return getPngSize(buffer) ?? getJpegSize(buffer);
}

function findScreenshot(dir, stem) {
  for (const ext of ['png', 'jpg', 'jpeg']) {
    const filePath = path.join(dir, `${stem}.${ext}`);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

function checkOnePlatform(platform) {
  const dir = path.join(screenshotDir, platform);
  const lines = [];
  let missing = 0;
  let warnings = 0;

  for (const [stem, label] of requiredScreenshots) {
    const filePath = findScreenshot(dir, stem);

    if (!filePath) {
      missing += 1;
      lines.push(`- MISSING ${stem}: ${label}`);
      continue;
    }

    const size = getImageSize(filePath);
    if (!size) {
      warnings += 1;
      lines.push(`- WARN ${stem}: unsupported image format`);
      continue;
    }

    const portrait = size.height > size.width;
    const minSide = Math.min(size.width, size.height);
    const maxSide = Math.max(size.width, size.height);
    const googleBasicOk = minSide >= 320 && maxSide <= 3840 && maxSide <= minSide * 2;
    const googleRecommendedOk = portrait && size.width >= 1080 && size.height >= 1920;
    const appleUsefulSize = portrait && size.width >= 1080 && size.height >= 1920;

    if (!portrait) warnings += 1;
    if (platform === 'android' && !googleBasicOk) warnings += 1;

    lines.push(
      [
        `- OK ${stem}: ${label}`,
        `${size.width}x${size.height}`,
        size.type,
        portrait ? 'portrait' : 'not portrait',
        platform === 'android' ? `Google basic ${googleBasicOk ? 'OK' : 'WARN'}` : null,
        platform === 'android' ? `Google recommended ${googleRecommendedOk ? 'OK' : 'optional'}` : null,
        platform === 'iphone' ? `App Store large-screen useful ${appleUsefulSize ? 'OK' : 'check exact accepted size'}` : null,
      ]
        .filter(Boolean)
        .join(' | '),
    );
  }

  return { lines, missing, warnings };
}

for (const platform of ['iphone', 'android']) {
  const result = checkOnePlatform(platform);
  console.log(`\n${platform.toUpperCase()}`);
  console.log(result.lines.join('\n'));
  console.log(`Summary: ${result.missing} missing, ${result.warnings} warnings`);
}

