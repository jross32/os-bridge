'use strict';

const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text);
}

function safeReadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writePngBase64(filePath, base64Data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
}

module.exports = {
  ensureDir,
  writeJson,
  writeText,
  safeReadJson,
  writePngBase64,
};
