import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const screenshotRoot = path.join(root, 'store-assets', 'screenshots');
const sourceDir = path.join(screenshotRoot, 'source');
const iphoneDir = path.join(screenshotRoot, 'iphone');
const androidDir = path.join(screenshotRoot, 'android');

const requiredStems = [
  '01_home',
  '02_journal_photos_quote',
  '03_todos',
  '04_calendar',
  '05_friends',
];

function findSource(stem) {
  for (const ext of ['png', 'jpg', 'jpeg']) {
    const filePath = path.join(sourceDir, `${stem}.${ext}`);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

function runSips(args) {
  const result = spawnSync('sips', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'sips failed').trim());
  }

  return result.stdout;
}

function getSize(filePath) {
  const output = runSips(['-g', 'pixelWidth', '-g', 'pixelHeight', filePath]);
  const width = Number(output.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(output.match(/pixelHeight:\s*(\d+)/)?.[1]);

  if (!width || !height) throw new Error(`Could not read image size: ${filePath}`);

  return { width, height };
}

fs.mkdirSync(iphoneDir, { recursive: true });
fs.mkdirSync(androidDir, { recursive: true });

let exportedIphone = 0;
let exportedAndroid = 0;
let missing = 0;

for (const stem of requiredStems) {
  const source = findSource(stem);
  const iphoneOutput = path.join(iphoneDir, `${stem}.png`);
  const androidOutput = path.join(androidDir, `${stem}.png`);

  if (!source) {
    missing += 1;
    console.log(`MISSING source/${stem}.png|jpg|jpeg`);
    continue;
  }

  fs.copyFileSync(source, iphoneOutput);
  runSips(['-s', 'format', 'png', '--resampleHeightWidth', '2796', '1290', iphoneOutput]);
  exportedIphone += 1;
  console.log(`EXPORTED iphone/${stem}.png -> 1290x2796`);

  fs.copyFileSync(source, androidOutput);
  runSips(['-s', 'format', 'png', androidOutput]);
  const { height, width } = getSize(androidOutput);
  const minAndroidWidth = Math.ceil(height / 2);
  const outputWidth = Math.max(width, minAndroidWidth);

  if (outputWidth > width) {
    runSips(['--padToHeightWidth', String(height), String(outputWidth), '--padColor', '10110f', androidOutput]);
  }

  exportedAndroid += 1;
  console.log(`EXPORTED android/${stem}.png -> ${outputWidth}x${height}`);
}

console.log(`Done: ${exportedIphone} iPhone exported, ${exportedAndroid} Android exported, ${missing} missing.`);
